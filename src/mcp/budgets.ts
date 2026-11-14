/**
 * Size budgets of the MCP tool results. Every tool
 * result stays under `RESULT_BUDGET_BYTES` by default; a caller gets more
 * only through an explicit parameter (`limit`, `max_chars`, `verbose`). Tests
 * and docs reference these constants.
 */

export { EVENT_STRING_MAX } from "../runs/event-data.js";
export {
	LOGS_MCP_DEFAULT_LIMIT,
	LOGS_MCP_MAX_BYTES,
	LOGS_MCP_MAX_CHARS,
} from "../runs/transcript.js";

/** Size a default tool result stays under (about 2k tokens). */
export const RESULT_BUDGET_BYTES = 8_000;

/** Default number of events of one af_events page (the CLI keeps 500). */
export const EVENTS_MCP_DEFAULT_LIMIT = 50;

/** Size of the events of one default af_events page; at least one event is returned. */
export const EVENTS_MCP_MAX_BYTES = 6_000;

/** Default number of runs of af_list_runs and of af_status without a run. */
export const RUNS_MCP_DEFAULT_LIMIT = 20;

/** Longest `outputSummary` kept per step in the slim af_status view. */
export const STATUS_SUMMARY_CHARS = 300;

/**
 * Characters of step summaries shared by all steps of the slim af_status view:
 * each step keeps `STATUS_SUMMARY_BUDGET / steps` characters, at most
 * `STATUS_SUMMARY_CHARS`, at least `STATUS_SUMMARY_MIN_CHARS`.
 */
export const STATUS_SUMMARY_BUDGET = 3_600;

export const STATUS_SUMMARY_MIN_CHARS = 80;

/** Default `max_chars` of af_artifacts content. */
export const ARTIFACT_DEFAULT_CHARS = 6_000;

/** Largest `max_chars` of af_artifacts content. */
export const ARTIFACT_MAX_CHARS = 100_000;

/**
 * Size of the `tools/list` response: tool schemas are sent on every overseer
 * turn. Measured after the description cleanup, plus 20% headroom.
 */
export const TOOLS_LIST_BUDGET_BYTES = 28_700;

/** Most rows of one af_usage report; more set `truncated`. */
export const USAGE_MCP_MAX_ROWS = 30;

/** Most active runs listed by af_digest (one line each). */
export const DIGEST_MAX_RUNS = 20;

/** Most changes of one af_digest call; more set `truncated`. */
export const DIGEST_MAX_CHANGES = 20;

/** Size of the changes of one af_digest call; at least one change is returned. */
export const DIGEST_CHANGES_MAX_BYTES = 4_000;

/** Longest question or error text of an af_digest change. */
export const DIGEST_TEXT_CHARS = 200;
