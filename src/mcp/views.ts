/**
 * Slim views of supervisor responses for MCP tool results: the fields an
 * overseer decides on, with long texts cut. The full
 * payloads stay available through `verbose: true`.
 */

import { cutText } from "../runs/event-data.js";
import { type RunDetails, pendingInputs, pendingKind } from "../runs/manager.js";
import type { RegistryEntry, TreeEntry } from "../runs/registry.js";
import {
	STATUS_SUMMARY_BUDGET,
	STATUS_SUMMARY_CHARS,
	STATUS_SUMMARY_MIN_CHARS,
} from "./budgets.js";

/** Longest question and context texts of a pending request in the slim af_status view. */
const QUESTION_CHARS = 300;

export interface SlimStep {
	name: string;
	status: string;
	result_status?: string;
	summary?: string;
	error?: true;
}

/** Characters of `outputSummary` each of `count` steps keeps. */
export function summaryChars(count: number): number {
	if (count <= 0) return STATUS_SUMMARY_CHARS;
	const share = Math.floor(STATUS_SUMMARY_BUDGET / count);
	return Math.min(STATUS_SUMMARY_CHARS, Math.max(STATUS_SUMMARY_MIN_CHARS, share));
}

/** The slim af_status view of one run. */
export function slimRunDetails(details: RunDetails): Record<string, unknown> {
	const { entry, run } = details;
	const chars = summaryChars(details.steps.length);
	const steps: SlimStep[] = details.steps.map((s) => ({
		name: s.name,
		status: s.status,
		...(s.resultStatus ? { result_status: s.resultStatus } : {}),
		...(s.outputSummary ? { summary: cutText(s.outputSummary.trim(), chars) } : {}),
		...(s.error ? { error: true as const } : {}),
	}));
	const pending = run ? pendingInputs(run) : [];
	return {
		id: entry.id,
		workflow: entry.workflow,
		status: entry.status,
		repo: entry.repo,
		dir: entry.dir,
		branch: run?.branch ?? null,
		worktree: run?.worktree ?? null,
		pr: run?.pr ?? null,
		max_risk: run?.max_risk ?? null,
		current_step: details.current_step,
		parent: details.tree.parent,
		depth: details.tree.depth,
		children: details.tree.children.length,
		...(pending.length > 0
			? {
					needs_input: pending.map((p) => ({
						id: p.request.id,
						step: p.step,
						kind: pendingKind(p),
						risk: p.risk ?? null,
						question: cutText(String(p.request.question ?? ""), QUESTION_CHARS),
						...(p.request.context
							? { context: cutText(String(p.request.context), QUESTION_CHARS) }
							: {}),
						options: (p.request.options ?? []).map((o) => `${o.id}: ${cutText(o.label, 80)}`),
						recommended: p.request.recommended ?? null,
						live: p.live === true,
						...(p.overseer_policy ? { overseer_policy: p.overseer_policy } : {}),
					})),
				}
			: {}),
		steps,
	};
}

/** The af_list_runs and af_status (no run) view of a registry entry. */
export function slimEntry(entry: RegistryEntry | TreeEntry): Record<string, unknown> {
	const depth = (entry as Partial<TreeEntry>).depth;
	return {
		id: entry.id,
		workflow: entry.workflow,
		status: entry.status,
		repo: entry.repo,
		dir: entry.dir,
		parent: entry.parent ?? null,
		...(depth !== undefined ? { depth } : {}),
		...(entry.type ? { type: entry.type } : {}),
		created_at: entry.created_at,
		updated_at: entry.updated_at,
	};
}
