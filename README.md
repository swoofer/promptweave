# promptweave

**YAML composer for assembling agent prompts, hooks, and MCP configs from reusable behaviors.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@swoofer/promptweave.svg)](https://www.npmjs.com/package/@swoofer/promptweave)
[![Tests](https://github.com/swoofer/promptweave/actions/workflows/test.yml/badge.svg)](https://github.com/swoofer/promptweave/actions)

---

## What it does

You write small YAML behaviors (one rule each: "wait for upstream agent", "announce target files before writing", "use read-only mode"). You declare a preset (a list of behaviors), and `promptweave` assembles them into:

- a **prompt** (sections sorted by number, deduped, composed)
- **hook scripts** (per lifecycle: SessionStart, PreToolUse, etc.)
- a **`.mcp.json`** with declared MCP tools
- **environment variables** for the agent's runtime

The same behavior catalog can target Claude Code, Cursor, Aider, or any agent framework that consumes prompts + hooks + MCP configs.

---

## Architecture

```
                         ┌─────────────┐
                         │  Agent YAML │
                         │  or Preset  │
                         └──────┬──────┘
                                │
                 ┌──────────────▼──────────────┐
                 │     promptweave engine      │
                 │                             │
                 │  1. Resolve   preset → list │
                 │  2. Validate  requires/etc. │
                 │  3. Compose   rules apply   │
                 │  4. Assemble  sections sort │
                 │  5. Warn      collisions    │
                 │                             │
                 └──────────────┬──────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
        prompt.md         hooks/*.sh         .mcp.json
```

Each step is a discrete pass over the in-memory registry. The engine is deterministic — same inputs produce identical outputs, so generated prompts/hooks are diffable in version control.

---

## Quick start

```bash
npm install -g @swoofer/promptweave
promptweave list behaviors                     # 4 generic behaviors ship bundled
promptweave list presets                        # 2 demo presets: dev, inspect
promptweave build inspect --dry-run             # preview a preset
promptweave build inspect                       # write to ./.claude/promptweave/
promptweave build inspect --root ./my-prompts   # use your own behaviors/presets/compositions/
```

---

## What ships bundled

promptweave is a generic engine. The 4 bundled behaviors are demo-grade — `project-context`, `read-only-mode`, `shared-workspace`, `worktree-isolation`. Real-world catalogs live in YOUR project (pass via `--root`) or in companion packages.

For example, the multi-agent coordination behaviors (announce-before-write, conflict-resolution, work-stealing phases, etc.) live in [essaim](https://github.com/swoofer/essaim) *(coming soon)* and pair with [mcp-coordinator](https://github.com/swoofer/mcp-coordinator) at runtime.

---

## Behavior format

A behavior is one YAML file declaring a name, category, and one or more **sections** keyed by a 3-digit number. The number drives ordering when multiple behaviors are composed.

```yaml
name: read-only-mode
description: Agent cannot modify files — analysis and communication only
category: safety
sections:
  "090-safety-readonly":
    prompt: |
      ## Constraint
      You are in read-only mode. Do not modify files. Analyze, communicate, report.
```

A behavior can also declare hooks, MCP tools, environment variables, and parameters — see `behaviors/*.yaml` in this repo for working examples.

---

## Recommended layer convention

When you compose multiple behaviors, the section number determines where each contribution lands in the assembled prompt. The convention below keeps prompts readable and avoids accidental collisions across behaviors:

```
 LAYER          SECTIONS    RESPONSIBILITY
 ─────────────────────────────────────────────────────
 Foundation     000–009     Identity, project context
 Patterns       010–029     How the agent collaborates
 Mission        030–050     What the agent actually does
 Transversal    050–099     Constraints and style overlays
```

Every behavior contributes one or more sections under one of these ranges. The assembler sorts numerically, so two `Foundation` behaviors land before any `Mission` section regardless of file order. Keep section numbers stable — they are part of your behavior's public contract once another preset starts composing it.

---

## Preset format

A preset is a named list of behaviors. The engine resolves it to a flat list (deduplicating shared dependencies), runs validation, applies composition rules, and assembles the final output.

```yaml
name: inspect
description: Read-only project inspection in an isolated worktree
profile: codeur
behaviors:
  - project-context
  - worktree-isolation
  - read-only-mode
```

Presets can override behavior parameters via `params`:

```yaml
name: inspect-auth
behaviors:
  - project-context
  - read-only-mode
params:
  project-context:
    modules: ["src/auth", "src/api"]
```

---

## Composition rules

A composition rule **adapts behaviors when certain combinations appear together** — without forcing every behavior to know about every other. The engine evaluates each rule against the resolved behavior list and applies its mutation declaratively.

Typical patterns:

| Pattern | Example trigger | Action |
|---|---|---|
| Section override | `announce-before-write` + `read-only-mode` are both in the preset | Rewrite section 020 to say *"before your analysis"* instead of *"before modifying"* |
| Section injection | `sequential-wait` + `announce-before-write` both present | Inject a glue section: *"wait for predecessor → announce → code"* |
| Behavior strip | A scalar parameter (e.g., `solo_mode = true`) flips on a coordinator-rules behavior | Disable announce / conflict-resolution behaviors entirely |

Rules live in `compositions/` and have a clear declarative shape: a `when` clause (predicate over the resolved list) and an `apply` clause (mutation). See bundled `compositions/` for examples and the engine's `src/compose.ts` for the contract.

---

## Phases

A behavior can declare an optional `phase`, which the engine surfaces in the assembled output for downstream consumers (orchestrators, schedulers, etc.) to act on. Phases are how a single preset describes a multi-stage workflow without hard-coding stage transitions in prompts.

```yaml
name: phase-discover
phase:
  name: discover          # phase identifier
  tools_mode: read_only   # read_only | full | none
  loop: false             # true → repeat until pool drained
```

A preset that mixes phased behaviors with non-phased ones produces a multi-phase workflow. The engine sorts phased contributions per phase, applies composition rules per phase, and emits the resulting bundle. Whether and how to **execute** the phases is the consumer's concern — promptweave only describes the workflow.

```
 PHASE             TOOLS       LOOP    DESCRIPTION
 ─────────────────────────────────────────────────────
 discover          read_only   no      Read-only scan; produce findings
 review            none        no      Compare findings; deduplicate
 execute           full        yes     Iterate over a shared work pool
 (custom)          configurable        Defined per behavior
 (no phase)        full        no      One-shot mode (backward-compat)
```

A preset with no phased behaviors degrades to the simple one-shot mode: a single bundle is emitted with no phase metadata.

---

## CLI reference

| Command | Description |
| --- | --- |
| `promptweave list behaviors [--category C] [--root PATH]` | List behaviors in the registry |
| `promptweave list presets [--root PATH]` | List presets |
| `promptweave list compositions [--root PATH]` | List composition rules |
| `promptweave build <preset> [--root PATH] [--dry-run] [--output DIR] [--set k=v]` | Assemble a preset into output files |
| `promptweave validate <file.yaml>` | Validate a single YAML file |
| `promptweave validate --all [--root PATH]` | Validate the entire registry |

`--set k=v` overrides a behavior parameter at build time without modifying the preset (e.g., `--set project-context.modules='["src/auth"]'`).

---

## Programmatic API

```ts
import { Registry, runPipeline } from "@swoofer/promptweave";

const registry = Registry.load("./my-prompts");
const result = runPipeline(
  { name: "agent-x", preset: "inspect" },
  "./my-prompts",
  {},
);
console.log(result.output.prompt);
console.log(result.output.hooks);
console.log(result.output.mcpConfig);
```

The pipeline is a pure function over the registry plus an agent identifier — easy to wrap in a CI step that re-renders all your agent bundles on each commit.

---

## Use cases

- **Agent profiles in YAML.** Define agent-style profiles for Claude Code subagents in YAML, version-controlled with the codebase. Re-render on every preset/behavior change.
- **Cross-vendor catalogs.** Build the prompts/hooks/MCP-config bundle for Cursor, Cline, or Aider with a shared catalog of behaviors. The engine doesn't care which client consumes the output.
- **CI consistency enforcement.** Run `promptweave build` in CI to catch drift — generated prompts diff against the previous render, so behavior changes are reviewable like any code change.
- **Multi-agent runtime catalogs.** Pair with a coordination runtime (e.g., [mcp-coordinator](https://github.com/swoofer/mcp-coordinator)) so generated agents announce their work and resolve conflicts at runtime.

---

## Related projects

- **[mcp-coordinator](https://github.com/swoofer/mcp-coordinator)** — embedded MQTT broker + MCP server for multi-agent coordination. Pairs with `promptweave`-built agents that announce their work over MQTT.
- **[essaim](https://github.com/swoofer/essaim)** *(coming soon)* — end-to-end orchestrator that spawns N coordinated Claude Code agents using `promptweave` + `mcp-coordinator`. Ships the curated behavior catalog (announce-before-write, work-stealing phases, etc.) that the engine here only demonstrates with 4 minimal behaviors.

---

## License

MIT
