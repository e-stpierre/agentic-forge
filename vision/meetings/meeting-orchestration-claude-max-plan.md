# Implementation Plan: Multi-Agent Meeting Orchestration (Claude Max)

This plan describes how to build a meeting orchestration system using **Claude Code native features** that work with your **Claude Max subscription** - no API keys required.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Component Summary](#2-component-summary)
3. [Phase 1: Agent Personas](#phase-1-agent-personas)
4. [Phase 2: Meeting Orchestration Skill](#phase-2-meeting-orchestration-skill)
5. [Phase 3: Python CLI Wrapper](#phase-3-python-cli-wrapper)
6. [Phase 4: Live Monitoring with Hooks](#phase-4-live-monitoring-with-hooks)
7. [Phase 5: Documentation Generation](#phase-5-documentation-generation)
8. [File Structure](#file-structure)
9. [Usage Examples](#usage-examples)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  Meeting Orchestration System (Claude Max)               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────┐     ┌────────────────┐     ┌────────────────────┐   │
│  │  Agent Personas │     │  Meeting Skill  │     │  Slash Commands   │   │
│  │  .claude/agents │────▶│  .claude/skills │────▶│  .claude/commands │   │
│  └────────────────┘     └────────────────┘     └────────────────────┘   │
│          │                      │                        │               │
│          ▼                      ▼                        ▼               │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                     Python Orchestrator                          │    │
│  │    • Invokes `claude -p` with agent system prompts               │    │
│  │    • Chains sessions with --resume                               │    │
│  │    • Parses stream-json output                                   │    │
│  │    • Triggers hooks for monitoring                               │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│          │                      │                        │               │
│          ▼                      ▼                        ▼               │
│  ┌────────────────┐     ┌────────────────┐     ┌────────────────────┐   │
│  │     Hooks      │     │  Transcript    │     │  Doc Generator     │   │
│  │ (PreToolUse/   │     │  Recorder      │     │  (Markdown/JSON)   │   │
│  │  PostToolUse)  │     │  (Python)      │     │                    │   │
│  └────────────────┘     └────────────────┘     └────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Approach

Instead of using the Claude SDK with API keys, we:

1. **Define agent personas** as Claude Code agents (`.claude/agents/*.md`)
2. **Create a meeting skill** that orchestrates multi-agent discussions
3. **Use Python scripts** to invoke `claude -p` with session chaining
4. **Configure hooks** for real-time monitoring and logging
5. **Generate documentation** from captured transcripts

---

## 2. Component Summary

| Component | Claude Code Feature | Purpose |
|-----------|---------------------|---------|
| Agent Personas | `.claude/agents/*.md` | Define specialized AI personalities |
| Meeting Skill | `.claude/skills/meeting/` | Orchestration instructions + templates |
| Slash Commands | `.claude/commands/*.md` | Quick meeting actions (`/meeting`, `/summarize`) |
| Hooks | `.claude/settings.json` | Real-time logging and monitoring |
| Python Scripts | `claude -p` subprocess | Session management and automation |
| MCP Server | Local stdio server | Custom meeting tools (optional) |

---

## Phase 1: Agent Personas

Create agent definitions that mirror BMAD's approach.

### 1.1 Directory Structure

```
.claude/
└── agents/
    ├── analyst.md
    ├── architect.md
    ├── pm.md
    ├── developer.md
    ├── scrum-master.md
    └── meeting-facilitator.md
```

### 1.2 Agent Template

```markdown
---
name: architect
description: System architect for technical design discussions. Use for architecture decisions, technology choices, and system design.
tools: Read,Grep,Glob,Bash
model: sonnet
---

# Winston - System Architect

You are **Winston**, a senior system architect with 15+ years of experience in distributed systems, cloud architecture, and technical leadership.

## Your Identity

- **Name:** Winston
- **Icon:** 🏗️
- **Role:** System Architect
- **Expertise:** Distributed systems, cloud infrastructure, API design, scalability

## Communication Style

You are methodical and visual. You:
- Use diagrams and analogies to explain complex concepts
- Always consider scalability and maintainability
- Document decisions with clear rationale
- Ask probing questions before proposing solutions

## Guiding Principles

- Scalability over premature optimization
- Document decisions with Architecture Decision Records (ADRs)
- Consider operational complexity, not just development speed
- Prefer proven patterns over novel approaches
- Always have a migration path

## Response Format

When responding in meetings:
1. Acknowledge the topic/question
2. Share your architectural perspective
3. Highlight trade-offs and risks
4. Propose concrete next steps

Always sign responses with: `🏗️ **Winston (Architect)**`
```

### 1.3 All Agent Definitions

Create these agent files:

**`.claude/agents/analyst.md`**
```markdown
---
name: analyst
description: Business analyst for requirements gathering and stakeholder analysis. Use for requirements, user stories, and business logic.
tools: Read,Grep,Glob
model: sonnet
---

# Mary - Business Analyst

You are **Mary**, a senior business analyst specializing in requirements engineering and stakeholder management.

## Your Identity
- **Name:** Mary
- **Icon:** 📊
- **Role:** Business Analyst
- **Expertise:** Requirements gathering, user stories, process mapping, stakeholder analysis

## Communication Style
You are detail-oriented and empathetic. You:
- Ask clarifying questions to uncover hidden requirements
- Translate technical concepts for non-technical stakeholders
- Document assumptions explicitly
- Focus on user outcomes, not just features

## Guiding Principles
- Requirements should trace to business value
- Ambiguity is the enemy - clarify early
- Users know their problems, not always the solutions
- Document the "why" behind every requirement

Always sign responses with: `📊 **Mary (Analyst)**`
```

**`.claude/agents/pm.md`**
```markdown
---
name: pm
description: Product manager for prioritization, roadmap, and stakeholder alignment. Use for product decisions and planning.
tools: Read,Grep,Glob
model: sonnet
---

# John - Product Manager

You are **John**, a seasoned product manager with expertise in agile methodologies and product strategy.

## Your Identity
- **Name:** John
- **Icon:** 📋
- **Role:** Product Manager
- **Expertise:** Product strategy, prioritization, roadmaps, stakeholder management

## Communication Style
You are decisive and outcome-focused. You:
- Frame discussions around user value and business impact
- Make trade-off decisions explicit
- Keep discussions focused on priorities
- Balance short-term wins with long-term vision

## Guiding Principles
- User value over feature count
- Data-informed decisions, not data-driven paralysis
- Ship early, iterate often
- Every feature has an opportunity cost

Always sign responses with: `📋 **John (PM)**`
```

**`.claude/agents/developer.md`**
```markdown
---
name: developer
description: Senior developer for implementation details, code quality, and technical feasibility. Use for coding discussions.
tools: Read,Write,Edit,Bash,Grep,Glob
model: sonnet
---

# Amelia - Senior Developer

You are **Amelia**, a senior full-stack developer with deep expertise in modern web technologies.

## Your Identity
- **Name:** Amelia
- **Icon:** 💻
- **Role:** Senior Developer
- **Expertise:** Full-stack development, code quality, testing, CI/CD

## Communication Style
You are pragmatic and direct. You:
- Speak in concrete code examples
- Highlight implementation challenges early
- Advocate for code quality and testing
- Prefer simple solutions over clever ones

## Guiding Principles
- Write tests first (red-green-refactor)
- Code is read more than written - optimize for clarity
- Technical debt is real debt - track it
- The best code is code you don't have to write

Always sign responses with: `💻 **Amelia (Developer)**`
```

**`.claude/agents/scrum-master.md`**
```markdown
---
name: scrum-master
description: Scrum master for facilitation, process improvement, and team dynamics. Use for retrospectives and process discussions.
tools: Read,Grep,Glob
model: sonnet
---

# Bob - Scrum Master

You are **Bob**, an experienced scrum master and agile coach focused on team effectiveness.

## Your Identity
- **Name:** Bob
- **Icon:** 🏃
- **Role:** Scrum Master
- **Expertise:** Agile methodologies, facilitation, team dynamics, process improvement

## Communication Style
You are facilitative and supportive. You:
- Ask open-ended questions to draw out perspectives
- Ensure everyone has a voice in discussions
- Focus on process improvement, not blame
- Celebrate wins and learn from failures

## Guiding Principles
- The team owns the process
- Impediments must be surfaced and addressed
- Retrospectives are sacred - protect them
- Sustainable pace over heroics

Always sign responses with: `🏃 **Bob (Scrum Master)**`
```

**`.claude/agents/meeting-facilitator.md`**
```markdown
---
name: meeting-facilitator
description: Meeting facilitator and orchestrator. Use to coordinate multi-agent discussions and synthesize outcomes.
tools: Read,Write,Grep,Glob
model: sonnet
---

# BMad - Meeting Facilitator

You are **BMad**, the meeting facilitator responsible for orchestrating productive multi-agent discussions.

## Your Role

You coordinate discussions between specialized agents, ensuring:
- Each agent contributes their unique perspective
- Discussions stay focused on the agenda
- Decisions and action items are captured
- All voices are heard

## Facilitation Protocol

1. **Open** - State the topic and invite initial perspectives
2. **Explore** - Draw out different viewpoints, encourage cross-talk
3. **Synthesize** - Summarize points of agreement and disagreement
4. **Decide** - Drive toward decisions or next steps
5. **Close** - Recap decisions and action items

## Response Format

When facilitating:
- Address agents by name when inviting input
- Acknowledge contributions before moving on
- Highlight areas of agreement and tension
- Keep discussions moving toward outcomes

Always sign responses with: `🎯 **BMad (Facilitator)**`
```

---

## Phase 2: Meeting Orchestration Skill

Create a skill that Claude can use to run meetings.

### 2.1 Skill Structure

```
.claude/
└── skills/
    └── meeting-orchestration/
        ├── SKILL.md
        ├── agents-roster.md
        ├── meeting-template.md
        └── output-format.md
```

### 2.2 Main Skill Definition

**`.claude/skills/meeting-orchestration/SKILL.md`**
```markdown
---
name: meeting-orchestration
description: Orchestrates multi-agent meeting discussions with specialized AI personas. Use when user wants to run a meeting, discussion, or collaborative session.
allowed-tools: Read,Write,Grep,Glob,Bash
---

# Meeting Orchestration Skill

You facilitate multi-agent meetings where specialized AI personas discuss topics, make decisions, and generate documentation.

## How This Works

1. You act as the **Meeting Facilitator (BMad)**
2. You invoke other agent personas by speaking as them
3. Each agent has a unique perspective defined in @agents-roster.md
4. You guide the discussion through phases
5. You capture decisions and action items
6. You generate meeting documentation at the end

## Meeting Phases

### Phase 1: Opening
- State the meeting topic
- Introduce relevant agents (2-3 per topic)
- Set the agenda

### Phase 2: Discussion
- Invite each agent to share their perspective
- Use format: `🎭 **[Agent Name] ([Role]):** [Their input]`
- Enable cross-talk: agents can agree, disagree, or build on ideas
- Ask the user for input at key decision points

### Phase 3: Synthesis
- Summarize areas of agreement
- Highlight unresolved tensions
- Propose decisions

### Phase 4: Decisions & Actions
- Document key decisions made
- Assign action items with owners
- Note open questions for follow-up

### Phase 5: Documentation
- Generate meeting summary in @output-format.md format
- Save to specified output location

## Agent Selection

Choose 2-3 agents per topic based on relevance:

| Topic Type | Primary Agent | Secondary Agents |
|------------|---------------|------------------|
| Requirements | Analyst | PM, Architect |
| Architecture | Architect | Developer, PM |
| Implementation | Developer | Architect, Scrum Master |
| Process | Scrum Master | PM, Developer |
| Planning | PM | Analyst, Architect |

## Cross-Talk Patterns

Agents should naturally interact:
- "Building on what [Agent] said..."
- "I see it differently - from my perspective..."
- "That's a great point, [Agent]. How would we handle..."
- "[Agent], what do you think about this trade-off?"

## User Participation

The user participates as **Project Lead**. At key points:
- Ask for their input on decisions
- Validate assumptions with them
- Get approval before finalizing

## Output Requirements

After the meeting, always:
1. Generate a summary document
2. List all decisions made
3. List action items with owners
4. Note any open questions
```

### 2.3 Agents Roster Reference

**`.claude/skills/meeting-orchestration/agents-roster.md`**
```markdown
# Available Meeting Agents

## Core Team

| Agent | Name | Icon | Expertise |
|-------|------|------|-----------|
| Analyst | Mary | 📊 | Requirements, user stories, stakeholder analysis |
| Architect | Winston | 🏗️ | System design, technology choices, scalability |
| PM | John | 📋 | Product strategy, prioritization, roadmaps |
| Developer | Amelia | 💻 | Implementation, code quality, testing |
| Scrum Master | Bob | 🏃 | Process, facilitation, team dynamics |

## Agent Personalities Summary

**Mary (Analyst):** Detail-oriented, asks clarifying questions, focuses on user outcomes.

**Winston (Architect):** Methodical, uses diagrams/analogies, considers scalability.

**John (PM):** Decisive, outcome-focused, balances short/long-term.

**Amelia (Developer):** Pragmatic, speaks in code examples, advocates for quality.

**Bob (Scrum Master):** Facilitative, ensures all voices heard, focuses on process.

## Invoking Agents

Use this format for agent responses:

```
🏗️ **Winston (Architect):** [Winston's perspective in his voice]

📊 **Mary (Analyst):** [Mary's perspective in her voice]
```

Always maintain character consistency with the full agent definitions in `.claude/agents/`.
```

### 2.4 Output Format Template

**`.claude/skills/meeting-orchestration/output-format.md`**
```markdown
# Meeting Output Format

## File Naming
`meeting-{topic-slug}-{YYYY-MM-DD}.md`

## Template

```markdown
# Meeting: {Topic}

**Date:** {Date}
**Participants:** {List of agents + user}
**Facilitator:** BMad

---

## Executive Summary

{2-3 sentence summary of the meeting and key outcomes}

---

## Discussion Summary

### Topic 1: {Subtopic}
{Summary of discussion points and perspectives}

### Topic 2: {Subtopic}
{Summary of discussion points and perspectives}

---

## Decisions Made

| # | Decision | Rationale | Owner |
|---|----------|-----------|-------|
| 1 | {Decision} | {Why} | {Who} |
| 2 | {Decision} | {Why} | {Who} |

---

## Action Items

- [ ] {Action item} - **Owner:** {Name} - **Due:** {Date}
- [ ] {Action item} - **Owner:** {Name} - **Due:** {Date}

---

## Open Questions

1. {Question that needs follow-up}
2. {Question that needs follow-up}

---

## Next Steps

{What happens next, when to reconvene if needed}

---

*Meeting facilitated by BMad Meeting Orchestrator*
*Generated: {Timestamp}*
```
```

---

## Phase 3: Python CLI Wrapper

Python scripts that orchestrate Claude Code CLI calls.

### 3.1 Core Orchestrator

**`scripts/meeting_orchestrator.py`**
```python
#!/usr/bin/env python3
"""
Meeting Orchestrator - Runs multi-agent meetings via Claude Code CLI.
Works with Claude Max subscription (no API keys required).
"""

import subprocess
import json
import sys
from pathlib import Path
from datetime import datetime
from dataclasses import dataclass, field
from typing import Optional, Iterator
import argparse

@dataclass
class AgentResponse:
    agent: str
    content: str
    timestamp: datetime = field(default_factory=datetime.now)

@dataclass
class MeetingSession:
    topic: str
    session_id: Optional[str] = None
    responses: list[AgentResponse] = field(default_factory=list)
    decisions: list[str] = field(default_factory=list)
    action_items: list[str] = field(default_factory=list)
    start_time: datetime = field(default_factory=datetime.now)

class ClaudeRunner:
    """Runs Claude Code CLI commands with session management."""

    def __init__(self, working_dir: Path = None):
        self.working_dir = working_dir or Path.cwd()
        self.current_session: Optional[str] = None

    def run(
        self,
        prompt: str,
        system_prompt: str = None,
        resume: str = None,
        allowed_tools: list[str] = None,
        stream: bool = False
    ) -> dict:
        """Run Claude CLI and return result."""

        cmd = ["claude", "-p", prompt]

        if stream:
            cmd.extend(["--output-format", "stream-json"])
        else:
            cmd.extend(["--output-format", "json"])

        if system_prompt:
            cmd.extend(["--append-system-prompt", system_prompt])

        if resume:
            cmd.extend(["--resume", resume])
        elif self.current_session:
            cmd.extend(["--resume", self.current_session])

        if allowed_tools:
            cmd.extend(["--allowedTools", ",".join(allowed_tools)])

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=self.working_dir
        )

        if result.returncode != 0:
            return {"error": result.stderr, "is_error": True}

        try:
            data = json.loads(result.stdout)
            if data.get("session_id"):
                self.current_session = data["session_id"]
            return data
        except json.JSONDecodeError:
            return {"result": result.stdout, "is_error": False}

    def stream(self, prompt: str, **kwargs) -> Iterator[dict]:
        """Stream Claude CLI output line by line."""

        cmd = ["claude", "-p", prompt, "--output-format", "stream-json"]

        if kwargs.get("system_prompt"):
            cmd.extend(["--append-system-prompt", kwargs["system_prompt"]])

        if kwargs.get("resume") or self.current_session:
            cmd.extend(["--resume", kwargs.get("resume") or self.current_session])

        if kwargs.get("allowed_tools"):
            cmd.extend(["--allowedTools", ",".join(kwargs["allowed_tools"])])

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=self.working_dir
        )

        for line in process.stdout:
            if line.strip():
                try:
                    data = json.loads(line)
                    # Capture session ID from stream
                    if data.get("session_id"):
                        self.current_session = data["session_id"]
                    yield data
                except json.JSONDecodeError:
                    yield {"type": "raw", "content": line}

        process.wait()


class MeetingOrchestrator:
    """Orchestrates multi-agent meeting discussions."""

    def __init__(self, topic: str, output_dir: Path = None):
        self.topic = topic
        self.output_dir = output_dir or Path("./meeting_outputs")
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.runner = ClaudeRunner()
        self.session = MeetingSession(topic=topic)
        self.transcript: list[str] = []

    def log(self, message: str):
        """Log message to console and transcript."""
        print(message)
        self.transcript.append(f"[{datetime.now().strftime('%H:%M:%S')}] {message}")

    def run_meeting(self):
        """Execute the full meeting workflow."""

        self.log(f"\n{'='*60}")
        self.log(f"Starting Meeting: {self.topic}")
        self.log(f"{'='*60}\n")

        # Phase 1: Opening
        self.log("Phase 1: Opening the meeting...")
        opening = self._run_phase(
            f"""You are facilitating a meeting about: {self.topic}

Using the meeting-orchestration skill, open this meeting:
1. Introduce the topic
2. Select 2-3 relevant agents from the roster
3. Set the agenda
4. Invite the first agent to share their perspective

Format agent responses as: 🎭 **[Name] ([Role]):** [Their input]"""
        )
        self.log(f"\n{opening}\n")

        # Phase 2: Discussion rounds
        for round_num in range(1, 4):
            self.log(f"\nPhase 2.{round_num}: Discussion round {round_num}...")

            discussion = self._run_phase(
                f"""Continue the meeting discussion (round {round_num}/3).

Have the agents:
- Build on previous points
- Offer different perspectives
- Identify areas of agreement and disagreement
- Ask each other clarifying questions

End this round with a question for the user (Project Lead)."""
            )
            self.log(f"\n{discussion}\n")

            # Get user input
            user_input = input("\n[Your response as Project Lead]: ").strip()
            if user_input.lower() in ['exit', 'quit', 'done']:
                break

            # Continue with user input
            self._run_phase(f"The Project Lead responds: {user_input}")

        # Phase 3: Synthesis
        self.log("\nPhase 3: Synthesizing discussion...")
        synthesis = self._run_phase(
            """Synthesize the meeting discussion:
1. Summarize key points from each agent
2. Highlight areas of agreement
3. Note any unresolved tensions
4. Propose decisions to make"""
        )
        self.log(f"\n{synthesis}\n")

        # Phase 4: Decisions
        self.log("\nPhase 4: Finalizing decisions and action items...")
        decisions = self._run_phase(
            """Finalize the meeting:
1. List all decisions made (get user confirmation)
2. Assign action items with owners
3. Note open questions for follow-up
4. Summarize next steps"""
        )
        self.log(f"\n{decisions}\n")

        # Phase 5: Generate documentation
        self.log("\nPhase 5: Generating meeting documentation...")
        self._generate_documentation()

        self.log(f"\n{'='*60}")
        self.log(f"Meeting Complete: {self.topic}")
        self.log(f"Duration: {(datetime.now() - self.session.start_time).total_seconds():.1f}s")
        self.log(f"{'='*60}\n")

    def _run_phase(self, prompt: str) -> str:
        """Run a meeting phase and capture response."""

        result = self.runner.run(
            prompt=prompt,
            allowed_tools=["Read", "Grep", "Glob"],
        )

        if result.get("is_error"):
            return f"Error: {result.get('error', 'Unknown error')}"

        response_text = result.get("result", "")
        self.session.responses.append(AgentResponse(
            agent="Meeting",
            content=response_text
        ))

        # Store session ID
        if result.get("session_id"):
            self.session.session_id = result["session_id"]

        return response_text

    def _generate_documentation(self):
        """Generate meeting summary document."""

        # Ask Claude to generate the summary
        summary = self._run_phase(
            f"""Generate a complete meeting summary document following the format in @output-format.md.

Include:
- Executive summary
- Discussion summary by topic
- All decisions made
- Action items with owners
- Open questions
- Next steps

Topic: {self.topic}"""
        )

        # Save to file
        slug = self.topic.lower().replace(" ", "-")[:30]
        date_str = datetime.now().strftime("%Y-%m-%d")
        filename = f"meeting-{slug}-{date_str}.md"

        output_path = self.output_dir / filename
        output_path.write_text(summary)
        self.log(f"\nSaved meeting summary to: {output_path}")

        # Also save raw transcript
        transcript_path = self.output_dir / f"transcript-{slug}-{date_str}.txt"
        transcript_path.write_text("\n".join(self.transcript))
        self.log(f"Saved transcript to: {transcript_path}")

        # Save JSON for programmatic access
        json_path = self.output_dir / f"meeting-{slug}-{date_str}.json"
        json_data = {
            "topic": self.topic,
            "session_id": self.session.session_id,
            "start_time": self.session.start_time.isoformat(),
            "end_time": datetime.now().isoformat(),
            "responses": [
                {
                    "agent": r.agent,
                    "content": r.content,
                    "timestamp": r.timestamp.isoformat()
                }
                for r in self.session.responses
            ]
        }
        json_path.write_text(json.dumps(json_data, indent=2))
        self.log(f"Saved JSON data to: {json_path}")


def main():
    parser = argparse.ArgumentParser(description="Run a multi-agent meeting")
    parser.add_argument("topic", help="Meeting topic")
    parser.add_argument("--output", "-o", default="./meeting_outputs", help="Output directory")
    args = parser.parse_args()

    orchestrator = MeetingOrchestrator(
        topic=args.topic,
        output_dir=Path(args.output)
    )
    orchestrator.run_meeting()


if __name__ == "__main__":
    main()
```

### 3.2 Live Stream Monitor

**`scripts/stream_monitor.py`**
```python
#!/usr/bin/env python3
"""
Stream Monitor - Real-time display of Claude Code output.
"""

import subprocess
import json
import sys
from datetime import datetime

try:
    from rich.console import Console
    from rich.live import Live
    from rich.panel import Panel
    from rich.text import Text
    RICH_AVAILABLE = True
except ImportError:
    RICH_AVAILABLE = False
    print("Note: Install 'rich' for better display: pip install rich")


def stream_meeting(prompt: str):
    """Stream a meeting session with live display."""

    cmd = [
        "claude", "-p", prompt,
        "--output-format", "stream-json",
        "--allowedTools", "Read,Grep,Glob"
    ]

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )

    current_text = ""

    if RICH_AVAILABLE:
        console = Console()
        with Live(Panel("Starting meeting...", title="Meeting"), refresh_per_second=4) as live:
            for line in process.stdout:
                if line.strip():
                    try:
                        data = json.loads(line)

                        # Handle different message types
                        if data.get("type") == "content_block_delta":
                            delta = data.get("delta", {})
                            if delta.get("type") == "text_delta":
                                current_text += delta.get("text", "")
                                live.update(Panel(
                                    Text(current_text[-2000:]),  # Last 2000 chars
                                    title="Meeting in Progress"
                                ))

                        elif data.get("type") == "result":
                            live.update(Panel(
                                data.get("result", "Complete"),
                                title="Meeting Complete"
                            ))

                    except json.JSONDecodeError:
                        pass
    else:
        # Simple fallback without rich
        for line in process.stdout:
            if line.strip():
                try:
                    data = json.loads(line)
                    if data.get("type") == "content_block_delta":
                        delta = data.get("delta", {})
                        if delta.get("type") == "text_delta":
                            print(delta.get("text", ""), end="", flush=True)
                except json.JSONDecodeError:
                    pass

    process.wait()


if __name__ == "__main__":
    topic = " ".join(sys.argv[1:]) or "Project Planning Discussion"
    prompt = f"""Run a meeting about: {topic}

Using the meeting-orchestration skill, facilitate a full meeting with multiple agent perspectives."""

    stream_meeting(prompt)
```

---

## Phase 4: Live Monitoring with Hooks

Configure hooks for automatic logging and monitoring.

### 4.1 Hook Configuration

Add to `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "python scripts/hooks/log_tool_use.py pre"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "python scripts/hooks/log_tool_use.py post"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "python scripts/hooks/session_complete.py"
          }
        ]
      }
    ]
  }
}
```

### 4.2 Tool Logging Hook

**`scripts/hooks/log_tool_use.py`**
```python
#!/usr/bin/env python3
"""Hook script to log tool usage."""

import json
import sys
from datetime import datetime
from pathlib import Path

LOG_FILE = Path.home() / ".claude" / "meeting_tool_log.jsonl"

def main():
    phase = sys.argv[1] if len(sys.argv) > 1 else "unknown"

    # Read hook input from stdin
    try:
        input_data = json.load(sys.stdin)
    except:
        input_data = {}

    log_entry = {
        "timestamp": datetime.now().isoformat(),
        "phase": phase,
        "tool": input_data.get("tool_name", "unknown"),
        "input": input_data.get("tool_input", {}),
    }

    # Append to log file
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG_FILE, "a") as f:
        f.write(json.dumps(log_entry) + "\n")

    # Allow operation to proceed
    sys.exit(0)

if __name__ == "__main__":
    main()
```

### 4.3 Session Complete Hook

**`scripts/hooks/session_complete.py`**
```python
#!/usr/bin/env python3
"""Hook script called when Claude session completes."""

import json
import sys
from datetime import datetime
from pathlib import Path

def main():
    # Read session data from stdin
    try:
        session_data = json.load(sys.stdin)
    except:
        session_data = {}

    # Log session completion
    log_entry = {
        "timestamp": datetime.now().isoformat(),
        "event": "session_complete",
        "session_id": session_data.get("session_id"),
        "duration_ms": session_data.get("duration_ms"),
        "num_turns": session_data.get("num_turns")
    }

    log_file = Path.home() / ".claude" / "session_log.jsonl"
    log_file.parent.mkdir(parents=True, exist_ok=True)

    with open(log_file, "a") as f:
        f.write(json.dumps(log_entry) + "\n")

    print(f"Session complete: {session_data.get('session_id', 'unknown')}")
    sys.exit(0)

if __name__ == "__main__":
    main()
```

---

## Phase 5: Documentation Generation

### 5.1 Slash Command for Quick Summary

**`.claude/commands/meeting-summary.md`**
```markdown
---
description: Generate a meeting summary from the current session
allowed-tools: Read,Write,Grep
---

# Generate Meeting Summary

Based on our discussion, generate a comprehensive meeting summary.

## Required Sections

1. **Executive Summary** - 2-3 sentences capturing key outcomes
2. **Discussion Points** - Main topics covered with different perspectives
3. **Decisions Made** - Table with decision, rationale, and owner
4. **Action Items** - Checklist with owner and due date
5. **Open Questions** - Items needing follow-up
6. **Next Steps** - What happens next

## Output Location

Save the summary to: `./meeting_outputs/summary-{date}.md`

## Format

Use Markdown with clear headings and formatting.
```

### 5.2 Post-Meeting Report Generator

**`scripts/generate_report.py`**
```python
#!/usr/bin/env python3
"""Generate formatted reports from meeting transcripts."""

import json
import sys
from pathlib import Path
from datetime import datetime

def generate_markdown_report(json_path: Path) -> str:
    """Generate Markdown from meeting JSON."""

    with open(json_path) as f:
        data = json.load(f)

    md_lines = [
        f"# Meeting Report: {data['topic']}",
        "",
        f"**Date:** {data['start_time'][:10]}",
        f"**Session ID:** {data.get('session_id', 'N/A')}",
        "",
        "---",
        "",
        "## Transcript",
        ""
    ]

    for response in data.get("responses", []):
        md_lines.extend([
            f"### {response['timestamp'][:19]}",
            "",
            response["content"],
            "",
            "---",
            ""
        ])

    md_lines.extend([
        "",
        f"*Generated: {datetime.now().isoformat()}*"
    ])

    return "\n".join(md_lines)


def main():
    if len(sys.argv) < 2:
        print("Usage: python generate_report.py <meeting.json>")
        sys.exit(1)

    json_path = Path(sys.argv[1])
    if not json_path.exists():
        print(f"File not found: {json_path}")
        sys.exit(1)

    report = generate_markdown_report(json_path)

    output_path = json_path.with_suffix(".md")
    output_path.write_text(report)
    print(f"Generated: {output_path}")


if __name__ == "__main__":
    main()
```

---

## File Structure

Complete project structure:

```
your-project/
├── .claude/
│   ├── agents/                    # Agent personas
│   │   ├── analyst.md
│   │   ├── architect.md
│   │   ├── pm.md
│   │   ├── developer.md
│   │   ├── scrum-master.md
│   │   └── meeting-facilitator.md
│   │
│   ├── skills/                    # Skills
│   │   └── meeting-orchestration/
│   │       ├── SKILL.md
│   │       ├── agents-roster.md
│   │       ├── meeting-template.md
│   │       └── output-format.md
│   │
│   ├── commands/                  # Slash commands
│   │   ├── meeting.md             # /meeting - start a meeting
│   │   ├── meeting-summary.md     # /meeting-summary - generate summary
│   │   └── agents-list.md         # /agents-list - show available agents
│   │
│   └── settings.json              # Hooks configuration
│
├── scripts/
│   ├── meeting_orchestrator.py    # Main orchestrator
│   ├── stream_monitor.py          # Live streaming display
│   ├── generate_report.py         # Report generator
│   │
│   └── hooks/                     # Hook scripts
│       ├── log_tool_use.py
│       └── session_complete.py
│
├── meeting_outputs/               # Generated outputs
│   ├── meeting-*.md
│   ├── meeting-*.json
│   └── transcript-*.txt
│
└── README.md
```

---

## Usage Examples

### Interactive Meeting (Claude Code)

```bash
# Start Claude Code
claude

# Run a meeting using the skill
> Let's have a meeting about building a new authentication system

# Or use slash command
> /meeting authentication system redesign
```

### Scripted Meeting (Python)

```bash
# Run full orchestrated meeting
python scripts/meeting_orchestrator.py "API Redesign Discussion"

# With custom output directory
python scripts/meeting_orchestrator.py "Sprint Planning" -o ./sprint_outputs
```

### Live Streaming

```bash
# Watch meeting in real-time with rich display
python scripts/stream_monitor.py "Architecture Review"
```

### Resume Previous Meeting

```bash
# Continue a previous meeting session
claude --resume "550e8400-e29b-41d4-a716-446655440000" \
  -p "Let's continue our discussion from earlier"
```

### Quick Summary Generation

```bash
# In Claude Code interactive mode
/meeting-summary

# Generate report from JSON
python scripts/generate_report.py meeting_outputs/meeting-api-redesign-2024-01-15.json
```

---

## Summary

This implementation uses **only Claude Max subscription features**:

| Feature | How We Use It |
|---------|---------------|
| Custom Agents | Agent personas in `.claude/agents/` |
| Skills | Meeting orchestration in `.claude/skills/` |
| Slash Commands | Quick actions like `/meeting`, `/meeting-summary` |
| Hooks | Real-time logging in `.claude/settings.json` |
| CLI `-p` Mode | Python scripts calling `claude -p` |
| Session Resume | `--resume` for conversation continuity |
| Stream JSON | Real-time output monitoring |

**No API keys required** - everything runs through Claude Code with your Claude Max subscription.
