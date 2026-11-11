/**
 * Runs one step on a runtime session (`driver: session`) and returns the
 * same `RuntimeResult` as the `cli` driver, so steps do not care which
 * driver ran them.
 *
 * The session starts with the step prompt. When it goes idle, pending
 * operator messages (`send --mode next`) are sent as the next turn;
 * otherwise the session is closed and the last turn's final message is the
 * step output (its last line holds the result block). Requests (permissions,
 * questions) go to `SessionHost.requestInput` while the session waits alive.
 */

import type { RuntimeSession, SessionEvent } from "./session.js";
import type { RuntimeAdapter, RuntimeResult, RuntimeRunOptions } from "./types.js";

export async function runSession(
	adapter: RuntimeAdapter,
	options: RuntimeRunOptions,
): Promise<RuntimeResult> {
	if (!adapter.createSession || !adapter.sessionOptions) {
		throw new Error(`Runtime ${adapter.id} has no session driver`);
	}
	if (options.signal?.aborted) {
		return adapter.buildFinalResult(-1, "", "Step interrupted before it started", options);
	}
	const host = options.sessionHost ?? {};
	const console = options.console ?? null;
	const stop = new AbortController();
	const onAbort = () => stop.abort();
	options.signal?.addEventListener("abort", onAbort, { once: true });

	let last: { text: string; isError: boolean } | null = null;
	let model: string | null = options.model ?? null;
	let lastError: string | null = null;
	let timedOut = false;
	let deciding = false;
	let session: RuntimeSession | null = null;

	const onIdle = async () => {
		if (deciding || !session) return;
		deciding = true;
		try {
			const next = stop.signal.aborted ? "" : ((await host.nextMessages?.()) ?? "");
			if (next && session.state !== "closed") {
				if (console) {
					console.streamText(next, "user");
					console.streamComplete();
				}
				session.send(next);
			} else {
				session.close();
			}
		} catch (err) {
			lastError = (err as Error).message;
			session.close();
		} finally {
			deciding = false;
		}
	};

	const onEvent = (event: SessionEvent) => {
		host.onEvent?.(event);
		switch (event.type) {
			case "session.started":
				model = event.model ?? model;
				break;
			case "item":
				if (event.kind === "message" && event.role === "assistant" && event.text && console) {
					console.streamText(event.text, "assistant", model);
					console.streamComplete();
				}
				break;
			case "request": {
				const current = session;
				const request = event.request;
				if (!current) break;
				if (!host.requestInput) {
					current.respond(request.id, { option: null, text: "No operator is connected" });
					break;
				}
				host.requestInput(request, current.sessionId).then(
					(decision) => current.respond(request.id, decision),
					(err: Error) => current.respond(request.id, { option: null, text: err.message }),
				);
				break;
			}
			case "turn.completed":
				last = { text: event.result, isError: event.isError };
				break;
			case "state":
				if (event.state === "idle") void onIdle();
				break;
			case "error":
				lastError = event.message;
				break;
		}
	};

	session = adapter.createSession(onEvent);
	const unregister = host.onLive?.({
		get sessionId() {
			return session?.sessionId ?? null;
		},
		steer: (text) => {
			if (session && session.state !== "closed") session.steer(text);
		},
		interrupt: async () => {
			await session?.interrupt();
		},
	});

	let timer: ReturnType<typeof setTimeout> | null = null;
	if (options.timeout) {
		timer = setTimeout(() => {
			timedOut = true;
			stop.abort();
		}, options.timeout * 1000);
	}

	if (console) {
		console.streamText(options.prompt, "user");
		console.streamComplete();
	}
	const start = { ...adapter.sessionOptions(options), signal: stop.signal };
	if (options.resumeSessionId) session.resume(options.resumeSessionId, start);
	else session.start(start);

	const failure = await session.done;
	if (timer) clearTimeout(timer);
	options.signal?.removeEventListener("abort", onAbort);
	unregister?.();

	const final = last as { text: string; isError: boolean } | null;
	const stdout = final?.text ?? "";
	let returncode = 0;
	let stderr = "";
	if (stop.signal.aborted) {
		returncode = -1;
		stderr = timedOut ? `Step timed out after ${options.timeout} seconds` : "Step interrupted";
	} else if (failure || lastError || !final || final.isError) {
		returncode = 1;
		stderr = failure?.message ?? lastError ?? (final ? final.text : "Session ended without a result");
	}
	return adapter.buildFinalResult(returncode, stdout, stderr, options, session.sessionId);
}
