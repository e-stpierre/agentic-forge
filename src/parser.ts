/** YAML workflow parser. */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type {
	OutputDefinition,
	StepDefinition,
	StepType,
	Variable,
	WorkflowDefinition,
	WorkflowSettings,
} from "./types.js";
import { VALID_STEP_TYPES } from "./types.js";

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

		return { name, version, description, settings, variables, steps, outputs };
	}

	private required(data: Record<string, unknown>, key: string): unknown {
		if (!(key in data)) {
			throw new WorkflowParseError(`Missing required field: ${key}`);
		}
		return data[key];
	}

	private parseSettings(data: Record<string, unknown>): WorkflowSettings {
		return {
			maxRetry: (data["max-retry"] as number) ?? 3,
			timeoutMinutes: (data["timeout-minutes"] as number) ?? 60,
			trackProgress: (data["track-progress"] as boolean) ?? true,
			autofix: (data.autofix as string) ?? "none",
			terminalOutput: (data["terminal-output"] as string) ?? "base",
			bypassPermissions: (data["bypass-permissions"] as boolean) ?? false,
			strictMode: (data["strict-mode"] as boolean) ?? false,
			model: (data.model as string) ?? null,
			runtime: (data.runtime as string) ?? null,
			requiredTools: (data["required-tools"] as string[]) ?? [],
		};
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

	private parseStep(data: Record<string, unknown>, parentIsParallel = false): StepDefinition {
		const name = this.required(data, "name") as string;
		const typeStr = this.required(data, "type") as string;

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
			pollingInterval: 15,
			onTimeout: "abort",
			model: null,
			runtime: null,
			stepTimeoutMinutes: null,
			stepMaxRetry: null,
			onError: "retry",
			checkpoint: false,
			dependsOn: null,
		};

		if (stepType === "prompt") {
			step.prompt = (data.prompt as string) ?? null;
			step.agent = (data.agent as string) ?? null;
		} else if (stepType === "parallel") {
			step.steps = ((data.steps as unknown[]) ?? []).map((s) =>
				this.parseStep(s as Record<string, unknown>, true),
			);
		} else if (stepType === "serial") {
			step.steps = ((data.steps as unknown[]) ?? []).map((s) =>
				this.parseStep(s as Record<string, unknown>),
			);
		} else if (stepType === "conditional") {
			step.condition = (data.condition as string) ?? null;
			step.thenSteps = ((data.then as unknown[]) ?? []).map((s) =>
				this.parseStep(s as Record<string, unknown>),
			);
			step.elseSteps = ((data.else as unknown[]) ?? []).map((s) =>
				this.parseStep(s as Record<string, unknown>),
			);
		} else if (stepType === "ralph-loop") {
			step.prompt = (data.prompt as string) ?? null;
			step.maxIterations = (data["max-iterations"] as number) ?? 5;
			step.completionPromise = (data["completion-promise"] as string) ?? null;
		} else if (stepType === "wait-for-human") {
			step.message = (data.message as string) ?? null;
			step.pollingInterval = (data["polling-interval"] as number) ?? 15;
			step.onTimeout = (data["on-timeout"] as string) ?? "abort";
			step.stepTimeoutMinutes = (data["timeout-minutes"] as number) ?? 5;
		}

		step.model = (data.model as string) ?? null;
		step.runtime = (data.runtime as string) ?? null;
		step.stepTimeoutMinutes = (data["timeout-minutes"] as number) ?? step.stepTimeoutMinutes;
		step.stepMaxRetry = (data["max-retry"] as number) ?? null;
		step.onError = (data["on-error"] as string) ?? "retry";
		step.checkpoint = (data.checkpoint as boolean) ?? false;
		step.dependsOn = (data["depends-on"] as string) ?? null;

		return step;
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
