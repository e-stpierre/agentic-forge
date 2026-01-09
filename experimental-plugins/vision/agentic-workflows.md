# Agentic Worklows

## Goal

The agentic workflows goal is to enable Claude Code to execute any type of task with a high success rate. The framework allows Claude Code to work fully independently, with resiliency and accuracy, in a multi-sessions workflow.

## Guiding Principles

- Composed of highly flexible building blocks
- Yaml workflows are the top level entity in the framework, they support arguments:
  - autofix
  - max-retry: maximum retries for a single step, after which the workflow is stopped
  - timeout-minutes: maximum timeout, the workflow stops if it reaches this time without completing (can also be configured at the step level)
  - track-progress: if enabled, the claude sessions will be instructed to track progress in the workflow progress document
- Able to complete short and long-running tasks
- Mainly used for software development tasks, but must not be limited to this
- Support any task size: chore, bug, task, story, epic
- Support retry, on error and for requested loop to improve result quality.
- The workflow must be able to work in every scenario where agents can be used:
  - feature development
  - code analysis
  - code improvement
  - bug fixes
  - brainstorming
  - technical analysis
  - financial analysis
  - pentesting, security analysis
  - QA
  - Product management
- Workflows are yml files that consist of one-many steps
- Steps can be executed in serie, in parallel and support conditional execution
- Workflows must support additional custom steps and commands, that can be written by the user and not be part of the core package.
- Support an integrated checkpoint system to support stopping and continuing the workflow.
- Support full logging options, configurable by the user for specific levels (information, warning, error, critical). Every Claude session that runs must be able to add logs to this system (can be a .md file per workflow execution)
- Support a json configuration schema and a Claude /configure command that will guide the user in the creation of this configuration. The configuration is then used by many steps in the framework, for example log levels, git main branch name (main, master, etc.), always use git, always create prs, maximum retry count for failing steps, framework documents outputs location (feature plan, checkpoints, logs, notes, analysis results, etc.)
- Workflows steps must have the capability of continuing on an existing Claude Code session, not always starting from a new session. The user should be able to configure in the workflow steps if the workflows starts from a new session or if it should /resume an existin session.
- Support fully automated git workflows and github interactions (issues, pr, etc.)
- Support git worktree, that can be configured per steps or globally for the workflow
- Support permissions management, per step or for the whole workflow. If bypass-permission is configured, claude will run with the --dangerously-skip-permission flag.
- Use jinja 2 for template resolution (yaml)
- Have a base output folder configured (/agentic) in the current directory. Every documents produced by the framework will be added there.
- Have a basic self-learning and self-improving process. When a claude instance faces an error, fail at a task, discover something unexpected, or anything else similar, it should create a .md document in the /memory directory to note this. Eventually, these findings can be used for automatically update CLAUDE.md, create Skill, etc.
- Include a CLAUDE.example.md file, that provides section that a user can include in it's CLAUDE.md to ehanced the utility provided by the framework, for examples a section about how and when to create Memory, how and when to create checkpoints, etc.
- IMPORTANT: only add comments in the code of this plugin when it's necessary, to identify something unusual. Don't use comment for normal codepaths.

## Building Blocks

### Python Scripts

The following python scripts are what I envision as the base scripts to build, that are used in the core of the framework (use by steps scripts) or that are used directly by a step in a workflow.

#### Runner

Base scripts to run Claude Code in a programatic way

Can be build similar to:
experimental-plugins\agentic-core\src\agentic_core\runner.py
experimental-plugins\core\src\claude_core\runner.py

#### Orchestrator

Run Claude instances in parallel

Can be inspired from:
experimental-plugins\agentic-sdlc\src\claude_sdlc\orchestrator.py
experimental-plugins\core\src\claude_core\orchestrator.py

#### Memory

Use to create the memory about a specific topics that can be re-used later. Use clear fontmatter to help navigate and search in these .md files for a specific topic.
They are always stored as .md files

Can be inspired from
experimental-plugins\agentic-core\src\agentic_core\memory

#### Workflows

Scripts responsible of parsing and running the workflows

Can be strongly inspired from:
experimental-plugins\agentic-core\src\agentic_core\workflow

### Agents

Workflow steps can be assigned to an agent. The plugin offers base agents, but a user can install and refer his own agents when creating new yaml workflows. Here's the list

### Commands

The following commands are commands that can be explicitely calls in workflows. Additional commands, that don't come front this plugin, can also be used, if a user refer the command in a workflow step. So the commands listed here are really just the basics of the plugin, and the offering can be extended. Commands will always be executed in an agentic workflows, without interactions with the developer, it's important that they proceed to completion and that they have clear and fix arguments and output structure (json).

#### Plan

Base on the type of task or requested template, create a plan that will be used to accomplished the requested task

#### Build

plugins\interactive-sdlc\commands\dev\build.md

#### Validate

plugins\interactive-sdlc\commands\dev\validate.md

#### Analyse

Same commands and interactive sdlc analyse commands, oriented for agentic use case, with fixed json output. The commands support a template argument as input, that is the template file to use, otherwise they fallback to the default, if a template is provided in the workflow step, it's passed to the command argument.

plugins\interactive-sdlc\commands\analyse

#### Git

Same commands and interactive sdlc git commands, oriented for agentic use case, with fixed json output.

plugins\interactive-sdlc\commands\git

#### GitHub

Same commands and interactive sdlc github commands, oriented for agentic use case, with fixed json output.

plugins\interactive-sdlc\commands\github

### Skills

Skills are the same as commands in this framework, the skills offered in this plugin are a good basis, claude session invoked by the workflow should be able to use them, but they can be extended by any skill installed by the user.

#### Create Memory

Skill use to create memory, refers to the plugin json configuration for:

- directory to persist memory in
- memory template to use

Have configured default if these are not provided.
Ask Claude to double check if the memory he's about to create is not duplicated and is pertinent.
Put emphasis on creating a clear frontmatter for the memory, that respect the required properties defined in the templated used.

#### Create Checkpoint

Checkpoints are scoped per workflow, the checkpoint file name must contain the workflow execution name
Skill used to create a checkpoint, refers to the plugin json configuration for:

- directory to persist checkpoint in
- memory template to use

#### Create Log

If an event occured that matches the configured log level, add it to the workflow's log file.

Critical: Critical error, for example max retried fail causing the workflow to stop
Error: Any error
Warning: Unexpected issue that happened
Information: Regular logging during the progression

### Outputs

Other that expected framework outputs, such as modifying code, editing documents, etc., Workflow steps can be requested to create an output, that can use a template. Same as the other building block, the plugin will offer core outputs templates, but the user can use it's own templates. Output templates must respect the followinf rules:

Prompt templates use **Mustache/Handlebars-style placeholders** with the following format:

```markdown
## {{section_title}}

{{content}}

<!--
Instructions:
- Replace {{content}} with the actual content
- Additional guidance for this section
- Suggested elements (include others as needed):
  - Element 1
  - Element 2
-->
```

**Key principles:**

- Use `{{variable_name}}` for all placeholders (not `<placeholder>` or other formats)
- Include HTML comments with instructions below each section
- Mark suggested elements as "include others as needed" to allow flexibility

Here's that base outputs that will be included in the plugin.

#### Workflow Progress

Generated at the start of the workflow if the track-progress argument is enabled, this document is the main document used to orchestrate long-running workflows and workflows that are managed by a top level orchestrator. Sessions will not their progress in the document, the orchestrator will then select which step to trigger and continue based on the workflow progress. This is also based on this document that the orchestrator will know if an error must cause the workflow to stop (for example a session reached max retry trying to accomplish a task, failing every time) or if the workflow is completed and it can end.

#### Checkpoint

Document use to store checkpoint, that contains information about the current progress, an issue discovered, data that should be communicated to another Claude session, etc. The checkpoint act as notebook for the sessions and can be use to enable basic communication between them.

#### Plans

Exact same plan as the interactive-sdlc plugin (only the plan section of the command)

plugins\interactive-sdlc\commands\plan

#### Analysis

Exact same template as the interactive-sdlc analyse commands templates

plugins\interactive-sdlc\commands\analyse

### Workflow Steps

The workflow steps are the blocks that can be defined in a .yaml workflow file.

#### Run Claude with a prompt

The most basic step, it simply is configured with a prompt, and this prompt is passed to a Claude Session.

#### Execute a command with Claude

Request Claude to execute a specific command, with provided arguments

#### Parallel step

Execute the nested steps in parallel

#### Conditional step

Execute the step nested in it only if the condition is met

#### Recurring step

Execute this step(s) embedded a specific amount of time, to increase success rate

### Workflows

Workflows are yaml files that re-use building blocks to create full set of automation, that will be executed by one or multiple sessions of Claude Code. The plugin will offers base workflows, but the main goal of this framework is to allow a user to create and customize it's own workflows. Here's a list of examples workflows that should be included in the plugin.

#### Analyse Codebase

Supported arguments:

- autofix "level" => --autofix "Major" => This will make the workflow trigger another claude session after each analyse command complete, to create a git branch, fix every issues at or above the selected level (major and critical in this case), commit and push the changes and open a PR.

Run in parallel all 5 analyse commands (bug, debt, doc, security, style), with one claude session per analyse command. One list of improvement is generated for each commands.

When autofix is enabled, the workflow is composed of 5 branches, that each have two steps (analyse + fix). The branches run in parallel, each in a dedicated git worktree to avoid conflict.

#### One Shot

A single step and session, use to complete a specific task, is a git worktree, from start to finish. Analyse the prompt request and code, create a git branch, make the changes, commit and push the code, create a PR

#### Plan Build Validate

Multiple steps, one Claude session per step:

- The python orchestrator uses the Claude orchestrator command to create the progress document initially. Then, the python orchestrator loops, using the Claude orchestrator command to know which step to execute next.
- Plan using the plan command and appropriate plan type.
- Build: create a branch, implement the changes following the plan, commit the changes after every milestones. If the session implementing the changes reaches 80% of it's context limit, it updates the workflow progress document, optionaly create a checkpoint for anything additional that must be saved, and end.
- Validate the changes based on the plan and diff in the current branch
- Fix issues identified by the validation (default major+, configurable with argument)
- Create a PR

## Future Development

The following elements are ideas for future development, that must not be included in the implmentation plan of the agentic workflows.

- Support other CLI tools such as Codex CLI, Cursor CLI and Copilot CLI
- Permission framework, that is permissive enough to allow agents to run without issue but does not provide every permissions

## References

### Existing Agentic Plugins

#### agentic-core

experimental-plugins\vision\agentic-core.md
experimental-plugins\agentic-core

This is the latest version of the agentic plugin and this contains the best examples of code that can be re-used to build this plugin. It's important to note that it has downside and everything should not be used as-is, it must respect the current plugin requirements.

Full agentic plugin that is fully implemented but has not been fully validated. It's a bit too complex for the needs of this project, for example the use of kafka and postgresql, the meetings orchestration, etc.

- Uses the concept of yaml workflows, which can be re-used partially
- Use template for expected output of steps, which can be re-used

#### agentic-sdlc

experimental-plugins\vision\agentic-sdlc.md
experimental-plugins\agentic-sdlc

#### core

experimental-plugins\vision\core.md
experimental-plugins\core

Legacy plugin, only kept because it's script can be use as example to implement the bse python scriptsÈ

- logging.py
- orchestrator.py
- runner.py
- worktree.py

## Existing Framework

Here's a list of existing framework that have similarities to the system that I want to build:

- [BMAD](https://github.com/bmad-code-org/BMAD-METHOD): seems great for planning, but contains too much project managements processing, like scrum meetings, too many documents created. It's also a big downside that for a given meeting, one single session is role playing every meeting participant, instead of every participant being a dedicated agent. Mostly manual steps, the developer must start a plan, start a meeting, start the build phase, etc.
- [GetShitDone](https://github.com/glittercowboy/get-shit-done): Excellent simplicity, great approach for a single developer workflow. Only prompts, not scripts, lacking agentic features
- [Ralph-Wiggum](https://github.com/anthropics/claude-code/blob/main/plugins/ralph-wiggum/README.md): Simple loop using a hook, that forces Claude to process the same prompt in a loop, until the completion criteria are all met. Very interesting approach, known to give great results online. Would be interesting to have a similar workflow step in the framework

## Questions

1. How should the main orchestator python script work with intelligence. Should it use a Claude orchestrator command, asked to validate the current state of the workflow, and based on the output, make a decision of what happens next? Claude Orchestrator would always return a specific json response that the python script could parse, for example to know that the workflow is still in progress, working on the implementation phase.
2. Considering the current requirements, are there any existing framework online that would cover similar requirements and offer similar features, except those mentioned in the "Existing Framework" section?
3. Considering the goal of the plugin and the use case examples, should the plugin offer additional agents, commands or skills?
