# CLI Reference

Agentic Forge provides two CLI aliases: `agentic-forge` and `af`. All examples below use `af` for brevity.

## Commands

| Command         | Description                                          |
| --------------- | ---------------------------------------------------- |
| `run`           | Run a workflow with optional variables               |
| `resume`        | Resume a paused or failed workflow                   |
| `status`        | Show status of a workflow run                        |
| `cancel`        | Cancel a running or paused workflow                  |
| `list`          | List all workflow runs                               |
| `input`         | Provide input to a paused workflow                   |
| `init`          | Initialize directory structure                       |
| `config`        | Get or set configuration values                      |
| `configure`     | Display current configuration                        |
| `workflows`     | List available workflows with descriptions           |
| `paths`         | Show resolved directory and config paths             |
| `skills-dir`    | Print path to bundled workflow skills directory      |
| `authoring-dir` | Print path to interactive authoring skills directory |
| `release-notes` | Show release notes and changelog                     |
| `version`       | Show current version                                 |
| `update`        | Update to the latest version                         |

## run

Run a workflow with optional key=value variables. Prompts interactively for missing required variables.

```bash
af run <workflow> [vars...] [options]
```

### Arguments

| Argument     | Required | Description                               |
| ------------ | -------- | ----------------------------------------- |
| `<workflow>` | No       | Workflow name or path to YAML file        |
| `[vars...]`  | No       | Variables as positional `key=value` pairs |

### Options

| Option                     | Description                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `--var <key=value>`        | Set workflow variable (repeatable)                                                                            |
| `--slug <slug>`            | Use this slug as the output directory name instead of a generated timestamp ID. Auto-increments on collision. |
| `--from-step <step>`       | Resume from a specific step                                                                                   |
| `--no-interactive`         | Disable interactive prompts for missing variables                                                             |
| `--terminal-output <mode>` | Terminal output granularity: `base` or `all`                                                                  |
| `--list`                   | List all available workflows                                                                                  |

### Examples

```bash
# Run with a variable
af run one-shot --var "task=Add dark mode support"

# Run with multiple variables
af run plan-build-review --var "task=Add auth" --var "create_pr=true"

# Run with positional variables
af run one-shot task="Add dark mode support"

# Run with a custom output slug
af run plan-build-review --slug "dark-mode" --var "task=Add dark mode"

# Resume from a specific step
af run one-shot --from-step review --var "task=Add dark mode"

# Non-interactive mode (fails if required variables are missing)
af run one-shot --no-interactive --var "task=Add dark mode"

# Run a workflow from a YAML file path
af run ./agentic/workflows/my-workflow.yaml --var "key=value"
```

## resume

Resume a paused or failed workflow execution from where it left off.

```bash
af resume <workflow_id> [options]
```

### Arguments

| Argument        | Required | Description               |
| --------------- | -------- | ------------------------- |
| `<workflow_id>` | Yes      | Workflow run ID to resume |

### Options

| Option                     | Description                                  |
| -------------------------- | -------------------------------------------- |
| `--terminal-output <mode>` | Terminal output granularity: `base` or `all` |

### Examples

```bash
# Resume a failed workflow
af resume abc123

# Resume with full terminal output
af resume abc123 --terminal-output all
```

## status

Show status of a running or completed workflow, including current step, retry count, completed steps, pending steps, and errors.

```bash
af status <workflow_id>
```

### Arguments

| Argument        | Required | Description     |
| --------------- | -------- | --------------- |
| `<workflow_id>` | Yes      | Workflow run ID |

### Examples

```bash
af status abc123
```

## cancel

Cancel a running or paused workflow. Cannot cancel completed workflows.

```bash
af cancel <workflow_id>
```

### Arguments

| Argument        | Required | Description               |
| --------------- | -------- | ------------------------- |
| `<workflow_id>` | Yes      | Workflow run ID to cancel |

### Examples

```bash
af cancel abc123
```

## list

List all workflow runs. Shows ID, name, status, and start time.

```bash
af list [options]
```

### Options

| Option              | Description                                                  |
| ------------------- | ------------------------------------------------------------ |
| `--status <status>` | Filter by status: `running`, `completed`, `failed`, `paused` |

### Examples

```bash
# List all workflow runs
af list

# List only running workflows
af list --status running

# List failed workflows
af list --status failed
```

## input

Provide a text response to a paused workflow that is waiting for human input.

```bash
af input <workflow_id> <response>
```

### Arguments

| Argument        | Required | Description              |
| --------------- | -------- | ------------------------ |
| `<workflow_id>` | Yes      | Workflow run ID          |
| `<response>`    | Yes      | Response text to provide |

### Examples

```bash
af input abc123 "yes, proceed with the refactor"
```

## init

Initialize the agentic-forge directory structure with bundled workflows and config. Defaults to global initialization.

```bash
af init [options]
```

### Options

| Option              | Description                                      |
| ------------------- | ------------------------------------------------ |
| `--local`           | Initialize project-local `agentic/` directory    |
| `--global`          | Initialize global user directory (default)       |
| `--force`           | Overwrite existing workflow files and config     |
| `--list`            | List available bundled workflows without copying |
| `--config-only`     | Only create config, skip workflow copy           |
| `--workflows-only`  | Only copy workflows, skip config creation        |
| `--workflow <name>` | Copy only the named bundled workflow             |

### Examples

```bash
# Initialize global directory (default)
af init

# Initialize project-local directory
af init --local

# Copy only one specific workflow locally
af init --local --workflow plan-build-review

# List available bundled workflows
af init --list

# Force overwrite existing files
af init --local --force

# Only create config, no workflows
af init --local --config-only
```

## config

Get or set configuration values. Supports dot notation for nested keys.

### config get

```bash
af config get <key>
```

| Argument | Required | Description                                              |
| -------- | -------- | -------------------------------------------------------- |
| `<key>`  | Yes      | Configuration key (dot notation, e.g., `defaults.model`) |

### config set

```bash
af config set <key> <value> [options]
```

| Argument  | Required | Description       |
| --------- | -------- | ----------------- |
| `<key>`   | Yes      | Configuration key |
| `<value>` | Yes      | Value to set      |

| Option     | Description                   |
| ---------- | ----------------------------- |
| `--global` | Write to global config        |
| `--local`  | Write to local project config |

Values are auto-parsed: `true`/`false` become booleans, numeric strings become numbers.

### Examples

```bash
# Get a config value
af config get defaults.model

# Set model globally
af config set defaults.model opus --global

# Set output directory locally
af config set outputDirectory local --local

# Set max workers
af config set execution.maxWorkers 8 --local
```

## configure

Display the current merged configuration (defaults + global + local).

```bash
af configure
```

## workflows

List available workflows with descriptions, grouped by location (project, user, bundled).

```bash
af workflows [options]
```

### Options

| Option          | Description                                   |
| --------------- | --------------------------------------------- |
| `-v, --verbose` | Show workflow variables and full descriptions |

### Examples

```bash
# List all workflows
af workflows

# List with variable details
af workflows --verbose
```

## paths

Show all resolved directory and config paths with existence status.

```bash
af paths
```

Displays: global config, global workflows, global outputs, local config, local workflows, local outputs, bundled workflows, and the resolved output directory.

## skills-dir

Print the absolute path to the bundled workflow skills directory. Used internally by the workflow engine.

```bash
af skills-dir
```

## authoring-dir

Print the absolute path to the interactive authoring skills directory. Use this to add authoring skills to your Claude Code session:

```bash
claude --add-dir $(af authoring-dir)
```

## release-notes

Show release notes from the changelog.

```bash
af release-notes [version] [options]
```

### Arguments

| Argument    | Required | Description                       |
| ----------- | -------- | --------------------------------- |
| `[version]` | No       | Show notes for a specific version |

### Options

| Option     | Description                       |
| ---------- | --------------------------------- |
| `--latest` | Show only the most recent version |

### Examples

```bash
# Show all release notes
af release-notes

# Show latest version only
af release-notes --latest

# Show specific version
af release-notes 0.7.0
```

## version

Show the current agentic-forge version.

```bash
af version
```

## update

Update agentic-forge to the latest version via npm.

```bash
af update [options]
```

### Options

| Option    | Description                          |
| --------- | ------------------------------------ |
| `--check` | Check for updates without installing |

### Examples

```bash
# Update to latest
af update

# Check without installing
af update --check
```
