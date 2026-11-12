/**
 * Merge method resolution for the native `merge` step (`github.merge.method:
 * repo`), the same rules as the esp-merge script:
 *
 * 1. Allowed methods come from the repository settings and the branch rulesets
 *    (`pull_request.allowed_merge_methods`); linear history excludes `merge`.
 * 2. A merge queue on the base: enqueue, the queue decides.
 * 3. One method allowed: use it.
 * 4. Several: the first allowed in `github.merge.preference`.
 * 5. An explicit method overrides, but is an error when it is not allowed.
 */

import type { BranchRule, RepoMergeSettings } from "./pr.js";

export const MERGE_METHODS = ["squash", "rebase", "merge"] as const;
export type MergeMethod = (typeof MERGE_METHODS)[number];

export interface MergePolicy {
	allowed: MergeMethod[];
	linearHistory: boolean;
	mergeQueue: boolean;
	queueMethod: MergeMethod | null;
}

export interface ResolvedMethod {
	method: MergeMethod;
	queue: boolean;
	reason: string;
	alternatives: MergeMethod[];
}

const QUEUE_METHODS: Record<string, MergeMethod> = {
	MERGE: "merge",
	SQUASH: "squash",
	REBASE: "rebase",
};

export function isMergeMethod(value: unknown): value is MergeMethod {
	return typeof value === "string" && (MERGE_METHODS as readonly string[]).includes(value);
}

/** Combines the repository settings and the branch rules into one policy. */
export function mergePolicy(settings: RepoMergeSettings, rules: BranchRule[] = []): MergePolicy {
	let allowed = MERGE_METHODS.filter((m) => settings[m]);
	for (const rule of rules) {
		const methods = rule.type === "pull_request" ? rule.parameters?.allowed_merge_methods : null;
		if (Array.isArray(methods)) {
			const lower = methods.map((m) => String(m).toLowerCase());
			allowed = allowed.filter((m) => lower.includes(m));
		}
	}
	const queue = rules.find((r) => r.type === "merge_queue");
	const queueMethod = queue?.parameters?.merge_method;
	return {
		allowed,
		linearHistory: rules.some((r) => r.type === "required_linear_history"),
		mergeQueue: Boolean(queue),
		queueMethod: typeof queueMethod === "string" ? (QUEUE_METHODS[queueMethod] ?? null) : null,
	};
}

/** Resolves the merge method. `method` is `repo` or an explicit method; throws when none is allowed. */
export function resolveMergeMethod(
	policy: MergePolicy,
	method = "repo",
	preference: readonly string[] = MERGE_METHODS,
): ResolvedMethod {
	const usable = policy.allowed.filter((m) => !(policy.linearHistory && m === "merge"));
	const excluded =
		policy.linearHistory && policy.allowed.includes("merge")
			? " (merge commits excluded: linear history required)"
			: "";
	const preferred = (): MergeMethod =>
		(preference.find((m) => (usable as string[]).includes(m)) as MergeMethod | undefined) ??
		usable[0];

	if (method && method !== "repo") {
		if (!isMergeMethod(method)) throw new Error(`Unknown merge method: ${method}`);
		if (!usable.includes(method)) {
			const why = policy.allowed.includes(method)
				? "linear history is required"
				: "the repository does not allow it";
			throw new Error(
				`Merge method ${method} is not allowed: ${why}. Allowed: ${usable.join(", ") || "none"}`,
			);
		}
		return {
			method,
			queue: policy.mergeQueue,
			reason: policy.mergeQueue
				? `explicit method ${method}, then the merge queue decides`
				: `explicit method ${method}`,
			alternatives: usable.filter((m) => m !== method),
		};
	}
	if (usable.length === 0)
		throw new Error(`No merge method is allowed on this repository${excluded}`);
	if (policy.mergeQueue) {
		const chosen =
			policy.queueMethod && usable.includes(policy.queueMethod) ? policy.queueMethod : preferred();
		return {
			method: chosen,
			queue: true,
			reason: "merge queue enabled on the base branch: enqueue, the queue decides",
			alternatives: [],
		};
	}
	if (usable.length === 1) {
		return {
			method: usable[0],
			queue: false,
			reason: `only method allowed${excluded}`,
			alternatives: [],
		};
	}
	const chosen = preferred();
	return {
		method: chosen,
		queue: false,
		reason: `first allowed method in preference [${preference.join(", ")}]${excluded}`,
		alternatives: usable.filter((m) => m !== chosen),
	};
}
