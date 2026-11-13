/**
 * Reviewer completion on the pull request head, for `wait-for-review`.
 *
 * Verified on real pull requests (Nov 2026):
 * - Codex (`chatgpt-codex-connector[bot]`) posts a pull request review when it
 *   has findings, and always keeps one summary issue comment whose
 *   `<!-- codex-review-state:v1 {...} -->` marker names the reviewed commit
 *   (`code_review.commit_sha`, `status: "completed"`). It reviews on its own
 *   when a pull request is opened or marked ready; a later head needs the
 *   `@codex review` trigger comment.
 * - Claude (`claude[bot]`, the Claude Code GitHub Action) posts a pull request
 *   review on the head commit when it has findings, or an issue comment
 *   ("No issues found") with no commit. When it runs is up to the repository's
 *   workflow (`pull_request` events or an `@claude` mention).
 */

import type { IssueComment, PullRequest, Review } from "./pr.js";

/** A reviewer to wait for. */
export interface ReviewerSpec {
	/** Name used in the workflow (`claude`, `codex`) or the login itself. */
	name: string;
	/** GitHub login (`claude[bot]`). */
	login: string;
	/** Comment that asks this reviewer for a review, or null. */
	trigger: string | null;
}

/** Built-in reviewers (`github.reviewers` in the config overrides or extends them). */
export const DEFAULT_REVIEWERS: Record<string, { login: string; trigger: string | null }> = {
	claude: { login: "claude[bot]", trigger: null },
	codex: { login: "chatgpt-codex-connector[bot]", trigger: "@codex review" },
};

/** How a reviewer covered the head commit. */
export interface ReviewOfHead {
	reviewer: string;
	login: string;
	/** `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`, or `COMMENTED` for a comment. */
	state: string;
	/** `review`, `summary` (Codex state marker) or `comment`. */
	source: "review" | "summary" | "comment";
	commit: string;
	at: string | null;
	url: string | null;
	/** Codex summary marker: the review found something. */
	findings?: boolean | null;
}

const CODEX_STATE = /<!--\s*codex-review-state:v1\s*(\{[\s\S]*?\})\s*-->/;

/** Reads the Codex summary marker of a comment, or null. */
export function codexReviewState(
	body: string,
): { commit: string | null; status: string | null; findings: boolean | null } | null {
	const match = CODEX_STATE.exec(body);
	if (!match) return null;
	try {
		const state = JSON.parse(match[1]) as {
			code_review?: {
				commit_sha?: string | null;
				status?: string | null;
				has_any_findings?: boolean;
			};
		};
		return {
			commit: state.code_review?.commit_sha ?? null,
			status: state.code_review?.status ?? null,
			findings: state.code_review?.has_any_findings ?? null,
		};
	} catch {
		return null;
	}
}

function sameLogin(a: string, b: string): boolean {
	const norm = (s: string) => s.toLowerCase().replace(/\[bot\]$/, "");
	return norm(a) === norm(b);
}

/** True when two commit ids name the same commit (a 7+ character prefix matches). */
export function sameCommit(a: string | null, b: string): boolean {
	if (!a) return false;
	return a === b || (a.length >= 7 && b.startsWith(a)) || (b.length >= 7 && a.startsWith(b));
}

/**
 * True when a comment body has the known result format of a review comment
 * (the Claude Code GitHub Action: a `## Code review` heading, or "No issues
 * found"). Progress and tracking comments do not match.
 */
export function isReviewResultComment(body: string): boolean {
	return /^\s*#{1,6}\s*code review\b/im.test(body) || /\bno issues found\b/i.test(body);
}

/**
 * The reviewer's review of the head commit, or null while it has none. In
 * order: a submitted pull request review on the head; a Codex summary marker
 * that completed on the head; an issue comment (without a marker) in the
 * review result format, created after the head commit was committed and,
 * with `options.since` (ms), after that time too (the step saw an older head
 * then, so an earlier comment may be about that one).
 */
export function reviewOfHead(
	reviewer: ReviewerSpec,
	pr: PullRequest,
	reviews: Review[],
	comments: IssueComment[],
	options: { since?: number | null } = {},
): ReviewOfHead | null {
	const head = pr.headRefOid;
	const base = { reviewer: reviewer.name, login: reviewer.login, commit: head };
	const review = reviews
		.filter((r) => sameLogin(r.login, reviewer.login) && r.state !== "PENDING")
		.filter((r) => sameCommit(r.commitId, head))
		.at(-1);
	if (review) {
		return {
			...base,
			state: review.state,
			source: "review",
			at: review.submittedAt,
			url: review.url,
		};
	}
	const mine = comments.filter((c) => sameLogin(c.login, reviewer.login));
	for (const comment of mine) {
		const state = codexReviewState(comment.body);
		if (state && state.status === "completed" && sameCommit(state.commit, head)) {
			return {
				...base,
				state: "COMMENTED",
				source: "summary",
				at: comment.updatedAt,
				url: comment.url,
				findings: state.findings,
			};
		}
	}
	if (pr.headCommittedAt) {
		const since = Math.max(Date.parse(pr.headCommittedAt), options.since ?? 0);
		const comment = mine
			.filter(
				(c) =>
					!codexReviewState(c.body) &&
					isReviewResultComment(c.body) &&
					Date.parse(c.createdAt) >= since,
			)
			.at(-1);
		if (comment) {
			return {
				...base,
				state: "COMMENTED",
				source: "comment",
				at: comment.createdAt,
				url: comment.url,
			};
		}
	}
	return null;
}

/**
 * Resolves the reviewers of a step: names from `github.reviewers` (or the
 * built-in ones), else the value is taken as a login with no trigger.
 */
export function resolveReviewers(
	names: string[],
	configured: Record<string, unknown> | null | undefined,
): ReviewerSpec[] {
	const table: Record<string, { login: string; trigger: string | null }> = { ...DEFAULT_REVIEWERS };
	for (const [name, value] of Object.entries(configured ?? {})) {
		if (value && typeof value === "object") {
			const v = value as { login?: unknown; trigger?: unknown };
			if (typeof v.login === "string" && v.login) {
				table[name] = { login: v.login, trigger: typeof v.trigger === "string" ? v.trigger : null };
			}
		}
	}
	const seen = new Set<string>();
	const specs: ReviewerSpec[] = [];
	for (const raw of names) {
		const name = raw.trim();
		if (!name || seen.has(name)) continue;
		seen.add(name);
		const known = table[name];
		specs.push(known ? { name, ...known } : { name, login: name, trigger: null });
	}
	return specs;
}
