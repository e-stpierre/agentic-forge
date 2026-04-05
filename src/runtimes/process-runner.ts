/** Shared process runner for all runtime adapters. */

import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import type { ConsoleOutput } from "../console.js";
import type { RuntimeAdapter, RuntimeResult, RuntimeRunOptions, StreamEvent } from "./types.js";
import { resolveCmdScript } from "./utils.js";

/** Write a debug entry to spawn-debug.log in the output directory when AF_DEBUG_SPAWN is set. */
function spawnDebug(outputDir: string | null | undefined, label: string, data: unknown): void {
	if (!process.env.AF_DEBUG_SPAWN || !outputDir) return;
	try {
		mkdirSync(outputDir, { recursive: true });
		const logPath = path.join(outputDir, "spawn-debug.log");
		const ts = new Date().toISOString();
		const line = `[${ts}] ${label}: ${typeof data === "string" ? data : JSON.stringify(data)}\n`;
		appendFileSync(logPath, line);
	} catch {
		// Debug logging must never break the workflow
	}
}

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

		// On Windows, .cmd wrappers from npm cannot be spawned directly by
		// Node's spawn(). Resolve the underlying .js entry point and run it
		// with node, which avoids shell quoting issues with multi-line prompts.
		let spawnExe = executable;
		let spawnArgs = args;
		if (process.platform === "win32" && /\.(cmd|bat)$/i.test(executable)) {
			const script = resolveCmdScript(executable);
			if (script) {
				spawnExe = process.execPath;
				spawnArgs = [script, ...args];
			}
		}

		// When there is no stdin input, use "ignore" so the child process
		// does not see an open pipe and try to read from it (e.g. Codex).
		const useStdin = stdinInput && stdinInput.length > 0;

		spawnDebug(options.outputDir, "SPAWN", {
			exe: spawnExe,
			args: spawnArgs.map((a, i) => (a.length > 100 ? `[${i}](${a.length}ch)` : `[${i}]${a}`)),
			stdin: useStdin ? "pipe" : "ignore",
			cwd: options.cwd,
			adapterId: adapter.id,
			originalExe: executable,
		});

		const proc = spawn(spawnExe, spawnArgs, {
			cwd: options.cwd ?? undefined,
			env,
			stdio: [useStdin ? "pipe" : "ignore", "pipe", "pipe"],
		});

		// Handle spawn errors (e.g., executable not found at runtime)
		proc.on("error", (err) => {
			spawnDebug(options.outputDir, "SPAWN_ERROR", err.message);
			const result = adapter.buildFinalResult(-1, "", err.message, options);
			resolve(result);
		});

		// Write prompt to stdin
		if (useStdin && proc.stdin) {
			proc.stdin.write(stdinInput);
			proc.stdin.end();
		}

		// Show user prompt at start in streaming mode
		if (options.printOutput && options.console) {
			options.console.streamText(stdinInput, "user");
			options.console.streamComplete();
		}

		const collectedText: string[] = [];
		const rawStdout: string[] = [];
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
					if (!event) {
						// Accumulate raw stdout for non-streaming output paths
						if (line) rawStdout.push(line);
						continue;
					}

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

			spawnDebug(options.outputDir, "CLOSE", {
				exitCode: code,
				stderrLength: stderrData.length,
				stderrPreview: stderrData.slice(0, 500),
				stdoutLines: rawStdout.length,
				collectedTextLength: collectedText.join("").length,
				hasResultText: resultText !== null,
			});

			// Process any remaining data in the line buffer
			if (lineBuffer.trim()) {
				const event = adapter.parseStreamLine(lineBuffer);
				if (event && event.type === "result") {
					resultText = event.text ?? null;
				} else if (lineBuffer.trim()) {
					rawStdout.push(lineBuffer);
				}
			}

			if (options.printOutput && options.console && hasStreamedContent) {
				options.console.streamComplete();
			}

			const streamOutput = collectedText.join("");
			const finalOutput = resultText ?? (streamOutput || rawStdout.join("\n"));

			const result = adapter.buildFinalResult(code ?? 1, finalOutput, stderrData, options);

			resolve(result);
		});
	});
}
