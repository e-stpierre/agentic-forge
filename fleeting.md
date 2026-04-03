Here are the key questions and considerations for a Python →  
 TypeScript/Node migration:  
 ---  
 Architecture & Design Decisions

1. Package manager: pnpm, npm, or yarn? You already use pnpm for
   linting — stick with pnpm for consistency? 2. Build system: What replaces hatchling? Options: tsup, unbuild, or plain tsc. Need to bundle non-code assets (YAML workflows, markdown skills/agents/prompts, Jinja2 templates). 3. CLI framework: argparse → what? Popular choices: commander, yargs, clipanion, or oclif. You have ~12 subcommands with flags/args. 4. Template engine: Jinja2 → nunjucks (closest Jinja2 port for Node), handlebars, or eta? Your templates use Jinja2 syntax (.md.j2 files) — nunjucks would minimize rewrite. 5. YAML parsing: pyyaml → js-yaml (straightforward 1:1). 6. File locking: filelock → proper-lockfile or lockfile. Used for progress.json concurrency.  
   Concurrency Model

2. Async model: Python uses ThreadPoolExecutor for parallel
   steps and subprocess calls. Node's native async I/O and
   child_process are quite different. Do you want to lean into
   Node's event loop, or use worker threads?
3. Signal handling: signal_manager.py handles SIGINT/SIGTERM for
   graceful shutdown. Node has different signal behavior on
   Windows — needs careful testing.

Bundling & Distribution

9. Package data strategy: Python bundles
   skills/workflows/agents/prompts via wheel package data,
   discovered at runtime via Path(**file**).parent. In Node, you'd
   use \_\_dirname or import.meta.url, but need to ensure assets are
   included in the npm package (files field in package.json).
10. Entry point: agentic-forge CLI binary — in Node this is a  
    bin field in package.json. Global install via npm i -g or npx.
11. Distribution: PyPI → npm. The uv tool install workflow  
    becomes npm i -g agentic-forge.

Code Migration Complexity

12. Dataclasses → TypeScript types/interfaces: parser.py uses  
    Python dataclasses and enums extensively for WorkflowDefinition,
    StepDefinition, StepType, etc. These map cleanly to TS
    interfaces + string union types.
13. Subprocess management: runner.py spawns claude CLI with  
    stream-json output parsing. Node's child_process.spawn is  
    similar but stream handling differs. This is the most critical  
    module to get right.
14. Git worktree management: worktree.py shells out to git —  
    straightforward to port, but test cross-platform behavior.
15. Two-tier execution: You have both WorkflowExecutor (sync)  
    and WorkflowOrchestrator (async with Claude decisions). In Node
    everything is naturally async — this might simplify or
    complicate things depending on how you look at it.

Testing

16. Test framework: pytest → vitest, jest, or Node's built-in  
    test runner? You have ~12 test files with fixtures and mocking.
17. CI matrix: Currently tests on Python 3.12 + 3.14, ubuntu +  
    windows. Node equivalent: test on Node 20 + 22 (LTS versions),  
    same OS matrix.

Migration Strategy

18. Big bang or incremental? Options:

- Big bang: Rewrite everything at once in a new branch
- Incremental: Keep Python working while porting module by  
  module (hard with a CLI)
- Parallel: Maintain both for a transition period

19. Non-code assets: Skills (.md), agents (.md), workflows  
    (.yaml), templates (.md.j2), and prompts (.md) are
    language-agnostic — they transfer as-is. This is a big chunk of
    the repo.
20. What about the update command? Currently does uv tool  
    upgrade. Needs to become npm update -g or similar.

Risk Areas

- Windows compatibility: Python's subprocess and path handling  
  is mature cross-platform. Node on Windows has quirks (shell  
  escaping, signal handling, path separators).
- Stream-json parsing: The runner.py streaming output parser is
  non-trivial — needs careful porting.
- Jinja2 template compatibility: If you switch engines, all .j2
  templates may need syntax updates.

1. pnpm
2. tsc + copy script
3. commander
4. nunjucks
5. js-yaml
6. proper-lockfile
7. Worker thread
