/**
 * Test helper: a fake runtime that replaces `runRuntime` so workflows run
 * without a real `claude` or `codex` session.
 *
 * Usage (the mock must be declared in the test file so vitest hoists it):
 *
 *   vi.mock("../src/runtimes/process-runner.js", async (importOriginal) => {
 *     const { fakeRuntime } = await import("./helpers/fake-runtime.js");
 *     return { ...(await importOriginal()), runRuntime: fakeRuntime.run };
 *   });
 *
 * By default every prompt succeeds. `fakeRuntime.on(match, behavior)` changes
 * the outcome for prompts containing `match`: "fail", "hang" (never settles,
 * as a step whose supervisor died, unless `options.signal` aborts it, as the
 * real runner does when it kills the process tree), or a function returning
 * the result.
 */

import type { RuntimeAdapter, RuntimeResult, RuntimeRunOptions } from "../../src/runtimes/types.js";

export interface FakeCall {
	prompt: string;
	cwd: string | null;
	env: NodeJS.ProcessEnv | null;
	/** True once the call was stopped through `options.signal`. */
	aborted: boolean;
}

type Behavior =
	| "succeed"
	| "fail"
	| "hang"
	| ((options: RuntimeRunOptions) => RuntimeResult | Promise<RuntimeResult>);

function result(options: RuntimeRunOptions, success: boolean): RuntimeResult {
	return {
		returncode: success ? 0 : 1,
		stdout: success ? "ok" : "",
		stderr: success ? "" : "fake runtime failure",
		prompt: options.prompt,
		cwd: options.cwd ?? null,
		model: options.model ?? null,
		success,
		sessionOutput: { sessionId: null, isSuccess: success, context: success ? "done" : "" },
	};
}

class FakeRuntime {
	calls: FakeCall[] = [];
	private behaviors: [string, Behavior][] = [];
	private waiters: { match: string; resolve: () => void }[] = [];

	reset(): void {
		this.calls = [];
		this.behaviors = [];
		this.waiters = [];
	}

	/** Sets the behavior for prompts containing `match` (last registration wins). */
	on(match: string, behavior: Behavior): void {
		this.behaviors.unshift([match, behavior]);
	}

	/** Resolves once a prompt containing `match` has been started. */
	waitFor(match: string): Promise<void> {
		if (this.calls.some((c) => c.prompt.includes(match))) return Promise.resolve();
		return new Promise((resolve) => this.waiters.push({ match, resolve }));
	}

	run = async (_adapter: RuntimeAdapter, options: RuntimeRunOptions): Promise<RuntimeResult> => {
		const call: FakeCall = {
			prompt: options.prompt,
			cwd: options.cwd ?? null,
			env: options.env ?? null,
			aborted: false,
		};
		this.calls.push(call);
		for (const w of this.waiters.filter((x) => options.prompt.includes(x.match))) w.resolve();
		this.waiters = this.waiters.filter((x) => !options.prompt.includes(x.match));
		const behavior = this.behaviors.find(([m]) => options.prompt.includes(m))?.[1] ?? "succeed";
		if (behavior === "hang") {
			return new Promise<RuntimeResult>((resolve) => {
				const signal = options.signal;
				if (!signal) return;
				const abort = () => {
					call.aborted = true;
					resolve(result(options, false));
				};
				if (signal.aborted) abort();
				else signal.addEventListener("abort", abort, { once: true });
			});
		}
		if (behavior === "fail") return result(options, false);
		if (behavior === "succeed") return result(options, true);
		return behavior(options);
	};
}

export const fakeRuntime = new FakeRuntime();
