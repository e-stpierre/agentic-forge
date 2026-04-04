import { execSync } from "node:child_process";

const MIN_AGE_DAYS = 7;
const IGNORE_MAJOR = ["@types/node"];
const mode = process.argv[2] || "check";

if (mode !== "check" && mode !== "fix") {
	console.error("Usage: node scripts/check-updates.js [check|fix]");
	process.exit(1);
}

function getOutdated() {
	try {
		const output = execSync("pnpm outdated --json", {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		return JSON.parse(output);
	} catch (error) {
		// pnpm outdated exits with code 1 when packages are outdated
		if (error.stdout) {
			return JSON.parse(error.stdout);
		}
		return {};
	}
}

function getPublishDate(name, version) {
	try {
		const output = execSync(`npm view ${name} time --json`, {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		const times = JSON.parse(output);
		return times[version] ? new Date(times[version]) : null;
	} catch {
		return null;
	}
}

function isMajorBump(current, latest) {
	const currentMajor = Number.parseInt(current.split(".")[0], 10);
	const latestMajor = Number.parseInt(latest.split(".")[0], 10);
	return latestMajor > currentMajor;
}

function daysAgo(date) {
	return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function formatRow(name, current, latest, age, eligible, skipped) {
	const tag = eligible ? "\x1b[32m✓\x1b[0m" : skipped ? "\x1b[33m⊘\x1b[0m" : "\x1b[90m·\x1b[0m";
	const ageStr = age !== null ? `${age}d ago` : "\x1b[33munknown\x1b[0m";
	const skipLabel = skipped ? " \x1b[33m(major ignored)\x1b[0m" : "";
	return `  ${tag} ${name.padEnd(28)} ${current.padEnd(14)} → ${latest.padEnd(14)} ${ageStr}${skipLabel}`;
}

async function main() {
	console.log(`\nChecking for package updates (min age: ${MIN_AGE_DAYS}d)...\n`);

	const outdated = getOutdated();
	const packages = Object.keys(outdated);

	if (packages.length === 0) {
		console.log("All packages are up to date.");
		return;
	}

	const results = [];

	for (const name of packages) {
		const { current, latest, dependencyType } = outdated[name];
		const publishDate = getPublishDate(name, latest);
		const age = publishDate ? daysAgo(publishDate) : null;
		const majorIgnored = IGNORE_MAJOR.includes(name) && isMajorBump(current, latest);
		const eligible = !majorIgnored && age !== null && age >= MIN_AGE_DAYS;

		results.push({
			name,
			current,
			latest,
			age,
			eligible,
			majorIgnored,
			dependencyType,
		});
	}

	// Sort: eligible first, then by name
	results.sort((a, b) => {
		if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
		return a.name.localeCompare(b.name);
	});

	const eligible = results.filter((r) => r.eligible);
	const skipped = results.filter((r) => r.majorIgnored);
	const tooRecent = results.filter((r) => !r.eligible && !r.majorIgnored);

	if (eligible.length > 0) {
		console.log(`\x1b[32mEligible for update (>= ${MIN_AGE_DAYS}d old):\x1b[0m`);
		for (const r of eligible) {
			console.log(formatRow(r.name, r.current, r.latest, r.age, true, false));
		}
	}

	if (skipped.length > 0) {
		if (eligible.length > 0) console.log();
		console.log("\x1b[33mMajor version ignored:\x1b[0m");
		for (const r of skipped) {
			console.log(formatRow(r.name, r.current, r.latest, r.age, false, true));
		}
	}

	if (tooRecent.length > 0) {
		if (eligible.length > 0 || skipped.length > 0) console.log();
		console.log(`\x1b[90mToo recent (< ${MIN_AGE_DAYS}d old):\x1b[0m`);
		for (const r of tooRecent) {
			console.log(formatRow(r.name, r.current, r.latest, r.age, false, false));
		}
	}

	console.log(
		`\n  Total: ${packages.length} outdated, ${eligible.length} eligible, ${skipped.length} ignored, ${tooRecent.length} too recent\n`,
	);

	if (mode === "fix") {
		if (eligible.length === 0) {
			console.log("Nothing to update.");
			return;
		}

		const deps = eligible.filter((r) => r.dependencyType === "dependencies");
		const devDeps = eligible.filter((r) => r.dependencyType === "devDependencies");

		if (deps.length > 0) {
			const pkgs = deps.map((r) => `${r.name}@${r.latest}`).join(" ");
			console.log(`Updating dependencies: ${pkgs}`);
			execSync(`pnpm add ${pkgs}`, { stdio: "inherit" });
		}

		if (devDeps.length > 0) {
			const pkgs = devDeps.map((r) => `${r.name}@${r.latest}`).join(" ");
			console.log(`Updating devDependencies: ${pkgs}`);
			execSync(`pnpm add -D ${pkgs}`, { stdio: "inherit" });
		}

		console.log("\n\x1b[32mUpdate complete.\x1b[0m");
	}
}

main();
