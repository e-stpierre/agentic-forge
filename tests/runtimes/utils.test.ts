import { describe, expect, it } from "vitest";
import { formatModelName } from "../../src/runtimes/utils.js";

describe("formatModelName", () => {
	it("returns an empty string for a null model", () => {
		expect(formatModelName(null)).toBe("");
	});

	it("formats current undated model IDs", () => {
		expect(formatModelName("claude-opus-5")).toBe("opus-5");
		expect(formatModelName("claude-sonnet-5")).toBe("sonnet-5");
		expect(formatModelName("claude-fable-5")).toBe("fable-5");
		expect(formatModelName("claude-mythos-5")).toBe("mythos-5");
	});

	it("formats major.minor model IDs", () => {
		expect(formatModelName("claude-opus-4-8")).toBe("opus-4.8");
		expect(formatModelName("claude-haiku-4-5")).toBe("haiku-4.5");
	});

	it("formats dated model IDs", () => {
		expect(formatModelName("claude-sonnet-4-6-20251201")).toBe("sonnet-4.6");
		expect(formatModelName("claude-haiku-4-5-20251001")).toBe("haiku-4.5");
	});

	it("formats legacy version-first model IDs", () => {
		expect(formatModelName("claude-3-5-sonnet-20241022")).toBe("sonnet-3.5");
	});

	it("does not mistake a date suffix for a version number", () => {
		expect(formatModelName("claude-opus-20240229")).toBe("opus");
	});

	it("passes through aliases and non-Claude models unchanged", () => {
		expect(formatModelName("opus")).toBe("opus");
		expect(formatModelName("gpt-5.3-codex")).toBe("gpt-5.3-codex");
	});
});
