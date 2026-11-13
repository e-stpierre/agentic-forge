/**
 * Overseer runs (`run.json` `type: overseer`): the run directory of an
 * interactive overseer session started by `af overseer`. The supervisor never
 * executes an overseer run: it records it (`running` while it is open), keeps
 * its epic and config snapshot, and ends it when the overseer finishes. The
 * session itself is a `claude` process owned by the launcher.
 *
 * Files: `run.json`, `events.jsonl`, `overseer.json` (the open payload: repo,
 * config snapshot, sessions), `epic.md` (the epic text, when given) and, once
 * finished, `summary.md`.
 */

import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type RunStatus, validateArtifact } from "../contract/index.js";
import { resolveRunsRoot } from "../paths.js";
import type { RegistryEntry, RunRegistry } from "./registry.js";
import { RunStore } from "./run-store.js";

export const OVERSEER_FILE = "overseer.json";
export const EPIC_FILE = "epic.md";
export const OVERSEER_WORKFLOW = "overseer";

/** Body of `POST /v1/overseer`: open a new overseer run or reopen one. */
export interface OverseerPayload {
	/** Absolute repository root of the launching client. */
	repo_root: string;
	/** Config resolved by the client (defaults -> global -> local). */
	config: Record<string, unknown>;
	/** Allowlisted client environment. */
	env?: Record<string, string>;
	/** Epic text (`--epic`: a file's contents, or the text itself). */
	epic?: string | null;
	/** Source of the epic: the file path, or null for inline text. */
	epic_source?: string | null;
	/** Reopen this overseer run (`--resume`). */
	resume?: string | null;
	/** Always create a run, even when one is open for the repository. */
	new?: boolean;
}

export interface OverseerSession {
	n: number;
	at: string;
}

/** `overseer.json`: what the launcher sent, plus every session opened on the run. */
export interface OverseerFile {
	repo_root: string;
	config: Record<string, unknown>;
	env: Record<string, string>;
	epic_source: string | null;
	sessions: OverseerSession[];
}

export interface OverseerOpenResult {
	run: { id: string; status: RunStatus; title?: string | null };
	dir: string;
	/** `created` (new run), `reused` (open run of the repository) or `resumed` (`--resume`). */
	mode: "created" | "reused" | "resumed";
	/** 1 for the first session of the run, then 2, 3, ... */
	session: number;
	/** Path of `epic.md`, or null when the run has no epic. */
	epic: string | null;
	warnings: string[];
}

export interface OverseerFinishInput {
	/** Final status: done (default), halted or failed. */
	status?: string;
	/** Markdown body of summary.md. */
	summary?: string;
}

export const OVERSEER_FINISH_STATUSES = ["done", "halted", "failed"] as const;

const OPEN_STATUSES: readonly RunStatus[] = ["running", "paused", "blocked", "awaiting-human"];

export class OverseerError extends Error {
	constructor(
		message: string,
		readonly status = 400,
	) {
		super(message);
		this.name = "OverseerError";
	}
}

/** True for the registry entry of an overseer run (the supervisor never executes it). */
export function isOverseerEntry(entry: Pick<RegistryEntry, "type"> | null | undefined): boolean {
	return entry?.type === "overseer";
}

/** Reads `overseer.json` of a run directory, or null. */
export function readOverseerFile(dir: string): OverseerFile | null {
	const store = new RunStore(dir);
	if (!existsSync(path.join(dir, OVERSEER_FILE))) return null;
	try {
		return store.readJson<OverseerFile>(OVERSEER_FILE);
	} catch {
		return null;
	}
}

function samePath(a: string, b: string): boolean {
	const ra = path.resolve(a);
	const rb = path.resolve(b);
	return process.platform === "win32" ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

/** First non-empty line of the epic, without markdown heading marks, as the run title. */
export function epicTitle(epic: string | null | undefined): string {
	const line = (epic ?? "")
		.split(/\r?\n/)
		.map((l) => l.replace(/^#+\s*/, "").trim())
		.find((l) => l.length > 0);
	if (!line) return "overseer";
	return line.length > 80 ? `${line.slice(0, 77)}...` : line;
}

/** Validates the body of `POST /v1/overseer`; returns an error message or null. */
export function validateOverseerPayload(body: unknown): string | null {
	if (typeof body !== "object" || body === null) return "Body must be a JSON object";
	const p = body as Partial<OverseerPayload>;
	if (typeof p.repo_root !== "string" || p.repo_root.length === 0) return "repo_root is required";
	if (typeof p.config !== "object" || p.config === null) return "config is required";
	if (p.env != null && typeof p.env !== "object") return "env must be an object";
	if (p.epic != null && typeof p.epic !== "string") return "epic must be a string";
	if (p.resume != null && (typeof p.resume !== "string" || p.resume.length === 0)) {
		return "resume must be a run id";
	}
	if (p.resume && typeof p.epic === "string" && p.epic.trim()) {
		return "epic and resume cannot be combined: a resumed overseer keeps its epic";
	}
	return null;
}

export interface OverseerDeps {
	registry: RunRegistry;
	log: (message: string) => void;
	/** Picks a free run directory under a runs root. */
	allocateRunDir: (runsRoot: string, slug: string) => Promise<RunStore>;
}

/**
 * Opens an overseer run: `resume` reopens that run; otherwise, without an
 * epic and without `new`, the newest open overseer run of the repository is
 * reused; otherwise a new run is created. Every open is a new session
 * (`run.started` for the first, `run.resumed` after that).
 */
export async function openOverseer(
	deps: OverseerDeps,
	payload: OverseerPayload,
): Promise<OverseerOpenResult> {
	const invalid = validateOverseerPayload(payload);
	if (invalid) throw new OverseerError(`Invalid overseer request: ${invalid}`);
	const epic = typeof payload.epic === "string" && payload.epic.trim() ? payload.epic : null;

	let existing: RegistryEntry | null = null;
	let mode: OverseerOpenResult["mode"] = "created";
	if (payload.resume) {
		existing = deps.registry.get(payload.resume);
		if (!existing) throw new OverseerError(`Run not found: ${payload.resume}`, 404);
		if (!isOverseerEntry(existing)) {
			throw new OverseerError(
				`Run ${payload.resume} is not an overseer run: resume a workflow run with af resume`,
			);
		}
		if (!OPEN_STATUSES.includes(existing.status)) {
			throw new OverseerError(
				`Overseer run ${payload.resume} has ended (${existing.status}): start a new one with af overseer`,
				409,
			);
		}
		// The session runs claude and dispatches children in the launching
		// directory, so it must be the run's repository
		const runRepo = readOverseerFile(existing.dir)?.repo_root ?? existing.repo;
		if (runRepo && !samePath(runRepo, payload.repo_root)) {
			throw new OverseerError(
				`Overseer run ${payload.resume} belongs to repository ${runRepo}: resume it from that directory`,
				409,
			);
		}
		mode = "resumed";
	} else if (!epic && !payload.new) {
		existing =
			deps.registry
				.list()
				.filter(
					(r) =>
						isOverseerEntry(r) &&
						OPEN_STATUSES.includes(r.status) &&
						samePath(r.repo, payload.repo_root),
				)
				.sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
		if (existing) mode = "reused";
	}

	if (existing) return reopen(deps, existing, payload, mode);
	return create(deps, payload, epic);
}

async function create(
	deps: OverseerDeps,
	payload: OverseerPayload,
	epic: string | null,
): Promise<OverseerOpenResult> {
	const runsRoot = resolveRunsRoot(payload.config, payload.repo_root);
	const warnings = runsRoot.deprecation ? [runsRoot.deprecation] : [];
	const store = await deps.allocateRunDir(runsRoot.root, "overseer");
	const now = new Date().toISOString();
	const file: OverseerFile = {
		repo_root: payload.repo_root,
		config: payload.config,
		env: payload.env ?? {},
		epic_source: epic ? (payload.epic_source ?? null) : null,
		sessions: [{ n: 1, at: now }],
	};
	const title = epicTitle(epic);
	const run = await store.create({
		type: "overseer",
		title,
		workflow: null,
		parent: null,
		repo: payload.repo_root,
		base: null,
		branch: null,
		worktree: null,
		pr: null,
		status: "running",
		max_risk: null,
		started_at: now,
		ended_at: null,
		runtime: "claude",
		models: {},
		budgets_used: {},
	});
	store.writeJson(OVERSEER_FILE, file);
	const epicPath = path.join(store.dir, EPIC_FILE);
	if (epic) writeFileSync(epicPath, epic.endsWith("\n") ? epic : `${epic}\n`, "utf-8");
	await deps.registry.upsert({
		id: store.id,
		dir: store.dir,
		repo: payload.repo_root,
		workflow: OVERSEER_WORKFLOW,
		type: "overseer",
		status: "running",
		worktree: false,
		priority: 0,
		created_at: now,
		updated_at: now,
	});
	await store.appendEvent("run.started", {
		type: "overseer",
		session: 1,
		repo: payload.repo_root,
		epic: epic ? EPIC_FILE : null,
		epic_source: file.epic_source,
	});
	deps.log(`Overseer run opened: ${store.id} (${payload.repo_root})`);
	return {
		run: { id: run.id, status: run.status, title },
		dir: store.dir,
		mode: "created",
		session: 1,
		epic: epic ? epicPath : null,
		warnings,
	};
}

async function reopen(
	deps: OverseerDeps,
	entry: RegistryEntry,
	payload: OverseerPayload,
	mode: OverseerOpenResult["mode"],
): Promise<OverseerOpenResult> {
	const store = new RunStore(entry.dir);
	const previous = readOverseerFile(entry.dir);
	const n = (previous?.sessions.at(-1)?.n ?? 0) + 1;
	const now = new Date().toISOString();
	// The newest config and environment of the launching client win
	store.writeJson(OVERSEER_FILE, {
		repo_root: previous?.repo_root ?? payload.repo_root,
		config: payload.config,
		env: payload.env ?? previous?.env ?? {},
		epic_source: previous?.epic_source ?? null,
		sessions: [...(previous?.sessions ?? []), { n, at: now }],
	} satisfies OverseerFile);
	const from = entry.status;
	const run = await store.updateRun({ status: "running", ended_at: null });
	if (from !== "running") await deps.registry.update(entry.id, { status: "running" });
	await store.appendEvent("run.resumed", { type: "overseer", session: n, mode, from });
	deps.log(`Overseer run ${mode}: ${entry.id} (session ${n})`);
	const epicPath = path.join(entry.dir, EPIC_FILE);
	return {
		run: { id: run.id, status: run.status, title: run.title },
		dir: entry.dir,
		mode,
		session: n,
		epic: existsSync(epicPath) ? epicPath : null,
		warnings: [],
	};
}

/** YAML scalar: JSON strings are valid YAML double-quoted scalars. */
function yamlScalar(value: string | number | null): string {
	if (value === null) return "null";
	return typeof value === "number" ? String(value) : JSON.stringify(value);
}

/**
 * Ends an open overseer run with `done` (default), `halted` or `failed`,
 * writes `summary.md` (contract frontmatter plus the summary text) and
 * returns the status to record. The caller writes the status and emits the
 * end event (`run.completed`, `run.halted`, `run.failed`).
 */
export function writeOverseerSummary(
	entry: RegistryEntry,
	input: OverseerFinishInput,
): { status: RunStatus; summary: string } {
	if (!isOverseerEntry(entry)) {
		throw new OverseerError(`Run ${entry.id} is not an overseer run: use af cancel to stop it`);
	}
	if (!OPEN_STATUSES.includes(entry.status)) {
		throw new OverseerError(`Overseer run ${entry.id} has already ended (${entry.status})`, 409);
	}
	const status = (input.status ?? "done") as RunStatus;
	if (!(OVERSEER_FINISH_STATUSES as readonly string[]).includes(status)) {
		throw new OverseerError(
			`Invalid status '${String(input.status)}': expected ${OVERSEER_FINISH_STATUSES.join(", ")}`,
		);
	}
	if (input.summary != null && typeof input.summary !== "string") {
		throw new OverseerError("summary must be a string");
	}
	const store = new RunStore(entry.dir);
	const run = store.readRun();
	const started = Date.parse(run.started_at);
	const frontmatter = {
		task: entry.id,
		title: run.title || "overseer",
		workflow: null,
		status,
		pr: null,
		max_risk: run.max_risk ?? null,
		decisions: store.readDecisions().length,
		duration_minutes: Number.isNaN(started)
			? null
			: Math.max(0, Math.round((Date.now() - started) / 60_000)),
	};
	const check = validateArtifact("summary-frontmatter", frontmatter);
	if (!check.valid) {
		throw new OverseerError(
			`Invalid summary: ${check.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`,
		);
	}
	const body = (input.summary ?? "").trim() || "The overseer ended without a summary.";
	const yaml = Object.entries(frontmatter)
		.map(([key, value]) => `${key}: ${yamlScalar(value as string | number | null)}`)
		.join("\n");
	const file = path.join(entry.dir, "summary.md");
	writeFileSync(file, `---\n${yaml}\n---\n\n# Overseer summary\n\n${body}\n`, "utf-8");
	return { status, summary: file };
}
