/**
 * Tests for `af doctor` (ORC-024): every check is pass, warn or fail with a fix
 * hint, the runs root is printed, the auth method of each runtime is shown,
 * and discovered skill packs are checked for contract compatibility. Commands
 * go through an injected probe, so no real CLI runs.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type DoctorCheck,
	type Probe,
	type ProbeResult,
	formatDoctorReport,
	runDoctorChecks,
} from "../src/commands/doctor.js";
import { useTempGlobalRoot } from "./helpers/temp-home.js";

const home = useTempGlobalRoot();
let base: string;
let repo: string;
let claudeDir: string;

const ok = (stdout: string): ProbeResult => ({ code: 0, stdout, stderr: "" });
const missing: ProbeResult = { code: 1, stdout: "", stderr: "not found" };

const CLAUDE_PLAN = JSON.stringify({
	loggedIn: true,
	authMethod: "claude.ai",
	subscriptionType: "max",
});

function probeFrom(responses: Record<string, ProbeResult>): Probe {
	return (command, args) => responses[[command, ...args].join(" ")] ?? missing;
}

const allGood: Record<string, ProbeResult> = {
	"git --version": ok("git version 2.50.0"),
	"claude --version": ok("2.1.322 (Claude Code)"),
	"claude auth status": ok(CLAUDE_PLAN),
	"codex --version": ok("codex-cli 0.128.0"),
	"codex login status": ok("Logged in using ChatGPT"),
	"gh --version": ok("gh version 2.81.0"),
	"gh auth status": ok(""),
};

function check(checks: DoctorCheck[], name: string): DoctorCheck | undefined {
	return checks.find((c) => c.name === name);
}

function writePack(root: string, files: Record<string, string>): void {
	mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
	writeFileSync(path.join(root, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "esp" }));
	mkdirSync(path.join(root, "af-workflows"), { recursive: true });
	for (const [file, text] of Object.entries(files)) {
		writeFileSync(path.join(root, "af-workflows", file), text);
	}
}

function installPlugin(root: string): void {
	mkdirSync(path.join(claudeDir, "plugins"), { recursive: true });
	writeFileSync(
		path.join(claudeDir, "plugins", "installed_plugins.json"),
		JSON.stringify({ version: 2, plugins: { "esp@m": [{ scope: "user", installPath: root }] } }),
	);
}

async function doctor(responses: Record<string, ProbeResult>, env: NodeJS.ProcessEnv = {}) {
	return runDoctorChecks({
		cwd: repo,
		env,
		probe: probeFrom(responses),
		version: "0.11.0",
		claudeDir,
		clientDirs: { codexHome: path.join(base, "codex") },
		findSupervisor: async () => null,
	});
}

beforeEach(() => {
	base = mkdtempSync(path.join(tmpdir(), "af-doctor-"));
	repo = path.join(base, "repo");
	mkdirSync(repo, { recursive: true });
	claudeDir = path.join(base, "claude");
});

afterEach(() => {
	rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("af doctor", () => {
	it("passes with installed, logged-in runtimes and prints the runs root", async () => {
		const report = await doctor(allGood);
		expect(report.runs_root).toBe(path.join(home.root, "runs"));
		expect(check(report.checks, "claude auth")).toMatchObject({
			status: "pass",
			detail: "Claude plan login (max)",
		});
		expect(check(report.checks, "codex auth")).toMatchObject({
			status: "pass",
			detail: "ChatGPT login",
		});
		expect(check(report.checks, "gh auth")?.status).toBe("pass");
		expect(check(report.checks, "runs root")?.detail).toContain(path.join(home.root, "runs"));
		expect(report.checks.filter((c) => c.status === "fail")).toEqual([]);

		const text = formatDoctorReport(report);
		expect(text).toContain(`Runs root: ${path.join(home.root, "runs")}`);
		expect(text).toContain("[PASS] claude auth: Claude plan login (max)");
	});

	it("fails missing tools and logged-out runtimes with a fix hint", async () => {
		const report = await doctor({
			"git --version": ok("git version 2.50.0"),
			"claude --version": ok("2.1.322"),
			"claude auth status": { code: 1, stdout: JSON.stringify({ loggedIn: false }), stderr: "" },
			"codex --version": ok("codex-cli 0.128.0"),
			"codex login status": { code: 1, stdout: "Not logged in", stderr: "" },
		});
		expect(check(report.checks, "claude auth")).toMatchObject({ status: "fail" });
		expect(check(report.checks, "claude auth")?.hint).toContain("claude auth login");
		expect(check(report.checks, "codex auth")?.hint).toContain("codex login");
		expect(check(report.checks, "gh")).toMatchObject({ status: "warn" });
		expect(check(report.checks, "gh auth")).toBeUndefined();
		const text = formatDoctorReport(report);
		expect(text).toContain("[FAIL] claude auth: not logged in");
		expect(text).toContain("fix: Run 'claude auth login'");
	});

	it("only warns when the optional codex and gh are installed but logged out", async () => {
		const report = await doctor({
			...allGood,
			"codex login status": { code: 1, stdout: "Not logged in", stderr: "" },
			"gh auth status": { code: 1, stdout: "", stderr: "not logged in" },
		});
		expect(check(report.checks, "codex auth")).toMatchObject({ status: "warn" });
		expect(check(report.checks, "codex auth")?.hint).toContain("codex login");
		expect(check(report.checks, "gh auth")).toMatchObject({ status: "warn" });
		expect(check(report.checks, "gh auth")?.hint).toContain("gh auth login");
		expect(report.checks.filter((c) => c.status === "fail")).toEqual([]);
	});

	it("fails a missing claude and skips its auth check", async () => {
		const report = await doctor({ "git --version": ok("git version 2.50.0") });
		expect(check(report.checks, "claude")).toMatchObject({ status: "fail" });
		expect(check(report.checks, "claude")?.hint).toContain(
			"npm install -g @anthropic-ai/claude-code",
		);
		expect(check(report.checks, "claude auth")).toBeUndefined();
		expect(check(report.checks, "codex")).toMatchObject({ status: "warn" });
	});

	it("warns when ANTHROPIC_API_KEY is set (it bills the key, not the plan)", async () => {
		const report = await doctor(allGood, { ANTHROPIC_API_KEY: "sk-test" });
		const warning = check(report.checks, "ANTHROPIC_API_KEY");
		expect(warning?.status).toBe("warn");
		expect(warning?.detail).toContain("instead of the Claude plan");
	});

	it("reports the API key as the auth method when claude is not logged in", async () => {
		const report = await doctor(
			{ ...allGood, "claude auth status": ok(JSON.stringify({ loggedIn: false })) },
			{ ANTHROPIC_API_KEY: "sk-test" },
		);
		expect(check(report.checks, "claude auth")).toMatchObject({
			status: "pass",
			detail: "API key (ANTHROPIC_API_KEY)",
		});
	});

	it("warns when the supervisor runs another version", async () => {
		const report = await runDoctorChecks({
			cwd: repo,
			env: {},
			probe: probeFrom(allGood),
			version: "0.11.0",
			claudeDir,
			clientDirs: { codexHome: path.join(base, "codex") },
			findSupervisor: async () => ({ version: "0.10.0", pid: 42 }),
		});
		expect(check(report.checks, "supervisor")).toMatchObject({ status: "warn" });
		expect(check(report.checks, "supervisor")?.hint).toContain("af serve --restart");
	});

	it("warns when the Claude plugin list is missing", async () => {
		const report = await doctor(allGood);
		expect(check(report.checks, "plugin detection")).toMatchObject({ status: "warn" });
		expect(check(report.checks, "plugin detection")?.hint).toContain("skill_packs.paths");
	});

	it("checks the contract compatibility of discovered packs", async () => {
		const pack = path.join(base, "cache", "esp");
		writePack(pack, {
			"ok.yaml": 'name: ok\nrequires: { agentic-forge: ">=0.11", contract: 1 }\nsteps: []\n',
		});
		installPlugin(pack);
		let report = await doctor(allGood);
		expect(check(report.checks, "plugin detection")?.status).toBe("pass");
		expect(check(report.checks, "skill pack esp")).toMatchObject({ status: "pass" });
		expect(report.skill_packs).toEqual([
			{ name: "esp", root: pack, origin: "claude-plugin", version: null },
		]);

		writeFileSync(
			path.join(pack, "af-workflows", "newer.yaml"),
			'name: newer\nrequires: { agentic-forge: ">=0.12", contract: 1 }\nsteps: []\n',
		);
		report = await doctor(allGood);
		expect(check(report.checks, "skill pack esp")).toMatchObject({ status: "warn" });
		expect(check(report.checks, "skill pack esp")?.detail).toContain("newer.yaml");

		writeFileSync(
			path.join(pack, "af-workflows", "future.yaml"),
			"name: future\nrequires: { contract: 2 }\nsteps: []\n",
		);
		report = await doctor(allGood);
		expect(check(report.checks, "skill pack esp")).toMatchObject({ status: "fail" });
		expect(check(report.checks, "skill pack esp")?.detail).toContain("future.yaml (contract 2)");
	});

	it("warns about configured pack paths without af-workflows", async () => {
		mkdirSync(path.join(repo, "agentic"), { recursive: true });
		writeFileSync(
			path.join(repo, "agentic", "config.json"),
			JSON.stringify({ skill_packs: { paths: ["../nowhere"], auto_detect: false } }),
		);
		const report = await doctor(allGood);
		expect(check(report.checks, "skill_packs.paths")).toMatchObject({ status: "warn" });
		expect(check(report.checks, "plugin detection")).toBeUndefined();
	});
});
