# promptweave

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@swoofer/promptweave.svg)](https://www.npmjs.com/package/@swoofer/promptweave)
[![Tests](https://github.com/swoofer/promptweave/actions/workflows/test.yml/badge.svg)](https://github.com/swoofer/promptweave/actions)

YAML composer that assembles agent prompts, hooks, MCP configs, and Anthropic-standard `SKILL.md` files from small reusable behaviors. Vendor-agnostic (Claude Code, Cursor, Aider, any framework that consumes prompts + hooks + MCP). Deterministic output: same inputs produce byte-identical files, so generated artifacts are diffable in version control.

## Table of Contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Concepts in one minute](#concepts-in-one-minute)
- [Behavior format](#behavior-format)
- [Preset format](#preset-format)
- [Composition rules](#composition-rules)
- [Phases and profiles](#phases-and-profiles)
- [Hook lifecycle](#hook-lifecycle)
- [CLI reference](#cli-reference)
- [Programmatic API](#programmatic-api)
- [What ships bundled](#what-ships-bundled)
- [Recommended layer convention](#recommended-layer-convention)
- [Use cases](#use-cases)
- [Related projects](#related-projects)
- [Support](#support)
- [License](#license)

## What it does

You write small YAML behaviors (one rule each: *"work in an isolated worktree"*, *"read-only mode"*, *"announce target files before writing"*). You declare a **preset** (a list of behaviors), and `promptweave` assembles them into one of two output formats:

**`--target bundle`** (default) writes a complete agent runtime to `.claude/promptweave/<preset>/`:

```
.claude/promptweave/inspect/
  prompt.md          # composed prompt, sections sorted by number
  hooks/
    session-start.sh
    session-stop.sh
  .mcp.json          # MCP server declarations
  env                # environment variables
```

**`--target skill`** writes a single Anthropic-standard skill to `.claude/skills/<preset>/SKILL.md`:

```markdown
---
name: inspect
description: Read-only project inspection in an isolated worktree
---

## Contexte du projet
- Langage: typescript
- ...

## Workspace
You are working in an isolated git worktree...

## Parameters
| Name | Type | Default | Description |
| --- | --- | --- | --- |
| language | string | typescript | Project language |
```

Same behavior catalog, two consumable shapes.

## Quick start

```bash
npm install -g @swoofer/promptweave           # requires Node 20+

promptweave list behaviors                     # 4 generic behaviors ship bundled
promptweave list presets                       # 2 demo presets: dev, inspect
promptweave build inspect --dry-run            # preview a preset (bundle)
promptweave build inspect                      # write bundle to ./.claude/promptweave/
promptweave build inspect --target skill       # write SKILL.md to ./.claude/skills/inspect/
promptweave build inspect --root ./my-prompts  # use your own behaviors/ presets/ compositions/
promptweave validate --all                     # lint the whole registry
```

## Concepts in one minute

- **Behavior** — one YAML file, one rule. Prompt sections + optional hooks, MCP tools, params, conflicts, dependencies. Atomic and reusable.
- **Preset** — a named list of behaviors plus optional param overrides. The unit you `build`.
- **Composition rule** — declarative *"if these behaviors meet, mutate the assembly"*. Lives in `compositions/`. Behaviors stay independent yet adapt in combination.
- **Phase** — optional behavior tag (`name`, `tools_mode`, `loop`) turning a preset into a multi-stage workflow. The engine emits one assembled bundle per phase; consumers decide how to execute them.
- **Target** — output shape: `bundle` (prompt + hooks + MCP + env) or `skill` (single `SKILL.md`).

The pipeline is a pure deterministic function:

```
   ┌─────────────┐    ┌──────────────────────────────────────────────────────┐    ┌──────────┐
   │ Agent or    │ -> │  Registry.load                                       │ -> │ bundle   │
   │ Preset YAML │    │   -> resolveBehaviors  (preset -> flat list, dedup)  │    │   or     │
   └─────────────┘    │   -> resolveParams     (defaults < preset < --set)   │    │ SKILL.md │
                      │   -> validateBehaviors (requires/conflicts)          │    └──────────┘
                      │   -> applyCompositionRules                           │
                      │   -> assemble          (sections / hooks / mcp / env)│
                      │   -> generateWarnings                                │
                      │   -> render            (target = bundle | skill)     │
                      └──────────────────────────────────────────────────────┘
```

## Behavior format

A behavior is one YAML file. Section keys must match the pattern `NNN-name` (three digits + dash + slug). The number drives ordering when several behaviors compose.

```yaml
name: read-only-mode
description: Agent cannot modify files — analysis and communication only
category: safety              # workspace | coordination | mission | safety | tone

# Dependencies and conflicts (optional)
requires:
  behaviors: []               # other behaviors that must be present
  infrastructure: []          # named runtime requirements (e.g., "mqtt-broker")
conflicts_with: []            # mutually exclusive with these behaviors
suggests: []                  # advisory companions

# Typed parameters (optional, with defaults and required flag)
params:
  scope:
    type: string              # string | number | boolean | string[] | number[]
    default: "all"
    required: false
    description: "Scope of the read-only constraint"

# Prompt sections — keys are NNN-name and sort numerically
sections:
  "090-safety-readonly":
    prompt: |
      ## Constraint
      You are in read-only mode. Do not modify files.
      Analyze, communicate, report. Do not write code.

# Hooks (optional) — see Hook lifecycle below
hooks:
  session-start:
    script: setup_readonly.sh
    args: []
    blocking: true            # block session start until script exits 0
    order: 10                 # ordering when multiple behaviors register the same lifecycle

# MCP tools the agent should be granted (optional)
mcp_tools: []

# Phase tag (optional) — turns this behavior into a phase contributor
phase:
  name: discover
  tools_mode: read_only       # read_only | full | none
  loop: false

# Phase scope filter (optional) — only include this behavior in matching phases
applies_when:
  phase_tools_mode: [read_only]
```

## Preset format

A preset is a named list of behaviors plus optional parameter overrides. The engine resolves it to a flat deduplicated list, runs validation, applies composition rules, and assembles the output.

```yaml
name: inspect
description: Read-only project inspection in an isolated worktree
profile: codeur               # codeur | communicant — affects prompt tone defaults
behaviors:
  - project-context
  - worktree-isolation
  - read-only-mode

# Override behavior parameters at preset level
params:
  project-context:
    language: typescript
    test_command: npm test
    modules: ["src/auth", "src/api"]
```

Parameter precedence (lowest to highest): behavior `default` < preset `params` < agent `params` < CLI `--set`.

## Composition rules

A composition rule **adapts behaviors when certain combinations meet** — without forcing every behavior to know about every other. Rules live in `compositions/*.yaml`.

```yaml
name: readonly-rephrases-announce
description: When read-only mode meets announce-before-write, rephrase the announce
priority: 10                      # higher priority runs later (last write wins)

when:                             # at least one of `all` or `any` is required
  all: [announce-before-write, read-only-mode]
  any: []
  none: []
  params_match: {}                # optional: match against resolved params

actions:
  override_sections:               # rewrite an existing section
    - behavior: announce-before-write
      section: "020-before-coding"
      prompt: |
        ## Before your analysis
        Announce the files you intend to inspect before reading them.
  inject_sections:                 # add a new bridging section
    "015-bridge":
      prompt: "Glue between phases: wait → announce → analyze."
  override_params:                 # set params on a behavior
    - behavior: announce-before-write
      params: { mode: passive }
  disable_behaviors: []            # remove behaviors entirely
```

Rules run in priority order over the resolved behavior list. Each application is recorded in `result.compositionRulesApplied` and surfaced by `--dry-run`.

## Phases and profiles

A behavior with a `phase` tag turns the preset into a multi-stage workflow. Phased and non-phased behaviors can mix; the engine sorts and assembles per phase.

| Phase | Tools | Loop | Typical use |
| --- | --- | --- | --- |
| `discover` | `read_only` | no | One-shot scan; produce findings |
| `review` | `none` | no | Compare findings; deduplicate |
| `execute` | `full` | yes | Iterate over a shared work pool |
| (custom) | configurable | configurable | Defined per behavior |
| (no phase) | `full` | no | One-shot mode (backward compatible) |

Profiles (`codeur`, `communicant`) are passed through to consumers as an `AgentContext` field — useful for tone or default-tool selection downstream.

## Hook lifecycle

Behaviors can register shell scripts on four lifecycle points. The engine concatenates scripts from every behavior contributing to the same point, ordered by `hooks.<point>.order` (ascending).

| Lifecycle point | Fires | Typical use |
| --- | --- | --- |
| `session-start` | Before the agent gets its first input | Create worktree, fetch context, set env |
| `pre-tool-use` | Before each tool invocation | Permission gating, dry-run, audit log |
| `post-tool-use` | After each tool invocation | Lint, test runner, telemetry |
| `session-stop` | Agent session ends | Commit changes, archive logs, cleanup |

A hook block can declare `script`, `args`, `blocking` (does the agent wait for exit code 0), and `order`. Only the **bundle** target emits hook scripts; the **skill** target drops hooks with an explicit warning.

## CLI reference

| Command | Description |
| --- | --- |
| `promptweave list behaviors [--category C] [--root PATH]` | List behaviors in the registry |
| `promptweave list presets [--root PATH]` | List presets |
| `promptweave list compositions [--root PATH]` | List composition rules |
| `promptweave build <preset> [flags]` | Assemble a preset into output files |
| `promptweave validate <file.yaml>` | Validate one YAML file |
| `promptweave validate --all [--root PATH]` | Validate the entire registry |

`build` flags:

| Flag | Default | Effect |
| --- | --- | --- |
| `--target <bundle\|skill>` | `bundle` | Output shape |
| `--output <dir>` | `.claude/promptweave/` (bundle) or `.claude/skills/` (skill) | Destination directory |
| `--root <path>` | bundled | Use behaviors/presets/compositions from this directory |
| `--dry-run` | — | Print resolution + composition + assembled output to stdout, write nothing |
| `--set k=v` | — | Override a behavior parameter at build time, repeatable. Example: `--set project-context.modules='["src/auth"]'` |

The output directory is destroyed and rewritten on each non-dry-run build (atomic backup-swap on bundle and skill renderers). Manual edits in the output are lost — YAML is the source of truth.

## Programmatic API

```ts
import { Registry, runPipeline } from "@swoofer/promptweave";

const result = runPipeline(
  { name: "agent-x", preset: "inspect" },
  "./my-prompts",
  { "project-context": { modules: ["src/auth"] } }, // launch params
);

result.output.prompt;     // assembled prompt (one-shot mode)
result.output.phases;     // PhasePrompt[] — empty if no phase declared
result.output.hooks;      // { "session-start": "#!/bin/sh\n...", ... }
result.output.mcpTools;   // string[]
result.output.envVars;    // Record<string, string>
result.compositionRulesApplied;
result.warnings;
```

A pure function over the registry plus an agent identifier — easy to wrap in a CI step that re-renders all your agent bundles on each commit.

## What ships bundled

The 4 bundled behaviors are demo-grade. Real catalogs live in **your** project (pass `--root`) or in companion packages.

**Behaviors:**

- `project-context` — project identity (language, test command, modules) injected at section 000
- `read-only-mode` — agent cannot modify files, analysis only (section 090)
- `worktree-isolation` — isolated git worktree, with `session-start` and `session-stop` hooks
- `shared-workspace` — shared directory, conflicts with `worktree-isolation`

**Presets:**

- `dev` — solo development session in an isolated worktree
- `inspect` — read-only project inspection in an isolated worktree

## Recommended layer convention

When several behaviors compose, the section number determines where each contribution lands. The convention below keeps prompts readable and avoids accidental collisions across behaviors.

| Layer | Sections | Responsibility |
| --- | --- | --- |
| Foundation | 000–009 | Identity, project context |
| Patterns | 010–029 | How the agent collaborates |
| Mission | 030–049 | What the agent actually does |
| Transversal | 050–099 | Constraints, safety, style overlays |

The assembler sorts numerically, so two `Foundation` sections always land before any `Mission` section regardless of file order. Section numbers are part of a behavior's public contract once a preset starts composing it.

## Use cases

- **Agent profiles in YAML** — version-control Claude Code subagent profiles alongside the codebase; re-render on every change.
- **Cross-vendor catalogs** — build prompts/hooks/MCP-config bundles for Cursor, Cline, or Aider from a shared catalog.
- **CI consistency enforcement** — run `promptweave build` in CI to diff generated prompts; behavior changes become reviewable like code.
- **Skill catalog maintenance** — extract recurring instruction patterns into reusable behaviors; regenerate `SKILL.md` reproducibly; propagate a fix across every skill in one edit.
- **Multi-agent runtime catalogs** — pair with a coordination runtime so generated agents announce their work and resolve conflicts at runtime.

## Related projects

- **[mcp-coordinator](https://github.com/swoofer/mcp-coordinator)** — embedded MQTT broker + MCP server for multi-agent coordination. Pairs with `promptweave`-built agents that announce their work over MQTT.
- **[essaim](https://github.com/swoofer/essaim)** — end-to-end orchestrator that spawns N coordinated Claude Code agents using `promptweave` + `mcp-coordinator`. Ships the curated coordination behavior catalog (announce-before-write, work-stealing phases, etc.) that the engine here only demonstrates with 4 minimal behaviors.

## Support

Solo maintainer. If this project saves you time, consider supporting development:

- [GitHub Sponsors](https://github.com/sponsors/swoofer)
- [Buy Me A Coffee](https://buymeacoffee.com/swoofer)

A star on the repo also helps surface the project to other developers.

## License

MIT
