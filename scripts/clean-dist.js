import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Removes dist/ before a build, so deleted sources and assets are not shipped.
const __dirname = dirname(fileURLToPath(import.meta.url));
rmSync(join(__dirname, "..", "dist"), { recursive: true, force: true });
