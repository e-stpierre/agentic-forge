/**
 * Token usage reported by a runtime, normalized across runtimes. Captured
 * from the stream the adapters already parse: the Claude `result` message
 * (`model_usage_since_last_result`, else `usage` and `total_cost_usd`), the Codex `turn.completed` line of
 * `codex exec --json` (`usage`) and the app-server
 * `thread/tokenUsage/updated` notification. A runtime that reports nothing
 * gives `null`, never zeros.
 */

/** Token counts of one runtime call (snake_case: written as is to `usage.json`). */
export interface Usage {
	/** Input tokens not read from the prompt cache. */
	input_tokens: number;
	/** Input tokens read from the prompt cache. */
	cached_input_tokens: number;
	/** Input tokens written to the prompt cache (Claude; 0 for Codex). */
	cache_creation_tokens: number;
	/** Output tokens, reasoning included. */
	output_tokens: number;
	/**
	 * Cost the runtime reported (Claude `total_cost_usd`), null when it reports
	 * none. On a subscription login it is a notional list-price estimate.
	 */
	cost_usd: number | null;
}

/** The token fields of a `Usage`, in output order. */
export const USAGE_TOKEN_FIELDS = [
	"input_tokens",
	"cached_input_tokens",
	"cache_creation_tokens",
	"output_tokens",
] as const;

/** Every token of a usage: input (cached or not), cache writes and output. */
export function totalTokens(usage: Usage): number {
	return USAGE_TOKEN_FIELDS.reduce((n, k) => n + usage[k], 0);
}

/** Sum of two usages; null only when both are null (an unknown part adds nothing). */
export function addUsage(a: Usage | null | undefined, b: Usage | null | undefined): Usage | null {
	if (!a) return b ? { ...b } : null;
	if (!b) return { ...a };
	return {
		input_tokens: a.input_tokens + b.input_tokens,
		cached_input_tokens: a.cached_input_tokens + b.cached_input_tokens,
		cache_creation_tokens: a.cache_creation_tokens + b.cache_creation_tokens,
		output_tokens: a.output_tokens + b.output_tokens,
		cost_usd:
			a.cost_usd === null && b.cost_usd === null
				? null
				: round((a.cost_usd ?? 0) + (b.cost_usd ?? 0)),
	};
}

function round(cost: number): number {
	return Math.round(cost * 1e6) / 1e6;
}

function count(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** Token fields of one model in a Claude `modelUsage` map (camelCase). */
const CLAUDE_MODEL_TOKEN_FIELDS = [
	"inputTokens",
	"cacheReadInputTokens",
	"cacheCreationInputTokens",
	"outputTokens",
] as const;

/**
 * Usage of a Claude `result` message (stream-json line or Agent SDK message),
 * null when it carries no `usage`. Claude's `input_tokens` already excludes
 * cache reads and writes. The `usage` field counts only the main agent loop
 * (no Task subagents, sidechains or auxiliary calls), so the per-model
 * `model_usage_since_last_result` map, when present, gives both the tokens and
 * the cost of the turn (`total_cost_usd` covers the whole query in a
 * multi-turn session). `usage` and `total_cost_usd` are the fallback.
 */
export function claudeResultUsage(message: Record<string, unknown>): Usage | null {
	const usage = message.usage as Record<string, unknown> | undefined;
	if (!usage || typeof usage !== "object") return null;
	const result: Usage = {
		input_tokens: count(usage.input_tokens),
		cached_input_tokens: count(usage.cache_read_input_tokens),
		cache_creation_tokens: count(usage.cache_creation_input_tokens),
		output_tokens: count(usage.output_tokens),
		cost_usd: typeof message.total_cost_usd === "number" ? message.total_cost_usd : null,
	};
	const since = message.model_usage_since_last_result as
		| Record<string, Record<string, unknown> | null>
		| undefined;
	if (since && typeof since === "object") {
		const models = Object.values(since).filter(
			(m): m is Record<string, unknown> => !!m && typeof m === "object",
		);
		const costs = models.map((m) => m.costUSD).filter((c): c is number => typeof c === "number");
		if (costs.length > 0) result.cost_usd = costs.reduce((n, c) => n + c, 0);
		const withTokens = models.filter((m) =>
			CLAUDE_MODEL_TOKEN_FIELDS.some((k) => typeof m[k] === "number"),
		);
		if (withTokens.length > 0) {
			const sum = (k: (typeof CLAUDE_MODEL_TOKEN_FIELDS)[number]) =>
				withTokens.reduce((n, m) => n + count(m[k]), 0);
			result.input_tokens = sum("inputTokens");
			result.cached_input_tokens = sum("cacheReadInputTokens");
			result.cache_creation_tokens = sum("cacheCreationInputTokens");
			result.output_tokens = sum("outputTokens");
		}
	}
	if (result.cost_usd !== null) result.cost_usd = round(result.cost_usd);
	return result;
}

/**
 * Usage of a Codex `turn.completed` line (`codex exec --json`): `input_tokens`
 * includes `cached_input_tokens`, so the uncached part is the difference.
 */
export function codexExecUsage(data: Record<string, unknown>): Usage | null {
	const usage = data.usage as Record<string, unknown> | undefined;
	if (!usage || typeof usage !== "object") return null;
	return codexBreakdown({
		inputTokens: usage.input_tokens,
		cachedInputTokens: usage.cached_input_tokens,
		outputTokens: usage.output_tokens,
	});
}

/** Usage of an app-server `TokenUsageBreakdown` (camelCase, input includes cached). */
export function codexBreakdown(breakdown: {
	inputTokens?: unknown;
	cachedInputTokens?: unknown;
	outputTokens?: unknown;
}): Usage {
	const input = count(breakdown.inputTokens);
	const cached = Math.min(count(breakdown.cachedInputTokens), input);
	return {
		input_tokens: input - cached,
		cached_input_tokens: cached,
		cache_creation_tokens: 0,
		output_tokens: count(breakdown.outputTokens),
		cost_usd: null,
	};
}

/** `a - b` field by field, never below zero (a thread total minus a baseline). */
export function subtractUsage(a: Usage, b: Usage | null): Usage {
	if (!b) return { ...a };
	return {
		input_tokens: Math.max(0, a.input_tokens - b.input_tokens),
		cached_input_tokens: Math.max(0, a.cached_input_tokens - b.cached_input_tokens),
		cache_creation_tokens: Math.max(0, a.cache_creation_tokens - b.cache_creation_tokens),
		output_tokens: Math.max(0, a.output_tokens - b.output_tokens),
		cost_usd: null,
	};
}
