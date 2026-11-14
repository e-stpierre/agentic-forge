/**
 * Tests for `af setup claude|codex` and the `af doctor` MCP registration
 * checks. Every client config dir is a temp dir, and the `claude` CLI is a
 * fake that writes the files the real CLI writes, so no test touches the
 * user's Claude Code or Codex config. The smoke test lists the af tools and
 * dispatches the bundled demo workflow through the MCP server.
 */

import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkClaudeMcp, checkCodexMcp } from "../src/commands/doctor.js";
import { getOverseerPluginDir } from "../src/commands/overseer.js";
import { cmdSetup } from "../src/commands/setup.js";
import { createMcpServer } from "../src/mcp/index.js";
import { GLOBAL_ROOT_ENV } from "../src/paths.js";
import { RunManager } from "../src/runs/manager.js";
import {
	type ClientDirs,
	OVERSEER_PLUGIN_KEY,
	codexConfigPath,
	readClaudeUserMcp,
	readPluginMcp,
} from "../src/setup/clients.js";
import { readCodexMcp, writeCodexMcp } from "../src/setup/codex-toml.js";
import {
	type ClaudeCli,
	MARKETPLACE_DIR,
	type SetupOptions,
	runSetup,
} from "../src/setup/setup.js";
import { Supervisor, SupervisorClient, stopSupervisor } from "../src/supervisor/index.js";
import { fakeRuntime } from "./helpers/fake-runtime.js";
import { useTempGlobalRoot } from "./helpers/temp-home.js";

vi.mock("../src/runtimes/process-runner.js", async (importOriginal) => {
	const { fakeRuntime: fake } = await import("./helpers/fake-runtime.js");
	const original = await importOriginal<typeof import("../src/runtimes/process-runner.js")>();
	return { ...original, runRuntime: fake.run };
});

const home = useTempGlobalRoot();
const VERSION = JSON.parse(readFileSync(path.resolve(__dirname, "..", "package.json"), "utf-8"))
	.version as string;
let base: string;
let dirs: ClientDirs;
let cliScript: string;
let calls: string[][];

function readJson(file: string): Record<string, unknown> {
	return existsSync(file)
		? (JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>)
		: {};
}

function writeJson(file: string, data: unknown): void {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(data, null, 2));
}

/** A `claude` CLI that writes what the real one writes for the commands af setup runs. */
const fakeClaude: ClaudeCli = (args) => {
	calls.push(args);
	const plugins = path.join(dirs.claudeDir, "plugins");
	const known = path.join(plugins, "known_marketplaces.json");
	const installed = path.join(plugins, "installed_plugins.json");
	const [group, action, name] = args;
	if (group === "plugin" && action === "marketplace") {
		const markets = readJson(known);
		const [, , sub, target] = args;
		if (sub === "add") {
			markets["agentic-forge"] = {
				source: { source: "directory", path: target },
				installLocation: target,
			};
		} else if (sub === "remove") {
			delete markets[target];
		}
		writeJson(known, markets);
	} else if (group === "plugin" && action === "install") {
		const market = (readJson(known)["agentic-forge"] as { installLocation: string } | undefined)
			?.installLocation;
		if (!market) return { code: 1, stdout: "", stderr: "marketplace not found" };
		const manifest = readJson(path.join(market, ".claude-plugin", "marketplace.json")) as {
			plugins: { version: string }[];
		};
		const version = manifest.plugins[0].version;
		const installPath = path.join(plugins, "cache", "agentic-forge", "af-overseer", version);
		cpSync(path.join(market, "af-overseer"), installPath, { recursive: true });
		const list = readJson(installed) as { plugins?: Record<string, unknown> };
		writeJson(installed, {
			version: 2,
			plugins: { ...list.plugins, [name]: [{ scope: "user", installPath, version }] },
		});
	} else if (group === "plugin" && action === "uninstall") {
		const list = readJson(installed) as { plugins: Record<string, { installPath: string }[]> };
		for (const entry of list.plugins[name] ?? []) rmSync(entry.installPath, { recursive: true });
		delete list.plugins[name];
		writeJson(installed, list);
	} else if (group === "plugin" && action === "enable") {
		const settings = path.join(dirs.claudeDir, "settings.json");
		const data = readJson(settings) as { enabledPlugins?: Record<string, boolean> };
		writeJson(settings, { ...data, enabledPlugins: { ...data.enabledPlugins, [name]: true } });
	} else if (group === "mcp" && action === "add-json") {
		const data = readJson(dirs.claudeUserConfig) as { mcpServers?: Record<string, unknown> };
		const server = JSON.parse(args[3]) as Record<string, unknown>;
		writeJson(dirs.claudeUserConfig, {
			...data,
			mcpServers: { ...data.mcpServers, [name]: server },
		});
	} else if (group === "mcp" && action === "remove") {
		const data = readJson(dirs.claudeUserConfig) as { mcpServers: Record<string, unknown> };
		delete data.mcpServers[name];
		writeJson(dirs.claudeUserConfig, data);
	} else if (group !== "plugin" || action !== "update") {
		return { code: 1, stdout: "", stderr: `unexpected: ${args.join(" ")}` };
	}
	return { code: 0, stdout: "", stderr: "" };
};

function setup(options: Partial<SetupOptions> & Pick<SetupOptions, "client">) {
	return runSetup({
		dirs,
		invocation: { command: process.execPath, args: [cliScript] },
		claudeCli: fakeClaude,
		...options,
	});
}

/** Every file under a directory, relative, with its content (to prove a dry run changed nothing). */
function snapshot(dir: string): Record<string, string> {
	const out: Record<string, string> = {};
	const walk = (current: string) => {
		if (!existsSync(current)) return;
		for (const name of readdirSync(current, { withFileTypes: true })) {
			const full = path.join(current, name.name);
			if (name.isDirectory()) walk(full);
			else out[path.relative(dir, full)] = readFileSync(full, "utf-8");
		}
	};
	walk(dir);
	return out;
}

beforeEach(() => {
	base = mkdtempSync(path.join(tmpdir(), "af-setup-"));
	dirs = {
		claudeDir: path.join(base, "claude"),
		claudeUserConfig: path.join(base, "claude", ".claude.json"),
		codexHome: path.join(base, "codex"),
		afRoot: home.root,
	};
	cliScript = path.join(base, "af", "dist", "cli.js");
	mkdirSync(path.dirname(cliScript), { recursive: true });
	writeFileSync(cliScript, "// af cli\n");
	calls = [];
});

afterEach(() => {
	rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("af setup claude (plugin)", () => {
	it("plans without changing anything on --dry-run", () => {
		const before = { ...snapshot(base), ...snapshot(home.root) };
		const report = setup({ client: "claude", dryRun: true });
		expect(report.mode).toBe("plugin");
		expect(report.steps.map((s) => s.status)).toEqual(["planned", "planned", "planned"]);
		expect(report.steps[1].detail).toContain("claude plugin marketplace add");
		expect(report.steps[2].detail).toContain(`claude plugin install ${OVERSEER_PLUGIN_KEY}`);
		expect(calls).toEqual([]);
		expect({ ...snapshot(base), ...snapshot(home.root) }).toEqual(before);
	});

	it("installs the plugin with a generated .mcp.json, then changes nothing on a second run", () => {
		const first = setup({ client: "claude" });
		expect(first.steps.map((s) => s.status)).toEqual(["done", "done", "done"]);
		const marketplace = path.join(home.root, MARKETPLACE_DIR);
		expect(calls).toEqual([
			["plugin", "marketplace", "add", marketplace, "--scope", "user"],
			["plugin", "install", OVERSEER_PLUGIN_KEY, "--scope", "user"],
		]);
		const manifest = readJson(path.join(marketplace, ".claude-plugin", "marketplace.json"));
		expect(manifest).toMatchObject({
			name: "agentic-forge",
			plugins: [{ name: "af-overseer", source: "./af-overseer", version: VERSION }],
		});
		const installed = path.join(
			dirs.claudeDir,
			"plugins",
			"cache",
			"agentic-forge",
			"af-overseer",
			VERSION,
		);
		expect(readPluginMcp(installed)).toEqual({
			command: process.execPath,
			args: [cliScript, "mcp"],
		});
		for (const skill of ["overseer", "af-delegate"]) {
			expect(existsSync(path.join(installed, "skills", skill, "SKILL.md"))).toBe(true);
		}
		// The bundled plugin itself stays without .mcp.json
		expect(existsSync(path.join(getOverseerPluginDir(), ".mcp.json"))).toBe(false);

		calls = [];
		const second = setup({ client: "claude" });
		expect(second.steps.map((s) => s.status)).toEqual(["ok", "ok", "ok"]);
		expect(calls).toEqual([]);
		expect(checkClaudeMcp(dirs, VERSION)).toMatchObject({ status: "pass" });
	});

	it("reinstalls the plugin when the af CLI moved, and enables a disabled plugin", () => {
		setup({ client: "claude" });
		writeJson(path.join(dirs.claudeDir, "settings.json"), {
			enabledPlugins: { [OVERSEER_PLUGIN_KEY]: false },
		});
		expect(checkClaudeMcp(dirs, VERSION)).toMatchObject({ status: "warn" });
		const moved = path.join(base, "af2", "cli.js");
		mkdirSync(path.dirname(moved), { recursive: true });
		writeFileSync(moved, "");
		calls = [];
		const report = runSetup({
			client: "claude",
			dirs,
			invocation: { command: process.execPath, args: [moved] },
			claudeCli: fakeClaude,
		});
		expect(report.steps.every((s) => s.status === "done")).toBe(true);
		expect(calls.map((c) => c.slice(0, 3).join(" "))).toEqual([
			"plugin marketplace update",
			"plugin uninstall af-overseer@agentic-forge",
			"plugin install af-overseer@agentic-forge",
			"plugin enable af-overseer@agentic-forge",
		]);
		expect(checkClaudeMcp(dirs, VERSION)).toMatchObject({ status: "pass" });
		rmSync(moved);
		expect(checkClaudeMcp(dirs, VERSION)).toMatchObject({
			status: "warn",
			detail: expect.stringContaining("missing af CLI"),
		});
		expect(checkClaudeMcp(dirs, "99.0.0")).toMatchObject({
			status: "warn",
			hint: expect.stringContaining("af setup claude"),
		});
	});

	it("fails with the claude output when a claude command fails", () => {
		expect(() =>
			setup({ client: "claude", claudeCli: () => ({ code: 1, stdout: "", stderr: "boom" }) }),
		).toThrow(/claude plugin marketplace add.*failed:\nboom/s);
	});
});

describe("af setup claude --mode mcp", () => {
	it("registers a user-scope server and the standalone skills, idempotently", () => {
		writeJson(dirs.claudeUserConfig, { theme: "dark", mcpServers: { other: { command: "x" } } });
		const dry = setup({ client: "claude", mode: "mcp", dryRun: true });
		expect(dry.steps.map((s) => s.status)).toEqual(["planned", "planned", "planned"]);
		expect(calls).toEqual([]);
		expect(existsSync(path.join(dirs.claudeDir, "skills"))).toBe(false);

		setup({ client: "claude", mode: "mcp" });
		expect(calls).toHaveLength(1);
		expect(calls[0].slice(0, 3)).toEqual(["mcp", "add-json", "agentic-forge"]);
		expect(calls[0].slice(4)).toEqual(["--scope", "user"]);
		expect(readClaudeUserMcp(dirs)).toEqual({
			command: process.execPath,
			args: [cliScript, "mcp"],
		});
		expect(readJson(dirs.claudeUserConfig)).toMatchObject({
			theme: "dark",
			mcpServers: { other: {} },
		});
		const overseer = readFileSync(
			path.join(dirs.claudeDir, "skills", "af-overseer", "SKILL.md"),
			"utf-8",
		);
		expect(overseer).toMatch(/^---\nname: af-overseer\n/);
		expect(existsSync(path.join(dirs.claudeDir, "skills", "af-delegate", "SKILL.md"))).toBe(true);
		expect(checkClaudeMcp(dirs, VERSION)).toMatchObject({ status: "pass" });

		calls = [];
		expect(setup({ client: "claude", mode: "mcp" }).steps.every((s) => s.status === "ok")).toBe(
			true,
		);
		expect(calls).toEqual([]);

		// A server registered with another command is replaced
		writeJson(dirs.claudeUserConfig, {
			mcpServers: { "agentic-forge": { command: "af", args: ["mcp"] } },
		});
		setup({ client: "claude", mode: "mcp" });
		expect(calls.map((c) => c.slice(0, 2).join(" "))).toEqual(["mcp remove", "mcp add-json"]);
	});
});

describe("af setup codex", () => {
	const USER_TOML = `# my codex config
model = "gpt-5.5"

[mcp_servers.docs]
command = "docs-mcp"

[profiles.fast]
model = "gpt-5.5-mini"
`;

	it("adds the af server table and skills, keeps the rest of config.toml, and is idempotent", () => {
		const file = codexConfigPath(dirs);
		writeJson(file, {});
		writeFileSync(file, USER_TOML);
		const dry = setup({ client: "codex", dryRun: true });
		expect(dry.steps.map((s) => s.status)).toEqual(["planned", "planned", "planned"]);
		expect(readFileSync(file, "utf-8")).toBe(USER_TOML);
		expect(existsSync(path.join(dirs.codexHome, "skills"))).toBe(false);

		const report = setup({ client: "codex" });
		expect(report.steps.map((s) => s.status)).toEqual(["done", "done", "done"]);
		const text = readFileSync(file, "utf-8");
		expect(text.startsWith(USER_TOML)).toBe(true);
		const portable = (p: string) => p.replace(/\\/g, "/");
		expect(readCodexMcp(text)).toEqual({
			command: portable(process.execPath),
			args: [portable(cliScript), "mcp"],
			tool_timeout_sec: 900,
		});
		expect(text).toContain("[mcp_servers.agentic-forge]\ncommand = ");
		const skill = readFileSync(
			path.join(dirs.codexHome, "skills", "af-overseer", "SKILL.md"),
			"utf-8",
		);
		expect(skill).toMatch(/^---\nname: af-overseer\n/);
		expect(existsSync(path.join(dirs.codexHome, "skills", "af-delegate", "SKILL.md"))).toBe(true);
		expect(checkCodexMcp(dirs)).toMatchObject({ status: "pass" });

		expect(setup({ client: "codex" }).steps.every((s) => s.status === "ok")).toBe(true);
		expect(readFileSync(file, "utf-8")).toBe(text);
		expect(calls).toEqual([]);
	});

	it("replaces an outdated table in place and keeps its env subtable", () => {
		const file = codexConfigPath(dirs);
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(
			file,
			`[mcp_servers.agentic-forge]\ncommand = 'af'\nargs = ['mcp']\n\n[mcp_servers.agentic-forge.env]\nAGENTIC_FORGE_HOME = "C:/af"\n\n# profiles\n[profiles.fast]\nmodel = "m"\n`,
		);
		expect(checkCodexMcp(dirs)).toMatchObject({ status: "pass" });
		setup({ client: "codex" });
		const text = readFileSync(file, "utf-8");
		expect(readCodexMcp(text)).toMatchObject({
			args: [cliScript.replace(/\\/g, "/"), "mcp"],
			env: { AGENTIC_FORGE_HOME: "C:/af" },
		});
		expect(text.match(/\[mcp_servers\.agentic-forge\]/g)).toHaveLength(1);
		expect(text).toContain('\n# profiles\n[profiles.fast]\nmodel = "m"\n');
	});

	it("updates an outdated table in place and keeps the user's other settings", () => {
		const file = codexConfigPath(dirs);
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(
			file,
			[
				"[mcp_servers.agentic-forge]",
				"# managed by af",
				"command = 'af'",
				'env = { A = "b" }',
				"enabled = false",
				"startup_timeout_sec = 30",
				"tool_timeout_sec = 1800",
				"",
				"[mcp_servers.agentic-forge.tools.af_wait]",
				"approval = 'never'",
				"",
			].join("\n"),
		);
		setup({ client: "codex" });
		const text = readFileSync(file, "utf-8");
		const portable = (p: string) => p.replace(/\\/g, "/");
		expect(readCodexMcp(text)).toEqual({
			command: portable(process.execPath),
			args: [portable(cliScript), "mcp"],
			tool_timeout_sec: 1800,
		});
		expect(text).toContain('env = { A = "b" }\nenabled = false\nstartup_timeout_sec = 30\n');
		expect(text).toContain("# managed by af\n");
		expect(text).toContain("[mcp_servers.agentic-forge.tools.af_wait]\napproval = 'never'\n");
		expect(text.match(/^command = /gm)).toHaveLength(1);
		expect(setup({ client: "codex" }).steps.every((s) => s.status === "ok")).toBe(true);
		expect(readFileSync(file, "utf-8")).toBe(text);
	});

	it("raises a tool timeout below the af one", () => {
		const text = writeCodexMcp(
			"[mcp_servers.agentic-forge]\ncommand = 'af'\nargs = [\n  'mcp',\n]\ntool_timeout_sec = 60\nenabled = true\n",
			{ command: "node", args: ["cli.js", "mcp"], tool_timeout_sec: 900 },
		);
		expect(text).toBe(
			'[mcp_servers.agentic-forge]\ncommand = "node"\nargs = ["cli.js", "mcp"]\ntool_timeout_sec = 900\nenabled = true\n',
		);
	});

	it("reports a missing registration in af doctor", () => {
		expect(checkCodexMcp(dirs)).toMatchObject({
			status: "warn",
			hint: expect.stringContaining("af setup codex"),
		});
		expect(checkClaudeMcp(dirs, VERSION)).toMatchObject({
			status: "warn",
			hint: expect.stringContaining("af setup claude"),
		});
	});

	it("writes a table into an empty config", () => {
		const text = writeCodexMcp("", { command: "node", args: ["cli.js", "mcp"] });
		expect(text).toBe('[mcp_servers.agentic-forge]\ncommand = "node"\nargs = ["cli.js", "mcp"]\n');
	});
});

describe("af setup command", () => {
	it("validates the client and the mode, and prints a report", async () => {
		await expect(cmdSetup({ client: "vim" })).rejects.toThrow(/claude or codex/);
		await expect(cmdSetup({ client: "codex", mode: "mcp" })).rejects.toThrow(/claude only/);
		await expect(cmdSetup({ client: "claude", mode: "x" })).rejects.toThrow(/plugin or mcp/);
		const out: string[] = [];
		await cmdSetup(
			{ client: "codex", dryRun: true },
			{ dirs, invocation: { command: "node", args: [cliScript] }, out: (t) => out.push(t) },
		);
		expect(out.join("")).toContain("af setup codex --dry-run: nothing was changed");
		expect(out.join("")).toContain("3 change(s) planned.");
	});
});

describe("MCP smoke test", () => {
	const supervisors: Supervisor[] = [];
	const managers: RunManager[] = [];
	const clients: Client[] = [];

	afterEach(async () => {
		for (const client of clients.splice(0)) await client.close().catch(() => {});
		for (const manager of managers.splice(0)) manager.close();
		for (const supervisor of supervisors.splice(0)) await supervisor.stop();
		fakeRuntime.reset();
	});

	it("lists the af tools and dispatches the demo workflow to completion", async () => {
		const repo = path.join(base, "repo");
		mkdirSync(repo, { recursive: true });
		const supervisor = new Supervisor({ root: home.root, version: "1.0.0" });
		const manager = new RunManager({ root: home.root });
		manager.attach(supervisor);
		const discovery = await supervisor.start();
		await manager.start();
		supervisors.push(supervisor);
		managers.push(manager);
		const server = createMcpServer({
			getClient: async () => new SupervisorClient(discovery),
			registryRoot: home.root,
			cwd: repo,
			version: "1.0.0",
		});
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		const mcp = new Client({ name: "setup-smoke", version: "1.0.0" });
		await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
		clients.push(mcp);

		const { tools } = await mcp.listTools();
		const names = tools.map((t) => t.name);
		for (const name of ["af_dispatch", "af_wait", "af_status", "af_ask", "af_answer"]) {
			expect(names).toContain(name);
		}
		const result = await mcp.callTool({
			name: "af_dispatch",
			arguments: { workflow: "claude-demo", repo, wait: true, timeout_seconds: 60 },
		});
		const text = (result.content as Array<{ text: string }>)[0].text;
		expect(result.isError).toBeFalsy();
		const json = JSON.parse(text);
		expect(json.workflow).toContain("claude-demo");
		expect(json.wait).toMatchObject({ state: "ended", status: "done" });
		expect(fakeRuntime.calls.some((c) => c.prompt.includes("Demo workflow started"))).toBe(true);
	}, 60_000);

	const cliPath = path.resolve(__dirname, "..", "dist", "cli.js");
	it.skipIf(!existsSync(cliPath))(
		"starts the server the generated plugin registers over stdio",
		async () => {
			setup({ client: "claude" });
			const installed = path.join(
				dirs.claudeDir,
				"plugins",
				"cache",
				"agentic-forge",
				"af-overseer",
				VERSION,
			);
			const entry = readPluginMcp(installed);
			expect(entry).not.toBeNull();
			const env: Record<string, string> = {};
			for (const [key, value] of Object.entries(process.env)) {
				if (value !== undefined) env[key] = value;
			}
			env[GLOBAL_ROOT_ENV] = home.root;
			// The generated entry points at the test's fake cli.js: start the built CLI the same way
			const transport = new StdioClientTransport({
				command: entry?.command ?? "",
				args: [cliPath, "mcp"],
				env,
				cwd: base,
				stderr: "pipe",
			});
			const client = new Client({ name: "setup-stdio", version: "1.0.0" });
			await client.connect(transport);
			clients.push(client);
			const { tools } = await client.listTools();
			expect(tools.map((t) => t.name)).toContain("af_dispatch");
			await stopSupervisor({ root: home.root, force: true }).catch(() => false);
		},
		60_000,
	);
});
