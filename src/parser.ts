/** YAML workflow parser. */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { RequiresError, parseRequires } from "./requires.js";
import type {
	AmendSettings,
	HumanInputOption,
	OutputDefinition,
	StepDefinition,
	StepType,
	Variable,
	WorkflowDefinition,
	WorkflowSettings,
	WorktreeCleanup,
	WorktreeLocation,
	WorktreeSettings,
} from "./types.js";
import { NOT_IN_PARALLEL_STEP_TYPES, STEP_TYPE_ALIASES, VALID_STEP_TYPES } from "./types.js";

/** `<plugin>:<skill>` or `<skill>` (Claude plugin and skill names). */
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*(:[A-Za-z0-9][A-Za-z0-9._-]*)?$/;

/** Contract id from an option label: `Ship it` -> `ship-it`. */
function optionId(label: string): string {
	return label
		.trim()
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/^[^A-Za-z0-9]+/, "")
		.replace(/-+$/, "")
		.slice(0, 200);
}

export class WorkflowParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WorkflowParseError";
	}
}

export class WorkflowParser {
	basePath: string;

	constructor(basePath?: string) {
		this.basePath = basePath ?? process.cwd();
	}

	parseFile(filePath: string): WorkflowDefinition {
		if (!existsSync(filePath)) {
			throw new WorkflowParseError(`Workflow file not found: ${filePath}`);
		}

		let data: unknown;
		try {
			const content = readFileSync(filePath, "utf-8");
			data = yaml.load(content);
		} catch (e: unknown) {
			if (e instanceof WorkflowParseError) throw e;
			const msg = e instanceof Error ? e.message : String(e);
			throw new WorkflowParseError(`Invalid YAML: ${msg}`);
		}

		this.basePath = path.dirname(filePath);
		return this.parseDict(data);
	}

	parseString(content: string): WorkflowDefinition {
		let data: unknown;
		try {
			data = yaml.load(content);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			throw new WorkflowParseError(`Invalid YAML: ${msg}`);
		}
		return this.parseDict(data);
	}

	parseDict(data: unknown): WorkflowDefinition {
		if (!data || typeof data !== "object" || Array.isArray(data)) {
			throw new WorkflowParseError("Workflow must be a dictionary");
		}

		const dict = data as Record<string, unknown>;
		const name = this.required(dict, "name") as string;
		const version = (dict.version as string) ?? "1.0";
		const description = (dict.description as string) ?? "";
		let requires: WorkflowDefinition["requires"] = null;
		try {
			requires = parseRequires(dict.requires);
		} catch (e: unknown) {
			if (e instanceof RequiresError) throw new WorkflowParseError(e.message);
			throw e;
		}

		const settings = this.parseSettings((dict.settings as Record<string, unknown>) ?? {});
		const variables = ((dict.variables as unknown[]) ?? []).map((v) =>
			this.parseVariable(v as Record<string, unknown>),
		);
		const steps = ((dict.steps as unknown[]) ?? []).map((s) =>
			this.parseStep(s as Record<string, unknown>),
		);
		const outputs = ((dict.outputs as unknown[]) ?? []).map((o) =>
			this.parseOutput(o as Record<string, unknown>),
		);

		if (settings.amend && !steps.some((s) => s.name === settings.amend?.step)) {
			throw new WorkflowParseError(
				`settings.amend.step '${settings.amend.step}' is not a top-level step`,
			);
		}

		return { name, version, description, requires, settings, variables, steps, outputs };
	}

	private required(data: Record<string, unknown>, key: string): unknown {
		if (!(key in data)) {
			throw new WorkflowParseError(`Missing required field: ${key}`);
		}
		return data[key];
	}

	private parseWorktreeSettings(data: Record<string, unknown>): WorktreeSettings {
		const worktreeRaw = (data.worktree as Record<string, unknown>) ?? {};
		const enabledRaw = worktreeRaw.enabled;
		const enabled: boolean | string =
			enabledRaw === undefined ? false : (enabledRaw as boolean | string);

		const result: WorktreeSettings = { enabled };

		if (worktreeRaw.location !== undefined) {
			const locationRaw = worktreeRaw.location as string;
			const validLocations = ["sibling", "nested", "absolute"] as const;
			if (!(validLocations as readonly string[]).includes(locationRaw)) {
				throw new WorkflowParseError(
					`Invalid worktree.location: '${locationRaw}'. Must be one of: sibling, nested, absolute`,
				);
			}
			result.location = locationRaw as WorktreeLocation;
		}

		if (worktreeRaw.directory !== undefined) {
			result.directory = (worktreeRaw.directory as string) ?? null;
		}

		if (worktreeRaw.cleanup !== undefined) {
			const cleanupRaw = worktreeRaw.cleanup as string;
			const validCleanups = ["on-success", "on-complete", "on-merge", "manual"] as const;
			if (!(validCleanups as readonly string[]).includes(cleanupRaw)) {
				throw new WorkflowParseError(
					`Invalid worktree.cleanup: '${cleanupRaw}'. Must be one of: on-success, on-complete, on-merge, manual`,
				);
			}
			result.cleanup = cleanupRaw as WorktreeCleanup;
		}

		if (result.location === "absolute" && !result.directory) {
			throw new WorkflowParseError(
				"worktree.location is 'absolute' but worktree.directory is not set",
			);
		}

		return result;
	}

	private parseSettings(data: Record<string, unknown>): WorkflowSettings {
		return {
			maxRetry: (data["max-retry"] as number) ?? null,
			timeoutMinutes: (data["timeout-minutes"] as number) ?? 60,
			trackProgress: (data["track-progress"] as boolean) ?? true,
			autofix: (data.autofix as string) ?? "none",
			terminalOutput: (data["terminal-output"] as string) ?? "base",
			bypassPermissions: (data["bypass-permissions"] as boolean) ?? false,
			strictMode: (data["strict-mode"] as boolean) ?? false,
			model: (data.model as string) ?? null,
			runtime: (data.runtime as string) ?? null,
			requiredTools: (data["required-tools"] as string[]) ?? [],
			worktree: this.parseWorktreeSettings(data),
			amend: this.parseAmendSettings(data),
		};
	}

	/** `settings.amend: { step: <top-level step name> }` (validated against the steps in parseDict). */
	private parseAmendSettings(data: Record<string, unknown>): AmendSettings | null {
		const raw = data.amend;
		if (raw === undefined || raw === null) return null;
		const step = (raw as Record<string, unknown>).step;
		if (typeof raw !== "object" || Array.isArray(raw) || typeof step !== "string" || !step) {
			throw new WorkflowParseError("settings.amend must be an object with a non-empty 'step'");
		}
		return { step };
	}

	private parseVariable(data: Record<string, unknown>): Variable {
		return {
			name: this.required(data, "name") as string,
			type: (data.type as string) ?? "string",
			required: (data.required as boolean) ?? true,
			default: data.default,
			description: (data.description as string) ?? "",
		};
	}

	/**
	 * `parentIsParallel`: the direct parent is a parallel step. `inParallel`:
	 * any ancestor is (a serial or conditional branch of a parallel step).
	 */
	private parseStep(
		data: Record<string, unknown>,
		parentIsParallel = false,
		inParallel = parentIsParallel,
	): StepDefinition {
		const name = this.required(data, "name") as string;
		const declaredType = this.required(data, "type") as string;
		const typeStr = STEP_TYPE_ALIASES[declaredType] ?? declaredType;

		if (!VALID_STEP_TYPES.includes(typeStr as StepType)) {
			throw new WorkflowParseError(
				`Invalid step type: ${typeStr}. Valid types: ${JSON.stringify(VALID_STEP_TYPES)}`,
			);
		}

		const stepType = typeStr as StepType;

		if (parentIsParallel && stepType === "parallel") {
			throw new WorkflowParseError(
				`Nested parallel steps are not allowed: '${name}' is a parallel step inside another parallel step`,
			);
		}

		// A parallel step cannot stop the run awaiting-human: its branches would all rerun
		if (inParallel && stepType === "human-input") {
			throw new WorkflowParseError(
				`Human-input steps are not allowed inside a parallel step: '${name}' is under a parallel step`,
			);
		}
		if (inParallel && NOT_IN_PARALLEL_STEP_TYPES.includes(stepType)) {
			throw new WorkflowParseError(
				`${stepType} steps are not allowed inside a parallel step: '${name}' is under a parallel step`,
			);
		}

		const step: StepDefinition = {
			name,
			type: stepType,
			prompt: null,
			agent: null,
			steps: [],
			condition: null,
			thenSteps: [],
			elseSteps: [],
			maxIterations: 5,
			completionPromise: null,
			message: null,
			model: null,
			runtime: null,
			stepTimeoutMinutes: null,
			stepMaxRetry: null,
			onError: "retry",
			checkpoint: false,
			dependsOn: null,
			bypassPermissions: null,
			worktree: null,
			onFailure: "fail",
		};

		if (stepType === "prompt") {
			step.prompt = (data.prompt as string) ?? null;
			step.agent = (data.agent as string) ?? null;
		} else if (stepType === "parallel") {
			step.steps = ((data.steps as unknown[]) ?? []).map((s) =>
				this.parseStep(s as Record<string, unknown>, true),
			);
			const worktreeRaw = data.worktree;
			if (worktreeRaw !== undefined && worktreeRaw !== null) {
				step.worktree = worktreeRaw as boolean | string;
			}
			const onFailureRaw = (data["on-failure"] as string) ?? "fail";
			if (onFailureRaw !== "fail" && onFailureRaw !== "warn") {
				throw new WorkflowParseError(
					`Invalid on-failure value: '${onFailureRaw}'. Must be one of: fail, warn`,
				);
			}
			step.onFailure = onFailureRaw;
		} else if (stepType === "serial") {
			step.steps = ((data.steps as unknown[]) ?? []).map((s) =>
				this.parseStep(s as Record<string, unknown>, false, inParallel),
			);
		} else if (stepType === "conditional") {
			step.condition = (data.condition as string) ?? null;
			step.thenSteps = ((data.then as unknown[]) ?? []).map((s) =>
				this.parseStep(s as Record<string, unknown>, false, inParallel),
			);
			step.elseSteps = ((data.else as unknown[]) ?? []).map((s) =>
				this.parseStep(s as Record<string, unknown>, false, inParallel),
			);
		} else if (stepType === "ralph-loop") {
			step.prompt = (data.prompt as string) ?? null;
			step.maxIterations = (data["max-iterations"] as number) ?? 5;
			step.completionPromise = (data["completion-promise"] as string) ?? null;
		} else if (stepType === "skill") {
			step.skill = this.parseSkillName(name, data.skill);
			step.args = data.args === undefined || data.args === null ? null : String(data.args);
		} else if (stepType === "human-input") {
			this.parseHumanInput(step, data, declaredType === "wait-for-human");
		} else if (
			stepType === "wait-for-review" ||
			stepType === "wait-for-checks" ||
			stepType === "merge"
		) {
			this.parseGithubStep(step, data);
		}

		step.model = (data.model as string) ?? null;
		step.runtime = (data.runtime as string) ?? null;
		step.stepTimeoutMinutes = (data["timeout-minutes"] as number) ?? step.stepTimeoutMinutes;
		step.stepMaxRetry = (data["max-retry"] as number) ?? null;
		step.onError = (data["on-error"] as string) ?? "retry";
		step.checkpoint = (data.checkpoint as boolean) ?? false;
		step.dependsOn = (data["depends-on"] as string) ?? null;
		step.bypassPermissions = (data["bypass-permissions"] as boolean | undefined) ?? null;

		return step;
	}

	/** `skill: <plugin>:<skill>` or a plain skill name; a template is checked when rendered. */
	private parseSkillName(stepName: string, raw: unknown): string {
		if (typeof raw !== "string" || !raw.trim()) {
			throw new WorkflowParseError(`Skill step '${stepName}' needs a 'skill' field`);
		}
		const skill = raw.trim().replace(/^\//, "");
		if (!skill.includes("{{") && !SKILL_NAME.test(skill)) {
			throw new WorkflowParseError(
				`Invalid skill '${raw}' in step '${stepName}': expected <plugin>:<skill> or <skill>`,
			);
		}
		return skill;
	}

	/**
	 * `human-input` fields. `wait-for-human` (before 0.12) is an alias:
	 * `on-timeout: continue` becomes a non-blocking request with a single
	 * `continue` option, applied after `timeout-minutes` (stop the run with
	 * `af cancel`); any other value waits for an answer.
	 */
	private parseHumanInput(
		step: StepDefinition,
		data: Record<string, unknown>,
		legacy: boolean,
	): void {
		const message = data.message ?? data.question;
		if (typeof message !== "string" || !message.trim()) {
			throw new WorkflowParseError(`Human-input step '${step.name}' needs a 'message' field`);
		}
		step.message = message;
		step.context = typeof data.context === "string" ? data.context : null;
		if (legacy) {
			const timeout = data["timeout-minutes"];
			const proceed = data["on-timeout"] === "continue";
			step.options = proceed ? [{ id: "continue", label: "Continue" }] : [];
			step.recommended = proceed ? "continue" : null;
			step.blocking = !proceed;
			step.stepTimeoutMinutes = proceed ? ((timeout as number) ?? 5) : null;
			return;
		}
		step.options = this.parseHumanInputOptions(step.name, data.options);
		const recommended = data.recommended;
		if (recommended !== undefined && recommended !== null) {
			if (!step.options.some((o) => o.id === String(recommended))) {
				throw new WorkflowParseError(
					`Human-input step '${step.name}': recommended '${String(recommended)}' is not one of its options`,
				);
			}
			step.recommended = String(recommended);
		} else {
			step.recommended = null;
		}
		const blocking = data.blocking ?? true;
		if (typeof blocking !== "boolean") {
			throw new WorkflowParseError(`Human-input step '${step.name}': blocking must be a boolean`);
		}
		step.blocking = blocking;
		if (data["timeout-minutes"] !== undefined && (blocking || step.recommended === null)) {
			throw new WorkflowParseError(
				`Human-input step '${step.name}': timeout-minutes needs blocking: false and a recommended option`,
			);
		}
	}

	/** Fields of `wait-for-review`, `wait-for-checks` and `merge`. */
	private parseGithubStep(step: StepDefinition, data: Record<string, unknown>): void {
		const where = `Step '${step.name}' (${step.type})`;
		const pr = data.pr;
		if (pr !== undefined && pr !== null) {
			if (typeof pr !== "string" && typeof pr !== "number") {
				throw new WorkflowParseError(`${where}: pr must be a number, '#<n>', a URL or a template`);
			}
			step.pr = String(pr);
		}
		const poll = data["poll-seconds"];
		if (poll !== undefined && poll !== null) {
			if (typeof poll !== "number" || !(poll > 0)) {
				throw new WorkflowParseError(`${where}: poll-seconds must be a positive number`);
			}
			step.pollSeconds = poll;
		}
		const timeout = data["timeout-minutes"];
		if (
			timeout !== undefined &&
			timeout !== null &&
			(typeof timeout !== "number" || !(timeout > 0))
		) {
			throw new WorkflowParseError(`${where}: timeout-minutes must be a positive number`);
		}

		if (step.type === "wait-for-review") {
			const reviewers = data.reviewers;
			if (reviewers === undefined || reviewers === null) {
				throw new WorkflowParseError(`${where} needs 'reviewers' (names or logins)`);
			}
			if (typeof reviewers === "string") {
				if (!reviewers.trim()) throw new WorkflowParseError(`${where}: reviewers is empty`);
				step.reviewers = reviewers;
			} else if (Array.isArray(reviewers) && reviewers.length > 0) {
				step.reviewers = reviewers.map((r) => String(r));
			} else {
				throw new WorkflowParseError(`${where}: reviewers must be a non-empty list or a string`);
			}
			const trigger = data.trigger;
			if (trigger !== undefined && trigger !== null) {
				if (typeof trigger !== "boolean") {
					throw new WorkflowParseError(`${where}: trigger must be a boolean`);
				}
				step.trigger = trigger;
			}
		} else if (step.type === "wait-for-checks") {
			const checks = data.checks ?? "required";
			if (checks !== "required" && checks !== "all") {
				throw new WorkflowParseError(`${where}: checks must be 'required' or 'all'`);
			}
			step.checks = checks;
			const onFail = data["on-fail"] ?? "fail";
			if (onFail !== "fail" && onFail !== "continue") {
				throw new WorkflowParseError(`${where}: on-fail must be 'fail' or 'continue'`);
			}
			step.onChecksFail = onFail;
		} else {
			if (data.skill !== undefined && data.skill !== null) {
				step.skill = this.parseSkillName(step.name, data.skill);
				step.args = data.args === undefined || data.args === null ? null : String(data.args);
			}
			const method = data.method;
			if (method !== undefined && method !== null) {
				if (typeof method !== "string" || !["repo", "squash", "rebase", "merge"].includes(method)) {
					throw new WorkflowParseError(
						`${where}: method must be one of repo, squash, rebase, merge`,
					);
				}
				step.method = method;
			}
			const del = data["delete-branch"];
			if (del !== undefined && del !== null) {
				if (typeof del !== "boolean") {
					throw new WorkflowParseError(`${where}: delete-branch must be a boolean`);
				}
				step.deleteBranch = del;
			}
		}
	}

	/** Options as strings (id = label) or `{ id, label, description }` objects. */
	private parseHumanInputOptions(stepName: string, raw: unknown): HumanInputOption[] {
		if (raw === undefined || raw === null) return [];
		if (!Array.isArray(raw)) {
			throw new WorkflowParseError(`Human-input step '${stepName}': options must be a list`);
		}
		const options = raw.map((item): HumanInputOption => {
			if (typeof item === "string" || typeof item === "number") {
				const label = String(item);
				return { id: optionId(label), label };
			}
			const o = (item ?? {}) as Record<string, unknown>;
			const label = o.label ?? o.id;
			if (typeof label !== "string" || !label.trim()) {
				throw new WorkflowParseError(
					`Human-input step '${stepName}': each option needs an id or a label`,
				);
			}
			const option: HumanInputOption = {
				id: typeof o.id === "string" && o.id ? optionId(o.id) : optionId(label),
				label,
			};
			if (typeof o.description === "string") option.description = o.description;
			return option;
		});
		const ids = new Set<string>();
		for (const o of options) {
			if (!o.id || ids.has(o.id)) {
				throw new WorkflowParseError(
					`Human-input step '${stepName}': option ids must be unique and non-empty ('${o.label}')`,
				);
			}
			ids.add(o.id);
		}
		return options;
	}

	private parseOutput(data: Record<string, unknown>): OutputDefinition {
		return {
			name: this.required(data, "name") as string,
			template: this.required(data, "template") as string,
			path: this.required(data, "path") as string,
			when: (data.when as string) ?? "completed",
		};
	}
}
