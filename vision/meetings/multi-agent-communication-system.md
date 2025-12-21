# Multi-Agent Communication System Analysis

This document provides a technical analysis of how BMAD Method enables agents to communicate with each other in a "meeting room" environment (Party Mode) and how conversation outputs are recorded.

---

## Overview

BMAD's multi-agent communication is implemented through **Party Mode**, a workflow-based orchestration system that simulates a collaborative meeting environment where specialized AI agents can discuss, debate, and build on each other's ideas. The system is prompt-driven rather than code-driven - there is no runtime multi-process architecture. Instead, a single LLM session role-plays multiple agent personas using a centralized manifest of agent personalities.

---

## Architecture Components

### 1. Agent Manifest System

**Location:** `_bmad/_config/agent-manifest.csv` (generated at install time)

**Generator:** `tools/cli/lib/agent-party-generator.js`

The agent manifest is an XML document generated during installation that contains merged personality data for all installed agents:

```xml
<manifest id="bmad/_config/agent-manifest.csv" version="1.0">
  <agent id="bmad/bmm/agents/pm.md" name="John" title="Product Manager" icon="📋">
    <persona>
      <role>Product lifecycle management...</role>
      <identity>Senior PM with agile expertise...</identity>
      <communication_style>Clear, stakeholder-focused...</communication_style>
      <principles>User value over feature count...</principles>
    </persona>
  </agent>
  <!-- Additional agents... -->
</manifest>
```

**Key attributes per agent:**
- `name` - Display name (e.g., "John", "Winston", "Amelia")
- `title` - Formal role (e.g., "Product Manager", "Architect")
- `icon` - Visual emoji identifier
- `role` - Capabilities summary
- `identity` - Background and expertise
- `communicationStyle` - How they express themselves
- `principles` - Decision-making philosophy
- `module` - Source module (bmm, cis, core, custom)

### 2. Party Mode Workflow

**Location:** `src/core/workflows/party-mode/`

```
party-mode/
├── workflow.md                      # Main workflow definition
└── steps/
    ├── step-01-agent-loading.md     # Load manifest, initialize session
    ├── step-02-discussion-orchestration.md  # Manage conversation
    └── step-03-graceful-exit.md     # Agent farewells, session close
```

### 3. Team Configurations

**Location:** `src/modules/*/teams/`

Teams define agent groupings for specific domains:

```yaml
# team-fullstack.yaml
bundle:
  name: Team Plan and Architect
  icon: 🚀
  description: Team capable of project analysis, design, and architecture.
agents:
  - analyst
  - architect
  - pm
  - sm
  - ux-designer
party: "./default-party.csv"
```

---

## How Multi-Agent Conversations Work

### Phase 1: Session Initialization

1. **Trigger:** User invokes `*party-mode` or `/bmad:core:workflows:party-mode`

2. **Manifest Loading:** The workflow loads `_bmad/_config/agent-manifest.csv` and parses all agent entries with complete personality data

3. **Welcome Message:**
```
🎉 PARTY MODE ACTIVATED! 🎉

Welcome {{user_name}}! All BMAD agents are here and ready for a dynamic
group discussion. I've brought together our complete team of experts...
```

4. **State Tracking:** Frontmatter tracks session state:
```yaml
---
stepsCompleted: [1]
workflowType: 'party-mode'
user_name: '{{user_name}}'
agents_loaded: true
party_active: true
exit_triggers: ['*exit', 'goodbye', 'end party', 'quit']
---
```

### Phase 2: Discussion Orchestration

**Intelligent Agent Selection** (per user message):

1. **Domain Analysis:** Analyze user's message for expertise requirements
2. **Agent Matching:** Select 2-3 most relevant agents based on:
   - Primary Agent: Best expertise match for core topic
   - Secondary Agent: Complementary perspective
   - Tertiary Agent: Cross-domain insight or devil's advocate

**Priority Rules:**
- If user names a specific agent → prioritize that agent + 1-2 complementary agents
- Rotate participation to ensure diverse perspectives over time

**Response Generation Protocol:**

Each selected agent responds in character:

```
[Icon Emoji] **[Agent Name]**: [Authentic in-character response]

[Bash: .claude/hooks/bmad-speak.sh "[Agent Name]" "[Their response]"]
```

**Cross-Talk Patterns:**

Agents can reference each other naturally:
- "As [Another Agent] mentioned..."
- "[Another Agent] makes a great point about..."
- "I see it differently than [Another Agent]..."
- Follow-up questions between agents

**Question Handling:**

| Question Type | Behavior |
|--------------|----------|
| Direct to User | End round, wait for user input |
| Inter-Agent | Allow natural back-and-forth within same round |
| Rhetorical | Continue without pausing flow |

### Phase 3: Session Conclusion

**Exit Triggers:** `*exit`, `goodbye`, `end party`, `quit`

**Graceful Exit Sequence:**
1. Acknowledgment of session conclusion
2. 2-3 selected agents give in-character farewells
3. Session highlights summary
4. Final positive closure message
5. Frontmatter updated: `party_active: false`, `workflow_completed: true`

---

## Conversation Output Recording

Party Mode itself is an interactive session that does not automatically persist conversation content. However, outputs are captured through specific workflows that use Party Mode protocol:

### 1. Retrospective Workflow (Primary Output Mechanism)

**Location:** `src/modules/bmm/workflows/4-implementation/retrospective/`

The retrospective workflow uses Party Mode dialogue format but adds document generation:

**Dialogue Format:**
```
Bob (Scrum Master): "Let's begin the retrospective..."
Alice (Product Owner): "The authentication flow exceeded expectations."
Charlie (Senior Dev): "The caching strategy cut API calls by 60%."
{user_name} (Project Lead): [User responds]
```

**Output Configuration:**
```yaml
config_source: "{project-root}/_bmad/bmm/config.yaml"
output_folder: "{config_source}:output_folder"
retrospectives_folder: "{sprint_artifacts}"
```

**Generated Document Structure:**

Output file: `{retrospectives_folder}/epic-{{epic_number}}-retro-{date}.md`

Contents:
- Epic summary and metrics (stories completed, velocity)
- Quality/technical metrics (blockers, technical debt, test coverage)
- Business outcomes (goals achieved, stakeholder feedback)
- Key insights and lessons learned
- Action items with owners and deadlines
- Next epic preparation tasks
- Critical path items
- Significant discovery alerts

**Status Tracking:**

Updates `sprint-status.yaml`:
```yaml
epic-{{epic_number}}-retrospective: done
```

### 2. Brainstorming Workflow

**Location:** `src/core/workflows/brainstorming/`

Uses 62 brainstorming techniques from `brain-methods.csv` with multi-agent facilitation. The Brainstorming Coach (Carson) guides sessions through:
- Session setup and technique selection
- Execution with collaborative patterns
- Idea organization and synthesis

---

## Agent Roster

**19+ agents available across modules:**

### BMM Module (12 agents)
| Agent | Name | Role |
|-------|------|------|
| PM | John | Product Manager |
| Analyst | Mary | Business Analyst |
| Architect | Winston | System Architect |
| SM | Bob | Scrum Master |
| DEV | Amelia | Developer |
| TEA | Murat | Test Architect |
| UX Designer | Sally | UX Specialist |
| Tech Writer | Paige | Documentation |
| Quick Flow Dev | Barry | Solo Full-Stack |
| Game Designer | - | Game Design |
| Game Dev | - | Game Development |
| Game Architect | - | Game Architecture |

### CIS Module (Creative Intelligence Suite)
| Agent | Name | Role |
|-------|------|------|
| Brainstorming Coach | Carson | Innovation Facilitator |
| Creative Problem Solver | Dr. Quinn | Solutions Architect |
| Design Thinking Coach | Maya | Human-Centered Design |
| Innovation Strategist | Victor | Business Model Innovation |
| Storyteller | Sophia | Narrative Expert |
| Presentation Master | Spike | Visual Communication |

### Core Module
| Agent | Role |
|-------|------|
| BMad Master | Orchestrator/Facilitator |

---

## Technical Implementation Details

### Agent Definition Schema

Agents are defined in YAML files (`.agent.yaml`):

```yaml
agent:
  metadata:
    id: "_bmad/bmm/agents/dev.md"
    name: Amelia
    title: Developer Agent
    icon: 💻
    module: bmm

  persona:
    role: Senior Software Engineer
    identity: Executes approved stories with strict adherence...
    communication_style: "Ultra-succinct. Speaks in file paths..."
    principles: |
      - The Story File is the single source of truth
      - Follow red-green-refactor cycle

  menu:
    - trigger: dev-story
      workflow: "{project-root}/_bmad/bmm/workflows/..."
```

### Agent Customization

Users can customize agents via override files:

**Location:** `_bmad/_config/agents/[module]-[agent].customize.yaml`

```yaml
agent:
  persona:
    principles:
      - 'HIPAA compliance is non-negotiable'
      - 'Patient safety over feature velocity'
```

After creating customization, run `npx bmad-method install` to rebuild agents with merged personalities.

### TTS Integration

Party mode includes optional Text-to-Speech:

```bash
.claude/hooks/bmad-speak.sh "[Agent Name]" "[Their response]"
```

Triggered after each agent's text response for voice synthesis.

---

## Key Design Principles

1. **Prompt-Driven Orchestration:** No multi-process runtime - single LLM session role-plays multiple personas using manifest data

2. **Character Consistency:** Each agent maintains strict adherence to their documented communication style, principles, and expertise domain

3. **Intelligent Selection:** 2-3 agents selected per topic based on expertise matching, with rotation for inclusive discussion

4. **Natural Discourse:** Agents can agree, disagree, build on each other's points, and ask follow-up questions

5. **User Participation:** User participates as "Project Lead" in the dialogue, not as a passive observer

6. **Moderation:** BMad Master can summarize and redirect if discussion becomes circular

7. **Output via Workflows:** Raw party mode conversations aren't persisted; structured workflows like retrospective generate documented outputs

---

## Use Cases

| Scenario | Recommended Approach |
|----------|---------------------|
| Multi-perspective decisions | Party Mode |
| Post-mortems and retrospectives | Retrospective workflow (uses Party Mode protocol) |
| Creative brainstorming | Party Mode + Brainstorming workflow |
| Sprint planning | Party Mode |
| Complex problem-solving | Party Mode with relevant agents |
| Simple implementation questions | Single agent (DEV) |
| Document review | Single agent (Tech Writer) |

---

## File Reference

| Component | Path |
|-----------|------|
| Party Mode Workflow | `src/core/workflows/party-mode/workflow.md` |
| Agent Loading Step | `src/core/workflows/party-mode/steps/step-01-agent-loading.md` |
| Discussion Orchestration | `src/core/workflows/party-mode/steps/step-02-discussion-orchestration.md` |
| Graceful Exit | `src/core/workflows/party-mode/steps/step-03-graceful-exit.md` |
| Agent Manifest Generator | `tools/cli/lib/agent-party-generator.js` |
| Retrospective Workflow | `src/modules/bmm/workflows/4-implementation/retrospective/` |
| Retrospective Instructions | `src/modules/bmm/workflows/4-implementation/retrospective/instructions.md` |
| Team Configurations | `src/modules/*/teams/team-*.yaml` |
| Party Documentation | `src/modules/bmm/docs/party-mode.md` |
| Brainstorming Techniques | `src/core/workflows/brainstorming/brain-methods.csv` |

---

## Summary

BMAD's multi-agent communication system is a sophisticated prompt engineering solution that enables collaborative AI agent discussions without complex runtime orchestration. The key innovation is using a centralized agent manifest with complete personality data, enabling a single LLM to consistently role-play multiple expert personas in a natural conversation flow. Output persistence is handled through structured workflows (primarily retrospective) that capture the value of multi-agent deliberation in documented artifacts.
