/**
 * `gh` CLI runner used by the GitHub step types (`wait-for-review`,
 * `wait-for-checks`, `merge`). Calls are asynchronous so a long wait never
 * blocks the supervisor's event loop (the merge lock heartbeat runs on it).
 *
 * `AF_GH_CMD` (a JSON array, for example `["node", "fake-gh.mjs"]`) replaces
 * `gh` in tests.
 */

import { execFile } from "node:child_process";

export interface GhResult {
	code: number;
	stdout: string;
	stderr: string;
}

export interface GhOptions {
	cwd?: string | null;
	env?: NodeJS.ProcessEnv | null;
	signal?: AbortSignal | null;
}

export class GhError extends Error {
	constructor(
		message: string,
		public readonly result: GhResult | null = null,
	) {
		super(message);
		this.name = "GhError";
	}
}

/** The `gh` command line: `AF_GH_CMD` when set, else `gh`. */
export function ghCommand(env: NodeJS.ProcessEnv = process.env): string[] {
	const raw = env.AF_GH_CMD;
	if (raw) {
		try {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed) && parsed.length > 0) return parsed.map(String);
		} catch {
			// Fall through to gh
		}
	}
	return ["gh"];
}

/**
 * The function every `gh` call goes through. Tests replace `ghRunner.run`
 * to answer in-process; `AF_GH_CMD` replaces the executable instead.
 */
export const ghRunner: { run: (args: string[], options: GhOptions) => Promise<GhResult> } = {
	run: execGh,
};

/** Runs `gh <args>` and returns its exit code and output (never throws on a non-zero exit). */
export function runGh(args: string[], options: GhOptions = {}): Promise<GhResult> {
	return ghRunner.run(args, options);
}

function execGh(args: string[], options: GhOptions = {}): Promise<GhResult> {
	const env = { ...process.env, ...(options.env ?? {}), GH_PROMPT_DISABLED: "1" };
	const [command, ...prefix] = ghCommand(env);
	return new Promise((resolve, reject) => {
		execFile(
			command,
			[...prefix, ...args],
			{
				cwd: options.cwd ?? undefined,
				env,
				maxBuffer: 32 * 1024 * 1024,
				windowsHide: true,
				signal: options.signal ?? undefined,
			},
			(error, stdout, stderr) => {
				const code = error ? (typeof error.code === "number" ? error.code : -1) : 0;
				if (error && typeof error.code !== "number") {
					if (error.name === "AbortError") {
						reject(new GhError("gh call aborted"));
						return;
					}
					reject(new GhError(`gh could not run: ${error.message}`));
					return;
				}
				resolve({ code, stdout: String(stdout), stderr: String(stderr) });
			},
		);
	});
}

/** Runs `gh <args>` and returns stdout; a non-zero exit throws a `GhError`. */
export async function gh(args: string[], options: GhOptions = {}): Promise<string> {
	const result = await runGh(args, options);
	if (result.code !== 0) {
		const detail = (result.stderr || result.stdout).trim();
		throw new GhError(`gh ${args.slice(0, 3).join(" ")} failed: ${detail}`, result);
	}
	return result.stdout;
}

/** Runs `gh <args>` and parses stdout as JSON. */
export async function ghJson<T>(args: string[], options: GhOptions = {}): Promise<T> {
	const out = await gh(args, options);
	try {
		return JSON.parse(out) as T;
	} catch {
		throw new GhError(`gh ${args.slice(0, 3).join(" ")} returned invalid JSON`);
	}
}

/**
 * Parses `gh api --paginate` output: one JSON array per page, concatenated
 * (`[...][...]`), or a single array.
 */
export function parsePaginated<T>(out: string): T[] {
	const text = out.trim();
	if (!text) return [];
	try {
		const parsed = JSON.parse(text);
		return Array.isArray(parsed) ? (parsed as T[]) : [parsed as T];
	} catch {
		const pages = JSON.parse(`[${text.replace(/\]\s*\[/g, "],[")}]`) as T[][];
		return pages.flat();
	}
}

/** `owner/repo` of a pull request URL (`https://github.com/o/r/pull/1`), or null. */
export function repoFromPrUrl(url: string): string | null {
	const match = /github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/.exec(url);
	return match ? `${match[1]}/${match[2]}` : null;
}
