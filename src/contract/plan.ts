/**
 * Harness contract v1: plan versions. `plan.md` is version 1, `plan.v<N>.md`
 * is version N (written by an amending step). Later steps read the highest.
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

export interface PlanVersion {
	/** 0 when the run directory holds no plan. */
	version: number;
	/** Absolute path of the latest plan file, or null. */
	path: string | null;
}

/** Highest plan version present in a run directory. */
export function latestPlan(runDir: string | null | undefined): PlanVersion {
	if (!runDir || !existsSync(runDir)) return { version: 0, path: null };
	let best: PlanVersion = { version: 0, path: null };
	for (const name of readdirSync(runDir)) {
		const match = name === "plan.md" ? ["", "1"] : /^plan\.v(\d+)\.md$/.exec(name);
		if (!match) continue;
		const version = Number.parseInt(match[1], 10);
		if (version > best.version) best = { version, path: path.join(runDir, name) };
	}
	return best;
}
