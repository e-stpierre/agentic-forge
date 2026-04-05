/** Shared process runner for all runtime adapters. */

import { spawn } from "node:child_process";

import type { ConsoleOutput } from "../console.js";
import type { RuntimeAdapter, RuntimeResult, RuntimeRunOptions, StreamEvent } from "./types.js";

/**
 * Run a workflow step using the specified runtime adapter.
 *
 * Handles:
 * - Command building via adapter
 * - Process spawning with stdin/stdout/stderr
 * - Stream parsing via adapter
 * - Console output (streaming or silent)
 * - Timeout handling
 * - Result assembly via adapter
 */
export async function runRuntime(
	adapter: RuntimeAdapter,
	options: RuntimeRunOptions,
): Promise<RuntimeResult> {
	return new Promise((resolve) => {
		const command = adapter.buildCommand(options);
		const { executable, args, env: extraEnv, stdinInput } = command;

		// Merge extra env vars with process.env
		const env = extraEnv ? { ...process.env, ...extraEnv } : process.env;

		const proc = spawn(executable, args, {
			cwd: options.cwd ?? undefined,
			env,
			stdio: ["pipe", "pipe", "pipe"],
		});

		// Write prompt to stdin
		if (proc.stdin) {
			proc.stdin.write(stdinInput);
			proc.stdin.end();
		}

		// Show user prompt at start in streaming mode
		if (options.printOutput && options.console) {
			options.console.streamText(stdinInput, "user");
			options.console.streamComplete();
		}

		const collectedText: string[] = [];
		let resultText: string | null = null;
		const accumulatedText: Map<number, string> = new Map();
		let hasStreamedContent = false;
		let stderrData = "";

		// Collect stderr
		if (proc.stderr) {
			proc.stderr.on("data", (chunk: Buffer) => {
				stderrData += chunk.toString("utf-8");
			});
			proc.stderr.on("error", () => {
				// Stream error during process execution; stderr data already captured
			});
		}

		// Process stdout
		let lineBuffer = "";

		if (proc.stdout) {
			proc.stdout.on("data", (chunk: Buffer) => {
				lineBuffer += chunk.toString("utf-8");
				const lines = lineBuffer.split("\n");
				// Keep the last partial line in the buffer
				lineBuffer = lines.pop() ?? "";

				for (const line of lines) {
					const event = adapter.parseStreamLine(line);
					if (!event) continue;

					// When a new assistant message starts, complete the previous one
					if (event.type === "text" && hasStreamedContent && options.console) {
						options.console.streamComplete();
						hasStreamedContent = false;
						accumulatedText.clear();
					}

					// Handle user messages
					if (event.type === "user_text" && options.console) {
						if (hasStreamedContent) {
							options.console.streamComplete();
							hasStreamedContent = false;
						}
						if (event.text) {
							options.console.streamText(event.text, "user");
						}
						options.console.streamComplete();
					}

					// Handle model info
					if (event.type === "model_info" && event.model && options.console) {
						// Model info can be logged separately if needed
					}

					// Stream text content
					if (event.type === "text" && event.text) {
						const idx = event.index ?? 0;
						const text = event.text;

						// Calculate delta (difference from previous)
						const prevText = accumulatedText.get(idx) ?? "";
						const delta = text.startsWith(prevText) ? text.slice(prevText.length) : text;
						accumulatedText.set(idx, text);

						if (delta) {
							if (options.printOutput && options.console) {
								options.console.streamText(delta, "assistant", event.model);
								hasStreamedContent = true;
							} else {
								process.stdout.write(delta);
							}
							collectedText.push(delta);
						}
					}

					// Capture final result
					if (event.type === "result") {
						resultText = event.text ?? null;
					}

					// Handle errors
					if (event.type === "error") {
						// Errors are collected but don't stop processing
					}
				}
			});
		}

		if (proc.stdout) {
			proc.stdout.on("error", () => {
				// Stream error during process execution; stdout data already captured
			});
		}

		// Handle timeout
		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		if (options.timeout) {
			timeoutId = setTimeout(() => {
				proc.stdout?.destroy();
				proc.stderr?.destroy();
				proc.kill();
			}, options.timeout * 1000);
		}

		proc.on("close", (code) => {
			if (timeoutId) clearTimeout(timeoutId);

			// Process any remaining data in the line buffer
			if (lineBuffer.trim()) {
				const event = adapter.parseStreamLine(lineBuffer);
				if (event && event.type === "result") {
					resultText = event.text ?? null;
				}
			}

			if (options.printOutput && options.console && hasStreamedContent) {
				options.console.streamComplete();
			}

			const finalOutput = resultText ?? collectedText.join("");

			const result = adapter.buildFinalResult(
				code ?? 1,
				finalOutput,
				stderrData,
				options,
			);

			resolve(result);
		});
	});
}
