/**
 * `af overseer`: opens (or reopens) an overseer run in the supervisor, then
 * starts an interactive `claude` session with the bundled `af-overseer`
 * plugin (the overseer skill), the af MCP server (`--mcp-config`) and the
 * overseer run directory. `--finish` ends an overseer run.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { filterEnv, getEnvPassthrough } from "../runs/dispatch.js";
import type { OverseerOpenResult, OverseerPayload } from "../runs/overseer.js";
import { getExecutable, resolveCmdScript } from "../runtimes/utils.js";
import type { SupervisorClient } from "../supervisor/client.js";
import { CliExitError } from "./run.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Name of the af MCP server in the overseer's MCP config (tools are `mcp__agentic-forge__af_*`). */
export const OVERSEER_MCP_SERVER = "agentic-forge";
/** Slash command of the overseer skill inside the bundled plugin. */
export const OVERSEER_SKILL_COMMAND = "/af-overseer:overseer";
/** Subdirectory of the overseer run dir for launcher files (MCP config, event cursor). */
export const OVERSEER_SESSION_DIR = "overseer";
/** Event types the overseer's monitor wakes on. */
export const OVERSEER_EVENT_TYPES = "needs_input,run.*,step.failed,merge.completed";

export interface OverseerOptions {
	/** `--epic <file|text>`: an existing file is read, anything else is the epic text. */
	epic?: string;
	/** `--resume <run>`: reopen this overseer run. */
	resume?: string;
	/** `--new`: always create a run, even when one is open for the repository. */
	new?: boolean;
	/** `--finish <run>`: end this overseer run instead of starting a session. */
	finish?: string;
	/** Final status with `--finish`: done (default), halted or failed. */
	status?: string;
	/** Summary text with `--finish` (`summary.md` body). */
	summary?: string;
	/** `--model` for the claude session. */
	model?: string;
	/** Prints the claude command instead of starting it (the run is still opened). */
	printCommand?: boolean;
	/** Extra arguments passed to claude (after `--`). */
	claudeArgs?: string[];
}

export interface OverseerDeps {
	/** Supervisor client (default: `ensureSupervisor()`). */
	client?: SupervisorClient;
	/** Repository root (default: `process.cwd()`). */
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	/** Starts the claude session and resolves with its exit code (test seam). */
	launch?: (command: OverseerCommand) => Promise<number>;
	/** Resolved claude executable (default: `getExecutable("claude")`). */
	claude?: string;
	/** stdout writer (default: `process.stdout`). */
	out?: (text: string) => void;
}

/** The claude session `af overseer` starts. */
export interface OverseerCommand {
	executable: string;
	args: string[];
	cwd: string;
	env: Record<string, string>;
	/** Path of the generated MCP config file. */
	mcpConfig: string;
}

/** Directory of the bundled `af-overseer` plugin (`dist/overseer`, `src/overseer` in tests). */
export function getOverseerPluginDir(): string {
	return path.resolve(__dirname, "..", "overseer");
}

/**
 * How to run this af CLI from another process: node with the CLI script, so
 * it works without `af` on PATH and without a Windows `.cmd` shim.
 */
export function afInvocation(): { command: string; args: string[] } {
	return { command: process.execPath, args: [path.resolve(__dirname, "..", "cli.js")] };
}

function quote(value: string): string {
	const portable = process.platform === "win32" ? value.replace(/\\/g, "/") : value;
	return /^[A-Za-z0-9_./:@=-]+$/.test(portable) ? portable : `"${portable}"`;
}

/** The af CLI as a Bash command line (for the overseer's event monitor and `--finish`). */
export function afShellCommand(invocation = afInvocation()): string {
	return [invocation.command, ...invocation.args].map(quote).join(" ");
}

/** `--epic`: an existing file is read (source = its absolute path); anything else is text. */
export function readEpic(
	value: string | undefined,
	cwd: string,
): { epic: string | null; source: string | null } {
	if (value === undefined) return { epic: null, source: null };
	const file = path.resolve(cwd, value);
	if (existsSync(file) && statSync(file).isFile()) {
		const epic = readFileSync(file, "utf-8");
		if (!epic.trim()) throw new CliExitError(`Error: The epic file is empty: ${file}`);
		return { epic, source: file };
	}
	if (!value.trim()) throw new CliExitError("Error: --epic needs a file or a text");
	return { epic: value, source: null };
}

/** The MCP config of the overseer session: the af MCP server, tagged with the overseer run. */
export function overseerMcpConfig(runId: string, invocation = afInvocation()) {
	return {
		mcpServers: {
			[OVERSEER_MCP_SERVER]: {
				command: invocation.command,
				args: [...invocation.args, "mcp"],
				env: { AF_OVERSEER_RUN: runId },
			},
		},
	};
}

/** The first prompt of the session: the overseer skill with its arguments. */
export function overseerPrompt(open: OverseerOpenResult, af = afShellCommand()): string {
	const args = [
		OVERSEER_SKILL_COMMAND,
		"--run",
		open.run.id,
		"--run-dir",
		quote(open.dir),
		"--af",
		JSON.stringify(af),
		"--session",
		String(open.session),
	];
	if (open.epic) args.push("--epic", quote(open.epic));
	if (open.mode !== "created") args.push("--rehydrate");
	return args.join(" ");
}

/**
 * Builds the claude command for an opened overseer run and writes its MCP
 * config into `<run dir>/overseer/mcp.json`. The prompt comes first: the
 * claude options that follow take several values each.
 */
export function buildOverseerCommand(
	open: OverseerOpenResult,
	options: {
		executable: string;
		cwd: string;
		env: NodeJS.ProcessEnv;
		model?: string;
		extra?: string[];
	},
): OverseerCommand {
	const sessionDir = path.join(open.dir, OVERSEER_SESSION_DIR);
	mkdirSync(sessionDir, { recursive: true });
	const mcpConfig = path.join(sessionDir, "mcp.json");
	writeFileSync(mcpConfig, `${JSON.stringify(overseerMcpConfig(open.run.id), null, 2)}\n`, "utf-8");
	const args = [
		overseerPrompt(open),
		"--mcp-config",
		mcpConfig,
		"--plugin-dir",
		getOverseerPluginDir(),
		"--add-dir",
		open.dir,
		"--allowedTools",
		`mcp__${OVERSEER_MCP_SERVER}`,
	];
	if (options.model) args.push("--model", options.model);
	args.push(...(options.extra ?? []));
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(options.env)) {
		if (value !== undefined) env[key] = value;
	}
	env.AF_OVERSEER_RUN = open.run.id;
	env.AF_OVERSEER_RUN_DIR = open.dir;
	return { executable: options.executable, args, cwd: options.cwd, env, mcpConfig };
}

/** Starts claude attached to the terminal; resolves with its exit code. */
async function launchClaude(command: OverseerCommand): Promise<number> {
	let exe = command.executable;
	let args = command.args;
	if (process.platform === "win32" && /\.(cmd|bat)$/i.test(exe)) {
		const script = resolveCmdScript(exe);
		if (!script) {
			throw new CliExitError(`Error: Cannot start ${exe}: install the native claude executable`);
		}
		exe = process.execPath;
		args = [script, ...args];
	}
	return new Promise((resolve, reject) => {
		const child = spawn(exe, args, { cwd: command.cwd, env: command.env, stdio: "inherit" });
		child.on("error", reject);
		child.on("exit", (code) => resolve(code ?? 1));
	});
}

async function defaultClient(): Promise<SupervisorClient> {
	const { ensureSupervisor } = await import("../supervisor/client.js");
	const { getVersion } = await import("./version.js");
	const found = await ensureSupervisor({
		version: getVersion(),
		onWarn: (message) => process.stderr.write(`Warning: ${message}\n`),
	});
	return found.client;
}

export async function cmdOverseer(
	options: OverseerOptions,
	deps: OverseerDeps = {},
): Promise<number> {
	const out = deps.out ?? ((text: string) => process.stdout.write(text));
	const cwd = deps.cwd ?? process.cwd();
	const env = deps.env ?? process.env;

	if (options.finish) {
		if (options.epic || options.resume || options.new) {
			throw new CliExitError("Error: --finish cannot be combined with --epic, --resume or --new");
		}
		const client = deps.client ?? (await defaultClient());
		try {
			const res = await client.request<{ id: string; status: string; summary: string }>(
				"POST",
				`/v1/overseer/${encodeURIComponent(options.finish)}/finish`,
				{ status: options.status ?? "done", summary: options.summary ?? "" },
			);
			out(`Overseer run ${res.status}: ${res.id}\nSummary:  ${res.summary}\n`);
		} catch (err) {
			throw new CliExitError(`Error: ${(err as Error).message}`);
		}
		return 0;
	}
	if (options.resume && options.epic) {
		throw new CliExitError("Error: --resume keeps the run's epic: drop --epic");
	}

	const { epic, source } = readEpic(options.epic, cwd);
	let executable = deps.claude;
	if (!executable && !options.printCommand) {
		try {
			executable = getExecutable("claude");
		} catch {
			throw new CliExitError(
				"Error: claude was not found on PATH. Install Claude Code (https://claude.com/claude-code) and try again",
			);
		}
	}
	const config = loadConfig(cwd);
	const payload: OverseerPayload = {
		repo_root: cwd,
		config,
		env: filterEnv(env, getEnvPassthrough(config)),
		epic,
		epic_source: source,
		resume: options.resume ?? null,
		new: options.new === true,
	};
	const client = deps.client ?? (await defaultClient());
	let open: OverseerOpenResult;
	try {
		open = await client.request<OverseerOpenResult>("POST", "/v1/overseer", payload);
	} catch (err) {
		throw new CliExitError(`Error: ${(err as Error).message}`);
	}
	for (const warning of open.warnings ?? []) process.stderr.write(`Warning: ${warning}\n`);
	const verb = {
		created: "created",
		reused: "reused (open run of this repository)",
		resumed: "resumed",
	};
	out(`Overseer run ${verb[open.mode]}: ${open.run.id} (session ${open.session})\n`);
	out(`Run dir: ${open.dir}\n`);

	const command = buildOverseerCommand(open, {
		executable: executable ?? "claude",
		cwd,
		env,
		model: options.model,
		extra: options.claudeArgs,
	});
	if (options.printCommand) {
		out(`${[command.executable, ...command.args].map((a) => JSON.stringify(a)).join(" ")}\n`);
		return 0;
	}
	const launch = deps.launch ?? launchClaude;
	const code = await launch(command);
	out(
		`\nThe overseer run stays open: ${open.run.id}\nReopen it with 'agentic-forge overseer --resume ${open.run.id}', end it with 'agentic-forge overseer --finish ${open.run.id}'.\n`,
	);
	return code;
}
