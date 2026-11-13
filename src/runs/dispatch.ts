/**
 * Dispatch payload: everything the supervisor needs to run a workflow without
 * reading its own cwd or environment. Resolved by the client and stored in the
 * run directory (`dispatch.json`) so a resume uses the same inputs.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.js";

export interface DispatchPayload {
	/** Absolute repository root of the dispatching client. */
	repo_root: string;
	workflow: {
		/** Absolute path of the resolved workflow file. */
		path: string;
		/** File contents at dispatch time. */
		contents: string;
	};
	/** Config resolved by the client (defaults -> global -> local). */
	config: Record<string, unknown>;
	/** Allowlisted client environment. */
	env: Record<string, string>;
	variables: Record<string, unknown>;
	runtime?: string | null;
	from_step?: string | null;
	slug?: string | null;
	terminal_output?: string | null;
	/** Higher runs first. Defaults to 0. */
	priority?: number;
	/** `--ignore-requires`: run despite an unmet agentic-forge version (never the contract). */
	ignore_requires?: boolean;
	/** Parent run id (`run.json` `parent`), for example the overseer run that dispatched it. */
	parent?: string | null;
}

/** Variables always forwarded (needed to spawn processes and find tools). */
const ENV_EXACT = new Set([
	"PATH",
	"PATHEXT",
	"HOME",
	"USERPROFILE",
	"HOMEDRIVE",
	"HOMEPATH",
	"APPDATA",
	"LOCALAPPDATA",
	"PROGRAMDATA",
	"PROGRAMFILES",
	"PROGRAMFILES(X86)",
	"SYSTEMROOT",
	"SYSTEMDRIVE",
	"WINDIR",
	"COMSPEC",
	"TEMP",
	"TMP",
	"TMPDIR",
	"USER",
	"USERNAME",
	"LOGNAME",
	"SHELL",
	"LANG",
	"LC_ALL",
	"TERM",
	"XDG_CONFIG_HOME",
	"XDG_DATA_HOME",
	"XDG_CACHE_HOME",
	"XDG_RUNTIME_DIR",
	"SSH_AUTH_SOCK",
	"GITHUB_TOKEN",
	"AGENTIC_FORGE_HOME",
	"AF_DEBUG_SPAWN",
]);

/** Prefixes always forwarded (runtime auth and config). */
const ENV_PREFIXES = [
	"CLAUDE_",
	"CODEX_",
	"GH_",
	"ANTHROPIC_",
	"OPENAI_",
	"GIT_AUTHOR_",
	"GIT_COMMITTER_",
	"GIT_SSH",
];

/**
 * Returns the allowlisted subset of `env`: the built-in names and prefixes,
 * plus `extra` names (config `supervisor.env_passthrough`). Names compare
 * case-insensitively; the original casing is kept.
 */
export function filterEnv(
	env: NodeJS.ProcessEnv,
	extra: readonly string[] = [],
): Record<string, string> {
	const extraSet = new Set(extra.map((n) => n.toUpperCase()));
	const out: Record<string, string> = {};
	for (const [name, value] of Object.entries(env)) {
		if (value === undefined) continue;
		const upper = name.toUpperCase();
		if (
			ENV_EXACT.has(upper) ||
			extraSet.has(upper) ||
			ENV_PREFIXES.some((p) => upper.startsWith(p))
		) {
			out[name] = value;
		}
	}
	return out;
}

/** Reads `supervisor.env_passthrough` from a config snapshot. */
export function getEnvPassthrough(config: Record<string, unknown>): string[] {
	const supervisor = config.supervisor as Record<string, unknown> | undefined;
	const list = supervisor?.env_passthrough;
	return Array.isArray(list) ? list.filter((n): n is string => typeof n === "string") : [];
}

export interface BuildDispatchOptions {
	/** Resolved workflow file (relative paths resolve against `repoRoot`). */
	workflowPath: string;
	/** Repository root of the dispatching client (config and project workflows). */
	repoRoot: string;
	variables: Record<string, unknown>;
	runtime?: string | null;
	slug?: string | null;
	/** Queue priority; omitted from the payload when undefined (the supervisor uses 0). */
	priority?: number;
	fromStep?: string | null;
	/** Terminal output level; null lets the workflow settings decide. */
	terminalOutput?: string | null;
	/** Client environment to filter (defaults to `process.env`). */
	env?: NodeJS.ProcessEnv;
	/** Run despite an unmet `requires` version; omitted from the payload when false. */
	ignoreRequires?: boolean;
	/** Parent run id; omitted from the payload when unset. */
	parent?: string | null;
}

/**
 * Builds the payload of `POST /v1/runs` for a resolved workflow file: reads the
 * workflow contents, the config of `repoRoot` and the allowlisted environment.
 * Shared by `af run` and the MCP `af_dispatch` tool. Throws when the workflow
 * file cannot be read.
 */
export function buildDispatchPayload(options: BuildDispatchOptions): DispatchPayload {
	const workflowPath = path.resolve(options.repoRoot, options.workflowPath);
	const config = loadConfig(options.repoRoot);
	const payload: DispatchPayload = {
		repo_root: options.repoRoot,
		workflow: { path: workflowPath, contents: readFileSync(workflowPath, "utf-8") },
		config,
		env: filterEnv(options.env ?? process.env, getEnvPassthrough(config)),
		variables: options.variables,
		runtime: options.runtime ?? null,
		from_step: options.fromStep ?? null,
		slug: options.slug ?? null,
		terminal_output: options.terminalOutput ?? null,
	};
	if (options.priority !== undefined) payload.priority = options.priority;
	if (options.ignoreRequires) payload.ignore_requires = true;
	if (options.parent) payload.parent = options.parent;
	return payload;
}

/** Validates a dispatch payload received over IPC; returns an error message or null. */
export function validateDispatch(body: unknown): string | null {
	if (typeof body !== "object" || body === null) return "Body must be a JSON object";
	const p = body as Partial<DispatchPayload>;
	if (typeof p.repo_root !== "string" || p.repo_root.length === 0) return "repo_root is required";
	if (
		typeof p.workflow !== "object" ||
		p.workflow === null ||
		typeof p.workflow.path !== "string" ||
		typeof p.workflow.contents !== "string"
	) {
		return "workflow.path and workflow.contents are required";
	}
	if (typeof p.config !== "object" || p.config === null) return "config is required";
	if (typeof p.env !== "object" || p.env === null) return "env is required";
	if (typeof p.variables !== "object" || p.variables === null) return "variables is required";
	if (p.parent != null && (typeof p.parent !== "string" || p.parent.length === 0)) {
		return "parent must be a run id";
	}
	return null;
}
