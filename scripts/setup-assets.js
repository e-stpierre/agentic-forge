import { cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const pythonSrc = join(root, "src", "agentic_forge");
const tsSrc = join(root, "src");

const assets = ["agents", "claude", "prompts", "templates", "workflows"];

for (const asset of assets) {
	cpSync(join(pythonSrc, asset), join(tsSrc, asset), { recursive: true });
	console.log(`Copied ${asset}`);
}
