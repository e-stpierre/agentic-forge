import { describe, expect, it } from "vitest";
import { SignalManager } from "../src/signal-manager.js";

describe("SignalManager", () => {
	it("should start with shutdownRequested false", () => {
		const manager = new SignalManager();
		expect(manager.shutdownRequested).toBe(false);
	});

	it("should set shutdownRequested on requestShutdown", () => {
		const manager = new SignalManager();
		manager.requestShutdown();
		expect(manager.shutdownRequested).toBe(true);
	});

	it("should accept an optional callback", () => {
		let called = false;
		const manager = new SignalManager(() => {
			called = true;
		});
		// Callback is only triggered by signal, not by requestShutdown
		manager.requestShutdown();
		expect(manager.shutdownRequested).toBe(true);
		expect(called).toBe(false);
	});
});
