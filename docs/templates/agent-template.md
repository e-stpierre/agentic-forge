<!--
AGENT PROMPT TEMPLATE

This template defines the exact structure for Claude Code agent prompts.

REQUIRED FRONTMATTER FIELDS:
- name: Kebab-case identifier for the agent
- description: One-line description of agent's domain expertise (recommended: under 100 characters)
- tools: Array of tool names the agent can access (e.g., [Read, Write, Bash, Glob, Grep])
- model: Model to use (must be one of: sonnet, opus, haiku)
- color: Display color for the agent in UI

REQUIRED SECTIONS:
- Purpose
- Methodology
- Tools Available
- Capabilities
- Knowledge Base
- Output Guidance
-->

---

name: {{agent-name}}
description: {{agent-description}}
tools: [{{tool1}}, {{tool2}}, {{tool3}}]
model: {{model-choice}}
color: {{color-name}}

---

# {{agent_title}}

## Purpose

{{purpose}}

<!--
Instructions:
- Replace {{purpose}} with a concise statement of the agent's role
- Define the agent's domain expertise and primary function
- Explain what problems this agent solves
- Clarify when this agent should be invoked
-->

## Methodology

{{methodology}}

<!--
Instructions:
- Replace {{methodology}} with the approach and framework the agent follows
- Sub-sections (### headings) are allowed for complex methodologies (e.g., "### Initial Assessment", "### Deep Analysis")
- Suggested elements (include others as needed):
  - Analysis techniques and decision-making processes
  - How the agent breaks down complex problems
  - Quality standards and verification methods
  - Step-by-step workflow approach
-->

## Tools Available

{{tools}}

<!--
Instructions:
- Replace {{tools}} with description of each tool and how the agent uses it
- Format: **Tool Name**: How the agent uses this tool in its workflow
- Include guidance on tool selection and sequencing
- Explain when to use each tool
- Suggested elements (include others as needed):
  - Tool-specific usage patterns
  - Tool combinations and workflows
  - Tool limitations within agent's domain
-->

## Capabilities

{{capabilities}}

<!--
Instructions:
- Replace {{capabilities}} with specific tasks and operations the agent can perform
- List concrete capabilities as bullet points
- Define scope boundaries (what the agent can and cannot do)
- Note any limitations or prerequisites
- Suggested elements (include others as needed):
  - Primary capabilities (core functions)
  - Secondary capabilities (supporting functions)
  - Edge cases or limitations
  - Integration points with other systems
-->

## Knowledge Base

{{knowledge}}

<!--
Instructions:
- Replace {{knowledge}} with domain knowledge and expertise the agent possesses
- Suggested elements (include others as needed):
  - Technical domains and frameworks
  - Best practices and standards it follows
  - Reference materials it draws upon
  - Specialized terminology or concepts
  - Industry standards or conventions
-->

## Output Guidance

{{output}}

<!--
Instructions:
- Replace {{output}} with expected outputs and deliverables
- Suggested elements (include others as needed):
  - Output formats and structure
  - Required content and detail level
  - How results should be presented to the user
  - Error reporting and edge case handling
  - Follow-up actions or recommendations
-->
