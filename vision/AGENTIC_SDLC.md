# Agentic SDLC

## Requirements

- The workflow must be able to run all type of requests:
  - Tasks: smallest unit of work, can be a chore, a bug, a techdebt or a task related to a feature. Task should be able to run quickly, with low planning and validation overhead.
  - Story: Can be a simple of complex feature that adds a new functionality to the application. Features can be standalone or can be associated to an Epic. Feature can contain tasks, that are use to split the work of the feature in multiple tasks.
  - Epic: An Epic is a scoped set of work to add a new functionality to the application. It can also be used for large refactoring or other large scope changes made to the application. Epics are composed of Stories. Epic can be standalone or have a Product parent
  - Product: A product is the bigger and most complex scope. It's used when creating a new app from scratch, or adding a large new set of features to an existing product. Product are split in Epics

- The workflow mainly uses Claude Code CLI as orchestrator and agent, but must also support the following CLI, that should be easily triggered and interchangeable: cursor-cli, copilot-cli, codex-cli. The ideal scenario would be to have a dedicated Claude Agent that is able to trigger these CLI with a set of instruction and have this CLI output it's result in a .md documentation or return in a json format a response to the CLaude instance that created it. Example of use case are to use a different LLM model (cursor/copilot/codex with model selection) to have a different perspective during the development flow and also to help during the development: specific agent with personality during brainstorm, have the review stage use in parallel different agents (GPT, Gemini, Grok) through these CLI to validate the code produce by Claude. Delegate some implementation tasks to specific agent based on their skillset, for example if Gemini is great at creating UI, ui task could be delegated to Gemini using the cursor-cli and selecting the gemini model. There is also a cost management aspect to consider, I pay for Pro subscription on all these CLI, for various reason, and I want to be able to use the usage that I'm allowed.

- Tasks should be created with parallelism in mind. Task that can be done in parallel must clearly be identified. The orchestrator can then trigger multiple agents instances in parallel to progress these tasks.

- The orchestrator must support to either start a full flow from a requirement (can be a prompt, a GitHub issue, or a list of GitHub issues)

## Phases

### Brainstorming

### Tasking

### Implementation

### Validation

## Scripts

The following python scripts must be created. The must be clear, concise and highly re-usable

- Git worktree
- Orchestrator

## Important
