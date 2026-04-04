import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOG_LEVEL, WorkflowLogger, getLogPath, readLogs } from "../src/logging/logger.js";

function makeTempDir(): string {
	const dir = path.join(
		tmpdir(),
		`agentic-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("LOG_LEVEL constants", () => {
	it("should have all expected values", () => {
		expect(LOG_LEVEL.CRITICAL).toBe("Critical");
		expect(LOG_LEVEL.ERROR).toBe("Error");
		expect(LOG_LEVEL.WARNING).toBe("Warning");
		expect(LOG_LEVEL.INFORMATION).toBe("Information");
	});
});

describe("getLogPath", () => {
	it("should return logs.ndjson inside the given outputDir", () => {
		const tempDir = makeTempDir();
		const p = getLogPath("test-workflow", tempDir);
		expect(p).toBe(path.join(tempDir, "logs.ndjson"));
	});
});

describe("WorkflowLogger", () => {
	it("should create log directory on construction", () => {
		const tempDir = makeTempDir();
		const logger = new WorkflowLogger("test-logger", tempDir);
		const logDir = path.dirname(logger.logPath);
		expect(existsSync(logDir)).toBe(true);
	});

	it("should write NDJSON entries", () => {
		const tempDir = makeTempDir();
		const logger = new WorkflowLogger("test-ndjson", tempDir);

		logger.info("step1", "Starting step");
		logger.warning("step1", "Something odd");
		logger.error("step1", "Failed", { code: 42 });

		const content = readFileSync(logger.logPath, "utf-8");
		const lines = content.trim().split("\n");
		expect(lines).toHaveLength(3);

		const entry1 = JSON.parse(lines[0]);
		expect(entry1.level).toBe("Information");
		expect(entry1.step).toBe("step1");
		expect(entry1.message).toBe("Starting step");
		expect(entry1.timestamp).toBeTruthy();

		const entry2 = JSON.parse(lines[1]);
		expect(entry2.level).toBe("Warning");

		const entry3 = JSON.parse(lines[2]);
		expect(entry3.level).toBe("Error");
		expect(entry3.context).toEqual({ code: 42 });
	});

	it("should write critical entries", () => {
		const tempDir = makeTempDir();
		const logger = new WorkflowLogger("test-critical", tempDir);

		logger.critical("orchestrator", "Fatal error");

		const entries = readLogs("test-critical", tempDir);
		expect(entries).toHaveLength(1);
		expect(entries[0].level).toBe("Critical");
		expect(entries[0].message).toBe("Fatal error");
	});

	it("should write null context when none provided", () => {
		const tempDir = makeTempDir();
		const logger = new WorkflowLogger("test-null-ctx", tempDir);

		logger.info("step1", "No context");

		const entries = readLogs("test-null-ctx", tempDir);
		expect(entries[0].context).toBeNull();
	});
});

describe("readLogs", () => {
	it("should return empty array for nonexistent log", () => {
		const tempDir = makeTempDir();
		const entries = readLogs("nonexistent", tempDir);
		expect(entries).toEqual([]);
	});

	it("should read all entries", () => {
		const tempDir = makeTempDir();
		const logger = new WorkflowLogger("test-read", tempDir);

		logger.info("s1", "msg1");
		logger.error("s2", "msg2");

		const entries = readLogs("test-read", tempDir);
		expect(entries).toHaveLength(2);
		expect(entries[0].step).toBe("s1");
		expect(entries[1].step).toBe("s2");
	});

	it("should skip corrupted log lines", () => {
		const tempDir = makeTempDir();
		const logger = new WorkflowLogger("test-corrupted", tempDir);

		logger.info("s1", "msg1");
		// Append a corrupted line directly
		appendFileSync(logger.logPath, "not valid json\n", "utf-8");
		logger.info("s3", "msg3");

		const entries = readLogs("test-corrupted", tempDir);
		expect(entries).toHaveLength(2);
		expect(entries[0].step).toBe("s1");
		expect(entries[1].step).toBe("s3");
	});
});
