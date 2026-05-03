# promptweave

**YAML composer for assembling agent prompts, hooks, and MCP configs from reusable behaviors.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@swoofer/promptweave.svg)](https://www.npmjs.com/package/promptweave)
[![Tests](https://github.com/swoofer/promptweave/actions/workflows/test.yml/badge.svg)](https://github.com/swoofer/promptweave/actions)

## What it does

You write small YAML behaviors (one rule each: "wait for upstream agent", "announce target files before writing", "use read-only mode"). You declare a preset (a list of behaviors), and `promptweave` assembles them into:

- a **prompt** (sections sorted by number, deduped, composed)
- **hook scripts** (per lifecycle: SessionStart, PreToolUse, etc.)
- a **`.mcp.json`** with declared MCP tools
- **environment variables** for the agent's runtime

The same behavior catalog can target Claude Code, Cursor, Aider, or any agent framework that consumes prompts + hooks + MCP configs.

## Quick start

```bash
npm install -g @swoofer/promptweave
promptweave list behaviors                     # 4 generic behaviors ship bundled
promptweave list presets                        # 2 demo presets: dev, inspect
promptweave build inspect --dry-run             # preview a preset
promptweave build inspect                       # write to ./.claude/promptweave/
promptweave build inspect --root ./my-prompts   # use your own behaviors/presets/compositions/
```

## What ships bundled

promptweave is a generic engine. The 4 bundled behaviors are demo-grade — `project-context`, `read-only-mode`, `shared-workspace`, `worktree-isolation`. Real-world catalogs live in YOUR project (pass via `--root`) or in companion packages (e.g., the multi-agent coordination behaviors live in [mcp-coordinator](https://github.com/swoofer/mcp-coordinator)).

## Behavior format

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

## Preset format

```yaml
name: inspect
description: Read-only project inspection in an isolated worktree
profile: codeur
behaviors:
  - project-context
  - worktree-isolation
  - read-only-mode
```

## Composition rules

Composition rules adapt assembly when certain behavior combinations appear together. See bundled `compositions/` for examples.

## CLI reference

| Command | Description |
| --- | --- |
| `promptweave list behaviors [--category C] [--root PATH]` | List behaviors |
| `promptweave list presets [--root PATH]` | List presets |
| `promptweave list compositions [--root PATH]` | List composition rules |
| `promptweave build <preset> [--root PATH] [--dry-run] [--output DIR] [--set k=v]` | Assemble a preset into output files |
| `promptweave validate <file.yaml>` | Validate a single YAML file |
| `promptweave validate --all [--root PATH]` | Validate the entire registry |

## Programmatic API

```ts
import { Registry, runPipeline } from "@swoofer/promptweave";

const registry = Registry.load("./my-prompts");
const result = runPipeline(
  { name: "agent-x", preset: "raid" },
  "./my-prompts",
  {},
);
console.log(result.output.prompt);
```

## Use cases

- Define agent-style profiles for Claude Code subagents in YAML, version-controlled with the codebase.
- Build the prompts/hooks/MCP-config bundle for Cursor, Cline, or Aider with a shared catalog of behaviors.
- Run the same behavior catalog through `promptweave build` in CI to enforce consistency across engineers.

## Related projects

- **[mcp-coordinator](https://github.com/swoofer/mcp-coordinator)** — embedded MQTT broker + MCP server for multi-agent coordination. Pairs with `promptweave`-built agents that announce their work over MQTT.
- **[essaim](https://github.com/swoofer/essaim)** *(coming soon)* — end-to-end orchestrator that spawns N coordinated Claude Code agents using `promptweave` + `mcp-coordinator`.

## License

MIT
