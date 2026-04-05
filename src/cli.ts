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
	cmdAuthoringDir,
	cmdCancel,
	cmdConfig,
	cmdConfigure,
	cmdInit,
	cmdInput,
	cmdList,
	cmdPaths,
	cmdReleaseNotes,
	cmdResume,
	cmdRun,
	cmdSkillsDir,
	cmdStatus,
	cmdUpdate,
	cmdVersion,
	cmdWorkflows,
	getVersion,
} from "./commands/index.js";

const program = new Command()
	.name("agentic-forge")
	.version(getVersion())
	.description("Agentic workflow orchestration for Claude Code");

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
	.option("--slug <slug>", "custom slug appended to the workflow run ID")
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
		});
	});

// resume command
program
	.command("resume")
	.argument("<workflow_id>", "workflow ID to resume")
	.option("--terminal-output <mode>", "terminal output granularity (base or all)")
	.action(async (workflowId: string, opts: Record<string, unknown>) => {
		await cmdResume({
			workflowId,
			terminalOutput: optString(opts.terminalOutput),
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
	.argument("<workflow_id>", "workflow ID to cancel")
	.action((workflowId: string) => {
		cmdCancel(workflowId);
	});

// list command
program
	.command("list")
	.option("--status <status>", "filter by status (running, completed, failed, paused)")
	.action((opts: Record<string, unknown>) => {
		cmdList(optString(opts.status));
	});

// input command
program
	.command("input")
	.argument("<workflow_id>", "workflow ID")
	.argument("<response>", "response to provide")
	.action((workflowId: string, response: string) => {
		cmdInput(workflowId, response);
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

// skills-dir command
program
	.command("skills-dir")
	.description("Print path to bundled skills directory")
	.action(() => {
		cmdSkillsDir();
	});

// authoring-dir command
program
	.command("authoring-dir")
	.description("Print path to interactive authoring skills directory")
	.action(() => {
		cmdAuthoringDir();
	});

// update command
program
	.command("update")
	.description("Update agentic-forge to the latest version")
	.option("--check", "check for updates without installing")
	.action((opts: Record<string, unknown>) => {
		cmdUpdate({
			check: optBool(opts.check),
		});
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

program.parseAsync().catch((err: unknown) => {
	if (err instanceof CliExitError) {
		process.stderr.write(`${err.message}\n`);
		process.exit(err.exitCode);
	}
	throw err;
});
