/**
 * `af doctor`: checks that agentic-forge can run workflows here, and says how
 * to fix what it cannot. Reports runtimes and their auth method, GitHub CLI
 * auth, the supervisor, the runs root, skill pack discovery and the contract
 * compatibility of every discovered skill pack workflow.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { loadConfig } from "../config.js";
import { CONTRACT_VERSION } from "../contract/index.js";
import { WorkflowParser } from "../parser.js";
import { resolveRunsRoot } from "../paths.js";
import { checkRequires } from "../requires.js";
import {
	type SkillPack,
	detectClaudePlugins,
	findSkillPacks,
	getClaudeConfigDir,
	getInstalledPluginsPath,
	getSkillPackConfig,
} from "../skill-packs.js";
import { CliExitError } from "./run.js";
import { getVersion } from "./version.js";

export type CheckStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
	name: string;
	status: CheckStatus;
	detail: string;
	/** How to fix a warn or fail. */
	hint?: string;
}

export interface ProbeResult {
	/** Exit code; null when the command could not start or timed out. */
	code: number | null;
	stdout: string;
	stderr: string;
}

/** Runs a fixed command line (never user input). Injected by tests. */
export type Probe = (command: string, args: string[]) => ProbeResult;

export interface DoctorReport {
	version: string;
	contract_version: number;
	runs_root: string;
	checks: DoctorCheck[];
	skill_packs: { name: string; root: string; origin: string; version: string | null }[];
}

export interface DoctorOptions {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	probe?: Probe;
	version?: string;
	/** Claude config dir for plugin auto-detection. */
	claudeDir?: string;
	/** Supervisor lookup (defaults to `findSupervisor()`). */
	findSupervisor?: () => Promise<{ version: string; pid: number } | null>;
}

/** Default probe: the commands are literals, so a shell (for Windows `.cmd` shims) is safe. */
export const defaultProbe: Probe = (command, args) => {
	const line = [command, ...args].join(" ");
	const result = spawnSync(line, {
		encoding: "utf-8",
		shell: true,
		timeout: 20_000,
		windowsHide: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	return {
		code: result.error ? null : result.status,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
};

function firstLine(text: string): string {
	return text.trim().split(/\r?\n/)[0] ?? "";
}

function checkNode(): DoctorCheck {
	const major = Number(process.versions.node.split(".")[0]);
	return major >= 22
		? { name: "node", status: "pass", detail: `Node.js ${process.versions.node}` }
		: {
				name: "node",
				status: "fail",
				detail: `Node.js ${process.versions.node} (22 or later required)`,
				hint: "Install Node.js 22 or later",
			};
}

/** `<tool> --version`: pass with the version, else `missingStatus` with the install hint. */
function checkTool(
	probe: Probe,
	name: string,
	missingStatus: CheckStatus,
	hint: string,
): { check: DoctorCheck; found: boolean } {
	const result = probe(name, ["--version"]);
	if (result.code === 0) {
		return {
			check: { name, status: "pass", detail: firstLine(result.stdout) || "installed" },
			found: true,
		};
	}
	return {
		check: { name, status: missingStatus, detail: `${name} not found on PATH`, hint },
		found: false,
	};
}

function checkClaudeAuth(probe: Probe, env: NodeJS.ProcessEnv): DoctorCheck[] {
	const checks: DoctorCheck[] = [];
	const apiKey = Boolean(env.ANTHROPIC_API_KEY);
	const result = probe("claude", ["auth", "status"]);
	type AuthStatus = { loggedIn?: boolean; authMethod?: string; subscriptionType?: string };
	let status: AuthStatus | null = null;
	try {
		status = JSON.parse(result.stdout) as AuthStatus;
	} catch {
		status = null;
	}
	if (status?.loggedIn) {
		const method =
			status.authMethod === "claude.ai"
				? `Claude plan login${status.subscriptionType ? ` (${status.subscriptionType})` : ""}`
				: (status.authMethod ?? "logged in");
		checks.push({ name: "claude auth", status: "pass", detail: method });
	} else if (status) {
		checks.push(
			apiKey
				? { name: "claude auth", status: "pass", detail: "API key (ANTHROPIC_API_KEY)" }
				: {
						name: "claude auth",
						status: "fail",
						detail: "not logged in",
						hint: "Run 'claude auth login' (or /login in claude)",
					},
		);
	} else {
		checks.push({
			name: "claude auth",
			status: "warn",
			detail: "could not read 'claude auth status'",
			hint: "Update Claude Code, then run 'claude auth status'",
		});
	}
	if (apiKey) {
		checks.push({
			name: "ANTHROPIC_API_KEY",
			status: "warn",
			detail: "set: Claude steps bill this API key instead of the Claude plan",
			hint: "Unset ANTHROPIC_API_KEY to use the Claude plan login",
		});
	}
	return checks;
}

function checkCodexAuth(probe: Probe): DoctorCheck {
	const result = probe("codex", ["login", "status"]);
	const text = firstLine(`${result.stdout}\n${result.stderr}`.trim());
	if (result.code === 0) {
		const method = /chatgpt/i.test(text)
			? "ChatGPT login"
			: /api key/i.test(text)
				? "API key"
				: text || "logged in";
		return { name: "codex auth", status: "pass", detail: method };
	}
	return {
		name: "codex auth",
		status: "fail",
		detail: text || "not logged in",
		hint: "Run 'codex login'",
	};
}

function checkGhAuth(probe: Probe): DoctorCheck {
	const result = probe("gh", ["auth", "status"]);
	return result.code === 0
		? { name: "gh auth", status: "pass", detail: "logged in" }
		: {
				name: "gh auth",
				status: "fail",
				detail: "not logged in",
				hint: "Run 'gh auth login'",
			};
}

/** Contract and version compatibility of every workflow in a pack. */
function checkPack(pack: SkillPack, version: string): DoctorCheck {
	const name = `skill pack ${pack.name}`;
	const files = existsSync(pack.workflowsDir)
		? readdirSync(pack.workflowsDir).filter((f) => f.endsWith(".yaml"))
		: [];
	const errors: string[] = [];
	const contractErrors: string[] = [];
	const versionErrors: string[] = [];
	for (const file of files.sort()) {
		try {
			const workflow = new WorkflowParser(pack.workflowsDir).parseFile(
				path.join(pack.workflowsDir, file),
			);
			const result = checkRequires(workflow.name, workflow.requires, { version });
			const contract = workflow.requires?.contract;
			if (contract != null && contract !== CONTRACT_VERSION) {
				contractErrors.push(`${file} (contract ${contract})`);
			} else if (result.errors.length > 0) {
				versionErrors.push(`${file} (agentic-forge ${workflow.requires?.agenticForge})`);
			}
		} catch (err) {
			errors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	const where = `${pack.root} (${pack.origin === "config" ? "skill_packs.paths" : "Claude plugin"})`;
	if (contractErrors.length > 0 || errors.length > 0) {
		return {
			name,
			status: "fail",
			detail: [
				where,
				contractErrors.length > 0
					? `needs another contract than ${CONTRACT_VERSION}: ${contractErrors.join(", ")}`
					: "",
				errors.length > 0 ? `invalid: ${errors.join("; ")}` : "",
			]
				.filter(Boolean)
				.join("; "),
			hint:
				contractErrors.length > 0
					? "Install versions of agentic-forge and the pack that share a contract version"
					: "Fix or update the pack's workflow files",
		};
	}
	if (versionErrors.length > 0) {
		return {
			name,
			status: "warn",
			detail: `${where}; needs a newer agentic-forge than ${version}: ${versionErrors.join(", ")}`,
			hint: "Upgrade agentic-forge (npm install -g agentic-forge@latest), or run with --ignore-requires",
		};
	}
	return {
		name,
		status: "pass",
		detail: `${where}; ${files.length} workflow(s), contract ${CONTRACT_VERSION} compatible`,
	};
}

/** Runs every check; never throws for a failed check. */
export async function runDoctorChecks(options: DoctorOptions = {}): Promise<DoctorReport> {
	const cwd = options.cwd ?? process.cwd();
	const env = options.env ?? process.env;
	const probe = options.probe ?? defaultProbe;
	const version = options.version ?? getVersion();
	const checks: DoctorCheck[] = [checkNode()];

	let config: Record<string, unknown> = {};
	try {
		config = loadConfig(cwd);
		checks.push({ name: "config", status: "pass", detail: "loaded" });
	} catch (err) {
		checks.push({
			name: "config",
			status: "fail",
			detail: err instanceof Error ? err.message : String(err),
			hint: "Fix the JSON of the global or agentic/config.json file ('af paths' shows them)",
		});
	}

	checks.push(checkTool(probe, "git", "fail", "Install git").check);

	const claude = checkTool(
		probe,
		"claude",
		"fail",
		"Install Claude Code: npm install -g @anthropic-ai/claude-code",
	);
	checks.push(claude.check);
	if (claude.found) checks.push(...checkClaudeAuth(probe, env));

	const codex = checkTool(
		probe,
		"codex",
		"warn",
		"Optional runtime. Install it with: npm install -g @openai/codex",
	);
	checks.push(codex.check);
	if (codex.found) checks.push(checkCodexAuth(probe));

	const gh = checkTool(
		probe,
		"gh",
		"warn",
		"Optional, used by GitHub steps. Install it from https://cli.github.com",
	);
	checks.push(gh.check);
	if (gh.found) checks.push(checkGhAuth(probe));

	const find =
		options.findSupervisor ??
		(async () => {
			const { findSupervisor } = await import("../supervisor/client.js");
			const found = await findSupervisor();
			return found ? { version: found.info.version, pid: found.info.pid } : null;
		});
	const supervisor = await find().catch(() => null);
	if (!supervisor) {
		checks.push({
			name: "supervisor",
			status: "pass",
			detail: "not running (started on demand by af run and af mcp)",
		});
	} else if (supervisor.version !== version) {
		checks.push({
			name: "supervisor",
			status: "warn",
			detail: `running ${supervisor.version} (pid ${supervisor.pid}), this CLI is ${version}`,
			hint: "Restart it with 'af serve --restart'",
		});
	} else {
		checks.push({
			name: "supervisor",
			status: "pass",
			detail: `running ${supervisor.version} (pid ${supervisor.pid})`,
		});
	}

	const runsRoot = resolveRunsRoot(config, cwd);
	checks.push(
		runsRoot.deprecation
			? {
					name: "runs root",
					status: "warn",
					detail: runsRoot.root,
					hint: runsRoot.deprecation,
				}
			: {
					name: "runs root",
					status: "pass",
					detail: `${runsRoot.root}${existsSync(runsRoot.root) ? "" : " (created on the first run)"}`,
				},
	);

	const packConfig = getSkillPackConfig(config);
	const claudeDir = options.claudeDir ?? getClaudeConfigDir();
	if (packConfig.autoDetect) {
		const listPath = getInstalledPluginsPath(claudeDir);
		if (existsSync(listPath)) {
			const plugins = detectClaudePlugins(cwd, claudeDir);
			checks.push({
				name: "plugin detection",
				status: "pass",
				detail: `${plugins.length} Claude plugin(s) in ${listPath}`,
			});
		} else {
			checks.push({
				name: "plugin detection",
				status: "warn",
				detail: `${listPath} not found`,
				hint: "Set skill_packs.paths in the af config to the plugin directories that ship af-workflows/",
			});
		}
	}
	for (const missing of packConfig.paths.filter(
		(p) => !existsSync(path.join(path.resolve(cwd, p), "af-workflows")),
	)) {
		checks.push({
			name: "skill_packs.paths",
			status: "warn",
			detail: `${path.resolve(cwd, missing)} has no af-workflows/ directory`,
			hint: "Point skill_packs.paths at a plugin root that contains af-workflows/",
		});
	}
	const packs = findSkillPacks(config, cwd, { claudeDir });
	for (const pack of packs) checks.push(checkPack(pack, version));

	return {
		version,
		contract_version: CONTRACT_VERSION,
		runs_root: runsRoot.root,
		checks,
		skill_packs: packs.map((p) => ({
			name: p.name,
			root: p.root,
			origin: p.origin,
			version: p.version,
		})),
	};
}

const LABELS: Record<CheckStatus, string> = { pass: "PASS", warn: "WARN", fail: "FAIL" };

/** Formats a report for the terminal. */
export function formatDoctorReport(report: DoctorReport): string {
	const lines = [
		`agentic-forge ${report.version} (contract ${report.contract_version})`,
		`Runs root: ${report.runs_root}`,
		"",
	];
	for (const check of report.checks) {
		lines.push(`[${LABELS[check.status]}] ${check.name}: ${check.detail}`);
		if (check.hint && check.status !== "pass") lines.push(`       fix: ${check.hint}`);
	}
	const failed = report.checks.filter((c) => c.status === "fail").length;
	const warned = report.checks.filter((c) => c.status === "warn").length;
	lines.push("", `${failed} failed, ${warned} warning(s), ${report.checks.length} checks`);
	return lines.join("\n");
}

export async function cmdDoctor(options: { json?: boolean } = {}): Promise<void> {
	const report = await runDoctorChecks();
	process.stdout.write(
		options.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatDoctorReport(report)}\n`,
	);
	if (report.checks.some((c) => c.status === "fail")) {
		throw new CliExitError("af doctor: some checks failed", 1);
	}
}
