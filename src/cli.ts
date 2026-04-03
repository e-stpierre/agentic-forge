#!/usr/bin/env node

/** CLI entry point for agentic-forge command. */

import { Command } from "commander";

import {
	cmdCancel,
	cmdConfig,
	cmdConfigure,
	cmdInit,
	cmdInput,
	cmdList,
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
	.argument("[workflow]", "workflow name or path to YAML file")
	.option("--list", "list all available workflows")
	.option("--var <key=value...>", "set workflow variable (can be used multiple times)")
	.option("--from-step <step>", "resume from a specific step")
	.option("--terminal-output <mode>", "terminal output granularity (base or all)")
	.action(async (workflow: string | undefined, opts: Record<string, unknown>) => {
		await cmdRun({
			workflow,
			listWorkflows: opts.list as boolean | undefined,
			vars: opts.var as string[] | undefined,
			fromStep: opts.fromStep as string | undefined,
			terminalOutput: opts.terminalOutput as string | undefined,
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
			terminalOutput: opts.terminalOutput as string | undefined,
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
		cmdList(opts.status as string | undefined);
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
	.description("Copy bundled workflow templates to local project")
	.option("--force", "overwrite existing workflow files")
	.option("--list", "list available bundled workflows without copying")
	.action((opts: Record<string, unknown>) => {
		cmdInit({
			force: opts.force as boolean | undefined,
			listOnly: opts.list as boolean | undefined,
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
	.action((key: string, value: string) => {
		cmdConfig("set", key, value);
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
			latest: opts.latest as boolean | undefined,
		});
	});

// skills-dir command
program
	.command("skills-dir")
	.description("Print path to bundled skills directory")
	.action(() => {
		cmdSkillsDir();
	});

// update command
program
	.command("update")
	.description("Update agentic-forge to the latest version")
	.option("--check", "check for updates without installing")
	.action((opts: Record<string, unknown>) => {
		cmdUpdate({
			check: opts.check as boolean | undefined,
		});
	});

// workflows command
program
	.command("workflows")
	.description("List available workflows with descriptions")
	.option("-v, --verbose", "show workflow variables and full descriptions")
	.action((opts: Record<string, unknown>) => {
		cmdWorkflows({
			verbose: opts.verbose as boolean | undefined,
		});
	});

program.parse();
