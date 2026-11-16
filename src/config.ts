/** Configuration management for agentic-forge. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Claude tools a step may use without asking (`runtimes.claude.allow`), in
 * Claude Code permission rule syntax: reading, editing, todos, skills and
 * subagents. Shell commands are not on it: a workflow's `required-tools`
 * (for example `Bash` or `Bash(git *)`) adds to it, and any other call asks.
 */
export const DEFAULT_CLAUDE_ALLOW: readonly string[] = [
	"Read",
	"Glob",
	"Grep",
	"Edit",
	"MultiEdit",
	"Write",
	"NotebookEdit",
	"TodoWrite",
	"Skill",
	"Task",
];

const DEFAULT_CONFIG: Record<string, unknown> = {
	outputDirectory: "global",
	logging: {
		enabled: true,
		level: "Error",
	},
	defaults: {
		runtime: "claude",
		maxRetry: 3,
		timeoutMinutes: 60,
		trackProgress: true,
		terminalOutput: "base",
	},
	claude: {
		model: "sonnet",
	},
	codex: {
		// No default model: Codex CLI has no version-agnostic alias, so pinning a
		// SKU here goes stale. Omitting it lets the Codex CLI use its own default.
		sandbox: "workspace-write",
	},
	execution: {
		maxWorkers: 4,
		pollingIntervalSeconds: 5,
	},
	worktree: {
		location: "sibling",
		directory: null,
		cleanup: "on-success",
	},
	runs: {
		// null: <global dir>/runs/. Replaces outputDirectory.
		root: null,
	},
	// Plugin directories with an af-workflows/ dir. auto_detect also reads the
	// Claude Code installed plugin list (installed_plugins.json).
	skill_packs: {
		paths: [],
		auto_detect: true,
	},
	supervisor: {
		max_parallel_runs: 4,
		max_parallel_tasks: 2,
		env_passthrough: [],
		/** Minutes before a non-blocking needs_input request gets its recommended option (null: never). */
		needs_input_timeout: null,
	},
	runtimes: {
		// session: Claude Agent SDK session (live messages, questions, permissions).
		// cli: one-shot `claude -p`.
		// permissions: allowlist (default) auto-approves `allow`; bypass skips every
		// permission check, with a warning on every step.
		claude: {
			driver: "session",
			plugins: [],
			permissions: "allowlist",
			allow: [...DEFAULT_CLAUDE_ALLOW],
		},
		// session: `codex app-server` thread (live messages, steering, approvals and
		// questions). cli: one-shot `codex exec`. Its sandbox is `codex.sandbox`;
		// approvals outside it ask, unless `allow` approves them (`Bash(git *)`,
		// `Edit`); bypass removes the sandbox. Skill steps use a native Codex
		// skill when `skills/list` has it, else send the skill's SKILL.md inline;
		// inline_references also appends the files it links to.
		codex: {
			driver: "session",
			permissions: "allowlist",
			allow: [],
			inline_references: false,
		},
	},
	// GitHub step types (wait-for-review, wait-for-checks, merge). Waiting polls
	// `gh` from the supervisor: no agent session runs while waiting.
	github: {
		// Reviewer names usable in `reviewers:`; `trigger` is the comment that
		// asks for a review (posted only when the step or auto_trigger enables it).
		reviewers: {
			claude: { login: "claude[bot]", trigger: null },
			codex: { login: "chatgpt-codex-connector[bot]", trigger: "@codex review" },
		},
		auto_trigger: false,
		// Seconds a reviewer gets on a new head before its trigger is posted.
		trigger_after_seconds: 120,
		poll_seconds: 30,
		max_poll_seconds: 300,
		review_timeout_minutes: 30,
		checks_timeout_minutes: 30,
		merge: {
			// repo: resolve from the repository settings and rulesets.
			method: "repo",
			preference: ["squash", "rebase", "merge"],
			delete_branch: true,
			lock_timeout_minutes: 30,
		},
	},
	// Notifications sent by the supervisor when a run event matches a trigger.
	// Every channel is off until enabled. A trigger is an event type (a `run.*`
	// prefix works) or { event, run_type } to match only one run type.
	notifications: {
		enabled: true,
		triggers: [
			"needs_input",
			"run.halted",
			"run.failed",
			{ event: "run.completed", run_type: "overseer" },
		],
		// Per trigger event type: { title, body } with {{placeholders}}.
		templates: {},
		channels: {
			desktop: { enabled: false },
			ntfy: { enabled: false, server: "https://ntfy.sh", topic: null, token: null },
			slack: { enabled: false, webhook_url: null },
			discord: { enabled: false, webhook_url: null },
			// Comment on the run's pull request (outward-facing: opt-in).
			github: { enabled: false },
		},
	},
	// Overseer (`af overseer`): its backlog, scheduling and answer policy. Read
	// from the overseer run's config snapshot (the config of the launching repo).
	overseer: {
		// Backlog items running at once (parallel only without a dependency or a
		// conflict zone overlap).
		max_parallel: 2,
		// Discovered items of child runs: auto (ready), ask (proposed, the user
		// approves) or log (recorded, never scheduled).
		accept_discovered_items: "ask",
		// What stops new dispatches until the user decides: an item that failed or
		// halted, an open critical discovered item, an exhausted budget.
		halt_epic_on: ["halted", "critical", "budget"],
		budgets: {
			// Backlog items (dropped and logged ones excluded).
			max_tasks: 20,
			// Extra dispatches of one item after its first run.
			max_retries: 1,
			// Total minutes of the child runs (parallel runs add up).
			max_run_minutes: 480,
			// Run tree guards (any run with a parent: overseer children and runs a
			// step dispatched with af_dispatch). Depth of a new run (a root run is
			// 0); a deeper dispatch is refused.
			max_dispatch_depth: 3,
			// Runs in one tree, its root included (ended runs count).
			max_tree_runs: 50,
			// Runs of one tree that have not ended (queued, running, paused,
			// blocked, awaiting-human), an overseer root excluded.
			max_tree_active: 6,
		},
		// needs_input requests of child runs the overseer may answer itself.
		answer_policy: {
			enabled: true,
			// Highest step risk (low, medium, high); a step without max_risk is asked.
			max_risk: "low",
			// Only the recommended option (a request without one is asked).
			recommended_only: true,
			// Also blocking requests (permission requests are always asked).
			blocking: true,
		},
	},
};

/** The `github` config section merged over its defaults. */
export function getGithubConfig(config: Record<string, unknown>): GithubConfig {
	const defaults = DEFAULT_CONFIG.github as Record<string, unknown>;
	const raw = (config.github as Record<string, unknown> | undefined) ?? {};
	const merged = deepMerge(deepCopy(defaults), raw) as Record<string, unknown>;
	const merge = (merged.merge as Record<string, unknown>) ?? {};
	const num = (value: unknown, fallback: number): number =>
		typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
	// Polling intervals must stay above zero, or the wait steps poll in a tight loop
	const positive = (value: unknown, fallback: number): number =>
		typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
	const d = defaults as Record<string, number>;
	const dm = defaults.merge as Record<string, unknown>;
	return {
		reviewers: (merged.reviewers as Record<string, unknown>) ?? {},
		autoTrigger: merged.auto_trigger === true,
		triggerAfterSeconds: num(merged.trigger_after_seconds, d.trigger_after_seconds),
		pollSeconds: positive(merged.poll_seconds, d.poll_seconds),
		maxPollSeconds: positive(merged.max_poll_seconds, d.max_poll_seconds),
		reviewTimeoutMinutes: num(merged.review_timeout_minutes, d.review_timeout_minutes),
		checksTimeoutMinutes: num(merged.checks_timeout_minutes, d.checks_timeout_minutes),
		merge: {
			method: typeof merge.method === "string" ? merge.method : (dm.method as string),
			preference: Array.isArray(merge.preference)
				? merge.preference.map(String)
				: (dm.preference as string[]),
			deleteBranch: merge.delete_branch !== false,
			lockTimeoutMinutes: num(merge.lock_timeout_minutes, dm.lock_timeout_minutes as number),
		},
	};
}

export const DISCOVERED_ITEM_POLICIES = ["auto", "ask", "log"] as const;
export type DiscoveredItemPolicy = (typeof DISCOVERED_ITEM_POLICIES)[number];
export const HALT_CONDITIONS = ["failed", "halted", "critical", "budget"] as const;
export type HaltCondition = (typeof HALT_CONDITIONS)[number];
export const POLICY_RISKS = ["low", "medium", "high"] as const;
export type PolicyRisk = (typeof POLICY_RISKS)[number];

export interface OverseerConfig {
	maxParallel: number;
	acceptDiscoveredItems: DiscoveredItemPolicy;
	haltEpicOn: HaltCondition[];
	budgets: {
		maxTasks: number;
		maxRetries: number;
		maxRunMinutes: number;
		maxDispatchDepth: number;
		maxTreeRuns: number;
		maxTreeActive: number;
	};
	answerPolicy: {
		enabled: boolean;
		maxRisk: PolicyRisk;
		recommendedOnly: boolean;
		blocking: boolean;
	};
}

/** The `overseer` config section merged over its defaults (invalid values fall back to them). */
export function getOverseerConfig(config: Record<string, unknown>): OverseerConfig {
	const defaults = DEFAULT_CONFIG.overseer as Record<string, unknown>;
	const raw = (config.overseer as Record<string, unknown> | undefined) ?? {};
	const merged = deepMerge(deepCopy(defaults), raw) as Record<string, unknown>;
	const db = defaults.budgets as Record<string, number>;
	const da = defaults.answer_policy as Record<string, unknown>;
	const budgets = (merged.budgets as Record<string, unknown>) ?? {};
	const answer = (merged.answer_policy as Record<string, unknown>) ?? {};
	const int = (value: unknown, fallback: number, min = 0): number =>
		typeof value === "number" && Number.isInteger(value) && value >= min ? value : fallback;
	const oneOf = <T extends string>(list: readonly T[], value: unknown, fallback: T): T =>
		(list as readonly unknown[]).includes(value) ? (value as T) : fallback;
	const halt = Array.isArray(merged.halt_epic_on)
		? merged.halt_epic_on.filter((c): c is HaltCondition =>
				(HALT_CONDITIONS as readonly unknown[]).includes(c),
			)
		: (defaults.halt_epic_on as HaltCondition[]);
	return {
		maxParallel: int(merged.max_parallel, defaults.max_parallel as number, 1),
		acceptDiscoveredItems: oneOf(
			DISCOVERED_ITEM_POLICIES,
			merged.accept_discovered_items,
			defaults.accept_discovered_items as DiscoveredItemPolicy,
		),
		haltEpicOn: halt,
		budgets: {
			maxTasks: int(budgets.max_tasks, db.max_tasks, 1),
			maxRetries: int(budgets.max_retries, db.max_retries),
			maxRunMinutes: int(budgets.max_run_minutes, db.max_run_minutes, 1),
			maxDispatchDepth: int(budgets.max_dispatch_depth, db.max_dispatch_depth, 1),
			maxTreeRuns: int(budgets.max_tree_runs, db.max_tree_runs, 2),
			maxTreeActive: int(budgets.max_tree_active, db.max_tree_active, 1),
		},
		answerPolicy: {
			enabled: answer.enabled !== false,
			maxRisk: oneOf(POLICY_RISKS, answer.max_risk, da.max_risk as PolicyRisk),
			recommendedOnly: answer.recommended_only !== false,
			blocking: answer.blocking !== false,
		},
	};
}

export interface GithubConfig {
	reviewers: Record<string, unknown>;
	autoTrigger: boolean;
	triggerAfterSeconds: number;
	pollSeconds: number;
	maxPollSeconds: number;
	reviewTimeoutMinutes: number;
	checksTimeoutMinutes: number;
	merge: {
		method: string;
		preference: string[];
		deleteBranch: boolean;
		lockTimeoutMinutes: number;
	};
}

/**
 * Returns the platform-native global config file path.
 * Inlined here to avoid a circular dependency with paths.ts.
 */
function getGlobalConfigPath(): string {
	const override = process.env.AGENTIC_FORGE_HOME;
	if (override) {
		return path.join(path.resolve(override), "config.json");
	}
	const platform = process.platform;
	let base: string;
	if (platform === "win32") {
		base = process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming");
	} else if (platform === "darwin") {
		base = path.join(homedir(), "Library", "Application Support");
	} else {
		base = process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config");
	}
	return path.join(base, "agentic-forge", "config.json");
}

export function getConfigPath(repoRoot?: string): string {
	const root = repoRoot ?? process.cwd();
	return path.join(root, "agentic", "config.json");
}

export function getDefaultConfig(): Record<string, unknown> {
	return deepCopy(DEFAULT_CONFIG);
}

/**
 * Loads configuration with 3-layer merge: defaults -> global -> local.
 * @param repoRoot - project root (for local config path)
 */
export function loadConfig(repoRoot?: string): Record<string, unknown> {
	let config = getDefaultConfig();

	// Layer 2: global config
	const globalConfigPath = getGlobalConfigPath();
	if (existsSync(globalConfigPath)) {
		const globalConfig = JSON.parse(readFileSync(globalConfigPath, "utf-8")) as Record<
			string,
			unknown
		>;
		config = deepMerge(config, globalConfig);
	}

	// Layer 3: local config
	const localConfigPath = getConfigPath(repoRoot);
	if (existsSync(localConfigPath)) {
		const localConfig = JSON.parse(readFileSync(localConfigPath, "utf-8")) as Record<
			string,
			unknown
		>;
		config = deepMerge(config, localConfig);
	}

	return config;
}

/**
 * Saves configuration to the specified scope.
 * @param config - config object to write
 * @param repoRoot - project root (for local writes)
 * @param scope - "global" writes to global config; "local" or omitted writes locally
 */
export function saveConfig(
	config: Record<string, unknown>,
	repoRoot?: string,
	scope?: "global" | "local",
): void {
	if (scope === "global") {
		const globalConfigPath = getGlobalConfigPath();
		mkdirSync(path.dirname(globalConfigPath), { recursive: true });
		writeFileSync(globalConfigPath, JSON.stringify(config, null, 2), "utf-8");
	} else {
		const configPath = getConfigPath(repoRoot);
		mkdirSync(path.dirname(configPath), { recursive: true });
		writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
	}
}

export function getConfigValue(key: string, repoRoot?: string): unknown {
	const config = loadConfig(repoRoot);
	const parts = key.split(".");
	let value: unknown = config;
	for (const part of parts) {
		if (
			value !== null &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			part in (value as Record<string, unknown>)
		) {
			value = (value as Record<string, unknown>)[part];
		} else {
			return null;
		}
	}
	return value;
}

/**
 * Sets a configuration value in the specified scope.
 * Reads only the target scope's config file, sets the key, and writes it back.
 * This avoids writing merged values from other layers into a single scope.
 *
 * When no scope is specified: writes to local config if it exists, otherwise global.
 */
export function setConfigValue(
	key: string,
	value: string,
	scope?: "global" | "local",
	repoRoot?: string,
): void {
	// Auto-detect scope: local if local config exists, otherwise global
	const effectiveScope = scope ?? (existsSync(getConfigPath(repoRoot)) ? "local" : "global");

	// Load only the target scope's config (not the full merged config)
	let config: Record<string, unknown>;
	if (effectiveScope === "global") {
		const globalConfigPath = getGlobalConfigPath();
		config = existsSync(globalConfigPath)
			? (JSON.parse(readFileSync(globalConfigPath, "utf-8")) as Record<string, unknown>)
			: {};
	} else {
		const localConfigPath = getConfigPath(repoRoot);
		config = existsSync(localConfigPath)
			? (JSON.parse(readFileSync(localConfigPath, "utf-8")) as Record<string, unknown>)
			: {};
	}

	const parts = key.split(".");
	let target = config;
	for (const part of parts.slice(0, -1)) {
		if (!(part in target)) {
			target[part] = {};
		}
		target = target[part] as Record<string, unknown>;
	}

	let parsedValue: unknown = value;
	if (value.toLowerCase() === "true") {
		parsedValue = true;
	} else if (value.toLowerCase() === "false") {
		parsedValue = false;
	} else if (/^\d+$/.test(value)) {
		parsedValue = Number.parseInt(value, 10);
	}

	target[parts[parts.length - 1]] = parsedValue;
	saveConfig(config, repoRoot, effectiveScope);
}

export function deepMerge(
	base: Record<string, unknown>,
	override: Record<string, unknown>,
): Record<string, unknown> {
	const result = { ...base };
	for (const key of Object.keys(override)) {
		if (
			key in result &&
			typeof result[key] === "object" &&
			result[key] !== null &&
			!Array.isArray(result[key]) &&
			typeof override[key] === "object" &&
			override[key] !== null &&
			!Array.isArray(override[key])
		) {
			result[key] = deepMerge(
				result[key] as Record<string, unknown>,
				override[key] as Record<string, unknown>,
			);
		} else {
			result[key] = override[key];
		}
	}
	return result;
}

function deepCopy(obj: Record<string, unknown>): Record<string, unknown> {
	return JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
}

/** Resolve the default model for a given runtime from config, with backward compatibility. */
export function getRuntimeModel(config: Record<string, unknown>, runtimeId: string): string | null {
	// Per-runtime config: config[runtimeId].model
	const runtimeConfig = config[runtimeId] as Record<string, unknown> | undefined;
	if (runtimeConfig?.model) {
		return runtimeConfig.model as string;
	}
	// Backward compat: config.defaults.model predates per-runtime namespaces and
	// always held a Claude alias, so it must not leak into other runtimes.
	if (runtimeId === "claude") {
		const defaults = config.defaults as Record<string, unknown> | undefined;
		if (defaults?.model) {
			return defaults.model as string;
		}
	}
	return null;
}

/** Extract the Codex sandbox mode from config. */
export function getSandboxMode(config: Record<string, unknown>): string | null {
	const codexConfig = config.codex as Record<string, unknown> | undefined;
	return (codexConfig?.sandbox as string) ?? null;
}

/**
 * Driver of a runtime (`runtimes.<id>.driver`): `session` or `cli`. Unknown
 * values fall back to the default (`session` for Claude and Codex, `cli`
 * otherwise).
 */
export function getRuntimeDriver(
	config: Record<string, unknown>,
	runtimeId: string,
): "session" | "cli" {
	const runtimes = config.runtimes as
		| Record<string, Record<string, unknown> | undefined>
		| undefined;
	const value = runtimes?.[runtimeId]?.driver;
	if (value === "session" || value === "cli") return value;
	return runtimeId === "claude" || runtimeId === "codex" ? "session" : "cli";
}

/** Local plugin directories loaded by the session driver (`runtimes.<id>.plugins`). */
export function getRuntimePlugins(config: Record<string, unknown>, runtimeId: string): string[] {
	const runtimes = config.runtimes as
		| Record<string, Record<string, unknown> | undefined>
		| undefined;
	const value = runtimes?.[runtimeId]?.plugins;
	return Array.isArray(value)
		? value.filter((p): p is string => typeof p === "string" && p !== "")
		: [];
}

/** Whether inlined skills also carry the files they link to (`runtimes.<id>.inline_references`). */
export function getInlineReferences(config: Record<string, unknown>, runtimeId: string): boolean {
	const runtimes = config.runtimes as
		| Record<string, Record<string, unknown> | undefined>
		| undefined;
	return runtimes?.[runtimeId]?.inline_references === true;
}

/** Permission mode of a runtime (`runtimes.<id>.permissions`). */
export type PermissionMode = "allowlist" | "bypass";

/** Permissions of a runtime: its mode and its allowlist (`runtimes.<id>.allow`). */
export interface RuntimePermissions {
	mode: PermissionMode;
	allow: string[];
}

/**
 * Permissions of a runtime: `runtimes.<id>.permissions` (`allowlist` unless
 * set to `bypass`) and `runtimes.<id>.allow` (when unset, Claude gets
 * `DEFAULT_CLAUDE_ALLOW` and other runtimes an empty list).
 */
export function getRuntimePermissions(
	config: Record<string, unknown>,
	runtimeId: string,
): RuntimePermissions {
	const runtimes = config.runtimes as
		| Record<string, Record<string, unknown> | undefined>
		| undefined;
	const entry = runtimes?.[runtimeId];
	const mode: PermissionMode = entry?.permissions === "bypass" ? "bypass" : "allowlist";
	const value = entry?.allow;
	let allow: string[];
	if (Array.isArray(value)) {
		allow = value.filter((t): t is string => typeof t === "string" && t !== "");
	} else {
		allow = runtimeId === "claude" ? [...DEFAULT_CLAUDE_ALLOW] : [];
	}
	return { mode, allow };
}
