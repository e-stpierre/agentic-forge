import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	LockTimeoutError,
	Supervisor,
	SupervisorAlreadyRunningError,
	SupervisorClient,
	SupervisorHttpError,
	ensureSupervisor,
	findSupervisor,
	getSupervisorFiles,
	isPidAlive,
	readDiscovery,
	stopSupervisor,
	withLock,
} from "../src/supervisor/index.js";
import { useTempGlobalRoot } from "./helpers/temp-home.js";

const home = useTempGlobalRoot();
const started: Supervisor[] = [];

async function startSupervisor(version = "1.0.0"): Promise<Supervisor> {
	const supervisor = new Supervisor({ root: home.root, version });
	started.push(supervisor);
	await supervisor.start();
	return supervisor;
}

/** A pid that belonged to a process that has exited. */
function deadPid(): number {
	const result = spawnSync(process.execPath, ["-e", "0"]);
	return result.pid as number;
}

afterEach(async () => {
	await Promise.all(started.splice(0).map((s) => s.stop()));
});

describe("contract lock", () => {
	it("is exclusive and removed afterward", async () => {
		const target = path.join(home.root, "file");
		await withLock(target, async () => {
			expect(existsSync(`${target}.lock`)).toBe(true);
			await expect(withLock(target, () => 1, { timeoutMs: 50 })).rejects.toBeInstanceOf(
				LockTimeoutError,
			);
		});
		expect(existsSync(`${target}.lock`)).toBe(false);
	});

	it("writes the owner pid as content", async () => {
		const target = path.join(home.root, "file");
		await withLock(target, () => {
			expect(readFileSync(`${target}.lock`, "utf-8")).toBe(String(process.pid));
		});
	});

	it("removes a lock older than 30 seconds", async () => {
		const target = path.join(home.root, "file");
		writeFileSync(`${target}.lock`, "99999");
		const old = new Date(Date.now() - 31_000);
		utimesSync(`${target}.lock`, old, old);
		await expect(withLock(target, () => "ok", { timeoutMs: 100 })).resolves.toBe("ok");
	});

	it("waits on a fresh lock held by another writer", async () => {
		const target = path.join(home.root, "file");
		writeFileSync(`${target}.lock`, "99999");
		await expect(withLock(target, () => "ok", { timeoutMs: 100 })).rejects.toBeInstanceOf(
			LockTimeoutError,
		);
	});
});

describe("supervisor server", () => {
	it("writes a discovery file and pidfile and answers ping with the token", async () => {
		const supervisor = await startSupervisor("1.2.3");
		const discovery = readDiscovery(home.root);
		expect(discovery).toMatchObject({ pid: process.pid, host: "127.0.0.1", version: "1.2.3" });
		expect(discovery?.token).toBe(supervisor.token);
		expect(readFileSync(getSupervisorFiles(home.root).pidfile, "utf-8").trim()).toBe(
			String(process.pid),
		);
		if (process.platform !== "win32") {
			expect(statSync(getSupervisorFiles(home.root).discovery).mode & 0o777).toBe(0o600);
		}
		const info = await new SupervisorClient(discovery as NonNullable<typeof discovery>).ping();
		expect(info).toMatchObject({
			version: "1.2.3",
			pid: process.pid,
			contract_version: 1,
			active_runs: 0,
		});
	});

	it("rejects requests without or with a wrong token", async () => {
		await startSupervisor();
		const discovery = readDiscovery(home.root) as NonNullable<ReturnType<typeof readDiscovery>>;
		const url = `http://127.0.0.1:${discovery.port}/v1/ping`;
		expect((await fetch(url)).status).toBe(401);
		expect((await fetch(url, { headers: { authorization: "Bearer nope" } })).status).toBe(401);
		const wrong = new SupervisorClient({ ...discovery, token: "x".repeat(discovery.token.length) });
		await expect(wrong.ping()).rejects.toMatchObject({ status: 401 });
		const shutdown = await fetch(`http://127.0.0.1:${discovery.port}/v1/shutdown`, {
			method: "POST",
		});
		expect(shutdown.status).toBe(401);
		expect(isPidAlive(process.pid)).toBe(true);
		expect(readDiscovery(home.root)).not.toBeNull();
	});

	it("returns 404 for unknown routes", async () => {
		await startSupervisor();
		const client = new SupervisorClient(
			readDiscovery(home.root) as NonNullable<ReturnType<typeof readDiscovery>>,
		);
		await expect(client.request("GET", "/v1/nope")).rejects.toMatchObject({ status: 404 });
	});

	it("refuses a second instance while one is running", async () => {
		const first = await startSupervisor();
		const second = new Supervisor({ root: home.root, version: "1.0.0" });
		await expect(second.start()).rejects.toBeInstanceOf(SupervisorAlreadyRunningError);
		expect(readDiscovery(home.root)?.token).toBe(first.token);
	});

	it("recovers from a stale pidfile and discovery file left by a crash", async () => {
		const files = getSupervisorFiles(home.root);
		const pid = deadPid();
		writeFileSync(files.pidfile, `${pid}\n`);
		writeFileSync(
			files.discovery,
			JSON.stringify({
				pid,
				host: "127.0.0.1",
				port: 1,
				token: "t",
				version: "0.0.1",
				contract_version: 1,
			}),
		);
		const supervisor = await startSupervisor();
		expect(readDiscovery(home.root)?.token).toBe(supervisor.token);
	});

	it("treats a live pid that does not answer as stale", async () => {
		const files = getSupervisorFiles(home.root);
		// The test process itself is alive but is not a supervisor on port 1.
		writeFileSync(
			files.discovery,
			JSON.stringify({
				pid: process.ppid,
				host: "127.0.0.1",
				port: 1,
				token: "t",
				version: "0.0.1",
			}),
		);
		writeFileSync(files.pidfile, `${process.ppid}\n`);
		await expect(startSupervisor()).resolves.toBeInstanceOf(Supervisor);
	});

	it("recovers from a stale supervisor lock", async () => {
		const lock = `${getSupervisorFiles(home.root).lockTarget}.lock`;
		writeFileSync(lock, "99999");
		const old = new Date(Date.now() - 31_000);
		utimesSync(lock, old, old);
		await startSupervisor();
		expect(existsSync(lock)).toBe(false);
	});

	it("stops on the named shutdown request and removes its files", async () => {
		const supervisor = await startSupervisor();
		const client = new SupervisorClient(
			readDiscovery(home.root) as NonNullable<ReturnType<typeof readDiscovery>>,
		);
		await expect(client.shutdown()).resolves.toEqual({ ok: true });
		await supervisor.stopped;
		expect(readDiscovery(home.root)).toBeNull();
		expect(existsSync(getSupervisorFiles(home.root).pidfile)).toBe(false);
		expect(await findSupervisor(home.root)).toBeNull();
	});

	it("refuses shutdown with active runs unless forced", async () => {
		const supervisor = await startSupervisor();
		supervisor.activeRuns = () => 2;
		const client = new SupervisorClient(
			readDiscovery(home.root) as NonNullable<ReturnType<typeof readDiscovery>>,
		);
		await expect(client.shutdown()).rejects.toMatchObject({ status: 409 });
		await expect(client.shutdown(true)).resolves.toEqual({ ok: true });
		await supervisor.stopped;
	});

	it("does not remove files that belong to another supervisor", async () => {
		const supervisor = await startSupervisor();
		const files = getSupervisorFiles(home.root);
		const other = { ...(readDiscovery(home.root) as object), pid: 424242 };
		writeFileSync(files.discovery, JSON.stringify(other));
		await supervisor.stop();
		expect(readDiscovery(home.root)?.pid).toBe(424242);
	});
});

describe("supervisor client", () => {
	it("starts a supervisor on demand when none is running", async () => {
		const start = vi.fn(async () => {
			await startSupervisor("2.0.0");
		});
		const found = await ensureSupervisor({ root: home.root, version: "2.0.0", start });
		expect(start).toHaveBeenCalledOnce();
		expect(found.info.version).toBe("2.0.0");
	});

	it("reuses a running supervisor with the same version", async () => {
		const supervisor = await startSupervisor("2.0.0");
		const start = vi.fn();
		const found = await ensureSupervisor({ root: home.root, version: "2.0.0", start });
		expect(start).not.toHaveBeenCalled();
		expect(found.client.discovery.token).toBe(supervisor.token);
	});

	it("restarts an idle supervisor with a different version", async () => {
		const old = await startSupervisor("1.0.0");
		const start = vi.fn(async () => {
			await startSupervisor("2.0.0");
		});
		const onWarn = vi.fn();
		const found = await ensureSupervisor({ root: home.root, version: "2.0.0", start, onWarn });
		await old.stopped;
		expect(start).toHaveBeenCalledOnce();
		expect(onWarn).not.toHaveBeenCalled();
		expect(found.info.version).toBe("2.0.0");
	});

	it("keeps a supervisor with a different version and warns when runs are active", async () => {
		const old = await startSupervisor("1.0.0");
		old.activeRuns = () => 1;
		const start = vi.fn();
		const onWarn = vi.fn();
		const found = await ensureSupervisor({ root: home.root, version: "2.0.0", start, onWarn });
		expect(start).not.toHaveBeenCalled();
		expect(onWarn).toHaveBeenCalledWith(expect.stringContaining("1 run(s) are active"));
		expect(found.info.version).toBe("1.0.0");
	});

	it("stopSupervisor reports false when none is running", async () => {
		expect(await stopSupervisor({ root: home.root })).toBe(false);
	});

	it("stopSupervisor surfaces the 409 for active runs", async () => {
		const supervisor = await startSupervisor();
		supervisor.activeRuns = () => 1;
		await expect(stopSupervisor({ root: home.root })).rejects.toBeInstanceOf(SupervisorHttpError);
	});
});
