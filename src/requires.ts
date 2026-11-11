/**
 * Workflow `requires`: the agentic-forge version range and the harness
 * contract version a workflow needs, e.g.
 * `requires: { agentic-forge: ">=0.12", contract: 1 }`.
 *
 * `checkRequires()` compares them with the running harness. A contract
 * mismatch always refuses; a version mismatch refuses unless
 * `--ignore-requires` is set, which turns it into a warning.
 */

import { CONTRACT_VERSION } from "./contract/index.js";

export interface WorkflowRequires {
	/** Version range of agentic-forge (`>=0.12`, `^0.12.0`, `>=0.12 <1`), null when unset. */
	agenticForge: string | null;
	/** Harness contract version, null when unset. */
	contract: number | null;
}

/** Thrown for a malformed `requires` block (wrapped by the parser). */
export class RequiresError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RequiresError";
	}
}

type Version = [number, number, number];

const VERSION_RE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Parses `X`, `X.Y` or `X.Y.Z` (pre-release and build suffixes are ignored). */
function parseVersion(text: string): { version: Version; parts: number } | null {
	const match = VERSION_RE.exec(text.trim());
	if (!match) return null;
	const parts = match[3] !== undefined ? 3 : match[2] !== undefined ? 2 : 1;
	return {
		version: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
		parts,
	};
}

function compare(a: Version, b: Version): number {
	for (let i = 0; i < 3; i++) {
		if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
	}
	return 0;
}

type Comparator = (v: Version) => boolean;

function comparator(token: string): Comparator | null {
	const match = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(token);
	if (!match) return null;
	const op = match[1] ?? "=";
	const parsed = parseVersion(match[2]);
	if (!parsed) return null;
	const base = parsed.version;
	switch (op) {
		case ">=":
			return (v) => compare(v, base) >= 0;
		case ">":
			return (v) => compare(v, base) > 0;
		case "<=":
			return (v) => compare(v, base) <= 0;
		case "<":
			return (v) => compare(v, base) < 0;
		case "^": {
			// ^1.2.3 -> <2.0.0; ^0.12.1 -> <0.13.0; ^0.0.3 -> <0.0.4
			const upper: Version =
				base[0] > 0
					? [base[0] + 1, 0, 0]
					: base[1] > 0 || parsed.parts < 3
						? [0, base[1] + 1, 0]
						: [0, 0, base[2] + 1];
			return (v) => compare(v, base) >= 0 && compare(v, upper) < 0;
		}
		case "~": {
			// ~1.2.3 -> <1.3.0; ~1 -> <2.0.0
			const upper: Version = parsed.parts === 1 ? [base[0] + 1, 0, 0] : [base[0], base[1] + 1, 0];
			return (v) => compare(v, base) >= 0 && compare(v, upper) < 0;
		}
		default: {
			// Bare or `=`: a partial version matches every patch (`0.12` is 0.12.x).
			if (parsed.parts === 3) return (v) => compare(v, base) === 0;
			const upper: Version = parsed.parts === 1 ? [base[0] + 1, 0, 0] : [base[0], base[1] + 1, 0];
			return (v) => compare(v, base) >= 0 && compare(v, upper) < 0;
		}
	}
}

/**
 * Parses a version range: space-separated comparators that must all match
 * (`>=0.12 <1`), and `||` between alternatives. Returns null when malformed.
 */
function parseRange(range: string): Comparator[][] | null {
	const alternatives = range.split("||").map((alt) => alt.trim());
	const parsed: Comparator[][] = [];
	for (const alt of alternatives) {
		if (alt === "" || alt === "*") {
			parsed.push([]);
			continue;
		}
		// Allow `>= 0.12` (space after the operator).
		const tokens = alt.replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1").split(/\s+/);
		const comparators: Comparator[] = [];
		for (const token of tokens) {
			const c = comparator(token);
			if (!c) return null;
			comparators.push(c);
		}
		parsed.push(comparators);
	}
	return parsed;
}

/** True when `range` is a valid version range. */
export function isValidRange(range: string): boolean {
	return parseRange(range) !== null;
}

/**
 * True when `version` satisfies `range`. An unparsable installed version
 * (`unknown`) never satisfies a range.
 */
export function satisfies(version: string, range: string): boolean {
	const parsed = parseVersion(version);
	const alternatives = parseRange(range);
	if (!parsed || !alternatives) return false;
	return alternatives.some((alt) => alt.every((c) => c(parsed.version)));
}

/**
 * Parses a workflow's `requires` block. Accepts `agentic-forge` (a version
 * range string; a number such as `0.12` is read as `"0.12"`) and `contract`
 * (a positive integer). Returns null when the block is absent.
 */
export function parseRequires(raw: unknown): WorkflowRequires | null {
	if (raw === undefined || raw === null) return null;
	if (typeof raw !== "object" || Array.isArray(raw)) {
		throw new RequiresError(
			'requires must be an object, e.g. requires: { agentic-forge: ">=0.12", contract: 1 }',
		);
	}
	const data = raw as Record<string, unknown>;
	const unknownKeys = Object.keys(data).filter((k) => k !== "agentic-forge" && k !== "contract");
	if (unknownKeys.length > 0) {
		throw new RequiresError(
			`requires has unknown key(s): ${unknownKeys.join(", ")} (allowed: agentic-forge, contract)`,
		);
	}
	let agenticForge: string | null = null;
	const range = data["agentic-forge"];
	if (range !== undefined && range !== null) {
		if (typeof range !== "string" && typeof range !== "number") {
			throw new RequiresError("requires.agentic-forge must be a version range string");
		}
		agenticForge = String(range).trim();
		if (!isValidRange(agenticForge)) {
			throw new RequiresError(
				`requires.agentic-forge '${agenticForge}' is not a valid version range (e.g. ">=0.12")`,
			);
		}
	}
	let contract: number | null = null;
	if (data.contract !== undefined && data.contract !== null) {
		if (
			typeof data.contract !== "number" ||
			!Number.isInteger(data.contract) ||
			data.contract < 1
		) {
			throw new RequiresError("requires.contract must be a positive integer");
		}
		contract = data.contract;
	}
	return { agenticForge, contract };
}

export interface RequiresCheck {
	/** Refusal messages (empty when the workflow may run). */
	errors: string[];
	/** Warnings for an unmet version overridden by `ignoreRequires`. */
	warnings: string[];
}

export interface CheckRequiresOptions {
	/** Installed agentic-forge version. */
	version: string;
	/** Supported contract version (defaults to `CONTRACT_VERSION`). */
	contract?: number;
	/** `--ignore-requires`: an unmet version becomes a warning (never the contract). */
	ignoreRequires?: boolean;
}

/**
 * Checks a workflow's `requires` against the running harness. Messages name
 * the required and installed versions and what to do about them.
 */
export function checkRequires(
	workflowName: string,
	requires: WorkflowRequires | null | undefined,
	options: CheckRequiresOptions,
): RequiresCheck {
	const result: RequiresCheck = { errors: [], warnings: [] };
	if (!requires) return result;
	const supported = options.contract ?? CONTRACT_VERSION;
	if (requires.contract !== null && requires.contract !== supported) {
		const fix =
			requires.contract > supported
				? "upgrade agentic-forge (npm install -g agentic-forge@latest)"
				: "use a version of the workflow (or its skill pack) built for this contract";
		result.errors.push(
			`Workflow '${workflowName}' requires harness contract ${requires.contract}, but agentic-forge ${options.version} implements contract ${supported}: ${fix}. --ignore-requires does not override the contract.`,
		);
	}
	if (requires.agenticForge !== null && !satisfies(options.version, requires.agenticForge)) {
		const message = `Workflow '${workflowName}' requires agentic-forge ${requires.agenticForge}, but ${options.version} is installed`;
		if (options.ignoreRequires) {
			result.warnings.push(`${message}; running anyway (--ignore-requires)`);
		} else {
			result.errors.push(
				`${message}: upgrade agentic-forge (npm install -g agentic-forge@latest), or pass --ignore-requires to run it anyway.`,
			);
		}
	}
	return result;
}
