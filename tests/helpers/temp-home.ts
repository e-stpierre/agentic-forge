/**
 * Test helper: points the af global directory at a fresh temp dir for each test
 * (through AGENTIC_FORGE_HOME) and removes it afterward. Every test that starts
 * a supervisor, writes a lock or pidfile, or creates runs must use it.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";
import { GLOBAL_ROOT_ENV } from "../../src/paths.js";

export function useTempGlobalRoot(): { readonly root: string } {
	const state = { root: "" };
	let previous: string | undefined;
	beforeEach(() => {
		previous = process.env[GLOBAL_ROOT_ENV];
		state.root = mkdtempSync(path.join(tmpdir(), "af-home-"));
		process.env[GLOBAL_ROOT_ENV] = state.root;
	});
	afterEach(() => {
		if (previous === undefined) delete process.env[GLOBAL_ROOT_ENV];
		else process.env[GLOBAL_ROOT_ENV] = previous;
		rmSync(state.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	});
	return state;
}
