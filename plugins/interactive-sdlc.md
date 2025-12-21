# Interactive SDLC

This is a draft plan that you must ehance an update to make it a complete final plan. Ask Clarifying questions first.

I want to separate the SDLC plugin in two parts, the agentic-sdlc and the intreactive-sdlc.

- The current SDLC plugin must be renamed to agentic-sdlc. It will contains commands and agents that are all configured to operate in a full agentic workflow, without any interaction with the user. These command will be called and orchestrated via python workflows.
- A new plugin is created, named interactive-sdlc. This plugin contains commands that are meant to be used within a single Claude Code session, and ask interactive questions to the user when necessary.

The new interactive plugin contains the following building blocks commands:

- plan-chore default 2 explore agents. List of tasks required to complete the chore
- plan-bug default 2 explore agents. Explanation of the bug impact, repro steps, focus on how to validate that it's fixed. Include list of tasks required to fix the bug.
- plan-feature default 3 explore agents. More in depth plan, that is composed of 1-many milestones, that each contains a set of tasks
- build (required arg is a plan.md) implement the plan, if --git is enable, commit changes while progression in the plan implementation
- validate

Each plan must include a templated plan format, that is used exactly, with replaced placeholder, to build the .md plan. Use the following placeholder style:

```md
# Chore: <chore-title>

Text written direcctly in the Plan is included as-is in the md plan

<description>Instruction about how to build this section</description>
```

And the following workflows command:

- one-shot: the goal is speed, create a plan in-memory, the default explorer agent is 0, validate step is disable by default
- plan-build-validate

Supported arguments:

- --git will automatically execute git operations (plans will commit the plan, build will commit the changes, workflows will create branch, commit changes, push then open a PR)
- --pr will automatically create a draft PR (only for workflows)
- --checkpoint instruction about where to continue the plan
- --explore 3, the amount of explore agents to use for the explore phase of the codebase

Keep the command clear and concise.
