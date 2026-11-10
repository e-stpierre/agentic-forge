/** `af serve` - run, start, inspect or stop the supervisor. */

import {
	Supervisor,
	SupervisorAlreadyRunningError,
	SupervisorHttpError,
	ensureSupervisor,
	findSupervisor,
	getSupervisorFiles,
	stopSupervisor,
} from "../supervisor/index.js";
import { CliExitError } from "./run.js";
import { getVersion } from "./version.js";

export interface ServeOptions {
	detach?: boolean;
	status?: boolean;
	stop?: boolean;
	restart?: boolean;
	force?: boolean;
	port?: string;
}

function write(message: string): void {
	process.stdout.write(`${message}\n`);
}

async function printStatus(): Promise<void> {
	const found = await findSupervisor();
	if (!found) {
		write("Supervisor: not running");
		return;
	}
	const { info, client } = found;
	write(`Supervisor: running (pid ${info.pid}, port ${client.discovery.port})`);
	write(
		`Version:    ${info.version}${info.version === getVersion() ? "" : ` (client ${getVersion()})`}`,
	);
	write(`Started:    ${info.started_at}`);
	write(`Active runs: ${info.active_runs}`);
}

async function stop(force: boolean): Promise<boolean> {
	try {
		return await stopSupervisor({ force });
	} catch (err) {
		if (err instanceof SupervisorHttpError && err.status === 409) {
			throw new CliExitError(`${err.message}. Use --force to stop it anyway.`);
		}
		throw new CliExitError((err as Error).message);
	}
}

/** Runs the supervisor in this process until it is asked to stop. */
async function runForeground(port: number | undefined): Promise<void> {
	const supervisor = new Supervisor({
		version: getVersion(),
		port,
		log: (message) => process.stderr.write(`[${new Date().toISOString()}] ${message}\n`),
	});
	try {
		await supervisor.start();
	} catch (err) {
		if (err instanceof SupervisorAlreadyRunningError) {
			write(err.message);
			return;
		}
		throw err;
	}
	const onSignal = () => {
		void supervisor.stop();
	};
	process.on("SIGINT", onSignal);
	process.on("SIGTERM", onSignal);
	if (process.platform === "win32") process.on("SIGBREAK", onSignal);
	await supervisor.stopped;
	process.off("SIGINT", onSignal);
	process.off("SIGTERM", onSignal);
	if (process.platform === "win32") process.off("SIGBREAK", onSignal);
}

export async function cmdServe(options: ServeOptions): Promise<void> {
	if (options.status) {
		await printStatus();
		return;
	}
	if (options.stop) {
		const stopped = await stop(options.force ?? false);
		write(stopped ? "Supervisor stopped" : "Supervisor: not running");
		return;
	}
	if (options.restart) {
		await stop(options.force ?? false);
	}
	if (options.detach || options.restart) {
		const found = await ensureSupervisor({
			version: getVersion(),
			onWarn: (message) => process.stderr.write(`Warning: ${message}\n`),
		});
		write(
			`Supervisor running (pid ${found.info.pid}, port ${found.client.discovery.port}, log ${getSupervisorFiles().log})`,
		);
		return;
	}
	const port = options.port === undefined ? undefined : Number.parseInt(options.port, 10);
	if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
		throw new CliExitError(`Invalid port: ${options.port}`);
	}
	await runForeground(port);
}
