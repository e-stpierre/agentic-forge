/**
 * Tests for the GitHub step types: `wait-for-review`, `wait-for-checks` and
 * `merge` with the per-repository merge lock and the `on-merge` worktree
 * cleanup. `gh` is replaced by `tests/helpers/fake-gh.mjs` through
 * `AF_GH_CMD`; runs go through an in-process supervisor with the fake runtime,
 * which also proves no agent session runs while a step waits.
 */

import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultConfig, getGithubConfig } from "../src/config.js";
import { shouldRemoveWorktree } from "../src/executor.js";
import { ghRunner, parsePaginated, repoFromPrUrl } from "../src/github/gh.js";
import {
	acquireMergeLock,
	gitCommonDir,
	mergeLockPath,
	readMergeLock,
} from "../src/github/merge-lock.js";
import { mergePolicy, resolveMergeMethod } from "../src/github/merge-method.js";
import { type PullRequest, deleteRemoteBranch } from "../src/github/pr.js";
import {
	codexReviewState,
	isReviewResultComment,
	resolveReviewers,
	reviewOfHead,
} from "../src/github/reviews.js";
import { WorkflowParseError, WorkflowParser } from "../src/parser.js";
import { dispatchRun } from "../src/runs/client.js";
import type { DispatchPayload } from "../src/runs/dispatch.js";
import { RunManager, pendingInput } from "../src/runs/manager.js";
import { RunStore } from "../src/runs/run-store.js";
import { SessionOutput } from "../src/runtimes/types.js";
import { Backoff, idSlug } from "../src/steps/github-base.js";
import { headRequestId } from "../src/steps/merge-step.js";
import {
	NO_CHECKS_GRACE_SECONDS,
	checksTiming,
	requiresChecks,
	summarizeChecks,
} from "../src/steps/wait-for-checks-step.js";
import { Supervisor, SupervisorClient } from "../src/supervisor/index.js";
// @ts-expect-error plain ESM test helper without types
import { fakeGh } from "./helpers/fake-gh.mjs";
import { fakeRuntime } from "./helpers/fake-runtime.js";
import { useTempGlobalRoot } from "./helpers/temp-home.js";

vi.mock("../src/runtimes/process-runner.js", async (importOriginal) => {
	const { fakeRuntime: fake } = await import("./helpers/fake-runtime.js");
	const original = await importOriginal<typeof import("../src/runtimes/process-runner.js")>();
	return { ...original, runRuntime: fake.run };
});

vi.setConfig({ testTimeout: 30_000 });

// In-process fake gh; FAKE_GH_PROCESS=1 in a run's env goes through the real
// runner, which spawns tests/helpers/fake-gh.mjs through AF_GH_CMD.
const realGh = ghRunner.run;
ghRunner.run = async (args, options) => {
	const env = { ...process.env, ...(options.env ?? {}) };
	if (env.FAKE_GH_PROCESS === "1") return realGh(args, options);
	return fakeGh(args, { cwd: options.cwd ?? process.cwd(), env });
};

const FAKE_GH = path.join(path.dirname(fileURLToPath(import.meta.url)), "helpers", "fake-gh.mjs");
// biome-ignore lint/suspicious/noExplicitAny: test reads of JSON files
type Json = Record<string, any>;

const HEAD = "a".repeat(40);
const NEW_HEAD = "b".repeat(40);

const home = useTempGlobalRoot();
let work: string;
const supervisors: Supervisor[] = [];
const managers: RunManager[] = [];

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
}

function initRepo(dir: string): string {
	mkdirSync(dir, { recursive: true });
	git(dir, "init", "-q", "-b", "main");
	git(dir, "config", "user.email", "test@example.com");
	git(dir, "config", "user.name", "Test");
	git(dir, "config", "commit.gpgsign", "false");
	writeFileSync(path.join(dir, "README.md"), "hello\n");
	git(dir, "add", ".");
	git(dir, "commit", "-q", "-m", "init");
	mkdirSync(path.join(dir, "agentic", "workflows"), { recursive: true });
	return dir;
}

function prJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		number: 7,
		url: "https://github.com/o/r/pull/7",
		state: "OPEN",
		isDraft: false,
		headRefName: "feature/x",
		headRefOid: HEAD,
		baseRefName: "main",
		isCrossRepository: false,
		commits: [{ oid: HEAD, committedDate: "2026-11-01T10:00:00Z" }],
		...overrides,
	};
}

/** Writes a fake gh state file and returns its path. */
function ghState(name: string, state: Record<string, unknown>): string {
	const file = path.join(work, `${name}.json`);
	writeFileSync(
		file,
		JSON.stringify({ pr: prJson(), repo: { allow_squash_merge: true }, ...state }),
	);
	return file;
}

function readState(file: string): Json {
	return JSON.parse(readFileSync(file, "utf-8"));
}

function ghCalls(file: string): { args: string[]; cwd: string; start: number; end: number }[] {
	const log = `${file}.calls.jsonl`;
	if (!existsSync(log)) return [];
	return readFileSync(log, "utf-8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((l) => JSON.parse(l));
}

function testConfig(): Record<string, unknown> {
	const config = getDefaultConfig();
	config.github = {
		...(config.github as Record<string, unknown>),
		poll_seconds: 0.05,
		max_poll_seconds: 0.05,
		trigger_after_seconds: 0,
	};
	return config;
}

function payload(
	repoRoot: string,
	contents: string,
	stateFile: string,
	config = testConfig(),
	extraEnv: Record<string, string> = {},
): DispatchPayload {
	return {
		repo_root: repoRoot,
		workflow: { path: path.join(repoRoot, "agentic", "workflows", "wf.yaml"), contents },
		config,
		env: {
			...process.env,
			AF_GH_CMD: JSON.stringify([process.execPath, FAKE_GH]),
			FAKE_GH_STATE: stateFile,
			...extraEnv,
		},
		variables: {},
		runtime: null,
		from_step: null,
		slug: "gh",
		terminal_output: "base",
	};
}

async function startSupervisor() {
	const supervisor = new Supervisor({ root: home.root, version: "1.0.0" });
	const manager = new RunManager({ root: home.root });
	manager.attach(supervisor);
	const discovery = await supervisor.start();
	await manager.start();
	supervisors.push(supervisor);
	managers.push(manager);
	return { supervisor, manager, client: new SupervisorClient(discovery) };
}

async function waitForStatus(
	manager: RunManager,
	run: string | { id: string },
	status: string,
): Promise<void> {
	const id = typeof run === "string" ? run : run.id;
	for (let i = 0; i < 1500; i++) {
		if (manager.registry.get(id)?.status === status) {
			await manager.idle();
			return;
		}
		await new Promise((r) => setTimeout(r, 10));
	}
	throw new Error(`Run ${id} never reached ${status} (${manager.registry.get(id)?.status})`);
}

function eventsOf(dir: string): { type: string; data: Json }[] {
	return new RunStore(dir).readEvents(0) as never;
}

function stepResult(dir: string, step: string): Json {
	const name = readdirSync(path.join(dir, "steps")).find((d) => d.endsWith(`-${step}`));
	if (!name) throw new Error(`No step dir for ${step}`);
	return JSON.parse(readFileSync(path.join(dir, "steps", name, "result.json"), "utf-8"));
}

function wf(steps: string, settings = ""): string {
	return `name: gh\n${settings}steps:\n${steps}`;
}

function pr(overrides: Partial<PullRequest> = {}): PullRequest {
	return {
		number: 7,
		url: "https://github.com/o/r/pull/7",
		repo: "o/r",
		state: "OPEN",
		isDraft: false,
		headRefName: "feature/x",
		headRefOid: HEAD,
		baseRefName: "main",
		isCrossRepository: false,
		headCommittedAt: "2026-11-01T10:00:00Z",
		...overrides,
	};
}

beforeEach(() => {
	fakeRuntime.reset();
	work = mkdtempSync(path.join(tmpdir(), "af-gh-steps-"));
});

afterEach(async () => {
	checksTiming.noChecksGraceSeconds = NO_CHECKS_GRACE_SECONDS;
	for (const m of managers.splice(0)) m.close();
	await Promise.all(supervisors.splice(0).map((s) => s.stop()));
	rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("parsing", () => {
	const parse = (steps: string, settings = "") =>
		new WorkflowParser().parseString(wf(steps, settings));

	it("parses the GitHub step fields", () => {
		const parsed = parse(
			[
				"  - { name: r, type: wait-for-review, reviewers: [claude, codex], trigger: true, poll-seconds: 10, timeout-minutes: 5 }",
				'  - { name: r2, type: wait-for-review, reviewers: "{{ variables.reviewers }}", pr: 12 }',
				"  - { name: c, type: wait-for-checks, checks: all, on-fail: continue }",
				"  - { name: m, type: merge, method: squash, delete-branch: false }",
				"  - { name: ms, type: merge, skill: esp-skills:esp-merge, args: --dry-run }",
			].join("\n"),
			"settings:\n  worktree: { enabled: true, cleanup: on-merge }\n",
		);
		expect(parsed.steps[0]).toMatchObject({
			type: "wait-for-review",
			reviewers: ["claude", "codex"],
			trigger: true,
			pollSeconds: 10,
			stepTimeoutMinutes: 5,
		});
		expect(parsed.steps[1]).toMatchObject({ reviewers: "{{ variables.reviewers }}", pr: "12" });
		expect(parsed.steps[2]).toMatchObject({ checks: "all", onChecksFail: "continue" });
		expect(parsed.steps[3]).toMatchObject({ method: "squash", deleteBranch: false });
		expect(parsed.steps[3].skill ?? null).toBeNull();
		expect(parsed.steps[4]).toMatchObject({ skill: "esp-skills:esp-merge", args: "--dry-run" });
		expect(parsed.settings.worktree.cleanup).toBe("on-merge");
	});

	it("rejects invalid fields and GitHub steps inside a parallel step", () => {
		expect(() => parse("  - { name: r, type: wait-for-review }")).toThrow(/needs 'reviewers'/);
		expect(() => parse("  - { name: c, type: wait-for-checks, checks: some }")).toThrow(
			WorkflowParseError,
		);
		expect(() => parse("  - { name: m, type: merge, method: fast-forward }")).toThrow(/method/);
		expect(() => parse('  - { name: m, type: merge, head: "" }')).toThrow(/head/);
		expect(
			parse("  - { name: m, type: merge, head: \"{{ outputs['c'].head }}\" }").steps[0].head,
		).toBe("{{ outputs['c'].head }}");
		expect(() =>
			parse(
				"  - name: p\n    type: parallel\n    steps:\n      - { name: m, type: merge }\n      - { name: x, type: prompt, prompt: hi }",
			),
		).toThrow(/not allowed inside a parallel step/);
	});
});

describe("pure helpers", () => {
	it("finds a reviewer's review of the head commit", () => {
		const claude = { name: "claude", login: "claude[bot]", trigger: null };
		const codex = {
			name: "codex",
			login: "chatgpt-codex-connector[bot]",
			trigger: "@codex review",
		};
		const review = (login: string, commit: string) => ({
			id: 1,
			login,
			state: "COMMENTED",
			commitId: commit,
			submittedAt: "2026-11-01T11:00:00Z",
			url: null,
		});
		// A review of an older commit does not count
		expect(reviewOfHead(claude, pr(), [review("claude[bot]", "c".repeat(40))], [])).toBeNull();
		expect(reviewOfHead(claude, pr(), [review("claude[bot]", HEAD)], [])?.source).toBe("review");

		// Codex summary marker on the head
		const marker = (sha: string) =>
			`<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 {"code_review":{"commit_sha":"${sha}","has_any_findings":false,"status":"completed"}} -->`;
		const comment = (login: string, body: string, at = "2026-11-01T12:00:00Z") => ({
			id: 2,
			login,
			body,
			createdAt: at,
			updatedAt: at,
			url: null,
		});
		expect(codexReviewState(marker(HEAD))).toEqual({
			commit: HEAD,
			status: "completed",
			findings: false,
		});
		expect(
			reviewOfHead(codex, pr(), [], [comment("chatgpt-codex-connector[bot]", marker(HEAD))])
				?.source,
		).toBe("summary");
		expect(
			reviewOfHead(
				codex,
				pr(),
				[],
				[comment("chatgpt-codex-connector[bot]", marker("d".repeat(40)))],
			),
		).toBeNull();

		// A Claude "No issues found" comment after the head commit counts; one before does not
		expect(
			reviewOfHead(claude, pr(), [], [comment("claude[bot]", "## Code review\nNo issues found.")])
				?.source,
		).toBe("comment");
		expect(
			reviewOfHead(claude, pr(), [], [comment("claude[bot]", "old", "2026-10-01T00:00:00Z")]),
		).toBeNull();
	});

	it("counts only review result comments, newer than the time a pushed head was first seen", () => {
		const claude = { name: "claude", login: "claude[bot]", trigger: null };
		const comment = (body: string, at: string) => ({
			id: 2,
			login: "claude[bot]",
			body,
			createdAt: at,
			updatedAt: at,
			url: null,
		});
		expect(isReviewResultComment("## Code review\n\nFound 2 issues")).toBe(true);
		expect(isReviewResultComment("No issues found. Checked for bugs.")).toBe(true);
		expect(isReviewResultComment("Claude is working on your request...")).toBe(false);
		// A progress comment after the head commit does not count
		expect(
			reviewOfHead(claude, pr(), [], [comment("Working on it...", "2026-11-01T12:00:00Z")]),
		).toBeNull();
		// A head committed at 10:00, pushed and first seen at 10:12: the 10:05
		// comment is about the previous head
		const old = comment("## Code review\nNo issues found.", "2026-11-01T10:05:00Z");
		expect(reviewOfHead(claude, pr(), [], [old])?.source).toBe("comment");
		const since = Date.parse("2026-11-01T10:12:00Z");
		expect(reviewOfHead(claude, pr(), [], [old], { since })).toBeNull();
		const fresh = comment("## Code review\nNo issues found.", "2026-11-01T10:20:00Z");
		expect(reviewOfHead(claude, pr(), [], [old, fresh], { since })?.at).toBe(
			"2026-11-01T10:20:00Z",
		);
	});

	it("reads required checks from the branch rules", () => {
		expect(requiresChecks([])).toBe(false);
		expect(requiresChecks([{ type: "pull_request" }])).toBe(false);
		expect(
			requiresChecks([
				{ type: "required_status_checks", parameters: { required_status_checks: [] } },
			]),
		).toBe(false);
		expect(
			requiresChecks([
				{
					type: "required_status_checks",
					parameters: { required_status_checks: [{ context: "test" }] },
				},
			]),
		).toBe(true);
	});

	it("builds contract ids from any step name", () => {
		expect(idSlug("Merge PR")).toBe("Merge-PR");
		expect(idSlug("  ")).toBe("step");
		expect(headRequestId("Merge PR", NEW_HEAD)).toBe("merge-head-Merge-PR-bbbbbbb");
	});

	it("keeps the polling intervals above zero", () => {
		const config = getGithubConfig({ github: { poll_seconds: 0, max_poll_seconds: -1 } });
		expect(config.pollSeconds).toBe(30);
		expect(config.maxPollSeconds).toBe(300);
		expect(getGithubConfig({ github: { poll_seconds: 0.5 } }).pollSeconds).toBe(0.5);
	});

	it("encodes the branch of a remote delete and tells a missing branch from a failure", async () => {
		const file = ghState("delete", {});
		const env = { FAKE_GH_STATE: file };
		expect(await deleteRemoteBranch(pr({ headRefName: "fix/issue#12" }), { env })).toEqual({
			outcome: "deleted",
		});
		expect(readState(file).deletedBranches).toEqual(["fix/issue%2312"]);
		const s = readState(file);
		s.deleteError = "gh: Reference does not exist (HTTP 422)";
		writeFileSync(file, JSON.stringify(s));
		expect((await deleteRemoteBranch(pr(), { env })).outcome).toBe("gone");
		s.deleteError = "gh: Resource not accessible by integration (HTTP 403)";
		writeFileSync(file, JSON.stringify(s));
		expect(await deleteRemoteBranch(pr(), { env })).toEqual({
			outcome: "failed",
			detail: "gh: Resource not accessible by integration (HTTP 403)",
		});
	});

	it("resolves reviewer names from the config and treats unknown names as logins", () => {
		const config = getGithubConfig({
			github: { reviewers: { bot: { login: "my-bot[bot]", trigger: "/review" } } },
		});
		expect(
			resolveReviewers(["claude", "codex", "bot", "someone", "claude"], config.reviewers),
		).toEqual([
			{ name: "claude", login: "claude[bot]", trigger: null },
			{ name: "codex", login: "chatgpt-codex-connector[bot]", trigger: "@codex review" },
			{ name: "bot", login: "my-bot[bot]", trigger: "/review" },
			{ name: "someone", login: "someone", trigger: null },
		]);
	});

	it("sums up checks", () => {
		const check = (name: string, bucket: string) => ({
			name,
			bucket,
			state: "",
			link: null,
			workflow: null,
		});
		expect(summarizeChecks([check("a", "pass"), check("b", "pending")]).conclusion).toBe("pending");
		expect(summarizeChecks([check("a", "pass"), check("b", "fail")])).toMatchObject({
			conclusion: "fail",
			failed: ["b"],
		});
		expect(summarizeChecks([check("a", "pass"), check("s", "skipping")]).conclusion).toBe("pass");
	});

	it("resolves the merge method like esp-merge", () => {
		const all = { squash: true, rebase: true, merge: true };
		expect(resolveMergeMethod(mergePolicy(all)).method).toBe("squash");
		expect(resolveMergeMethod(mergePolicy(all), "repo", ["merge", "squash"]).method).toBe("merge");
		expect(
			resolveMergeMethod(mergePolicy(all, [{ type: "required_linear_history" }]), "repo", [
				"merge",
				"rebase",
			]).method,
		).toBe("rebase");
		expect(
			resolveMergeMethod(mergePolicy({ squash: false, rebase: true, merge: false })).reason,
		).toMatch(/only method/);
		const queued = resolveMergeMethod(
			mergePolicy(all, [{ type: "merge_queue", parameters: { merge_method: "REBASE" } }]),
		);
		expect(queued).toMatchObject({ method: "rebase", queue: true });
		expect(
			resolveMergeMethod(
				mergePolicy(all, [
					{ type: "pull_request", parameters: { allowed_merge_methods: ["rebase"] } },
				]),
			).method,
		).toBe("rebase");
		expect(() =>
			resolveMergeMethod(mergePolicy({ squash: true, rebase: false, merge: false }), "rebase"),
		).toThrow(/not allowed/);
	});

	it("parses paginated output, repo URLs and backs off", () => {
		expect(parsePaginated("[1,2][3]")).toEqual([1, 2, 3]);
		expect(parsePaginated("")).toEqual([]);
		expect(repoFromPrUrl("https://github.com/o/r/pull/7")).toBe("o/r");
		const b = new Backoff(10, 35);
		expect([b.next(), b.next(), b.next(), b.next()]).toEqual([10_000, 20_000, 35_000, 35_000]);
		b.reset();
		expect(b.next()).toBe(10_000);
	});

	it("keeps or removes the worktree for on-merge", () => {
		expect(shouldRemoveWorktree("on-merge", "completed", { merged: true })).toBe(true);
		expect(shouldRemoveWorktree("on-merge", "completed")).toBe(false);
		expect(shouldRemoveWorktree("on-merge", "failed", { merged: true })).toBe(true);
		expect(shouldRemoveWorktree("on-merge", "awaiting-human", { merged: true })).toBe(false);
	});
});

describe("merge lock", () => {
	it("is shared by every worktree of a repository", () => {
		const main = initRepo(path.join(work, "repo"));
		const wt = path.join(work, "wt");
		git(main, "worktree", "add", "-q", "-b", "other", wt);
		expect(gitCommonDir(wt)).toBe(gitCommonDir(main));
		expect(mergeLockPath(wt)).toBe(mergeLockPath(main));
		const otherRepo = initRepo(path.join(work, "repo2"));
		expect(mergeLockPath(otherRepo)).not.toBe(mergeLockPath(main));
		expect(path.dirname(mergeLockPath(main))).toBe(path.join(home.root, "locks"));
	});

	it("serializes holders and takes over a stale lock", async () => {
		const lockPath = path.join(work, "merge.lock");
		const first = await acquireMergeLock(lockPath, { timeoutMs: 1000, holder: { run: "one" } });
		expect(first).not.toBeNull();
		expect(readMergeLock(lockPath)).toMatchObject({ run: "one", token: first?.token });

		// Busy: a second holder times out
		const busy: unknown[] = [];
		expect(
			await acquireMergeLock(lockPath, { timeoutMs: 100, pollMs: 20, onBusy: (h) => busy.push(h) }),
		).toBeNull();
		expect(busy).toHaveLength(1);

		// Waits, then gets it on release
		const second = acquireMergeLock(lockPath, {
			timeoutMs: 2000,
			pollMs: 20,
			holder: { run: "two" },
		});
		setTimeout(() => first?.release(), 100);
		const lock = await second;
		expect(readMergeLock(lockPath)?.run).toBe("two");
		lock?.release();
		expect(existsSync(lockPath)).toBe(false);

		// A holder that died (no heartbeat) leaves a stale lock: taken over
		writeFileSync(lockPath, JSON.stringify({ pid: 999999, token: "dead", run: "crashed" }));
		const old = new Date(Date.now() - 60_000);
		utimesSync(lockPath, old, old);
		const taken = await acquireMergeLock(lockPath, { timeoutMs: 100 });
		expect(taken).not.toBeNull();
		expect(readMergeLock(lockPath)?.token).toBe(taken?.token);

		// Release never removes a lock another holder took over
		writeFileSync(lockPath, JSON.stringify({ token: "someone-else" }));
		taken?.release();
		expect(readMergeLock(lockPath)?.token).toBe("someone-else");
	});

	it("refreshes a held lock with its heartbeat", async () => {
		const lockPath = path.join(work, "beat.lock");
		const lock = await acquireMergeLock(lockPath, { timeoutMs: 100, heartbeatMs: 20 });
		const old = new Date(Date.now() - 60_000);
		utimesSync(lockPath, old, old);
		await new Promise((r) => setTimeout(r, 80));
		const age = Date.now() - (await import("node:fs")).statSync(lockPath).mtimeMs;
		expect(age).toBeLessThan(5_000);
		lock?.release();
	});
});

describe("wait-for-review", () => {
	const marker = (sha: string) =>
		`<!-- codex-review-state:v1 {"code_review":{"commit_sha":"${sha}","status":"completed"}} -->`;

	it("completes once every reviewer reviewed the current head, restarting on a new head", async () => {
		const repo = initRepo(path.join(work, "repo"));
		const state = ghState("review", {
			reviews: [{ id: 1, user: { login: "claude[bot]" }, state: "COMMENTED", commit_id: HEAD }],
			comments: [],
			timeline: {
				// A push: the head moves before codex reviewed it
				"2": {
					pr: prJson({
						headRefOid: NEW_HEAD,
						commits: [{ oid: NEW_HEAD, committedDate: "2026-11-02T10:00:00Z" }],
					}),
				},
				"4": {
					reviews: [
						{ id: 1, user: { login: "claude[bot]" }, state: "COMMENTED", commit_id: HEAD },
						{ id: 2, user: { login: "claude[bot]" }, state: "APPROVED", commit_id: NEW_HEAD },
					],
					comments: [
						{
							id: 3,
							user: { login: "chatgpt-codex-connector[bot]" },
							body: marker(NEW_HEAD),
							created_at: "2026-11-02T11:00:00Z",
						},
					],
				},
			},
		});
		const { manager, client } = await startSupervisor();
		const { run, dir } = await dispatchRun(
			client,
			payload(
				repo,
				wf("  - { name: wait, type: wait-for-review, reviewers: [claude, codex] }"),
				state,
			),
		);
		await waitForStatus(manager, run, "done");

		const result = stepResult(dir, "wait");
		expect(result.status).toBe("done");
		expect(result.outputs).toMatchObject({ head: NEW_HEAD, missing: [], skipped: false });
		expect(result.outputs.reviews.map((r: { reviewer: string }) => r.reviewer)).toEqual([
			"claude",
			"codex",
		]);
		const received = eventsOf(dir).filter((e) => e.type === "review.received");
		expect(received.map((e) => `${e.data.reviewer}@${e.data.commit.slice(0, 1)}`)).toEqual([
			"claude@a",
			"claude@b",
			"codex@b",
		]);
		// No agent session ran while waiting, and no trigger was posted (auto_trigger off)
		expect(fakeRuntime.calls).toHaveLength(0);
		expect(readState(state).triggers).toBeUndefined();
		// The step's pull request becomes the run's
		expect(new RunStore(dir).readRun().pr).toBe("https://github.com/o/r/pull/7");
		expect(eventsOf(dir).some((e) => e.type === "pr.opened")).toBe(true);
	});

	it("posts trigger comments, times out to awaiting-human, and continues on the answer", async () => {
		const repo = initRepo(path.join(work, "repo"));
		const state = ghState("timeout", { reviews: [], comments: [] });
		const { manager, client } = await startSupervisor();
		const { run, dir } = await dispatchRun(
			client,
			payload(
				repo,
				wf(
					"  - { name: wait, type: wait-for-review, reviewers: [claude, codex], trigger: true, timeout-minutes: 0.005 }\n  - { name: after, type: prompt, prompt: next }",
				),
				state,
			),
		);
		await waitForStatus(manager, run, "awaiting-human");
		expect(readState(state).triggers).toEqual(["@codex review"]);
		const pending = pendingInput(new RunStore(dir).readRun());
		expect(pending?.request).toMatchObject({
			id: "review-timeout-wait-1",
			options: [{ id: "wait" }, { id: "continue" }],
			blocking: true,
		});
		expect(fakeRuntime.calls).toHaveLength(0);

		await client.request("POST", `/v1/runs/${run.id}/answer`, { answer: "continue" });
		await waitForStatus(manager, run, "done");
		expect(stepResult(dir, "wait").outputs).toMatchObject({
			skipped: true,
			missing: ["claude", "codex"],
		});
		expect(fakeRuntime.calls).toHaveLength(1);
	});

	it("waits again on a wait answer", async () => {
		const repo = initRepo(path.join(work, "repo"));
		const state = ghState("again", { reviews: [], comments: [] });
		const { manager, client } = await startSupervisor();
		const { run, dir } = await dispatchRun(
			client,
			payload(
				repo,
				wf(
					"  - { name: wait, type: wait-for-review, reviewers: [claude], timeout-minutes: 0.003 }",
				),
				state,
			),
		);
		await waitForStatus(manager, run, "awaiting-human");
		const s = readState(state);
		s.reviews = [{ id: 1, user: { login: "claude[bot]" }, state: "APPROVED", commit_id: HEAD }];
		writeFileSync(state, JSON.stringify(s));
		await client.request("POST", `/v1/runs/${run.id}/answer`, { answer: "wait" });
		await waitForStatus(manager, run, "done");
		expect(stepResult(dir, "wait").outputs).toMatchObject({ skipped: false, missing: [] });
	});
});

describe("wait-for-checks", () => {
	const check = (name: string, bucket: string) => ({ name, bucket, state: bucket.toUpperCase() });

	it("waits for required checks and reports pass", async () => {
		const repo = initRepo(path.join(work, "repo"));
		const state = ghState("checks", {
			requiredChecks: [check("test", "pending")],
			checks: [check("test", "pending"), check("lint", "fail")],
			timeline: { "3": { requiredChecks: [check("test", "pass")] } },
		});
		const { manager, client } = await startSupervisor();
		const { run, dir } = await dispatchRun(
			client,
			payload(repo, wf("  - { name: checks, type: wait-for-checks }"), state),
		);
		await waitForStatus(manager, run, "done");
		expect(stepResult(dir, "checks").outputs).toMatchObject({
			result: "pass",
			passed: true,
			scope: "required",
		});
		const completed = eventsOf(dir).find((e) => e.type === "checks.completed");
		expect(completed?.data).toMatchObject({ conclusion: "pass", commit: HEAD });
		expect(fakeRuntime.calls).toHaveLength(0);
	});

	it("falls back to all checks, and fails on a failing one unless on-fail is continue", async () => {
		const repo = initRepo(path.join(work, "repo"));
		const state = ghState("fail", {
			requiredChecks: null,
			checks: [check("test", "pass"), check("lint", "fail")],
		});
		const { manager, client } = await startSupervisor();
		const failing = await dispatchRun(
			client,
			payload(repo, wf("  - { name: checks, type: wait-for-checks }"), state),
		);
		await waitForStatus(manager, failing.run, "failed");
		expect(stepResult(failing.dir, "checks")).toMatchObject({
			status: "failed",
			outputs: { result: "fail", scope: "all", failed: ["lint"] },
		});

		const going = await dispatchRun(
			client,
			payload(repo, wf("  - { name: checks, type: wait-for-checks, on-fail: continue }"), state),
		);
		await waitForStatus(manager, going.run, "done");
		expect(stepResult(going.dir, "checks").outputs).toMatchObject({
			result: "fail",
			passed: false,
		});
	});

	it("keeps the required scope when the base rules require checks that are not listed yet", async () => {
		const repo = initRepo(path.join(work, "repo"));
		const state = ghState("rules", {
			rules: [
				{
					type: "required_status_checks",
					parameters: { required_status_checks: [{ context: "test" }] },
				},
			],
			// Right after the push: no required check listed yet, an optional one failed
			requiredChecks: null,
			checks: [check("lint", "fail")],
			timeline: {
				"3": {
					requiredChecks: [check("test", "pass")],
					checks: [check("test", "pass"), check("lint", "fail")],
				},
			},
		});
		const { manager, client } = await startSupervisor();
		const { run, dir } = await dispatchRun(
			client,
			payload(repo, wf("  - { name: checks, type: wait-for-checks }"), state),
		);
		await waitForStatus(manager, run, "done");
		expect(stepResult(dir, "checks").outputs).toMatchObject({
			result: "pass",
			scope: "required",
			total: 1,
		});
	});

	it("restarts the no-check grace period on a new head", async () => {
		checksTiming.noChecksGraceSeconds = 1;
		const repo = initRepo(path.join(work, "repo"));
		const newHead = prJson({
			headRefOid: NEW_HEAD,
			commits: [{ oid: NEW_HEAD, committedDate: "2026-11-02T10:00:00Z" }],
		});
		const state = ghState("grace", {
			// The first head keeps a pending check past the grace period
			checks: [check("test", "pending")],
			timeline: {
				// A push: the new head lists no check on its first polls
				"30": { pr: newHead, checks: [] },
				"32": { checks: [check("test", "pass")] },
			},
		});
		const { manager, client } = await startSupervisor();
		const { run, dir } = await dispatchRun(
			client,
			payload(repo, wf("  - { name: checks, type: wait-for-checks, checks: all }"), state),
		);
		await waitForStatus(manager, run, "done");
		expect(stepResult(dir, "checks").outputs).toMatchObject({
			head: NEW_HEAD,
			result: "pass",
			total: 1,
		});
	});
});

describe("merge", () => {
	it("merges natively from a worktree run, then removes the worktree and its branch (on-merge)", async () => {
		const repo = initRepo(path.join(work, "repo"));
		const state = ghState("merge", {
			repo: { allow_squash_merge: true, allow_rebase_merge: true, allow_merge_commit: true },
		});
		const { manager, client } = await startSupervisor();
		const { run, dir } = await dispatchRun(
			client,
			payload(
				repo,
				wf(
					"  - { name: merge, type: merge }",
					"settings:\n  worktree: { enabled: true, cleanup: on-merge }\n",
				),
				state,
				testConfig(),
				// The real runner: spawns the fake gh script through AF_GH_CMD
				{ FAKE_GH_PROCESS: "1" },
			),
		);
		await waitForStatus(manager, run, "merged");
		const runJson = new RunStore(dir).readRun();
		expect(runJson.worktree).toBeTruthy();
		expect(existsSync(runJson.worktree as string)).toBe(false);
		expect(git(repo, "branch", "--list", runJson.branch as string).trim()).toBe("");

		const merge = ghCalls(state).find((c) => c.args[0] === "pr" && c.args[1] === "merge");
		expect(merge?.args).toEqual(
			expect.arrayContaining(["--repo", "o/r", "--squash", "--match-head-commit", HEAD]),
		);
		expect(merge?.args).not.toContain("--delete-branch");
		// gh merges from outside the worktree (the run dir), never inside it
		expect(path.resolve(merge?.cwd ?? "")).toBe(path.resolve(dir));
		expect(readState(state).deletedBranches).toEqual(["feature/x"]);

		const types = eventsOf(dir).map((e) => e.type);
		expect(types).toEqual(
			expect.arrayContaining(["branch.created", "merge.locked", "merge.completed"]),
		);
		expect(types.indexOf("merge.locked")).toBeLessThan(types.indexOf("merge.completed"));
		expect(stepResult(dir, "merge")).toMatchObject({
			status: "merged",
			outputs: { method: "squash" },
		});
		const decisions = new RunStore(dir).readDecisions();
		expect(decisions.at(-1)).toMatchObject({ source: "policy", phase: "merge" });
		expect(fakeRuntime.calls).toHaveLength(0);
		expect(existsSync(mergeLockPath(repo))).toBe(false);
	});

	it("serializes two merges of one repository from two worktrees", async () => {
		const repo = initRepo(path.join(work, "repo"));
		const wt = path.join(work, "wt");
		git(repo, "worktree", "add", "-q", "-b", "other", wt);
		mkdirSync(path.join(wt, "agentic", "workflows"), { recursive: true });
		const a = ghState("a", { mergeDelayMs: 400 });
		const b = ghState("b", {
			mergeDelayMs: 400,
			pr: prJson({ number: 8, url: "https://github.com/o/r/pull/8" }),
		});
		const { manager, client } = await startSupervisor();
		const steps = wf("  - { name: merge, type: merge }");
		const first = await dispatchRun(client, payload(repo, steps, a));
		const second = await dispatchRun(client, payload(wt, steps, b));
		await waitForStatus(manager, first.run, "merged");
		await waitForStatus(manager, second.run, "merged");
		const span = (file: string) => {
			const call = ghCalls(file).find((c) => c.args[1] === "merge");
			if (!call) throw new Error("no merge call");
			return call;
		};
		const [x, y] = [span(a), span(b)].sort((p, q) => p.start - q.start);
		expect(x.end).toBeLessThanOrEqual(y.start);
	});

	it("takes over a stale lock left by a crashed supervisor", async () => {
		const repo = initRepo(path.join(work, "repo"));
		const lockPath = mergeLockPath(repo);
		mkdirSync(path.dirname(lockPath), { recursive: true });
		writeFileSync(lockPath, JSON.stringify({ pid: 999999, token: "crashed", run: "old-run" }));
		const old = new Date(Date.now() - 120_000);
		utimesSync(lockPath, old, old);
		const state = ghState("stale", {});
		const { manager, client } = await startSupervisor();
		const { run } = await dispatchRun(
			client,
			payload(repo, wf("  - { name: merge, type: merge }"), state),
		);
		await waitForStatus(manager, run, "merged");
		expect(readState(state).merges).toBe(1);
		expect(existsSync(lockPath)).toBe(false);
	});

	it("stops awaiting-human when GitHub refuses the merge, and never bypasses", async () => {
		const repo = initRepo(path.join(work, "repo"));
		const state = ghState("refused", {
			mergeError: "Pull request is not mergeable: required review missing",
		});
		const { manager, client } = await startSupervisor();
		const { run, dir } = await dispatchRun(
			client,
			payload(repo, wf("  - { name: merge, type: merge }"), state),
		);
		await waitForStatus(manager, run, "awaiting-human");
		expect(stepResult(dir, "merge")).toMatchObject({ status: "awaiting-human" });
		const args = ghCalls(state).flatMap((c) => c.args);
		expect(args).not.toContain("--admin");
		expect(existsSync(mergeLockPath(repo))).toBe(false);
	});

	it("refuses a head that moved since the wait step verified it, and merges it on a merge answer", async () => {
		const repo = initRepo(path.join(work, "repo"));
		const state = ghState("moved", {
			checks: [{ name: "test", bucket: "pass", state: "SUCCESS" }],
			requiredChecks: [{ name: "test", bucket: "pass", state: "SUCCESS" }],
			timeline: {
				// A push between the checks passing and the merge
				"2": {
					pr: prJson({
						headRefOid: NEW_HEAD,
						commits: [{ oid: NEW_HEAD, committedDate: "2026-11-02T10:00:00Z" }],
					}),
				},
			},
		});
		const { manager, client } = await startSupervisor();
		const { run, dir } = await dispatchRun(
			client,
			payload(
				repo,
				wf("  - { name: wait-checks, type: wait-for-checks }\n  - { name: merge, type: merge }"),
				state,
			),
		);
		await waitForStatus(manager, run, "awaiting-human");
		expect(stepResult(dir, "wait-checks").outputs.head).toBe(HEAD);
		const pending = pendingInput(new RunStore(dir).readRun());
		expect(pending?.request).toMatchObject({
			id: "merge-head-merge-bbbbbbb",
			options: [{ id: "merge" }, { id: "stop" }],
			blocking: true,
		});
		expect(readState(state).merges).toBeUndefined();

		await client.request("POST", `/v1/runs/${run.id}/answer`, { answer: "merge" });
		await waitForStatus(manager, run, "merged");
		const merge = ghCalls(state).find((c) => c.args[0] === "pr" && c.args[1] === "merge");
		expect(merge?.args).toEqual(expect.arrayContaining(["--match-head-commit", NEW_HEAD]));
	});

	it("checks the head field, and fails on a stop answer", async () => {
		const repo = initRepo(path.join(work, "repo"));
		const state = ghState("head-field", {});
		const { manager, client } = await startSupervisor();
		const steps = wf(`  - { name: merge, type: merge, head: "${"c".repeat(40)}" }`);
		const { run, dir } = await dispatchRun(client, payload(repo, steps, state));
		await waitForStatus(manager, run, "awaiting-human");
		expect(pendingInput(new RunStore(dir).readRun())?.request.id).toBe("merge-head-merge-aaaaaaa");
		await client.request("POST", `/v1/runs/${run.id}/answer`, { answer: "stop" });
		await waitForStatus(manager, run, "failed");
		expect(readState(state).merges).toBeUndefined();

		// A template head that matches merges with that SHA
		const ok = ghState("head-ok", {
			checks: [{ name: "test", bucket: "pass", state: "SUCCESS" }],
			requiredChecks: [{ name: "test", bucket: "pass", state: "SUCCESS" }],
		});
		const matching = await dispatchRun(
			client,
			payload(
				repo,
				wf(
					"  - { name: wait-checks, type: wait-for-checks }\n  - { name: merge, type: merge, head: \"{{ outputs['wait-checks'].head }}\" }",
				),
				ok,
			),
		);
		await waitForStatus(manager, matching.run, "merged");
		const merge = ghCalls(ok).find((c) => c.args[0] === "pr" && c.args[1] === "merge");
		expect(merge?.args).toEqual(expect.arrayContaining(["--match-head-commit", HEAD]));
	});

	it("merges from a step name with a space and reports a failed branch delete", async () => {
		const repo = initRepo(path.join(work, "repo"));
		const state = ghState("spaced", {
			deleteError: "gh: Resource not accessible by integration (HTTP 403)",
		});
		const { manager, client } = await startSupervisor();
		const { run, dir } = await dispatchRun(
			client,
			payload(repo, wf("  - { name: Merge PR, type: merge }"), state),
		);
		await waitForStatus(manager, run, "merged");
		expect(new RunStore(dir).readDecisions().at(-1)?.id).toBe("d-merge-Merge-PR-aaaaaaa");
		expect(stepResult(dir, "merge-pr").outputs.remote_branch).toBe(
			"delete failed: gh: Resource not accessible by integration (HTTP 403)",
		);
	});

	it("keeps the branch when on-merge cleanup auto-saved leftover changes", async () => {
		const repo = initRepo(path.join(work, "repo"));
		const state = ghState("leftover", {});
		fakeRuntime.on("edit after merge", (o) => {
			writeFileSync(path.join(o.cwd ?? "", "late.txt"), "late\n");
			return {
				returncode: 0,
				stdout: "ok",
				stderr: "",
				prompt: o.prompt,
				cwd: o.cwd ?? null,
				model: null,
				success: true,
				sessionOutput: { sessionId: null, isSuccess: true, context: "done" },
			};
		});
		const { manager, client } = await startSupervisor();
		const { run, dir } = await dispatchRun(
			client,
			payload(
				repo,
				wf(
					"  - { name: merge, type: merge }\n  - { name: after, type: prompt, prompt: edit after merge }",
					"settings:\n  worktree: { enabled: true, cleanup: on-merge }\n",
				),
				state,
			),
		);
		await waitForStatus(manager, run, "merged");
		const runJson = new RunStore(dir).readRun();
		const branch = runJson.branch as string;
		expect(existsSync(runJson.worktree as string)).toBe(false);
		expect(git(repo, "branch", "--list", branch).trim()).not.toBe("");
		expect(git(repo, "show", "--name-only", "--format=%s", branch)).toMatch(/late\.txt/);
	});

	it("runs a merge skill with AF_MERGE_LOCK and does not hold the lock itself", async () => {
		const repo = initRepo(path.join(work, "repo"));
		const state = ghState("skill", {});
		let seen: string | undefined;
		fakeRuntime.on("esp-merge", (o) => {
			seen = o.env?.AF_MERGE_LOCK;
			// The harness must not hold the lock while the skill runs
			expect(existsSync(seen ?? "")).toBe(false);
			const block = JSON.stringify({
				status: "merged",
				summary: "Merged #7",
				pr: "https://github.com/o/r/pull/7",
			});
			return {
				returncode: 0,
				stdout: block,
				stderr: "",
				prompt: o.prompt,
				cwd: null,
				model: null,
				success: true,
				sessionOutput: SessionOutput.fromStdout(block),
			};
		});
		const { manager, client } = await startSupervisor();
		const { run } = await dispatchRun(
			client,
			payload(repo, wf("  - { name: merge, type: merge, skill: esp-skills:esp-merge }"), state),
		);
		await waitForStatus(manager, run, "merged");
		expect(seen).toBe(mergeLockPath(repo));
		expect(fakeRuntime.calls[0].prompt).toMatch(/^\/esp-skills:esp-merge --run-dir/);
	});
});
