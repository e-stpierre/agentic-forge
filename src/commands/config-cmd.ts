/** Config command handler. */

import { getConfigValue, setConfigValue } from "../config.js";

export function cmdConfig(configCommand: string, key: string, value?: string): void {
	if (configCommand === "get") {
		const result = getConfigValue(key);
		if (result === null) {
			process.stderr.write(`Key not found: ${key}\n`);
			process.exit(1);
		}
		if (typeof result === "object" && result !== null) {
			process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		} else {
			process.stdout.write(`${result}\n`);
		}
	} else if (configCommand === "set") {
		if (value === undefined) {
			process.stderr.write("Usage: agentic-forge config set <key> <value>\n");
			process.exit(1);
		}
		setConfigValue(key, value);
		process.stdout.write(`Set ${key} = ${value}\n`);
	} else {
		process.stderr.write("Usage: agentic-forge config get|set <key> [value]\n");
		process.exit(1);
	}
}
