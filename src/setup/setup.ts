/**
 * `af setup claude|codex`: makes the af MCP server and the af skills
 * (`overseer`, `af-delegate`) available to a coding agent client.
 *
 * - Claude Code, `plugin` mode (default): af writes a local marketplace in
 *   its global dir (`<global dir>/claude-marketplace/`) holding a copy of the
 *   bundled `af-overseer` plugin plus a generated `.mcp.json` that starts
 *   this af CLI (`node <dist>/cli.js mcp`, absolute paths, so it works without
 *   `af` on PATH and without a Windows `.cmd` shim). Claude Code itself
 *   registers the marketplace and installs the plugin (`claude plugin ...`),
 *   so af never edits Claude Code's plugin files.
 * - Claude Code, `mcp` mode: a user-scope MCP server (`claude mcp add-json
 *   --scope user`) and the skills copied to `<claude dir>/skills/`.
 * - Codex: the `[mcp_servers.agentic-forge]` table of `config.toml` and the
 *   skills copied to `<codex home>/skills/`.
 *
 * Every step first reads the current state and only acts on a difference,
 * so a second run changes nothing. `dryRun` reports the steps without acting.
 */

import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { getOverseerPluginDir } from "../commands/overseer.js";
import { AF_MCP_SERVER, CODEX_AF_TOOL_TIMEOUT_SEC, afInvocation } from "../runtimes/af-mcp.js";
import { getExecutable, resolveCmdScript } from "../runtimes/utils.js";
import {
	AF_MARKETPLACE,
	type ClientDirs,
	type McpServerEntry,
	OVERSEER_PLUGIN,
	OVERSEER_PLUGIN_KEY,
	codexConfigPath,
	readAfMarketplace,
	readClaudeUserMcp,
	readOverseerPluginInstall,
} from "./clients.js";
import { type CodexMcpTable, readCodexMcp, writeCodexMcp } from "./codex-toml.js";

export type SetupClient = "claude" | "codex";
export type ClaudeSetupMode = "plugin" | "mcp";

/** Directory of the generated marketplace inside the af global dir. */
export const MARKETPLACE_DIR = "claude-marketplace";

/** Skills of the overseer plugin, by plugin directory name, with their standalone name. */
export const AF_SKILLS: { dir: string; name: string }[] = [
	{ dir: "overseer", name: "af-overseer" },
	{ dir: "af-delegate", name: "af-delegate" },
];

export interface CliResult {
	code: number | null;
	stdout: string;
	stderr: string;
}

/** Runs `claude <args>` (test seam). */
export type ClaudeCli = (args: string[]) => CliResult;

export interface SetupOptions {
	client: SetupClient;
	/** Claude Code only: `plugin` (default) or `mcp`. */
	mode?: ClaudeSetupMode;
	dryRun?: boolean;
	dirs: ClientDirs;
	/** How clients start this af CLI (default: `afInvocation()`). */
	invocation?: { command: string; args: string[] };
	/** Bundled plugin directory (default: `getOverseerPluginDir()`). */
	pluginDir?: string;
	claudeCli?: ClaudeCli;
}

export interface SetupStep {
	/** `ok`: already set up; `done`: changed now; `planned`: would change (dry run). */
	status: "ok" | "done" | "planned";
	detail: string;
}

export interface SetupReport {
	client: SetupClient;
	mode: ClaudeSetupMode | null;
	dryRun: boolean;
	steps: SetupStep[];
	/** Things the user should know (a duplicate registration, a restart). */
	notes: string[];
}

export class SetupError extends Error {}

/** Default `claude` runner: the native executable, or node with the npm shim's script. */
export const defaultClaudeCli: ClaudeCli = (args) => {
	let exe: string;
	try {
		exe = getExecutable("claude");
	} catch {
		throw new SetupError(
			"claude was not found on PATH. Install Claude Code (https://claude.com/claude-code), or use --mode mcp --dry-run to see the steps",
		);
	}
	let full = args;
	if (process.platform === "win32" && /\.(cmd|bat)$/i.test(exe)) {
		const script = resolveCmdScript(exe);
		if (!script) throw new SetupError(`Cannot start ${exe}: install the native claude executable`);
		full = [script, ...args];
		exe = process.execPath;
	}
	const result = spawnSync(exe, full, {
		encoding: "utf-8",
		windowsHide: true,
		timeout: 120_000,
		stdio: ["ignore", "pipe", "pipe"],
	});
	return {
		code: result.error ? null : result.status,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
};

/** The af MCP server entry clients get: this CLI with `mcp`. */
export function afMcpEntry(invocation = afInvocation()): McpServerEntry {
	return { command: invocation.command, args: [...invocation.args, "mcp"] };
}

function sameEntry(a: McpServerEntry | null, b: McpServerEntry): boolean {
	return (
		a !== null &&
		a.command === b.command &&
		a.args.length === b.args.length &&
		a.args.every((arg, i) => arg === b.args[i])
	);
}

function samePath(a: string, b: string): boolean {
	const ra = path.resolve(a);
	const rb = path.resolve(b);
	return process.platform === "win32" ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

/** Every file under `dir`, as relative paths with forward slashes. */
function listFiles(dir: string, prefix = ""): string[] {
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	for (const name of readdirSync(dir).sort()) {
		const full = path.join(dir, name);
		const rel = prefix ? `${prefix}/${name}` : name;
		if (statSync(full).isDirectory()) out.push(...listFiles(full, rel));
		else out.push(rel);
	}
	return out;
}

function readText(file: string): string | null {
	return existsSync(file) ? readFileSync(file, "utf-8") : null;
}

/** Files of a directory tree: relative path -> content. */
type FileMap = Map<string, string>;

function readTree(dir: string): FileMap {
	return new Map(listFiles(dir).map((rel) => [rel, readFileSync(path.join(dir, rel), "utf-8")]));
}

/** True when `dir` holds exactly `files` (extra files count as a difference when `exact`). */
function treeMatches(dir: string, files: FileMap, exact: boolean): boolean {
	for (const [rel, content] of files) {
		if (readText(path.join(dir, rel)) !== content) return false;
	}
	return !exact || listFiles(dir).every((rel) => files.has(rel));
}

/** Writes `files` into `dir` and removes the files it does not list. */
function writeTree(dir: string, files: FileMap): void {
	for (const rel of listFiles(dir)) {
		if (!files.has(rel)) rmSync(path.join(dir, rel), { force: true });
	}
	for (const [rel, content] of files) {
		const file = path.join(dir, rel);
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, content, "utf-8");
	}
}

class Steps {
	readonly steps: SetupStep[] = [];
	readonly notes: string[] = [];
	constructor(private readonly dryRun: boolean) {}

	ok(detail: string): void {
		this.steps.push({ status: "ok", detail });
	}

	/** Records a change and runs it unless this is a dry run. */
	change(detail: string, act: () => void): void {
		if (this.dryRun) {
			this.steps.push({ status: "planned", detail });
			return;
		}
		act();
		this.steps.push({ status: "done", detail });
	}
}

function pluginVersion(pluginDir: string): string {
	try {
		const manifest = JSON.parse(
			readFileSync(path.join(pluginDir, ".claude-plugin", "plugin.json"), "utf-8"),
		) as { version?: string };
		return manifest.version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
}

/** The plugin as installed from the af marketplace: the bundled files plus `.mcp.json`. */
export function marketplacePluginFiles(pluginDir: string, entry: McpServerEntry): FileMap {
	const files = readTree(pluginDir);
	files.set(
		".mcp.json",
		`${JSON.stringify({ mcpServers: { [AF_MCP_SERVER]: entry } }, null, 2)}\n`,
	);
	return files;
}

function marketplaceManifest(pluginDir: string): string {
	const manifest = {
		name: AF_MARKETPLACE,
		owner: { name: "agentic-forge" },
		metadata: { description: "Generated by 'af setup claude' from the installed agentic-forge" },
		plugins: [
			{
				name: OVERSEER_PLUGIN,
				source: `./${OVERSEER_PLUGIN}`,
				version: pluginVersion(pluginDir),
				description:
					"agentic-forge overseer and af-delegate skills, with the af MCP server (af mcp)",
			},
		],
	};
	return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** A plugin skill as a standalone skill: its directory files, `name` set to the standalone name. */
function standaloneSkill(pluginDir: string, skill: { dir: string; name: string }): FileMap {
	const files = readTree(path.join(pluginDir, "skills", skill.dir));
	const main = files.get("SKILL.md");
	if (main !== undefined) {
		files.set("SKILL.md", main.replace(/^name:\s*.*$/m, `name: ${skill.name}`));
	}
	return files;
}

function installSkills(steps: Steps, pluginDir: string, skillsRoot: string): void {
	for (const skill of AF_SKILLS) {
		const files = standaloneSkill(pluginDir, skill);
		if (files.size === 0) continue;
		const dir = path.join(skillsRoot, skill.name);
		if (treeMatches(dir, files, true)) {
			steps.ok(`Skill ${skill.name} is up to date (${dir})`);
		} else {
			steps.change(`${existsSync(dir) ? "Update" : "Install"} skill ${skill.name} in ${dir}`, () =>
				writeTree(dir, files),
			);
		}
	}
}

function runClaude(cli: ClaudeCli, args: string[]): void {
	const result = cli(args);
	if (result.code !== 0) {
		const output = `${result.stderr}\n${result.stdout}`.trim().split(/\r?\n/).slice(-5).join("\n");
		throw new SetupError(`'claude ${args.join(" ")}' failed${output ? `:\n${output}` : ""}`);
	}
}

function quoteArg(arg: string): string {
	return /^[A-Za-z0-9_./:@=-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`;
}

function claudeStep(steps: Steps, cli: ClaudeCli, args: string[], why: string): void {
	steps.change(`${why}: claude ${args.map(quoteArg).join(" ")}`, () => runClaude(cli, args));
}

function setupClaudePlugin(steps: Steps, options: SetupOptions, entry: McpServerEntry): void {
	const { dirs } = options;
	const cli = options.claudeCli ?? defaultClaudeCli;
	const pluginDir = options.pluginDir ?? getOverseerPluginDir();
	const marketplace = path.join(dirs.afRoot, MARKETPLACE_DIR);
	const files = marketplacePluginFiles(pluginDir, entry);
	const manifestDir = path.join(marketplace, ".claude-plugin");
	const manifest = new Map([["marketplace.json", marketplaceManifest(pluginDir)]]);

	const pluginTarget = path.join(marketplace, OVERSEER_PLUGIN);
	const marketplaceChanged =
		!treeMatches(pluginTarget, files, true) || !treeMatches(manifestDir, manifest, true);
	if (marketplaceChanged) {
		steps.change(`Write the af marketplace (${OVERSEER_PLUGIN} plugin) in ${marketplace}`, () => {
			writeTree(pluginTarget, files);
			writeTree(manifestDir, manifest);
		});
	} else {
		steps.ok(`The af marketplace is up to date (${marketplace})`);
	}

	const registered = readAfMarketplace(dirs);
	if (registered === null) {
		claudeStep(
			steps,
			cli,
			["plugin", "marketplace", "add", marketplace, "--scope", "user"],
			`Register the ${AF_MARKETPLACE} marketplace`,
		);
	} else if (!samePath(registered, marketplace)) {
		claudeStep(
			steps,
			cli,
			["plugin", "marketplace", "remove", AF_MARKETPLACE],
			`Replace the ${AF_MARKETPLACE} marketplace registered from ${registered}`,
		);
		claudeStep(
			steps,
			cli,
			["plugin", "marketplace", "add", marketplace, "--scope", "user"],
			`Register the ${AF_MARKETPLACE} marketplace`,
		);
	} else if (marketplaceChanged) {
		claudeStep(
			steps,
			cli,
			["plugin", "marketplace", "update", AF_MARKETPLACE],
			`Refresh the ${AF_MARKETPLACE} marketplace`,
		);
	} else {
		steps.ok(`Marketplace ${AF_MARKETPLACE} is registered in Claude Code`);
	}

	const install = readOverseerPluginInstall(dirs);
	const installArgs = ["plugin", "install", OVERSEER_PLUGIN_KEY, "--scope", "user"];
	if (!install) {
		claudeStep(steps, cli, installArgs, `Install the ${OVERSEER_PLUGIN} plugin`);
	} else if (!treeMatches(install.installPath, files, false)) {
		claudeStep(
			steps,
			cli,
			["plugin", "uninstall", OVERSEER_PLUGIN_KEY, "--scope", "user"],
			`Remove the outdated ${OVERSEER_PLUGIN} plugin (${install.version ?? "unknown version"})`,
		);
		claudeStep(steps, cli, installArgs, `Install the ${OVERSEER_PLUGIN} plugin`);
	} else {
		steps.ok(`Plugin ${OVERSEER_PLUGIN_KEY} is installed (${install.installPath})`);
	}
	if (install?.disabled) {
		claudeStep(
			steps,
			cli,
			["plugin", "enable", OVERSEER_PLUGIN_KEY, "--scope", "user"],
			`Enable the ${OVERSEER_PLUGIN} plugin`,
		);
	}

	if (readClaudeUserMcp(dirs)) {
		steps.notes.push(
			`A user-scope '${AF_MCP_SERVER}' MCP server is also registered, so the af tools appear twice. Remove it with: claude mcp remove ${AF_MCP_SERVER} --scope user`,
		);
	}
	steps.notes.push(
		`Restart Claude Code (or Claude Desktop) to load the plugin, then run /${OVERSEER_PLUGIN}:overseer`,
	);
}

function setupClaudeMcp(steps: Steps, options: SetupOptions, entry: McpServerEntry): void {
	const { dirs } = options;
	const cli = options.claudeCli ?? defaultClaudeCli;
	const current = readClaudeUserMcp(dirs);
	if (sameEntry(current, entry)) {
		steps.ok(`MCP server ${AF_MCP_SERVER} is registered with user scope`);
	} else {
		if (current) {
			claudeStep(
				steps,
				cli,
				["mcp", "remove", AF_MCP_SERVER, "--scope", "user"],
				`Replace the ${AF_MCP_SERVER} MCP server (${current.command} ${current.args.join(" ")})`,
			);
		}
		const json = JSON.stringify({ type: "stdio", command: entry.command, args: entry.args });
		claudeStep(
			steps,
			cli,
			["mcp", "add-json", AF_MCP_SERVER, json, "--scope", "user"],
			`Register the ${AF_MCP_SERVER} MCP server with user scope`,
		);
	}
	installSkills(
		steps,
		options.pluginDir ?? getOverseerPluginDir(),
		path.join(dirs.claudeDir, "skills"),
	);
	if (readOverseerPluginInstall(dirs)) {
		steps.notes.push(
			`The ${OVERSEER_PLUGIN} plugin is also installed, so the af tools and skills appear twice. Remove it with: claude plugin uninstall ${OVERSEER_PLUGIN_KEY}`,
		);
	}
	steps.notes.push("Restart Claude Code (or Claude Desktop), then run /af-overseer");
}

/** The af server table of the Codex config: this CLI, with a longer tool timeout. */
export function codexMcpTable(invocation = afInvocation()): CodexMcpTable {
	const portable = (p: string) => p.replace(/\\/g, "/");
	return {
		command: portable(invocation.command),
		args: [...invocation.args.map(portable), "mcp"],
		tool_timeout_sec: CODEX_AF_TOOL_TIMEOUT_SEC,
	};
}

function setupCodex(steps: Steps, options: SetupOptions): void {
	const { dirs } = options;
	const file = codexConfigPath(dirs);
	const table = codexMcpTable(options.invocation);
	const text = readText(file) ?? "";
	const current = readCodexMcp(text);
	if (current && sameEntry(current, table) && current.tool_timeout_sec === table.tool_timeout_sec) {
		steps.ok(`MCP server ${AF_MCP_SERVER} is in ${file}`);
	} else {
		const updated = writeCodexMcp(text, { ...table, env: current?.env });
		steps.change(`${current ? "Update" : "Add"} [mcp_servers.${AF_MCP_SERVER}] in ${file}`, () => {
			mkdirSync(path.dirname(file), { recursive: true });
			writeFileSync(file, updated, "utf-8");
		});
	}
	installSkills(
		steps,
		options.pluginDir ?? getOverseerPluginDir(),
		path.join(dirs.codexHome, "skills"),
	);
	steps.notes.push("Start a new Codex session to load the af MCP server and skills");
}

/** Runs the setup of one client. Throws `SetupError` when a client command fails. */
export function runSetup(options: SetupOptions): SetupReport {
	const steps = new Steps(options.dryRun === true);
	const entry = afMcpEntry(options.invocation);
	const mode = options.client === "claude" ? (options.mode ?? "plugin") : null;
	if (options.client === "claude") {
		if (mode === "mcp") setupClaudeMcp(steps, options, entry);
		else setupClaudePlugin(steps, options, entry);
	} else {
		setupCodex(steps, options);
	}
	return {
		client: options.client,
		mode,
		dryRun: options.dryRun === true,
		steps: steps.steps,
		notes: steps.notes,
	};
}

const LABELS: Record<SetupStep["status"], string> = {
	ok: "ok     ",
	done: "done   ",
	planned: "planned",
};

export function formatSetupReport(report: SetupReport): string {
	const title = `af setup ${report.client}${report.mode ? ` (${report.mode})` : ""}${report.dryRun ? " --dry-run: nothing was changed" : ""}`;
	const lines = [title, ""];
	for (const step of report.steps) lines.push(`[${LABELS[step.status]}] ${step.detail}`);
	const changed = report.steps.filter((s) => s.status !== "ok").length;
	lines.push(
		"",
		changed === 0
			? "Already set up."
			: report.dryRun
				? `${changed} change(s) planned.`
				: `${changed} change(s) made.`,
	);
	if (changed > 0 || report.notes.some((n) => /twice/.test(n))) {
		for (const note of report.notes) lines.push(`Note: ${note}`);
	}
	return lines.join("\n");
}
