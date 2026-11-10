/**
 * Out-of-process supervisor tests: detached spawn, single instance across
 * processes, and shutdown on Windows (named request) and POSIX (SIGTERM).
 * They run the built CLI (dist/cli.js), so they are skipped until `pnpm build`
 * has run (CI builds before testing).
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	ensureSupervisor,
	isPidAlive,
	readDiscovery,
	spawnDetachedSupervisor,
	stopSupervisor,
	waitForSupervisor,
} from "../src/supervisor/index.js";
import { useTempGlobalRoot } from "./helpers/temp-home.js";

const cliPath = path.resolve(__dirname, "..", "dist", "cli.js");
const home = useTempGlobalRoot();
const pids = new Set<number>();

async function waitForExit(pid: number, timeoutMs = 10_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (isPidAlive(pid)) {
		if (Date.now() > deadline) throw new Error(`pid ${pid} still alive`);
		await new Promise((r) => setTimeout(r, 50));
	}
}

function cli(...args: string[]): string {
	return execFileSync(process.execPath, [cliPath, ...args], {
		env: { ...process.env, AGENTIC_FORGE_HOME: home.root },
		encoding: "utf-8",
		windowsHide: true,
	});
}

afterEach(async () => {
	// Kill only the supervisors these tests started.
	for (const pid of pids) {
		if (isPidAlive(pid)) {
			try {
				process.kill(pid);
			} catch {
				// already gone
			}
			await waitForExit(pid).catch(() => {});
		}
	}
	pids.clear();
});

describe.skipIf(!existsSync(cliPath))("supervisor process", () => {
	it("starts detached on demand and stops through the named shutdown request", async () => {
		const found = await ensureSupervisor({
			root: home.root,
			version: "test-version",
			start: (root) => {
				spawnDetachedSupervisor({ root, cliPath });
			},
		});
		pids.add(found.info.pid);
		expect(found.info.pid).not.toBe(process.pid);
		expect(isPidAlive(found.info.pid)).toBe(true);

		expect(await stopSupervisor({ root: home.root })).toBe(true);
		await waitForExit(found.info.pid);
		expect(readDiscovery(home.root)).toBeNull();
	}, 30_000);

	it("a second start finds the running instance instead of starting another", async () => {
		spawnDetachedSupervisor({ root: home.root, cliPath });
		const first = await waitForSupervisor(home.root);
		pids.add(first.info.pid);

		const output = cli("serve", "--foreground");
		expect(output).toContain("already running");
		expect(readDiscovery(home.root)?.pid).toBe(first.info.pid);

		expect(cli("serve", "--status")).toContain(`pid ${first.info.pid}`);
		expect(cli("serve", "--stop")).toContain("Supervisor stopped");
		await waitForExit(first.info.pid);
		expect(cli("serve", "--status")).toContain("not running");
	}, 30_000);

	it("af serve --detach starts one supervisor and reuses it", async () => {
		const first = cli("serve", "--detach");
		const pid = readDiscovery(home.root)?.pid as number;
		pids.add(pid);
		expect(first).toContain(`pid ${pid}`);
		expect(cli("serve", "--detach")).toContain(`pid ${pid}`);
		await stopSupervisor({ root: home.root });
	}, 30_000);

	it.skipIf(process.platform === "win32")(
		"stops on SIGTERM and removes its files",
		async () => {
			spawnDetachedSupervisor({ root: home.root, cliPath });
			const found = await waitForSupervisor(home.root);
			pids.add(found.info.pid);
			process.kill(found.info.pid, "SIGTERM");
			await waitForExit(found.info.pid);
			expect(readDiscovery(home.root)).toBeNull();
		},
		30_000,
	);
});
