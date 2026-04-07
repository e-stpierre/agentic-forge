/** Shared helpers for resolving worktree settings template strings. */

import type { TemplateRenderer } from "./renderer.js";
import type { WorktreeSettings } from "./types.js";

/**
 * Resolves the workflow-level worktree.enabled value to a boolean.
 * Supports plain booleans and Nunjucks template strings like "{{ variables.use_worktree }}".
 */
export function resolveWorktreeEnabled(
	settings: WorktreeSettings,
	renderer: TemplateRenderer,
	variables: Record<string, unknown>,
): boolean {
	const raw = settings.enabled;
	if (typeof raw === "boolean") {
		return raw;
	}
	if (typeof raw === "string") {
		if (renderer.hasVariables(raw)) {
			const resolved = renderer.renderString(raw, { variables, ...variables });
			return resolved.trim().toLowerCase() === "true";
		}
		return raw.trim().toLowerCase() === "true";
	}
	return false;
}

/**
 * Resolves a step-level worktree value to a boolean.
 * Supports plain booleans, null/undefined (defaults to false), and Nunjucks template strings.
 */
export function resolveStepWorktree(
	value: boolean | string | null | undefined,
	renderer: TemplateRenderer,
	variables: Record<string, unknown>,
): boolean {
	if (value === null || value === undefined) {
		return false;
	}
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "string") {
		if (renderer.hasVariables(value)) {
			const resolved = renderer.renderString(value, { variables, ...variables });
			return resolved.trim().toLowerCase() === "true";
		}
		return value.trim().toLowerCase() === "true";
	}
	return false;
}
