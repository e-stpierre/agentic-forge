/** Pull request reads and writes through `gh`, for the GitHub step types. */

import { type GhOptions, gh, ghJson, parsePaginated, repoFromPrUrl, runGh } from "./gh.js";

/** The pull request facts the steps need. */
export interface PullRequest {
	number: number;
	url: string;
	/** `owner/repo` of the base repository. */
	repo: string;
	state: string;
	isDraft: boolean;
	headRefName: string;
	headRefOid: string;
	baseRefName: string;
	/** True when the head branch lives in a fork. */
	isCrossRepository: boolean;
	/** Committer date of the head commit (ISO), when known. */
	headCommittedAt: string | null;
}

interface PrViewJson {
	number: number;
	url: string;
	state: string;
	isDraft: boolean;
	headRefName: string;
	headRefOid: string;
	baseRefName: string;
	isCrossRepository: boolean;
	commits?: { oid: string; committedDate?: string }[];
}

const PR_FIELDS =
	"number,url,state,isDraft,headRefName,headRefOid,baseRefName,isCrossRepository,commits";

/**
 * Reads a pull request. `ref` is a number, `#<n>` or a URL; null reads the
 * pull request of the current branch in `options.cwd`.
 */
export async function viewPr(ref: string | null, options: GhOptions = {}): Promise<PullRequest> {
	const args = ["pr", "view"];
	const clean = ref ? ref.trim().replace(/^#/, "") : "";
	if (clean) args.push(clean);
	args.push("--json", PR_FIELDS);
	const pr = await ghJson<PrViewJson>(args, options);
	const repo = repoFromPrUrl(pr.url);
	if (!repo) throw new Error(`Cannot read the repository of pull request ${pr.url}`);
	const head = pr.commits?.find((c) => c.oid === pr.headRefOid) ?? pr.commits?.at(-1);
	return {
		number: pr.number,
		url: pr.url,
		repo,
		state: pr.state,
		isDraft: pr.isDraft,
		headRefName: pr.headRefName,
		headRefOid: pr.headRefOid,
		baseRefName: pr.baseRefName,
		isCrossRepository: Boolean(pr.isCrossRepository),
		headCommittedAt: head?.committedDate ?? null,
	};
}

/** A pull request review (`GET /repos/:o/:r/pulls/:n/reviews`). */
export interface Review {
	id: number;
	login: string;
	state: string;
	commitId: string | null;
	submittedAt: string | null;
	url: string | null;
}

/** An issue comment on the pull request (`GET /repos/:o/:r/issues/:n/comments`). */
export interface IssueComment {
	id: number;
	login: string;
	body: string;
	createdAt: string;
	updatedAt: string;
	url: string | null;
}

interface ApiUser {
	login?: string;
}

export async function listReviews(pr: PullRequest, options: GhOptions = {}): Promise<Review[]> {
	const out = await gh(
		["api", "--paginate", `repos/${pr.repo}/pulls/${pr.number}/reviews?per_page=100`],
		options,
	);
	return parsePaginated<{
		id: number;
		user?: ApiUser | null;
		state: string;
		commit_id?: string | null;
		submitted_at?: string | null;
		html_url?: string | null;
	}>(out).map((r) => ({
		id: r.id,
		login: r.user?.login ?? "",
		state: r.state,
		commitId: r.commit_id ?? null,
		submittedAt: r.submitted_at ?? null,
		url: r.html_url ?? null,
	}));
}

export async function listIssueComments(
	pr: PullRequest,
	options: GhOptions = {},
): Promise<IssueComment[]> {
	const out = await gh(
		["api", "--paginate", `repos/${pr.repo}/issues/${pr.number}/comments?per_page=100`],
		options,
	);
	return parsePaginated<{
		id: number;
		user?: ApiUser | null;
		body?: string | null;
		created_at: string;
		updated_at?: string | null;
		html_url?: string | null;
	}>(out).map((c) => ({
		id: c.id,
		login: c.user?.login ?? "",
		body: c.body ?? "",
		createdAt: c.created_at,
		updatedAt: c.updated_at ?? c.created_at,
		url: c.html_url ?? null,
	}));
}

/** Posts a comment on the pull request (a reviewer trigger such as `@codex review`). */
export async function commentOnPr(
	pr: PullRequest,
	body: string,
	options: GhOptions = {},
): Promise<void> {
	await gh(["pr", "comment", String(pr.number), "--repo", pr.repo, "--body", body], options);
}

/** One check of `gh pr checks --json`. */
export interface Check {
	name: string;
	/** `pass`, `fail`, `pending`, `skipping` or `cancel`. */
	bucket: string;
	state: string;
	link: string | null;
	workflow: string | null;
}

/**
 * Checks of the pull request head. `requiredOnly` reads only the checks branch
 * protection requires; a base with no required check gives an empty list.
 */
export async function listChecks(
	pr: PullRequest,
	requiredOnly: boolean,
	options: GhOptions = {},
): Promise<Check[]> {
	const args = ["pr", "checks", String(pr.number), "--repo", pr.repo];
	if (requiredOnly) args.push("--required");
	args.push("--json", "name,bucket,state,link,workflow");
	const result = await runGh(args, options);
	// gh exits 8 while checks are pending and 1 when one failed: read the JSON first
	const text = result.stdout.trim();
	if (text.startsWith("[")) {
		return (JSON.parse(text) as Partial<Check>[]).map((c) => ({
			name: c.name ?? "",
			bucket: c.bucket ?? "pending",
			state: c.state ?? "",
			link: c.link ?? null,
			workflow: c.workflow ?? null,
		}));
	}
	const detail = `${result.stderr}\n${result.stdout}`;
	if (/no (required )?checks reported/i.test(detail)) return [];
	throw new Error(`gh pr checks failed: ${detail.trim()}`);
}

/** Repository merge settings (`GET /repos/:o/:r`). */
export interface RepoMergeSettings {
	squash: boolean;
	rebase: boolean;
	merge: boolean;
}

export async function repoMergeSettings(
	repo: string,
	options: GhOptions = {},
): Promise<RepoMergeSettings> {
	const data = await ghJson<{
		allow_squash_merge?: boolean;
		allow_rebase_merge?: boolean;
		allow_merge_commit?: boolean;
	}>(["api", `repos/${repo}`], options);
	return {
		squash: data.allow_squash_merge !== false,
		rebase: data.allow_rebase_merge !== false,
		merge: data.allow_merge_commit !== false,
	};
}

/** A branch rule (`GET /repos/:o/:r/rules/branches/:branch`). */
export interface BranchRule {
	type: string;
	parameters?: Record<string, unknown>;
}

/** Rules that apply to a branch; empty when they cannot be read. */
export async function branchRules(
	repo: string,
	branch: string,
	options: GhOptions = {},
): Promise<BranchRule[]> {
	const result = await runGh(
		["api", `repos/${repo}/rules/branches/${encodeURIComponent(branch)}`],
		options,
	);
	if (result.code !== 0) return [];
	try {
		const parsed = JSON.parse(result.stdout);
		return Array.isArray(parsed) ? (parsed as BranchRule[]) : [];
	} catch {
		return [];
	}
}

/**
 * Merges the pull request with `gh pr merge --repo`, which never checks out
 * the base branch locally (no `--delete-branch`: the remote branch is deleted
 * through the API). `queue` enqueues with `--auto`. `--match-head-commit`
 * refuses a head that moved since it was checked.
 */
export async function mergePr(
	pr: PullRequest,
	method: string,
	queue: boolean,
	options: GhOptions = {},
): Promise<void> {
	const args = [
		"pr",
		"merge",
		String(pr.number),
		"--repo",
		pr.repo,
		`--${method}`,
		"--match-head-commit",
		pr.headRefOid,
	];
	if (queue) args.push("--auto");
	await gh(args, options);
}

/** Deletes the remote head branch (never for a fork). Returns false when it was already gone. */
export async function deleteRemoteBranch(
	pr: PullRequest,
	options: GhOptions = {},
): Promise<boolean> {
	const result = await runGh(
		["api", "-X", "DELETE", `repos/${pr.repo}/git/refs/heads/${pr.headRefName}`],
		options,
	);
	return result.code === 0;
}
