/** Signal handling for graceful shutdown. */

import type { WorkflowProgress } from "./types.js";

export class SignalManager {
	private _shutdownRequested = false;
	private readonly _onShutdown: (() => void) | null;
	private readonly _handler: () => void;

	constructor(onShutdown?: () => void) {
		this._onShutdown = onShutdown ?? null;
		this._handler = () => this._handleShutdown();
		this._installHandlers();
	}

	private _installHandlers(): void {
		process.on("SIGINT", this._handler);

		if (process.platform !== "win32") {
			process.on("SIGTERM", this._handler);
		} else {
			process.on("SIGBREAK", this._handler);
		}
	}

	dispose(): void {
		process.removeListener("SIGINT", this._handler);

		if (process.platform !== "win32") {
			process.removeListener("SIGTERM", this._handler);
		} else {
			process.removeListener("SIGBREAK", this._handler);
		}
	}

	private _handleShutdown(): void {
		this._shutdownRequested = true;
		console.log("\nShutdown requested, cleaning up...");
		if (this._onShutdown) {
			this._onShutdown();
		}
	}

	get shutdownRequested(): boolean {
		return this._shutdownRequested;
	}

	requestShutdown(): void {
		this._shutdownRequested = true;
	}
}

export async function handleGracefulShutdown(
	progress: WorkflowProgress,
	logger: { info: (step: string, message: string) => void },
	repoRoot: string,
): Promise<void> {
	// Lazy import to avoid circular dependencies
	const { pruneOrphaned } = await import("./git/worktree.js");

	logger.info("orchestrator", "Performing graceful shutdown");
	progress.status = "canceled";

	pruneOrphaned(repoRoot);
}
