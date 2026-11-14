/**
 * Harness contract v1: schema loading and artifact validation.
 *
 * The contract is specified in docs/harness-contract.md. The JSON Schemas live in
 * schemas/contract-v1/ at the package root and ship in the npm package, so other
 * tools can validate against them without this module.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import addFormatsModule from "ajv-formats";
import type { FormatsPlugin } from "ajv-formats";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv/dist/2020.js";
import yaml from "js-yaml";

export const CONTRACT_VERSION = 1;

/** Contract artifacts that have their own schema (common.schema.json is shared definitions only). */
export const CONTRACT_ARTIFACTS = [
	"run",
	"result",
	"needs-input",
	"inbox-message",
	"amendment",
	"event",
	"decision",
	"summary-frontmatter",
] as const;

export type ContractArtifact = (typeof CONTRACT_ARTIFACTS)[number];

export type RunStatus =
	| "queued"
	| "running"
	| "paused"
	| "blocked"
	| "awaiting-human"
	| "halted"
	| "failed"
	| "canceled"
	| "done"
	| "merged";

export type ResultStatus = "done" | "merged" | "halted" | "awaiting-human" | "failed" | "escalate";

/** Process exit code for each result status. Any other outcome exits 1. */
export const EXIT_CODES: Readonly<Record<ResultStatus, number>> = {
	done: 0,
	merged: 0,
	"awaiting-human": 10,
	halted: 20,
	escalate: 30,
	failed: 1,
};

/** Run statuses after which a run never changes again; ended_at is set on them. */
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
	"halted",
	"failed",
	"canceled",
	"done",
	"merged",
];

export function exitCodeFor(status: string): number {
	return EXIT_CODES[status as ResultStatus] ?? 1;
}

export interface ContractValidationError {
	/** 1-based line number, for jsonl files. */
	line?: number;
	/** JSON pointer to the offending value, or "(root)". */
	path: string;
	message: string;
}

export interface ContractValidationResult {
	valid: boolean;
	errors: ContractValidationError[];
}

/** Absolute path of the directory holding the contract v1 schemas. */
export function getContractSchemaDir(): string {
	// src/contract/index.ts and dist/contract/index.js are both two levels below the package root.
	const here = dirname(fileURLToPath(import.meta.url));
	return resolve(here, "..", "..", "schemas", "contract-v1");
}

export function schemaId(artifact: ContractArtifact): string {
	return `urn:harness-contract:v1:${artifact}`;
}

// ajv-formats is CommonJS: under Node16 resolution its default export arrives as the module object.
const addFormats: FormatsPlugin =
	(addFormatsModule as unknown as { default?: FormatsPlugin }).default ??
	(addFormatsModule as unknown as FormatsPlugin);

let validators: Map<ContractArtifact, ValidateFunction> | null = null;

function getValidators(): Map<ContractArtifact, ValidateFunction> {
	if (validators) return validators;
	const dir = getContractSchemaDir();
	const ajv = new Ajv2020({ allErrors: true });
	addFormats(ajv);
	for (const file of readdirSync(dir).filter((f) => f.endsWith(".schema.json"))) {
		ajv.addSchema(JSON.parse(readFileSync(join(dir, file), "utf8")));
	}
	const map = new Map<ContractArtifact, ValidateFunction>();
	for (const artifact of CONTRACT_ARTIFACTS) {
		const validate = ajv.getSchema(schemaId(artifact));
		if (!validate) throw new Error(`Missing contract schema: ${artifact}.schema.json in ${dir}`);
		map.set(artifact, validate);
	}
	validators = map;
	return map;
}

function formatError(error: ErrorObject): ContractValidationError {
	let message = error.message ?? "is invalid";
	if (error.keyword === "additionalProperties") {
		message = `unknown field "${(error.params as { additionalProperty: string }).additionalProperty}"`;
	} else if (error.keyword === "enum") {
		message = `must be one of ${(error.params as { allowedValues: unknown[] }).allowedValues.join(", ")}`;
	}
	return { path: error.instancePath || "(root)", message };
}

/** Validate one artifact value (a parsed JSON object, or parsed summary.md frontmatter). */
export function validateArtifact(
	artifact: ContractArtifact,
	value: unknown,
): ContractValidationResult {
	const validate = getValidators().get(artifact);
	if (!validate) throw new Error(`Unknown contract artifact: ${artifact}`);
	if (validate(value)) return { valid: true, errors: [] };
	return { valid: false, errors: (validate.errors ?? []).map(formatError) };
}

const JSONL_ARTIFACTS: Record<string, ContractArtifact> = {
	"events.jsonl": "event",
	"decisions.jsonl": "decision",
	"amendments.jsonl": "amendment",
};

/** Infer the artifact of a run directory file from its name, or null when it is not a contract file. */
export function artifactForFile(file: string): ContractArtifact | null {
	const name = basename(file);
	if (name === "run.json") return "run";
	if (name === "result.json") return "result";
	if (name === "summary.md") return "summary-frontmatter";
	if (JSONL_ARTIFACTS[name]) return JSONL_ARTIFACTS[name];
	if (basename(dirname(resolve(file))) === "inbox" && name.endsWith(".json")) {
		return "inbox-message";
	}
	return null;
}

const BOM = String.fromCharCode(0xfeff);

function stripBom(text: string): string {
	return text.startsWith(BOM) ? text.slice(1) : text;
}

/**
 * Parse the YAML frontmatter of a markdown document, or return null when it has none.
 * Uses the YAML core schema so dates stay strings.
 */
export function parseFrontmatter(text: string): unknown {
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(stripBom(text));
	if (!match) return null;
	return yaml.load(match[1], { schema: yaml.CORE_SCHEMA }) ?? {};
}

/**
 * Validate a contract file. The artifact is inferred from the file name unless given.
 * jsonl files are checked line by line: blank lines are only allowed at the end of the file, and
 * events.jsonl also checks that seq equals the physical line number.
 */
export function validateContractFile(
	file: string,
	artifact?: ContractArtifact,
): ContractValidationResult {
	const path = resolve(file);
	if (!existsSync(path)) throw new Error(`File not found: ${path}`);
	const kind = artifact ?? artifactForFile(path);
	if (!kind) throw new Error(`Cannot infer the contract artifact of ${path}`);
	const text = stripBom(readFileSync(path, "utf8"));
	const errors: ContractValidationError[] = [];

	if (path.endsWith(".jsonl")) {
		const lines = text.split("\n");
		// Trailing empty lines come from the final newline; any other blank line is an error.
		let end = lines.length;
		while (end > 0 && lines[end - 1].trim() === "") end--;
		for (let i = 0; i < end; i++) {
			const raw = lines[i];
			const line = i + 1;
			if (raw.trim() === "") {
				errors.push({ line, path: "(root)", message: "blank line inside a jsonl file" });
				continue;
			}
			let value: unknown;
			try {
				value = JSON.parse(raw);
			} catch (err) {
				errors.push({ line, path: "(root)", message: `invalid JSON (${(err as Error).message})` });
				continue;
			}
			for (const e of validateArtifact(kind, value).errors) errors.push({ line, ...e });
			const seq = (value as { seq?: unknown } | null)?.seq;
			if (kind === "event" && seq !== line) {
				errors.push({ line, path: "/seq", message: `expected ${line}, got ${String(seq)}` });
			}
		}
		return { valid: errors.length === 0, errors };
	}

	let value: unknown;
	try {
		if (kind === "summary-frontmatter" && path.endsWith(".md")) {
			value = parseFrontmatter(text);
			if (value === null) {
				return { valid: false, errors: [{ path: "(root)", message: "missing YAML frontmatter" }] };
			}
		} else {
			value = JSON.parse(text);
		}
	} catch (err) {
		return { valid: false, errors: [{ path: "(root)", message: (err as Error).message }] };
	}
	return validateArtifact(kind, value);
}

export {
	type NeedsInput,
	type NeedsInputKind,
	type NeedsInputOption,
	type ResultBlock,
	exitCodeForRun,
	parseResultBlock,
	resultStatusFromExit,
} from "./result.js";
