# Contributing to Agentic SDLC

Developer documentation for building, testing, and contributing to the agentic-sdlc plugin.

## Development Setup

### Prerequisites

- Python 3.10+
- uv package manager
- Git
- Claude Code

### Clone and Install

```bash
# Clone the repository
git clone https://github.com/anthropics/agentic-forge.git
cd agentic-forge

# Install the plugin in development mode
uv tool install --editable plugins/agentic-sdlc

# Install development dependencies
cd plugins/agentic-sdlc
uv sync --extra dev
```

## Code Structure

```
plugins/agentic-sdlc/
├── src/agentic_sdlc/          # Python source code
│   ├── __init__.py
│   ├── cli.py                 # CLI entry point
│   ├── runner.py              # Workflow execution engine
│   ├── console.py             # Terminal output formatting
│   ├── config.py              # Configuration management
│   ├── progress.py            # Progress tracking
│   ├── commands/              # CLI command implementations
│   │   ├── run.py
│   │   ├── status.py
│   │   ├── analyse.py
│   │   └── ...
│   ├── workflows/             # Bundled workflow YAML files
│   │   ├── plan-build-validate.yaml
│   │   ├── one-shot.yaml
│   │   └── ...
│   └── templates/             # Jinja2 templates for outputs
│
├── commands/                  # Claude command definitions (.md)
│   ├── plan/
│   ├── build/
│   ├── validate/
│   └── analyse/
│
├── agents/                    # Claude agent configurations
│   ├── explorer.md
│   └── reviewer.md
│
├── skills/                    # Claude skill modules
│   ├── create-checkpoint.md
│   └── create-log.md
│
├── schemas/                   # JSON schemas
│   ├── workflow.schema.json
│   └── config.schema.json
│
├── tests/                     # Python test suite
│   ├── test_runner.py
│   ├── test_config.py
│   └── ...
│
├── docs/                      # Documentation
│   ├── QuickStart.md
│   ├── WorkflowBuilder.md
│   ├── Contributing.md
│   └── workflow-example.yaml
│
├── pyproject.toml             # Package configuration
├── README.md                  # Plugin documentation
└── CHANGELOG.md               # Version history

```

## Building the Plugin

```bash
# Build the package
uv build

# Install locally
uv tool install dist/agentic_sdlc-*.whl

# Install from local source
uv tool install --editable .
```

## Running Tests

```bash
# Run all tests
uv run pytest

# Run with coverage
uv run pytest --cov --cov-report=term-missing

# Run specific test file
uv run pytest tests/test_runner.py

# Run specific test
uv run pytest tests/test_runner.py::test_workflow_execution

# Run with verbose output
uv run pytest -v

# Run with debug output
uv run pytest -s
```

## Code Quality

### Formatting

```bash
# Check formatting
pnpm run format:check

# Auto-format code
pnpm run format
```

### Linting

```bash
# Run linter
pnpm run lint

# Auto-fix linting issues
pnpm run lint:fix
```

### Type Checking

```bash
# Run type checker (if configured)
uv run mypy src/agentic_sdlc
```

## Making Changes

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
```

### 2. Make Your Changes

Follow these guidelines:

- **Python Code**: Follow PEP 8 style guidelines
- **Prompts**: Use templates from `docs/templates/`
- **Documentation**: Update relevant docs
- **Tests**: Add tests for new functionality

### 3. Test Your Changes

```bash
# Run tests
uv run pytest

# Check formatting and linting
pnpm check
```

### 4. Commit Your Changes

```bash
# Use the git-commit command
/git-commit
```

Follow commit message conventions:

- `feat: Add new feature`
- `fix: Fix bug description`
- `docs: Update documentation`
- `test: Add or update tests`
- `refactor: Code refactoring`
- `chore: Maintenance tasks`

### 5. Submit a Pull Request

```bash
# Use the git-pr command
/git-pr
```

## Adding New Features

### Adding a New CLI Command

1. Create command implementation in `src/agentic_sdlc/commands/your_command.py`:

```python
from agentic_sdlc.console import ConsoleOutput

def cmd_your_command(args, console: ConsoleOutput):
    """Your command description."""
    console.info("Executing your command...")
    # Implementation here
```

2. Register in `src/agentic_sdlc/cli.py`:

```python
subparsers.add_parser('your-command', help='Description')
```

3. Add to command router in `cli.py`:

```python
elif args.command == 'your-command':
    from agentic_sdlc.commands.your_command import cmd_your_command
    cmd_your_command(args, console)
```

4. Add tests in `tests/test_your_command.py`

### Adding a New Claude Command

1. Create markdown file in appropriate directory:

```
commands/
└── your-category/
    └── your-command.md
```

2. Follow the command template structure (see `docs/templates/command-template.md`)

3. Validate with `/normalize`:

```bash
/normalize plugins/agentic-sdlc/commands/your-category/
```

### Adding a New Workflow Step Type

1. Update schema in `schemas/workflow.schema.json`

2. Implement in `src/agentic_sdlc/runner.py`:

```python
def _execute_step(self, step, context):
    step_type = step.get("type")

    if step_type == "your-type":
        return self._execute_your_type(step, context)
    # ...

def _execute_your_type(self, step, context):
    # Implementation
    pass
```

3. Add tests for the new step type

4. Document in `docs/WorkflowBuilder.md`

### Adding a Bundled Workflow

1. Create workflow YAML in `src/agentic_sdlc/workflows/`:

```yaml
name: your-workflow
version: "1.0"
description: Description of what this workflow does

steps:
  - name: step-1
    type: prompt
    prompt: "Task to execute"
```

2. Test the workflow:

```bash
agentic-sdlc run your-workflow.yaml
```

3. Document in `README.md` if it's a primary use case

## Architecture Guidelines

### Python Orchestrator Responsibilities

The Python orchestrator handles:

- Parsing YAML workflow definitions
- Managing process lifecycle (starting/stopping Claude sessions)
- File I/O operations (progress, checkpoints, logs)
- Timeout and retry logic
- Git operations (worktrees, branches)
- Deterministic control flow

**DO:**

- Parse and validate YAML
- Manage subprocess execution
- Handle timeouts and retries
- Perform file operations
- Create git worktrees

**DON'T:**

- Make intelligent decisions (leave to Claude)
- Evaluate conditions (delegate to Claude orchestrator command)
- Parse complex outputs (use structured JSON from Claude)

### Claude Orchestrator Responsibilities

Claude handles intelligent decisions:

- Evaluating Jinja2 conditions in conditional steps
- Deciding next step in workflow progression
- Interpreting step outputs
- Error recovery strategies
- Content generation

**DO:**

- Evaluate conditions
- Interpret outputs
- Generate content
- Make context-aware decisions

**DON'T:**

- Direct file manipulation (use Claude tools)
- Process management
- Timeout handling

### Session Management

- **One session per step**: Each workflow step runs in a fresh Claude session
- **No context accumulation**: Steps don't share conversation context
- **State via files**: Use progress.json, checkpoint.md, and step outputs for state
- **Clean isolation**: Prevents context overflow and ensures deterministic behavior

## Testing Guidelines

### Unit Tests

Test individual components in isolation:

```python
def test_config_loading():
    """Test configuration file loading."""
    config = Config.load("test-config.json")
    assert config.output_directory == "agentic"
```

### Integration Tests

Test workflow execution end-to-end:

```python
def test_simple_workflow_execution():
    """Test executing a simple workflow."""
    workflow = {
        "name": "test",
        "steps": [{"name": "step1", "type": "prompt", "prompt": "test"}]
    }
    runner = WorkflowRunner(workflow)
    result = runner.execute()
    assert result.status == "completed"
```

### Workflow Tests

Test actual workflows:

```bash
# Create test workflow
cat > test-workflow.yaml << EOF
name: test
steps:
  - name: test-step
    type: prompt
    prompt: "echo 'test'"
EOF

# Run test
agentic-sdlc run test-workflow.yaml
```

## Documentation Standards

### README Updates

Keep README concise:

- Link to detailed docs in `docs/`
- Focus on quick start and common examples
- Under 200 lines

### Detailed Documentation

Place detailed content in `docs/`:

- **QuickStart.md**: 5-minute getting started
- **WorkflowBuilder.md**: Complete workflow authoring
- **Contributing.md**: Development guidelines

### Prompt Documentation

Follow template conventions:

- Use `docs/templates/` as reference
- Validate with `/normalize`
- Include examples and usage notes

## Release Process

### Version Numbering

Follow semantic versioning (major.minor.patch):

- **major**: Breaking changes
- **minor**: New features (backward compatible)
- **patch**: Bug fixes

### Creating a Release

1. Update version in `pyproject.toml`
2. Update `CHANGELOG.md` with changes
3. Commit changes:

```bash
/git-commit -m "chore: Bump version to X.Y.Z"
```

4. Create git tag:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

5. Build and publish:

```bash
uv build
# Distribution handled by repository maintainers
```

## Troubleshooting

### Common Development Issues

**Import errors after changes:**

```bash
# Reinstall in editable mode
uv tool install --editable --force .
```

**Tests failing:**

```bash
# Check test isolation
uv run pytest --verbose --capture=no

# Clear test cache
uv run pytest --cache-clear
```

**Schema validation errors:**

```bash
# Validate workflow against schema
uv run python -c "import json; import yaml;
schema = json.load(open('schemas/workflow.schema.json'));
workflow = yaml.safe_load(open('test.yaml'));
print('Valid')"
```

## Getting Help

- **Issues**: Open an issue in the repository
- **Discussions**: Use GitHub discussions for questions
- **Documentation**: Check `docs/` directory

## License

See repository LICENSE file for licensing information.
