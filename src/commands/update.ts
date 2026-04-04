/** Update command handler. */

import { execFileSync } from "node:child_process";

import { getVersion } from "./version.js";

function commandExists(cmd: string): boolean {
	try {
		execFileSync(process.platform === "win32" ? "where" : "which", [cmd], {
			stdio: "ignore",
		});
		return true;
	} catch {
		return false;
	}
}

export function cmdUpdate(options: { check?: boolean }): void {
	const currentVersion = getVersion();
	if (currentVersion === "unknown") {
		process.stderr.write("Error: agentic-forge is not installed\n");
		process.exit(1);
	}

	if (!commandExists("npm")) {
		process.stderr.write("Error: npm is required for updating agentic-forge\n");
		process.exit(1);
	}

	if (options.check) {
		process.stdout.write(`Current version: ${currentVersion}\n`);
		try {
			const result = execFileSync("npm", ["view", "agentic-forge", "version"], {
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
			}).trim();
			if (result && result !== currentVersion) {
				process.stdout.write(`Latest version: ${result}\n`);
			} else {
				process.stdout.write("Already at the latest version.\n");
			}
		} catch {
			process.stdout.write("Could not check for updates.\n");
		}
	} else {
		process.stdout.write(`Current version: ${currentVersion}\n`);
		process.stdout.write("Upgrading...\n");
		try {
			execFileSync("npm", ["install", "-g", "agentic-forge"], {
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
			});
			const newVersion = getVersion();
			if (newVersion !== currentVersion) {
				process.stdout.write(`Successfully updated to version ${newVersion}\n`);
			} else {
				process.stdout.write("Already at the latest version.\n");
			}
		} catch {
			process.stderr.write("Update failed.\n");
			process.exit(1);
		}
	}
}
