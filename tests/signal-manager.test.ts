import { afterEach, describe, expect, it } from "vitest";
import { SignalManager } from "../src/signal-manager.js";

describe("SignalManager", () => {
	let manager: SignalManager;

	afterEach(() => {
		manager.dispose();
	});

	it("should start with shutdownRequested false", () => {
		manager = new SignalManager();
		expect(manager.shutdownRequested).toBe(false);
	});

	it("should set shutdownRequested on requestShutdown", () => {
		manager = new SignalManager();
		manager.requestShutdown();
		expect(manager.shutdownRequested).toBe(true);
	});

	it("should accept an optional callback", () => {
		let called = false;
		manager = new SignalManager(() => {
			called = true;
		});
		// Callback is only triggered by signal, not by requestShutdown
		manager.requestShutdown();
		expect(manager.shutdownRequested).toBe(true);
		expect(called).toBe(false);
	});
});
