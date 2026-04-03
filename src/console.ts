/** Console output utilities for workflow execution. */

import type { Writable } from "node:stream";

// --- Enums and constants ---

export const OutputLevel = {
	BASE: "base",
	ALL: "all",
} as const;
export type OutputLevel = (typeof OutputLevel)[keyof typeof OutputLevel];

export const Color = {
	RESET: "\x1b[0m",
	BOLD: "\x1b[1m",
	DIM: "\x1b[2m",
	RED: "\x1b[31m",
	GREEN: "\x1b[32m",
	YELLOW: "\x1b[33m",
	BLUE: "\x1b[34m",
	MAGENTA: "\x1b[35m",
	CYAN: "\x1b[36m",
	WHITE: "\x1b[37m",
	BRIGHT_RED: "\x1b[91m",
	BRIGHT_GREEN: "\x1b[92m",
	BRIGHT_YELLOW: "\x1b[93m",
	BRIGHT_BLUE: "\x1b[94m",
	BRIGHT_CYAN: "\x1b[96m",
} as const;
export type Color = (typeof Color)[keyof typeof Color];

/** Maximum characters to accumulate in BASE mode before truncating (1MB). */
const MAX_ACCUMULATED_TEXT = 1024 * 1024;

// --- Utility functions ---

export function supportsColor(): boolean {
	if (typeof process.stdout.isTTY !== "boolean") {
		return false;
	}
	return process.stdout.isTTY;
}

export function colorize(text: string, ...colors: Color[]): string {
	if (!supportsColor()) {
		return text;
	}
	const colorCodes = colors.join("");
	return `${colorCodes}${text}${Color.RESET}`;
}

/**
 * Format a model name for display (e.g., "claude-sonnet-4-5-20250929" -> "Sonnet 4.5").
 * This is a simplified version; the full version lives in runner.ts.
 * We accept an optional formatter to avoid circular imports.
 */
type ModelFormatter = (model: string) => string | null;

// --- ParallelOutputHandler ---

export class ParallelOutputHandler {
	stream: Writable;
	level: OutputLevel;
	private printFn: ((message: string) => void) | null;

	private branches: string[] = [];
	private branchIndex: Map<string, number> = new Map();
	private branchDone: Map<string, boolean> = new Map();
	private deferredMessages: string[] = [];
	private linesPerBranch = 4;
	private active = false;

	// Per-branch accumulation (single-threaded, so we use maps instead of thread-local)
	private currentBranch: string | null = null;
	private accumulatedText = "";
	private accumulatedRole = "";
	private accumulatedModel: string | null = null;
	private baseAccumulatedText = "";

	// Message queue for ALL mode parallel
	private messageQueue: Array<[string, string, string, string | null]> = [];

	constructor(
		stream: Writable = process.stdout,
		level: OutputLevel = OutputLevel.BASE,
		printFn?: (message: string) => void,
	) {
		this.stream = stream;
		this.level = level;
		this.printFn = printFn ?? null;
	}

	private print(message: string): void {
		if (this.printFn) {
			this.printFn(message);
		} else {
			this.stream.write(`${message}\n`);
		}
	}

	get isActive(): boolean {
		return this.active;
	}

	get hasBranches(): boolean {
		return this.branches.length > 0;
	}

	registerBranches(branches: string[]): void {
		this.branches = [...branches];
		this.branchIndex = new Map(branches.map((name, idx) => [name, idx]));
		this.branchDone = new Map(branches.map((name) => [name, false]));
		this.deferredMessages = [];

		if (this.level === OutputLevel.BASE && supportsColor()) {
			for (const branch of branches) {
				const prefix = colorize(`[${branch}]`, Color.CYAN, Color.BOLD);
				this.print(prefix);
				const waiting = colorize("waiting...", Color.DIM);
				this.print(`  ${waiting}`);
				this.print(""); // Message line 2
				this.print(""); // Blank line
			}
		}
	}

	updateBranchLine(branch: string, text: string, maxWidth = 100): void {
		if (!supportsColor() || !this.branchIndex.has(branch)) return;
		if (this.branchDone.get(branch)) return;

		const idx = this.branchIndex.get(branch) ?? 0;
		const totalBranches = this.branches.length;
		const totalLines = totalBranches * this.linesPerBranch;
		const branchStartLine = idx * this.linesPerBranch;
		const messageLine1 = branchStartLine + 1;
		const messageLine2 = branchStartLine + 2;
		const linesUpToMsg1 = totalLines - messageLine1;
		const linesUpToMsg2 = totalLines - messageLine2;

		const trimmed = text.trim();
		let line1: string;
		let line2 = "";
		if (trimmed.length <= maxWidth) {
			line1 = trimmed;
		} else {
			let breakPoint = trimmed.lastIndexOf(" ", maxWidth);
			if (breakPoint === -1) breakPoint = maxWidth;
			line1 = trimmed.slice(0, breakPoint).trim();
			line2 = trimmed.slice(breakPoint).trim();
			if (line2.length > maxWidth) {
				line2 = `${line2.slice(0, maxWidth - 3)}...`;
			}
		}

		const prefix = colorize("...", Color.DIM);
		const w = this.stream;
		w.write("\x1b[s"); // Save cursor
		w.write(`\x1b[${linesUpToMsg1}A`); // Move up
		w.write("\x1b[K"); // Clear line
		w.write(`  ${prefix} ${line1}`);
		w.write(`\x1b[${linesUpToMsg1 - linesUpToMsg2}B`); // Move down to line 2
		w.write("\r\x1b[K"); // Clear line
		if (line2) {
			w.write(`  ${prefix} ${line2}`);
		}
		w.write("\x1b[u"); // Restore cursor
	}

	markBranchDone(branch: string, success = true): void {
		if (!supportsColor() || !this.branchIndex.has(branch)) return;

		this.branchDone.set(branch, true);
		const idx = this.branchIndex.get(branch) ?? 0;
		const totalBranches = this.branches.length;
		const totalLines = totalBranches * this.linesPerBranch;
		const branchStartLine = idx * this.linesPerBranch;
		const linesUpToHeader = totalLines - branchStartLine;
		const messageLine1 = branchStartLine + 1;
		const messageLine2 = branchStartLine + 2;
		const linesUpToMsg1 = totalLines - messageLine1;
		const linesUpToMsg2 = totalLines - messageLine2;

		const branchPrefix = colorize(`[${branch}]`, Color.CYAN, Color.BOLD);
		const status = success
			? colorize("[Done]", Color.BRIGHT_GREEN, Color.BOLD)
			: colorize("[Failed]", Color.BRIGHT_RED, Color.BOLD);

		const w = this.stream;
		w.write("\x1b[s");
		w.write(`\x1b[${linesUpToHeader}A`);
		w.write("\x1b[K");
		w.write(`${branchPrefix} ${status}`);
		w.write(`\x1b[${linesUpToHeader - linesUpToMsg1}B`);
		w.write("\r\x1b[K");
		w.write(`\x1b[${linesUpToMsg1 - linesUpToMsg2}B`);
		w.write("\r\x1b[K");
		w.write("\x1b[u");
	}

	private clearDisplay(): void {
		if (this.branches.length === 0 || !supportsColor()) {
			this.branches = [];
			this.branchIndex = new Map();
			this.branchDone = new Map();
			return;
		}

		const totalLines = this.branches.length * this.linesPerBranch;
		for (let i = 0; i < totalLines; i++) {
			this.stream.write("\x1b[A\x1b[2K");
		}

		this.branches = [];
		this.branchIndex = new Map();
		this.branchDone = new Map();
	}

	enter(): void {
		this.active = true;
		if (this.level === OutputLevel.ALL) {
			this.messageQueue = [];
		}
	}

	exit(): void {
		if (this.level === OutputLevel.BASE) {
			if (this.branches.length > 0) {
				this.clearDisplay();
			}
			for (const msg of this.deferredMessages) {
				this.print(msg);
			}
			this.deferredMessages = [];
		}

		// Flush remaining messages in ALL mode
		if (this.level === OutputLevel.ALL) {
			for (const [branch, role, text, model] of this.messageQueue) {
				this.printBranchMessage(branch, role, text, model);
			}
			this.messageQueue = [];
		}

		this.active = false;
	}

	deferMessage(message: string): void {
		this.deferredMessages.push(message);
	}

	setBranch(branchName: string): void {
		this.currentBranch = branchName;
		this.accumulatedText = "";
		this.accumulatedRole = "";
		this.accumulatedModel = null;
		this.baseAccumulatedText = "";
	}

	getCurrentBranch(): string | null {
		return this.currentBranch;
	}

	enqueueCurrentMessage(): void {
		if (
			this.level === OutputLevel.ALL &&
			this.active &&
			this.accumulatedText.trim() &&
			this.accumulatedRole &&
			this.currentBranch
		) {
			this.messageQueue.push([
				this.currentBranch,
				this.accumulatedRole,
				this.accumulatedText.trim(),
				this.accumulatedModel,
			]);
		}

		this.accumulatedText = "";
		this.accumulatedRole = "";
		this.accumulatedModel = null;
	}

	private printBranchMessage(
		branch: string,
		role: string,
		text: string,
		model: string | null,
		formatModelName?: ModelFormatter,
	): void {
		const formattedModel = formatModelName && model ? formatModelName(model) : null;
		const branchPrefix = colorize(`[${branch}] `, Color.CYAN, Color.BOLD);

		if (role === "user") {
			const prefix = colorize(">", Color.BRIGHT_CYAN, Color.BOLD);
			const label = colorize(" [user]", Color.DIM);
			this.print(`\n${branchPrefix}${prefix}${label}`);
			for (const line of text.split("\n")) {
				const coloredLine = colorize(line, Color.GREEN);
				this.print(`  ${coloredLine}`);
			}
		} else {
			const bullet = colorize("*", Color.BRIGHT_GREEN, Color.BOLD);
			let modelLabel = "";
			if (formattedModel) {
				modelLabel = ` ${colorize(`[${formattedModel}]`, Color.DIM)}`;
			}
			const lines = text.split("\n");
			this.print(`\n${branchPrefix}${bullet}${modelLabel} ${lines[0]}`);
			for (const line of lines.slice(1)) {
				this.print(`  ${line}`);
			}
		}
	}

	accumulateText(text: string, role: string, model?: string | null): void {
		if (this.accumulatedRole && this.accumulatedRole !== role && this.accumulatedText.trim()) {
			this.enqueueCurrentMessage();
		}

		this.accumulatedText += text;
		this.accumulatedRole = role;
		if (model) {
			this.accumulatedModel = model;
		}
	}

	accumulateBaseText(text: string): string {
		this.baseAccumulatedText += text;
		const accumulated = this.baseAccumulatedText.trim();
		if (accumulated) {
			const lines = accumulated.split("\n");
			return lines[lines.length - 1];
		}
		return "";
	}
}

// --- ConsoleOutput ---

export class ConsoleOutput {
	level: OutputLevel;
	stream: Writable;
	_baseAccumulatedText = "";
	private baseLastDisplayLines = 0;
	_parallelHandler: ParallelOutputHandler;
	private formatModelName: ModelFormatter | null = null;

	constructor(level: OutputLevel = OutputLevel.BASE, stream: Writable = process.stdout) {
		this.level = level;
		this.stream = stream;
		this._parallelHandler = new ParallelOutputHandler(stream, level, (msg) => this.printLine(msg));
	}

	/** Set model name formatter to avoid circular imports with runner. */
	setModelFormatter(fn: ModelFormatter): void {
		this.formatModelName = fn;
	}

	private printLine(message: string, end = "\n"): void {
		this.stream.write(`${message}${end}`);
	}

	private printInplace(message: string): void {
		const lines = message.trim().split("\n");
		const numLines = lines.length;

		if (supportsColor()) {
			if (this.baseLastDisplayLines > 0) {
				this.stream.write(`\x1b[${this.baseLastDisplayLines}A`);
				this.stream.write("\x1b[J");
			}
			const content = `${lines.join("\n")}\n`;
			this.stream.write(content);
		} else {
			const lastLine = lines[lines.length - 1] ?? "";
			const truncated = lastLine.length > 80 ? `${lastLine.slice(0, 80)}...` : lastLine;
			this.printLine(`  ... ${truncated}`);
		}

		this.baseLastDisplayLines = numLines;
	}

	private clearInplace(): void {
		if (this.baseLastDisplayLines > 0 && supportsColor()) {
			this.stream.write(`\x1b[${this.baseLastDisplayLines}A\x1b[J`);
		}
		this.baseLastDisplayLines = 0;
	}

	// --- Parallel mode delegation ---

	registerParallelBranches(branches: string[]): void {
		this._parallelHandler.registerBranches(branches);
	}

	enterParallelMode(): void {
		this._parallelHandler.enter();
	}

	exitParallelMode(): void {
		this._parallelHandler.exit();
	}

	setParallelBranch(branchName: string): void {
		this._parallelHandler.setBranch(branchName);
	}

	flushParallelBranch(_branchName: string): void {
		// No-op, kept for compatibility
	}

	markParallelBranchDone(branch: string, success = true): void {
		this._parallelHandler.markBranchDone(branch, success);
	}

	private isParallelMode(): boolean {
		return this._parallelHandler.isActive;
	}

	private shouldDeferMessage(): boolean {
		return (
			this._parallelHandler.isActive &&
			this.level === OutputLevel.BASE &&
			this._parallelHandler.hasBranches
		);
	}

	private deferMessage(message: string): void {
		this._parallelHandler.deferMessage(message);
	}

	// --- Workflow-level messages ---

	workflowStart(workflowName: string, workflowId: string): void {
		const header = colorize(`Workflow: ${workflowName}`, Color.BOLD, Color.BRIGHT_CYAN);
		const idStr = colorize(`[${workflowId}]`, Color.DIM);
		this.printLine(`\n${header} ${idStr}`);
		this.printLine(colorize("-".repeat(50), Color.DIM));
	}

	workflowComplete(workflowName: string, status: string): void {
		this.printLine(colorize("-".repeat(50), Color.DIM));
		const statusStr =
			status === "completed"
				? colorize("COMPLETED", Color.BOLD, Color.BRIGHT_GREEN)
				: colorize(status.toUpperCase(), Color.BOLD, Color.BRIGHT_RED);
		this.printLine(`Workflow ${workflowName}: ${statusStr}\n`);
	}

	// --- Step-level messages ---

	stepStart(stepName: string, stepType?: string | null, model?: string | null): void {
		let modelStr = "";
		if (this.level === OutputLevel.BASE && model) {
			const formattedModel = this.formatModelName ? this.formatModelName(model) : model;
			if (formattedModel) {
				modelStr = `${colorize(`[${formattedModel}] `, Color.DIM)}`;
			}
		}

		const stepStr = colorize(`Step: ${stepName}`, Color.BOLD);
		const typeStr = stepType ? colorize(`[${stepType}]`, Color.DIM) : "";
		const formatted = `\n${modelStr}${stepStr} ${typeStr}`;
		if (this.shouldDeferMessage()) {
			this.deferMessage(formatted);
		} else {
			this.printLine(formatted);
		}
	}

	stepComplete(stepName: string, summary?: string | null): void {
		if (this.level === OutputLevel.BASE && !this.isParallelMode()) {
			this.baseLastDisplayLines = 0;
			this._baseAccumulatedText = "";
		}

		const check = colorize("[OK]", Color.BRIGHT_GREEN);
		const name = colorize(stepName, Color.GREEN);
		const mainLine = `${check} ${name} completed`;

		const lines = [mainLine];
		if (summary && this.level === OutputLevel.BASE) {
			const summaryLines = summary.trim().split("\n");
			for (const line of summaryLines.slice(0, 5)) {
				const truncated = line.length > 200 ? `${line.slice(0, 200)}...` : line;
				lines.push(colorize(`    ${truncated}`, Color.DIM));
			}
			if (summaryLines.length > 5) {
				lines.push(colorize(`    ... (${summaryLines.length - 5} more lines)`, Color.DIM));
			}
		}

		if (this.shouldDeferMessage()) {
			const branch = this._parallelHandler.getCurrentBranch();
			if (branch) {
				this.markParallelBranchDone(branch);
			}
			for (const line of lines) {
				this.deferMessage(line);
			}
		} else {
			for (const line of lines) {
				this.printLine(line);
			}
		}
	}

	stepFailed(stepName: string, error?: string | null): void {
		if (this.level === OutputLevel.BASE && !this.isParallelMode()) {
			this.baseLastDisplayLines = 0;
			this._baseAccumulatedText = "";
		}

		const cross = colorize("[FAIL]", Color.BRIGHT_RED);
		const name = colorize(stepName, Color.RED);
		const mainLine = `${cross} ${name} failed`;

		const lines = [mainLine];
		if (error) {
			const errorLines = error.trim().split("\n");
			for (const line of errorLines.slice(0, 10)) {
				const truncated = line.length > 200 ? `${line.slice(0, 200)}...` : line;
				lines.push(colorize(`    ${truncated}`, Color.RED));
			}
			if (errorLines.length > 10) {
				lines.push(colorize(`    ... (${errorLines.length - 10} more lines)`, Color.DIM));
			}
		}

		if (this.shouldDeferMessage()) {
			const branch = this._parallelHandler.getCurrentBranch();
			if (branch) {
				this.markParallelBranchDone(branch, false);
			}
			for (const line of lines) {
				this.deferMessage(line);
			}
		} else {
			for (const line of lines) {
				this.printLine(line);
			}
		}
	}

	stepRetry(stepName: string, attempt: number, maxAttempts: number, error?: string | null): void {
		const retry = colorize(`[RETRY ${attempt}/${maxAttempts}]`, Color.YELLOW);
		const name = colorize(stepName, Color.YELLOW);
		const mainLine = `${retry} ${name}`;

		const lines = [mainLine];
		if (error) {
			const firstLine = error.trim().split("\n")[0].slice(0, 100);
			lines.push(colorize(`    Reason: ${firstLine}`, Color.DIM));
		}

		if (this.shouldDeferMessage()) {
			for (const line of lines) {
				this.deferMessage(line);
			}
		} else {
			for (const line of lines) {
				this.printLine(line);
			}
		}
	}

	// --- Ralph loop messages ---

	ralphIterationStart(stepName: string, iteration: number, maxIterations: number): void {
		if (this.level === OutputLevel.BASE && !this.isParallelMode()) {
			this.baseLastDisplayLines = 0;
			this._baseAccumulatedText = "";
		}

		const progress = colorize(`[${iteration}/${maxIterations}]`, Color.CYAN);
		const name = colorize(stepName, Color.CYAN);
		this.printLine(`${progress} ${name} iteration`);
	}

	ralphIteration(
		_stepName: string,
		_iteration: number,
		_maxIterations: number,
		summary?: string | null,
	): void {
		if (this.level === OutputLevel.BASE && !this.isParallelMode()) {
			return;
		}

		if (summary && this.level === OutputLevel.ALL) {
			const summaryLines = summary.trim().split("\n");
			for (const line of summaryLines.slice(0, 3)) {
				const truncated = line.length > 150 ? `${line.slice(0, 150)}...` : line;
				this.printLine(colorize(`    ${truncated}`, Color.DIM));
			}
		}
	}

	ralphComplete(stepName: string, iteration: number, maxIterations: number): void {
		if (this.level === OutputLevel.BASE && !this.isParallelMode()) {
			this.baseLastDisplayLines = 0;
			this._baseAccumulatedText = "";
		}

		const check = colorize("[OK]", Color.BRIGHT_GREEN);
		const name = colorize(stepName, Color.GREEN);
		this.printLine(`${check} ${name} completed at iteration ${iteration}/${maxIterations}`);
	}

	ralphMaxIterations(stepName: string, maxIterations: number): void {
		if (this.level === OutputLevel.BASE && !this.isParallelMode()) {
			this.baseLastDisplayLines = 0;
			this._baseAccumulatedText = "";
		}

		const warn = colorize("[WARN]", Color.YELLOW);
		const name = colorize(stepName, Color.YELLOW);
		this.printLine(`${warn} ${name} reached max iterations (${maxIterations})`);
	}

	// --- Generic messages ---

	info(message: string): void {
		const infoPrefix = colorize("[INFO]", Color.BLUE);
		const formatted = `${infoPrefix} ${message}`;
		if (this.shouldDeferMessage()) {
			this.deferMessage(formatted);
		} else {
			this.printLine(formatted);
		}
	}

	warning(message: string): void {
		const warn = colorize("[WARN]", Color.YELLOW);
		const formatted = `${warn} ${message}`;
		if (this.shouldDeferMessage()) {
			this.deferMessage(formatted);
		} else {
			this.printLine(formatted);
		}
	}

	error(message: string): void {
		const err = colorize("[ERROR]", Color.BRIGHT_RED);
		const formatted = `${err} ${message}`;
		if (this.shouldDeferMessage()) {
			this.deferMessage(formatted);
		} else {
			this.printLine(formatted);
		}
	}

	// --- Streaming ---

	streamText(text: string, role = "assistant", model?: string | null): void {
		const formattedModel = this.formatModelName && model ? this.formatModelName(model) : null;

		if (this.level === OutputLevel.ALL) {
			if (!text || !text.trim()) return;

			if (this.isParallelMode()) {
				this._parallelHandler.accumulateText(text, role, model);
				return;
			}

			if (role === "user") {
				const prefix = colorize(">", Color.BRIGHT_CYAN, Color.BOLD);
				const label = colorize(" [user]", Color.DIM);
				this.printLine("");
				this.printLine(`${prefix}${label}`);
				for (const line of text.split("\n")) {
					const coloredLine = colorize(line, Color.GREEN);
					this.printLine(`  ${coloredLine}`);
				}
			} else {
				const bullet = colorize("*", Color.BRIGHT_GREEN, Color.BOLD);
				let modelLabel = "";
				if (formattedModel) {
					modelLabel = ` ${colorize(`[${formattedModel}]`, Color.DIM)}`;
				}
				const lines = text.split("\n");
				this.printLine("");
				this.printLine(`${bullet}${modelLabel} ${lines[0]}`);
				for (const line of lines.slice(1)) {
					this.printLine(`  ${line}`);
				}
			}
		} else if (this.level === OutputLevel.BASE) {
			if (role === "user") return;

			if (this.isParallelMode()) {
				const branch = this._parallelHandler.getCurrentBranch();
				if (branch && this._parallelHandler.hasBranches) {
					const lastLine = this._parallelHandler.accumulateBaseText(text);
					if (lastLine) {
						this._parallelHandler.updateBranchLine(branch, lastLine);
					}
				}
				return;
			}

			this._baseAccumulatedText += text;
			if (this._baseAccumulatedText.length > MAX_ACCUMULATED_TEXT) {
				this._baseAccumulatedText = this._baseAccumulatedText.slice(-MAX_ACCUMULATED_TEXT);
			}

			if (this._baseAccumulatedText.trim()) {
				const prefix = colorize("...", Color.DIM);
				const lines = this._baseAccumulatedText.trim().split("\n");
				const formattedLines = [`${prefix} ${lines[0]}`];
				for (const line of lines.slice(1)) {
					formattedLines.push(`    ${line}`);
				}
				const displayText = formattedLines.join("\n");
				this.printInplace(displayText);
			}
		}
	}

	streamComplete(): void {
		if (this.level === OutputLevel.ALL && this.isParallelMode()) {
			this._parallelHandler.enqueueCurrentMessage();
		}
		this._baseAccumulatedText = "";
	}
}

// --- Standalone utility functions ---

export function extractJson(output: string): Record<string, unknown> | null {
	if (!output || !output.trim()) return null;

	const pattern = /```json\s*([\s\S]*?)```/g;
	const matches = [...output.matchAll(pattern)];

	if (matches.length === 0) return null;

	const jsonStr = matches[matches.length - 1][1].trim();

	try {
		return JSON.parse(jsonStr) as Record<string, unknown>;
	} catch {
		return null;
	}
}

export function extractSummary(output: string, maxLines = 5, maxChars = 500): string {
	if (!output || !output.trim()) return "";

	const trimmed = output.trim();

	const summaryMarkers = [
		"## Summary",
		"### Summary",
		"Summary:",
		"Result:",
		"Completed:",
		"Done:",
	];

	for (const marker of summaryMarkers) {
		if (trimmed.includes(marker)) {
			const idx = trimmed.indexOf(marker);
			const summarySection = trimmed.slice(idx);
			const lines = summarySection.split("\n");
			const resultLines: string[] = [];
			for (let i = 1; i < lines.length; i++) {
				if (i > maxLines) break;
				if (lines[i].startsWith("#") && i > 1) break;
				resultLines.push(lines[i]);
			}
			if (resultLines.length > 0) {
				return resultLines.join("\n").trim().slice(0, maxChars);
			}
		}
	}

	const nonEmptyLines = trimmed.split("\n").filter((line) => line.trim());
	if (nonEmptyLines.length === 0) return "";

	const lastLines = nonEmptyLines.slice(-maxLines);
	let summary = lastLines.join("\n");

	if (summary.length > maxChars) {
		summary = `${summary.slice(0, maxChars)}...`;
	}

	return summary;
}
