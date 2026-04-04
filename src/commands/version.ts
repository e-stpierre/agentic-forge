/** Version command handler. */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function cmdVersion(): void {
	try {
		const packageJsonPath = path.join(__dirname, "..", "..", "package.json");
		const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version: string };
		process.stdout.write(`agentic-forge ${pkg.version}\n`);
	} catch {
		process.stdout.write("agentic-forge version unknown (package not installed)\n");
	}
}

export function getVersion(): string {
	try {
		const packageJsonPath = path.join(__dirname, "..", "..", "package.json");
		const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version: string };
		return pkg.version;
	} catch {
		return "unknown";
	}
}
