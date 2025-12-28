# Agentic Core Use Cases

## Use Case Examples

### Use Case 1: One-Shot Bugfix

```
User: agentic one-shot "Fix issue #1234" --git --pr

┌─────────────────────────────────────────────────────────────┐
│                     ONE-SHOT WORKFLOW                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Create git branch: fix/issue-1234                        │
│          │                                                   │
│          ▼                                                   │
│  2. Load relevant memories (past similar bugs)               │
│          │                                                   │
│          ▼                                                   │
│  3. Invoke developer agent (Claude)                          │
│     - Analyze issue                                          │
│     - Make code changes                                      │
│     - Write tests                                            │
│          │                                                   │
│          ▼                                                   │
│  4. Commit changes                                           │
│          │                                                   │
│          ▼                                                   │
│  5. Push and create PR                                       │
│          │                                                   │
│          ▼                                                   │
│  6. Extract learnings → store in memory                      │
│                                                              │
│  Duration: ~5 minutes                                        │
│  Agents: 1 (developer:claude)                                │
└─────────────────────────────────────────────────────────────┘
```

### Use Case 2: Meeting/Brainstorm

```
User: agentic meeting "API versioning strategy" \
        --agents architect:claude developer:cursor pm:claude

┌─────────────────────────────────────────────────────────────┐
│                     MEETING WORKFLOW                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Start Kafka message bus for agent communication          │
│          │                                                   │
│          ▼                                                   │
│  2. Initialize 3 independent AI sessions                     │
│     - Architect (Claude)                                     │
│     - Developer (Cursor)                                     │
│     - PM (Claude)                                            │
│          │                                                   │
│          ▼                                                   │
│  3. Facilitator orchestrates discussion (5 rounds)           │
│     ┌──────────────────────────────────────┐                │
│     │  Round N:                            │                │
│     │  - Facilitator selects speakers      │                │
│     │  - Each agent responds via Kafka     │                │
│     │  - All messages logged to Postgres   │                │
│     └──────────────────────────────────────┘                │
│          │                                                   │
│          ▼                                                   │
│  4. Generate meeting summary and decision record             │
│          │                                                   │
│          ▼                                                   │
│  5. Store decisions in long-term memory                      │
│                                                              │
│  Duration: ~15 minutes                                       │
│  Agents: 3 (mixed providers)                                 │
└─────────────────────────────────────────────────────────────┘
```

### Use Case 3: Feature Development

```
User: agentic run feature.yaml --var feature="Add OAuth login"

┌─────────────────────────────────────────────────────────────┐
│                   FEATURE WORKFLOW                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Step 1: PLAN (planner:claude)                               │
│  ├─ Create implementation plan                               │
│  ├─ Checkpoint saved                                         │
│  └─ Output: plan.md                                          │
│          │                                                   │
│          ▼                                                   │
│  Step 2: IMPLEMENT (developer:claude)                        │
│  ├─ Read plan, make code changes                             │
│  ├─ Commit incrementally                                     │
│  ├─ Checkpoint saved                                         │
│  └─ Output: code changes                                     │
│          │                                                   │
│          ▼                                                   │
│  Step 3: VALIDATE (tester:cursor)                            │
│  ├─ Review code, run tests                                   │
│  ├─ If fail → retry implement step                           │
│  └─ Output: validation report                                │
│          │                                                   │
│          ▼                                                   │
│  Output: Feature complete, PR ready                          │
│                                                              │
│  Duration: ~30 minutes                                       │
│  Agents: 3 (planner, developer, tester)                      │
└─────────────────────────────────────────────────────────────┘
```

### Use Case 4: Epic Development (Multi-Day)

```
User: agentic run epic.yaml \
        --var epic="User Authentication System" \
        --human-in-loop

┌─────────────────────────────────────────────────────────────┐
│                     EPIC WORKFLOW                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Phase 1: BRAINSTORM (Day 1, Hour 1)                         │
│  ├─ Meeting with architect, pm, developer                    │
│  ├─ [HUMAN APPROVAL REQUIRED]                                │
│  └─ Checkpoint: brainstorm complete                          │
│          │                                                   │
│          ▼                                                   │
│  Phase 2: DESIGN (Day 1, Hour 2)                             │
│  ├─ Architect creates technical design                       │
│  ├─ [HUMAN APPROVAL REQUIRED]                                │
│  └─ Checkpoint: design complete                              │
│          │                                                   │
│          ▼                                                   │
│  Phase 3: PLAN FEATURES (Day 1, Hour 3)                      │
│  ├─ PM breaks epic into 5 features                           │
│  └─ Checkpoint: features defined                             │
│          │                                                   │
│          ▼                                                   │
│  Phase 4: IMPLEMENT FEATURES (Day 1-2)                       │
│  ┌──────────────────────────────────────┐                   │
│  │  For each feature (sequential):      │                   │
│  │  ├─ Create branch from previous      │                   │
│  │  ├─ Run feature.yaml workflow        │                   │
│  │  ├─ Checkpoint after each feature    │                   │
│  │  └─ [Crash recovery possible]        │                   │
│  └──────────────────────────────────────┘                   │
│          │                                                   │
│          ▼                                                   │
│  Phase 5: INTEGRATION TEST (Day 2)                           │
│  ├─ Tester validates all features together                   │
│  └─ Output: Epic complete                                    │
│                                                              │
│  Duration: ~8 hours (spread over 2 days)                     │
│  Agents: 5+ (architect, pm, developer, tester, etc.)         │
│  Checkpoints: 10+ (full crash recovery)                      │
└─────────────────────────────────────────────────────────────┘
```

### Use Case 5: Security Analysis

```
User: agentic analysis "Auth module security review" \
        --agents security-researcher pentester appsec-developer \
        --inputs "src/auth/**" "docs/architecture.md" \
        --human-in-loop

┌─────────────────────────────────────────────────────────────┐
│                   ANALYSIS WORKFLOW                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Load inputs                                              │
│     ├─ Codebase: src/auth/**/*.ts (45 files)                │
│     ├─ Documentation: docs/architecture.md                  │
│     └─ External: OWASP Top 10 reference                     │
│          │                                                   │
│          ▼                                                   │
│  2. THREAT MODELING (security-researcher:claude)            │
│     ├─ Analyze attack surface                               │
│     ├─ Identify threat vectors                              │
│     └─ Checkpoint saved                                     │
│          │                                                   │
│          ▼                                                   │
│  3. VULNERABILITY SCAN (pentester:claude)                   │
│     ├─ Review code for vulnerabilities                      │
│     ├─ Map to CWE/CVE references                            │
│     └─ Output: vulnerability-report.md                      │
│          │                                                   │
│          ▼                                                   │
│  4. REMEDIATION PLAN (appsec-developer:cursor)              │
│     ├─ Create fix recommendations                           │
│     ├─ Prioritize by severity                               │
│     └─ Output: remediation-tasks.md                         │
│          │                                                   │
│          ▼                                                   │
│  5. REVIEW MEETING (all 3 agents)                           │
│     ├─ Discuss findings and priorities                      │
│     ├─ [HUMAN DECIDES FINAL PRIORITIES]                     │
│     └─ Output: security-report.md                           │
│                                                              │
│  Duration: ~20 minutes                                       │
│  Agents: 3 (security-researcher, pentester, appsec-dev)     │
│  Inputs: codebase + docs + external references              │
└─────────────────────────────────────────────────────────────┘
```

### Use Case 6: Pentest Planning

```
User: agentic run analysis.yaml \
        --var target_url="https://example.com" \
        --var scope_document="scope.md" \
        --human-in-loop

┌─────────────────────────────────────────────────────────────┐
│                  PENTEST PLANNING WORKFLOW                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Load scope and target information                        │
│     ├─ Target: https://example.com                          │
│     └─ Scope: Defined rules of engagement                   │
│          │                                                   │
│          ▼                                                   │
│  2. RECONNAISSANCE (security-researcher:claude)             │
│     ├─ Passive information gathering                        │
│     ├─ Technology stack identification                      │
│     ├─ Attack surface mapping                               │
│     └─ Output: recon-report.md                              │
│          │                                                   │
│          ▼                                                   │
│  3. ATTACK PLANNING (pentester:claude)                      │
│     ├─ Develop attack methodology                           │
│     ├─ Identify potential entry points                      │
│     ├─ Plan exploitation techniques                         │
│     └─ Output: attack-plan.md                               │
│          │                                                   │
│          ▼                                                   │
│  4. METHODOLOGY REVIEW (meeting: both agents)               │
│     ├─ Review and refine approach                           │
│     ├─ [HUMAN APPROVAL REQUIRED]                            │
│     └─ Output: pentest-plan.md                              │
│                                                              │
│  Duration: ~15 minutes                                       │
│  Agents: 2 (security-researcher, pentester)                 │
│  Output: Complete pentest methodology document              │
└─────────────────────────────────────────────────────────────┘
```
