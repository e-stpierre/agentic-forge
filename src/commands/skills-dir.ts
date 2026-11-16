/** Skills-dir command handler. */

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function cmdSkillsDir(): void {
	const skillsDir = path.resolve(path.join(__dirname, "..", "claude"));
	process.stdout.write(`${skillsDir}\n`);
}
