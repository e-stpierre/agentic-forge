/** Authoring-dir command handler. */

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function cmdAuthoringDir(): void {
	const authoringDir = path.resolve(path.join(__dirname, "..", "authoring"));
	process.stdout.write(`${authoringDir}\n`);
}
