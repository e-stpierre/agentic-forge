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

import { type RuntimeSession, type SessionEvent, userMessageItem } from "./session.js";
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
	let closing = false;
	let session: RuntimeSession | null = null;
	let unregister: (() => void) | undefined;

	// Unregisters the live handle first, so `send --mode now` no longer steers a closing session
	const closeSession = () => {
		closing = true;
		unregister?.();
		unregister = undefined;
		session?.close();
	};

	const onIdle = async () => {
		if (deciding || !session) return;
		deciding = true;
		try {
			const open = !stop.signal.aborted && session.state !== "closed";
			// The step timeout does not run while the host waits (open af_ask questions)
			pauseTimer();
			const next = open ? ((await host.nextMessages?.()) ?? "") : "";
			if (next && session.state !== "closed" && !stop.signal.aborted) {
				resumeTimer();
				if (console) {
					console.streamText(next, "user");
					console.streamComplete();
				}
				transcript(userMessageItem(next));
				session.send(next);
			} else if (session.state === "running" && !stop.signal.aborted) {
				// A turn started while the host was asked (a steer that missed its turn):
				// the session goes idle again when it ends
				resumeTimer();
			} else {
				closeSession();
			}
		} catch (err) {
			lastError = (err as Error).message;
			closeSession();
		} finally {
			deciding = false;
		}
	};

	const transcript = (event: SessionEvent) => {
		try {
			host.onEvent?.(event);
		} catch {
			// A transcript error must not break the step
		}
	};
	const onEvent = (event: SessionEvent) => {
		transcript(
			event.type === "session.started"
				? { ...event, runtime: adapter.id, driver: "session" }
				: event,
		);
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
				// The step timeout does not run while the session waits for an answer
				if (event.state === "awaiting-input") pauseTimer();
				if (event.state === "running") resumeTimer();
				break;
			case "notice":
				console?.info(event.text);
				break;
			case "error":
				lastError = event.message;
				break;
		}
	};

	session = adapter.createSession(onEvent);
	unregister = host.onLive?.({
		get sessionId() {
			return session?.sessionId ?? null;
		},
		steer: (text) => {
			if (!session || closing || session.state === "closed") return false;
			transcript(userMessageItem(text));
			session.steer(text);
			return true;
		},
		interrupt: async () => {
			await session?.interrupt();
		},
	});

	let timer: ReturnType<typeof setTimeout> | null = null;
	let remainingMs = options.timeout ? options.timeout * 1000 : 0;
	let timerStart = 0;
	// An open af_ask question: the agent may wait in the tool call for a human
	let asking = false;
	function resumeTimer(): void {
		if (!options.timeout || timer || stop.signal.aborted || asking) return;
		timerStart = Date.now();
		timer = setTimeout(() => {
			timedOut = true;
			stop.abort();
		}, remainingMs);
	}
	function pauseTimer(): void {
		if (!timer) return;
		clearTimeout(timer);
		timer = null;
		remainingMs = Math.max(0, remainingMs - (Date.now() - timerStart));
	}
	const unsubscribeAsks = host.onAsks?.((open) => {
		asking = open;
		if (open) pauseTimer();
		// Resumed only while a turn runs: idle and awaiting-input keep it paused
		else if (session?.state === "running" && !deciding) resumeTimer();
	});
	resumeTimer();

	if (console) {
		console.streamText(options.prompt, "user");
		console.streamComplete();
	}
	transcript(userMessageItem(options.prompt));
	const start = { ...adapter.sessionOptions(options), signal: stop.signal };
	if (options.resumeSessionId) session.resume(options.resumeSessionId, start);
	else session.start(start);

	const failure = await session.done;
	unsubscribeAsks?.();
	pauseTimer();
	options.signal?.removeEventListener("abort", onAbort);
	unregister?.();
	unregister = undefined;

	const final = last as { text: string; isError: boolean } | null;
	const stdout = final?.text ?? "";
	let returncode = 0;
	let stderr = "";
	if (stop.signal.aborted) {
		returncode = -1;
		stderr = timedOut ? `Step timed out after ${options.timeout} seconds` : "Step interrupted";
	} else if (failure || lastError || !final || final.isError) {
		returncode = 1;
		stderr =
			failure?.message ?? lastError ?? (final ? final.text : "Session ended without a result");
	}
	return adapter.buildFinalResult(returncode, stdout, stderr, options, session.sessionId);
}
