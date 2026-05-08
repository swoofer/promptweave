# Skill Export — Design Spec

**Date:** 2026-05-07
**Status:** approved (pending implementation)
**Scope:** add `--target skill` to `promptweave build`, producing Anthropic-standard `SKILL.md` files from existing presets without altering current bundle output.

---

## 1. Problem Statement

The user maintains a catalog of Claude Code skills with overlapping instructions. Cross-skill drift is the maintenance pain: editing similar prose in N skills means N edits, N opportunities for inconsistency, N diffs to review.

Goal: use promptweave as a **build system for skills** — extract recurring patterns into reusable `behaviors/`, group them into `presets/` (one preset per skill), regenerate `SKILL.md` files reproducibly. A fix in a shared behavior propagates to every skill that includes it.

This adds a new output target. The current bundle output (prompt + hooks + `.mcp.json` + envVars) is preserved byte-for-byte.

---

## 2. Goals

- New CLI flag `--target skill` produces a Claude Code skill from any preset.
- Output respects Anthropic's standard SKILL.md format: YAML frontmatter (`name` + `description`), markdown body. No invented frontmatter fields.
- Behavior `params` declared by composing behaviors are auto-documented in a `## Parameters` section in the body so the skill consumer (Claude) understands the override contract.
- Default invocation (`promptweave build <preset>`, no flag) produces **identical byte-for-byte output** as today. Verified by tests.
- No schema changes to `BehaviorSchema`, `PresetSchema`, or `AgentSchema`.
- No changes to the pipeline (`resolve → validate → compose → assemble`).

## 3. Non-Goals

- Slash command export (`.claude/commands/<name>.md`) — out of scope.
- Cursor / Windsurf / Aider rule export — out of scope.
- Behavior-level `targets:` schema field signaling intended target(s) — known limitation, future work.
- `--strict` mode (warnings-as-errors) — YAGNI.
- Round-trip parsing (skill → preset import) — out of scope.
- Multi-file skill output (side-car scripts/references) — out of scope.

---

## 4. Architecture

A minimal `Renderer` abstraction with two implementations: `bundle` (existing logic relocated) and `skill` (new).

### File layout

```
src/
├── renderers/
│   ├── index.ts          ← Renderer interface + registry
│   ├── bundle.ts         ← contents of writer.ts, adapted to interface
│   └── skill.ts          ← new
├── pipeline.ts           ← unchanged
├── assemble.ts           ← unchanged
└── (everything else unchanged)

tests/
└── renderers/
    ├── bundle.test.ts    ← migrated from tests/coverage.test.ts (writer.ts block)
    ├── skill.test.ts     ← new
    └── index.test.ts     ← new (registry sanity)
```

### Interface contract

```ts
export interface Renderer {
  target: string;
  render(
    output: AssembledOutput,
    destDir: string,
    ctx: RenderContext
  ): RenderResult;
}

export interface RenderContext {
  presetName: string;       // skill folder name + frontmatter `name`
  projectRoot?: string;     // bundle uses for .mcp.json merge; skill ignores
}

export interface RenderResult {
  warnings: string[];       // dropped hooks/MCP/phases/envVars, etc.
}
```

The interface is intentionally **minimal**. No optional `preProcess`/`postProcess`/`validate` hooks "for future use." When command/rule targets arrive and need different shapes, the interface evolves with concrete data points, not anticipation.

### Registry

```ts
export const registry: Record<string, Renderer> = {
  bundle: bundleRenderer,
  skill: skillRenderer,
};
```

Hardcoded. No plugin discovery. Adding a target = adding an entry.

### Migration of `writer.ts`

`src/writer.ts` is **publicly exported** via `src/index.ts:10` (`export { writeOutput } from './writer.js'`). Removing it would be a breaking change for any consumer of the library. The migration is therefore:

- Logic relocated to `src/renderers/bundle.ts` with the new `bundleRenderer.render(output, dir, ctx)` signature.
- `src/writer.ts` **kept** as a thin backward-compatibility shim:
  ```ts
  import { bundleRenderer } from './renderers/bundle.js';
  export function writeOutput(targetDir, output, projectRoot) {
    bundleRenderer.render(output, targetDir, { presetName: '', projectRoot });
  }
  ```
- `presetName: ''` is acceptable because bundle does not consume it (kept in `RenderContext` for interface symmetry only).
- `src/index.ts` adds new exports alongside the existing ones: `Renderer`, `RenderContext`, `RenderResult`, `registry`, `bundleRenderer`, `skillRenderer`. No existing export is removed.
- All in-tree call sites in `cli/build.ts` switch to `registry[target].render(...)` directly — only the legacy public-API path goes through the shim.
- Existing tests for writer (currently in `tests/coverage.test.ts` lines 54-253) migrated to `tests/renderers/bundle.test.ts` with updated import paths and the new interface signature. The writer block is removed from `coverage.test.ts` post-migration. A small smoke test for the shim itself is added to confirm the public API still works.

### Dispatch in `cli/build.ts`

```ts
const target = opts.target ?? 'bundle';
const renderer = registry[target];
if (!renderer) {
  throw new Error(
    `Unknown target '${target}'. Valid: ${Object.keys(registry).join(', ')}`
  );
}
const renderResult = renderer.render(result.output, outputDir, {
  presetName: agent.displayName ?? agent.name,
  projectRoot: process.cwd(),
});
// merge pipeline warnings + render warnings for display
```

---

## 5. Mapping: Preset → SKILL.md

```
preset.yaml ──pipeline──> AssembledOutput ──skillRenderer──> SKILL.md
```

`AssembledOutput` (defined in `src/types.ts`) is the in-memory artifact emitted by the pipeline. Its fields used by the skill renderer: `prompt` (the fully composed and substituted markdown body). Fields ignored: `hooks`, `mcpTools`, `phases`, `envVars` (each produces a warning).

### Frontmatter

| Field | Source | Validation |
|---|---|---|
| `name` | `agent.displayName ?? agent.name` | Hard error if not matching `^[a-z0-9-]+$`. |
| `description` | `preset.description` | Verbatim. Author writes the trigger-rich prose; the renderer does not transform. |

Rationale for `agent.displayName ?? agent.name`: `cli/build.ts` already accepts either an `agents/<name>.yaml` (full agent identity with optional `displayName`) or falls back to a synthesized agent (`name` = preset name). Using `displayName ?? name` covers both paths consistently.

### Body composition

```
<frontmatter>

<output.prompt>

<auto-generated `## Parameters` section, if any>
```

Whitespace rules (relevant for snapshot tests):
- Exactly one blank line between the frontmatter closing `---` and `output.prompt`.
- `output.prompt` is appended with **trailing whitespace stripped** (trailing newlines/spaces removed before joining).
- If a `## Parameters` section is rendered, exactly one blank line separates the stripped prompt from the `## Parameters` heading.
- File ends with a single trailing newline.

Standard `{{params.x}}` substitution still happens upstream in the pipeline. `output.prompt` arrives at the renderer fully resolved with effective param values. The `## Parameters` section appended to the body is documentation for the skill consumer — separate from the operational prompt content.

### Auto-generated `## Parameters` section

Rendered **only if** at least one composing behavior declares params. Otherwise omitted (no empty section).

Per-param format (type names stay as prose; identifiers and values get backticks):

```markdown
- `<name>` (<type>, default: `<effective-default>`): <description>
```

Example rendered line:
```markdown
- `target_language` (string, default: `"français"`): Language to translate into
```

Special cases:
- `required: true` and no default → `(<type>, required): <description>`
- No description declared → omit the colon and trailing description; line ends after the closing paren
- "Effective default" = preset-level (or agent-level) override if present, else behavior's declared default

**Order:** stable. First the order of behaviors as listed in the preset, then declaration order of params within each behavior. No alphabetical sorting — preserves authorial intent.

**Conflict handling:** if two behaviors declare a param with the same name, the pipeline already emits a warning and resolves per existing rules. The renderer reads the resolved list — no new logic needed.

### Dropped fields (warnings)

| Source | Reason | Warning |
|---|---|---|
| `output.hooks` | Skills don't run shell hooks | `[render] skill target ignores hooks declared by behaviors: <names>` |
| `output.mcpTools` | Skills don't load MCP servers | `[render] skill target ignores mcp_tools declared by behaviors: <names>` |
| `output.phases` | Skills are one-shot | `[render] skill target ignores phases declared by behaviors: <names>` |
| `output.envVars` | Not applicable | `[render] skill target ignores envVars declared by behaviors: <names>` |

`<names>` in the warning messages is a comma-separated list of behavior names that contributed the dropped field, in their order of appearance in the preset. Drops are silent at the file level (the dropped data does not appear in `SKILL.md`); warnings surface in `RenderResult.warnings` and are displayed by the CLI.

---

## 6. CLI

```
promptweave build <agent> --target <bundle|skill> [--output DIR] [--dry-run] [--set k=v]
```

### Flag: `--target`

- Values: `bundle` (default), `skill`
- Invalid value → hard error with the list of valid targets

### Default output paths

| Target | Default output |
|---|---|
| `bundle` | `<cwd>/.claude/promptweave/` (unchanged) |
| `skill` | `<cwd>/.claude/skills/<presetName>/SKILL.md` |

With explicit `--output DIR`:
- bundle: `DIR` is the bundle output directory
- skill: `DIR` is the **parent** of the skill folder; renderer creates `DIR/<presetName>/SKILL.md`

### `--dry-run` behavior per target

| Target | Output |
|---|---|
| `bundle` | Resolution trace + sections + hooks + mcp tools list (unchanged) |
| `skill` | Resolution + composition rules applied + warnings + final `SKILL.md` content (in that order) |

Skill `--dry-run` output structure (mirrors bundle's, ends with the rendered file content instead of section traces):

```
=== Resolution ===
Agent: <id> (profile: <p>, model: <m>)
Behaviors: [<list>]

=== Composition rules applied ===
  + <rule-name>
  ...

=== Warnings ===
  ! [pipeline] <message>
  ! [render]   <message>
  ...

=== SKILL.md ===
<full file content>
```

### Other commands

`list`, `validate`: unchanged. `--target` does not apply.

---

## 7. Output Layout & Filesystem Behavior

### Skill output directory layout

```
<destDir>/
└── <presetName>/
    └── SKILL.md
```

No side-car files in v1. Hooks are dropped; multi-file output is a future-work candidate when a concrete need surfaces.

### Atomicity

Reuse the `tmp + rename` pattern from current `writer.ts`:
1. Write the new content to `<destDir>/<presetName>.tmp.<timestamp>/SKILL.md`.
2. If `<destDir>/<presetName>` exists, `rmSync(..., { recursive: true })` it.
3. `renameSync(<tmp>, <destDir>/<presetName>)`.
4. On any error mid-flight: remove the tmp dir, propagate the error. The previous skill state remains intact.

### Overwrite semantics

If `<destDir>/<presetName>/` already exists, it is **destroyed and rewritten**. Manual edits to a previously generated `SKILL.md` are lost without warning. This is the standard contract of a build system. Documented prominently in the README addition.

### File permissions and encoding

- `SKILL.md`: `0o644`. Not executable (unlike hooks).
- UTF-8 encoding.
- LF line endings, including on Windows. Anthropic's skill format expects LF.

---

## 8. Errors & Warnings

| Condition | Severity | Behavior |
|---|---|---|
| `--target` value not in registry | error | exit 1, list valid targets |
| `presetName` does not match `^[a-z0-9-]+$` | error | exit 1, message: `skill target requires preset name to match ^[a-z0-9-]+$ (got: '<name>')` |
| `output.prompt` is empty (no sections composed) | error | exit 1, message: `skill target requires at least one section in composed behaviors; preset '<name>' produces empty prompt` |
| Composing behavior declares hooks | warning | drop, list in warnings |
| Composing behavior declares mcp_tools | warning | drop, list in warnings |
| Composing behavior declares phases | warning | drop, list in warnings |
| Composing behavior declares envVars | warning | drop, list in warnings |
| `output.prompt` starts with `---\n` | warning | render anyway; warn: `composed prompt starts with frontmatter delimiter; rendered SKILL.md may have ambiguous frontmatter parsing` |
| Destination not writable | error | exit 1, propagate I/O error |

### Exit codes

- `0`: success (warnings allowed)
- `1`: any error from the table above
- No `--strict` flag in v1.

### Warning display

Pipeline warnings and render warnings are concatenated post-render and displayed with origin tags:

```
! [pipeline] <message>
! [render]   <message>
```

Format consistent with the existing pipeline warnings convention.

---

## 9. Testing Strategy

### `tests/renderers/bundle.test.ts` — migration

Source: `tests/coverage.test.ts` writer block (lines 54-253). All assertions preserved; only call signatures and import paths change.

- Import: `import { bundleRenderer } from '../../src/renderers/bundle.js'`
- Calls: `bundleRenderer.render(output, dir, { presetName: '...', projectRoot: '...' })`
- After migration, the writer block is **removed** from `coverage.test.ts` to avoid duplicate coverage.

Additional cases added to `bundle.test.ts` post-migration:
- Backward-compat shim: calling `writeOutput(dir, output, projectRoot)` produces output identical to `bundleRenderer.render(output, dir, { presetName: '', projectRoot })`.
- Idempotence (bundle): two consecutive renders into the same target dir produce byte-for-byte identical files.

### `tests/renderers/skill.test.ts` — new

| Test case | Assertion |
|---|---|
| Minimal preset (1 behavior, 1 section, no params) | SKILL.md = frontmatter + body. No `## Parameters`. |
| Preset with params, no overrides | `## Parameters` rendered; defaults reflect behavior values |
| Preset with params, preset-level overrides | Effective defaults reflect overrides |
| Param `required: true`, no default | Format: `(type, required): description` |
| Param without description | Line ends after closing paren, no colon |
| Behavior declares hooks | Warning emitted; no hook content in SKILL.md |
| Behavior declares mcp_tools | Warning emitted |
| Behavior declares phases | Warning emitted |
| Behavior declares envVars | Warning emitted |
| Empty `output.prompt` | Error thrown with documented message |
| `output.prompt` starts with `---\n` | Warning emitted; SKILL.md still written |
| `presetName` non-conforming (e.g., `My Skill!`) | Error thrown |
| Atomicity: simulate mid-write failure | Previous state preserved; tmp dir cleaned up |
| Round-trip parse: extract YAML frontmatter from generated file | Frontmatter parses as valid YAML |
| Stable param order across multi-behavior presets | Order = behavior order, then declaration order |
| Explicit `--output DIR` for skill mode | File written at `DIR/<presetName>/SKILL.md` |
| Idempotence (skill) | Two consecutive renders produce byte-for-byte identical `SKILL.md` |

### `tests/renderers/index.test.ts` — new

- Registry contains exactly `bundle` and `skill` (guards against accidental additions/removals).
- Each registry entry conforms to the `Renderer` interface (`target` is a non-empty string, `render` is a function).

### `tests/cli/build.test.ts` — new or extension

Integration tests for the dispatch wiring end-to-end:
- `createBuildCommand` with `--target skill` produces the expected filesystem layout for a fixture preset.
- `--target bundle` (explicit) produces byte-for-byte identical output to invoking with no `--target` flag.
- `--target skill --dry-run` writes nothing to disk; stdout matches the documented dry-run structure (Resolution / Composition rules / Warnings / SKILL.md content).
- `--target unknown-value` exits with code 1 and lists the valid targets.

### Fixtures

Add `tests/fixtures/skill-export/`:
- `behaviors/translation.yaml` — params with defaults
- `behaviors/no-params.yaml` — no params declared
- `behaviors/with-hooks.yaml` — declares hooks (for warning tests)
- `behaviors/with-mcp.yaml` — declares mcp_tools
- `behaviors/with-phase.yaml` — declares a phase
- `presets/translator.yaml` — uses `translation`, no overrides
- `presets/custom-translator.yaml` — overrides `translation` params
- `presets/empty-prompt.yaml` — uses behaviors that compose to no sections
- `presets/invalid-slug.yaml` — file is filesystem-safe, but its `name` field is `"Mon Skill!"` (slug validation fixture)

### Snapshot strategy

- Inline snapshots (`toMatchInlineSnapshot()`) for short SKILL.md outputs (under ~30 lines)
- File snapshots (`toMatchFileSnapshot()`) for longer bundle outputs

### Non-regression of bundle target

The migrated `bundle.test.ts` covers writer behaviors as before. Additionally, an integration test renders the bundled `dev` and `inspect` presets in bundle mode and snapshots the output — guards against any subtle byte-for-byte drift introduced by the refactor.

---

## 10. Known Limitations

1. **No behavior-level target affinity.** A behavior author cannot signal "this behavior is hooks-essential and shouldn't be skill-exported." Including `worktree-isolation` (or similar hook-heavy behaviors) in a skill preset produces a warning, but no structural prevention. Future work: optional `targets: ['bundle' | 'skill']` field on `BehaviorSchema`.

2. **Composition rules are target-agnostic.** A composition rule that injects glue text referencing hooks (e.g., "wait for setup_worktree.sh, then announce…") fires uniformly regardless of target. In skill mode, the glue text remains in the body but the referenced hooks don't exist at runtime. Authorial concern, not enforced.

3. **No round-trip.** Once a `SKILL.md` is generated, there is no `promptweave import skill <path>` to reconstruct a preset. Skills are forward-only output.

4. **Single-file output only.** Skills can include side-car scripts and references; v1 produces only `SKILL.md`. Multi-file output is a v2 candidate when a concrete need surfaces.

5. **Manual edits to generated `SKILL.md` are silently overwritten** on the next build. This is the explicit contract of the build system, but worth flagging in user-facing documentation.

6. **Build-time-only params surface in `## Parameters`.** Behaviors like `project-context` declare params (`language`, `test_command`, `modules`) intended as build-time project config, not runtime overrides. Including such a behavior in a skill preset causes those params to appear in the skill's `## Parameters` section, suggesting to the consumer that they are runtime-tunable when the author may not have intended that. Mitigations: avoid including build-time-only behaviors in skill presets, or split the build-time portion into a separate behavior that is composed only in bundle presets. A future `runtime: true/false` field on `ParamDefSchema` could enforce this declaratively.

---

## 11. Effort Estimate

Realistic 2-3 days of focused work:

| Task | Estimate |
|---|---|
| Refactor `writer.ts` → `renderers/bundle.ts` + interface scaffolding | 2-3h |
| Implement `skillRenderer` (frontmatter + body + `## Parameters` section) | 3-4h |
| Migrate `coverage.test.ts` writer block to `renderers/bundle.test.ts` | 1-2h |
| Write `renderers/skill.test.ts` (full coverage per the matrix above) | 3-4h |
| Wire `cli/build.ts` dispatch + `--target` flag + skill `--dry-run` mode | 1-2h |
| README documentation (CLI table, use case section, overwrite caveat) | 1h |
| Buffer for surprises | +30-50% |

---

## 12. Future Work (out of v1 scope)

- `--target command` for slash commands (`.claude/commands/<name>.md`)
- `--target cursorrule` for Cursor rules (`.cursorrules` or `.cursor/rules/*.mdc`)
- `--target windsurf` for Windsurf rules
- Behavior `targets:` schema field for target affinity
- Multi-file skill output (side-car scripts, references)
- `--strict` flag (warnings → errors)
- `promptweave import skill <path>` for round-trip authoring
- Composition rules with target-aware predicates
