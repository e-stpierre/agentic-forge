#!/usr/bin/env node

/** CLI entry point for agentic-forge command. */

import { Command } from "commander";

function optString(val: unknown): string | undefined {
	return typeof val === "string" ? val : undefined;
}

function optBool(val: unknown): boolean | undefined {
	return typeof val === "boolean" ? val : undefined;
}

function optStringArray(val: unknown): string[] | undefined {
	return Array.isArray(val) && val.every((v) => typeof v === "string") ? val : undefined;
}

import {
	CliExitError,
	cmdAmend,
	cmdAnswer,
	cmdArtifacts,
	cmdAuthoringDir,
	cmdCancel,
	cmdConfig,
	cmdConfigure,
	cmdDoctor,
	cmdEvents,
	cmdInit,
	cmdInput,
	cmdList,
	cmdLogs,
	cmdMcp,
	cmdNotify,
	cmdOverseer,
	cmdPaths,
	cmdPause,
	cmdReleaseNotes,
	cmdReprioritize,
	cmdResume,
	cmdRetryStep,
	cmdRun,
	cmdSend,
	cmdServe,
	cmdStatus,
	cmdVersion,
	cmdWorkflows,
	getVersion,
} from "./commands/index.js";

const program = new Command()
	.name("agentic-forge")
	.version(getVersion())
	.description("Agentic workflow orchestration for coding agents");

// run command
program
	.command("run")
	.description(
		"Run a workflow with optional key=value variables (prompts for missing required vars)",
	)
	.argument("[workflow]", "workflow name or path to YAML file")
	.argument("[vars...]", "workflow variables as key=value pairs")
	.option("--list", "list all available workflows")
	.option("--var <key=value...>", "set workflow variable (can be used multiple times)")
	.option("--from-step <step>", "resume from a specific step")
	.option("--no-interactive", "disable interactive prompts for missing variables")
	.option("--terminal-output <mode>", "terminal output granularity (base or all)")
	.option("--runtime <runtime>", "override default runtime (claude or codex)")
	.option("--slug <slug>", "custom slug used in the run ID (YYYY-MM-DD-<slug>)")
	.option("--foreground", "follow the run until it ends (Ctrl+C detaches, the run continues)")
	.option(
		"--ignore-requires",
		"run even if the workflow requires a newer agentic-forge (never overrides the contract)",
	)
	.option("--parent <run>", "parent run id (for example an overseer run)")
	.option("--item <id>", "backlog item of the parent overseer run this run implements")
	.action(async (workflow: string | undefined, vars: string[], opts: Record<string, unknown>) => {
		await cmdRun({
			workflow,
			listWorkflows: optBool(opts.list),
			vars: optStringArray(opts.var),
			bareVars: optStringArray(vars),
			fromStep: optString(opts.fromStep),
			interactive: opts.interactive !== false,
			terminalOutput: optString(opts.terminalOutput),
			runtime: optString(opts.runtime),
			slug: optString(opts.slug),
			foreground: optBool(opts.foreground),
			ignoreRequires: optBool(opts.ignoreRequires),
			parent: optString(opts.parent),
			item: optString(opts.item),
		});
	});

// resume command
program
	.command("resume")
	.description("Resume a paused, waiting or failed run from its last completed step")
	.argument("<workflow_id>", "run ID to resume")
	.option("--foreground", "follow the run until it ends (Ctrl+C detaches, the run continues)")
	.action(async (workflowId: string, opts: Record<string, unknown>) => {
		await cmdResume({
			workflowId,
			foreground: optBool(opts.foreground),
		});
	});

// status command
program
	.command("status")
	.argument("<workflow_id>", "workflow ID")
	.action((workflowId: string) => {
		cmdStatus(workflowId);
	});

// cancel command
program
	.command("cancel")
	.description(
		"Cancel a run: stop its current step now, safety-commit its worktree, apply the cleanup policy",
	)
	.argument("<workflow_id>", "run ID to cancel")
	.action(async (workflowId: string) => {
		await cmdCancel(workflowId);
	});

// send command
program
	.command("send")
	.description(
		"Queue an operator message, injected at the start of the next step or iteration (--mode now: restart the current step with it)",
	)
	.argument("<run_id>", "run ID")
	.argument("<text>", "message text")
	.option("--step <name>", "deliver to this step only (default: the next step of the run)")
	.option("--from <sender>", "sender: user or overseer", "user")
	.option(
		"--mode <mode>",
		"next: deliver at the next boundary; now: kill the current step and restart it with the message",
		"next",
	)
	.action(async (runId: string, text: string, opts: Record<string, unknown>) => {
		await cmdSend({
			runId,
			text,
			step: optString(opts.step),
			from: optString(opts.from),
			mode: optString(opts.mode),
		});
	});

// pause command
program
	.command("pause")
	.description("Pause a run at its next step or ralph-loop iteration boundary")
	.argument("<run_id>", "run ID")
	.option("--now", "stop the current step now (its process tree is killed; it reruns on resume)")
	.action(async (runId: string, opts: Record<string, unknown>) => {
		await cmdPause({ runId, now: optBool(opts.now) });
	});

// answer command
program
	.command("answer")
	.description("Answer the pending needs_input request of an awaiting-human run and resume it")
	.argument("<run_id>", "run ID")
	.argument("<request_id>", "needs_input request ID (from the needs_input event or af status)")
	.argument("<answer>", "option ID, option label, or free-form answer")
	.option("--from <sender>", "sender: user or overseer", "user")
	.action(
		async (runId: string, requestId: string, answer: string, opts: Record<string, unknown>) => {
			await cmdAnswer({ runId, requestId, answer, from: optString(opts.from) });
		},
	);

// amend command
program
	.command("amend")
	.description(
		"Record a requirement change; runs the workflow's amend step at the next boundary, or delivers it as an operator message",
	)
	.argument("<run_id>", "run ID")
	.argument("<text>", "the requirement change")
	.option("--affects <ids>", "comma-separated milestone IDs the amendment changes")
	.option("--from <sender>", "sender: user or overseer", "user")
	.action(async (runId: string, text: string, opts: Record<string, unknown>) => {
		await cmdAmend({
			runId,
			text,
			affects: optString(opts.affects),
			from: optString(opts.from),
		});
	});

// retry-step command
program
	.command("retry-step")
	.description("Rerun a top-level step of a stopped run, and every step after it")
	.argument("<run_id>", "run ID")
	.argument("<step>", "top-level step name")
	.option("--context <text>", "extra context, delivered to the step as an operator message")
	.option("--from <sender>", "sender: user or overseer", "user")
	.action(async (runId: string, step: string, opts: Record<string, unknown>) => {
		await cmdRetryStep({
			runId,
			step,
			context: optString(opts.context),
			from: optString(opts.from),
		});
	});

// notify command
program
	.command("notify")
	.description("Send a notification to the enabled notification channels")
	.argument("<text>", "message text")
	.option("--title <title>", "notification title")
	.option("--level <level>", "info, warning or error", "info")
	.option(
		"--run <run>",
		"run the notification is about (uses its config; records notification.sent)",
	)
	.option("--json", "print the delivery report as JSON")
	.action(async (text: string, opts: Record<string, unknown>) => {
		await cmdNotify({
			text,
			title: optString(opts.title),
			level: optString(opts.level),
			runId: optString(opts.run),
			json: optBool(opts.json),
		});
	});

// reprioritize command
program
	.command("reprioritize")
	.description("Change the queue priority of a run that has not ended (higher runs first)")
	.argument("<run_id>", "run ID")
	.argument("<priority>", "integer priority (default 0)")
	.action(async (runId: string, priority: string) => {
		await cmdReprioritize({ runId, priority });
	});

// list command
program
	.command("list")
	.description("List runs from the run registry, newest first")
	.option(
		"--status <status>",
		"filter by status (comma-separated: running,paused,awaiting-human,...)",
	)
	.option("--repo <path>", "only runs dispatched from this repository root")
	.option("--since <when>", "only runs created since an ISO date or a duration (30m, 2h, 7d)")
	.option("--parent <run>", "only child runs of this parent run")
	.option("--json", "print the registry entries as JSON")
	.action((opts: Record<string, unknown>) => {
		cmdList({
			status: optString(opts.status),
			repo: optString(opts.repo),
			since: optString(opts.since),
			parent: optString(opts.parent),
			json: optBool(opts.json),
		});
	});

// events command
program
	.command("events")
	.description("Print run events (all runs, or one) and optionally follow new ones")
	.option("--run <run>", "only events of this run")
	.option("--types <types>", "comma-separated event types; a trailing * matches a prefix (run.*)")
	.option("--follow", "keep streaming new events (Ctrl+C stops)")
	.option("--cursor <cursor>", "start after this cursor (printed on stderr when the command ends)")
	.option("--cursor-file <path>", "read the start cursor from this file and keep it updated")
	.option("--new", "skip existing events and only print new ones (ignored with a cursor)")
	.option("--json", "print events as JSON lines (contract envelopes)")
	.option("--wait <seconds>", "long-poll length per request with --follow", "30")
	.action(async (opts: Record<string, unknown>) => {
		await cmdEvents({
			run: optString(opts.run),
			types: optString(opts.types),
			follow: optBool(opts.follow),
			cursor: optString(opts.cursor),
			cursorFile: optString(opts.cursorFile),
			new: optBool(opts.new),
			json: optBool(opts.json),
			wait: optString(opts.wait),
		});
	});

// logs command
program
	.command("logs")
	.description("Print the live transcript of a run (all steps, or one) and optionally follow it")
	.argument("<run>", "run ID")
	.option("--step <step>", "only the transcript of this step")
	.option("--follow", "keep streaming new entries until the step (or the run) ends")
	.option("--cursor <cursor>", "start after this cursor (printed on stderr) instead of the tail")
	.option("--limit <n>", "entries of the tail and of each page", "50")
	.option("--json", "print entries as JSON lines")
	.option("--wait <seconds>", "long-poll length per request with --follow", "30")
	.action(async (runId: string, opts: Record<string, unknown>) => {
		await cmdLogs({
			runId,
			step: optString(opts.step),
			follow: optBool(opts.follow),
			cursor: optString(opts.cursor),
			limit: optString(opts.limit),
			json: optBool(opts.json),
			wait: optString(opts.wait),
		});
	});

// artifacts command
program
	.command("artifacts")
	.description("Show the plan, summary, decisions and review files of a run")
	.argument("<run>", "run ID")
	.option("--kind <kind>", "plan, summary, decisions or review")
	.option("--content", "print the latest file of --kind instead of the paths")
	.option("--json", "print the paths as JSON")
	.action((runId: string, opts: Record<string, unknown>) => {
		cmdArtifacts({
			runId,
			kind: optString(opts.kind),
			content: optBool(opts.content),
			json: optBool(opts.json),
		});
	});

// input command
program
	.command("input")
	.description("Answer the single pending request of an awaiting-human run (af answer shortcut)")
	.argument("<run_id>", "run ID")
	.argument("<response>", "option ID, option label, or free-form answer")
	.action(async (runId: string, response: string) => {
		await cmdInput(runId, response);
	});

// configure command
program
	.command("configure")
	.description("Configure plugin settings")
	.action(() => {
		cmdConfigure();
	});

// init command
program
	.command("init")
	.description("Initialize agentic-forge directory (global by default, or --local for project)")
	.option("--force", "overwrite existing workflow files and config")
	.option("--list", "list available bundled workflows without copying")
	.option("--local", "initialize project-local directory (cwd/agentic/)")
	.option("--global", "initialize global user directory (default)")
	.option("--config-only", "only create config, skip workflow copy")
	.option("--workflows-only", "only copy workflows, skip config creation")
	.option("--workflow <name>", "copy only the named bundled workflow")
	.action((opts: Record<string, unknown>) => {
		cmdInit({
			force: optBool(opts.force),
			listOnly: optBool(opts.list),
			local: optBool(opts.local),
			global: optBool(opts.global),
			configOnly: optBool(opts.configOnly),
			workflowsOnly: optBool(opts.workflowsOnly),
			workflow: optString(opts.workflow),
		});
	});

// config command with subcommands
const configCmd = program.command("config").description("Get or set configuration");

configCmd
	.command("get")
	.argument("<key>", "configuration key (dot notation)")
	.action((key: string) => {
		cmdConfig("get", key);
	});

configCmd
	.command("set")
	.argument("<key>", "configuration key (dot notation)")
	.argument("<value>", "value to set")
	.option("--global", "write to global config")
	.option("--local", "write to local project config")
	.action((key: string, value: string, opts: Record<string, unknown>) => {
		const scope: "global" | "local" | undefined = opts.global
			? "global"
			: opts.local
				? "local"
				: undefined;
		cmdConfig("set", key, value, scope);
	});

// version command
program
	.command("version")
	.description("Show version information")
	.action(() => {
		cmdVersion();
	});

// release-notes command
program
	.command("release-notes")
	.argument("[version]", "show release notes for a specific version")
	.option("--latest", "show only the most recent version's release notes")
	.action((specificVersion: string | undefined, opts: Record<string, unknown>) => {
		cmdReleaseNotes({
			specificVersion,
			latest: optBool(opts.latest),
		});
	});

// paths command
program
	.command("paths")
	.description("Show resolved path configuration (global, local, and bundled directories)")
	.action(() => {
		cmdPaths();
	});

// authoring-dir command
program
	.command("authoring-dir")
	.description("Print path to interactive authoring skills directory")
	.action(() => {
		cmdAuthoringDir();
	});

// workflows command
program
	.command("workflows")
	.description("List available workflows with descriptions")
	.option("-v, --verbose", "show workflow variables and full descriptions")
	.action((opts: Record<string, unknown>) => {
		cmdWorkflows({
			verbose: optBool(opts.verbose),
		});
	});

// doctor command
program
	.command("doctor")
	.description("Check runtimes, auth, the supervisor, the runs root and skill pack compatibility")
	.option("--json", "print the report as JSON")
	.action(async (opts: Record<string, unknown>) => {
		await cmdDoctor({ json: optBool(opts.json) });
	});

// serve command
program
	.command("serve")
	.description("Run the af supervisor (foreground by default), or start, inspect or stop it")
	.option("--foreground", "run in this process until stopped (default)")
	.option("--detach", "start a detached background supervisor if none is running")
	.option("--status", "show whether a supervisor is running")
	.option("--stop", "stop the running supervisor")
	.option("--restart", "stop the running supervisor and start a detached one")
	.option("--force", "with --stop or --restart, stop even when runs are active")
	.option("--port <port>", "listen on a fixed port instead of a random one (debugging)")
	.action(async (opts: Record<string, unknown>) => {
		await cmdServe({
			detach: optBool(opts.detach),
			status: optBool(opts.status),
			stop: optBool(opts.stop),
			restart: optBool(opts.restart),
			force: optBool(opts.force),
			port: optString(opts.port),
		});
	});

// overseer command
program
	.command("overseer")
	.description(
		"Start an interactive Claude overseer session that dispatches and steers runs (creates or reuses an overseer run)",
	)
	.argument("[claude-args...]", "extra claude arguments, after --")
	.option(
		"--epic <file|text>",
		"epic to work on: a file (read) or a text; starts a new overseer run",
	)
	.option(
		"--resume <run>",
		"reopen this overseer run in a new session (it rehydrates from the harness)",
	)
	.option("--new", "create a new overseer run even when one is open for this repository")
	.option("--model <model>", "model of the claude session")
	.option("--print-command", "open the run and print the claude command instead of starting it")
	.option("--finish <run>", "end this overseer run (writes summary.md, emits run.completed)")
	.option("--status <status>", "with --finish: done (default), halted or failed")
	.option("--summary <text>", "with --finish: summary text")
	.action(async (claudeArgs: string[], opts: Record<string, unknown>) => {
		const code = await cmdOverseer({
			epic: optString(opts.epic),
			resume: optString(opts.resume),
			new: optBool(opts.new),
			model: optString(opts.model),
			printCommand: optBool(opts.printCommand),
			finish: optString(opts.finish),
			status: optString(opts.status),
			summary: optString(opts.summary),
			claudeArgs,
		});
		if (code !== 0) process.exitCode = code;
	});

// mcp command
program
	.command("mcp")
	.description("Run a stdio MCP server that dispatches and steers runs through the supervisor")
	.action(async () => {
		await cmdMcp();
	});

program.parseAsync().catch((err: unknown) => {
	if (err instanceof CliExitError) {
		process.stderr.write(`${err.message}\n`);
		process.exit(err.exitCode);
	}
	throw err;
});
