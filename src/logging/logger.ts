/** NDJSON structured logging for workflows. */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

// --- Log levels ---

export const LOG_LEVEL = {
	CRITICAL: "Critical",
	ERROR: "Error",
	WARNING: "Warning",
	INFORMATION: "Information",
} as const;

export type LogLevel = (typeof LOG_LEVEL)[keyof typeof LOG_LEVEL];

// --- Log entry ---

export interface LogEntry {
	timestamp: string;
	level: string;
	step: string;
	message: string;
	context: Record<string, unknown> | null;
}

// --- Logger class ---

export class WorkflowLogger {
	readonly workflowId: string;
	readonly logPath: string;

	constructor(workflowId: string, outputDir: string) {
		this.workflowId = workflowId;
		this.logPath = path.join(outputDir, "logs.ndjson");
		mkdirSync(path.dirname(this.logPath), { recursive: true });
	}

	log(
		level: LogLevel,
		step: string,
		message: string,
		context?: Record<string, unknown> | null,
	): void {
		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			level,
			step,
			message,
			context: context ?? null,
		};
		appendFileSync(this.logPath, `${JSON.stringify(entry)}\n`, "utf-8");
	}

	critical(step: string, message: string, context?: Record<string, unknown>): void {
		this.log(LOG_LEVEL.CRITICAL, step, message, context || null);
	}

	error(step: string, message: string, context?: Record<string, unknown>): void {
		this.log(LOG_LEVEL.ERROR, step, message, context || null);
	}

	warning(step: string, message: string, context?: Record<string, unknown>): void {
		this.log(LOG_LEVEL.WARNING, step, message, context || null);
	}

	info(step: string, message: string, context?: Record<string, unknown>): void {
		this.log(LOG_LEVEL.INFORMATION, step, message, context || null);
	}
}

// --- Utility functions ---

export function readLogs(workflowId: string, outputDir: string): LogEntry[] {
	const logPath = getLogPath(workflowId, outputDir);
	if (!existsSync(logPath)) {
		return [];
	}

	const content = readFileSync(logPath, "utf-8");
	const entries: LogEntry[] = [];
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (trimmed) {
			try {
				entries.push(JSON.parse(trimmed) as LogEntry);
			} catch {
				// Skip corrupted log lines
			}
		}
	}
	return entries;
}

export function getLogPath(workflowId: string, outputDir: string): string {
	return path.join(outputDir, "logs.ndjson");
}
