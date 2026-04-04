import { cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const src = join(root, "src");
const dist = join(root, "dist");

const assets = ["agents", "authoring", "claude", "prompts", "templates", "workflows"];

for (const asset of assets) {
	const srcPath = join(src, asset);
	const distPath = join(dist, asset);
	if (existsSync(srcPath)) {
		cpSync(srcPath, distPath, { recursive: true });
		console.log(`Copied ${asset} -> dist/${asset}`);
	} else {
		console.warn(`Warning: ${srcPath} not found, skipping`);
	}
}
