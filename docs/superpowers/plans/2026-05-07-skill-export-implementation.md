# Skill Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--target skill` to `promptweave build` that emits Anthropic-standard `SKILL.md` files from existing presets, without altering current bundle output.

**Architecture:** Minimal `Renderer` interface with two implementations: `bundleRenderer` (existing logic relocated) and `skillRenderer` (new). The pipeline (`resolve → validate → compose → assemble`) is unchanged — confirmed by spec non-goal §2. CLI dispatches to the appropriate renderer via the `--target` flag using **static imports** (no dynamic `await import`, no async action callback). `src/writer.ts` is kept as a backward-compat shim because `writeOutput` is exported from `src/index.ts`.

**Tech Stack:** TypeScript (ESM, strict), Vitest 4.x, Zod 3.x, Commander 14.x, js-yaml 4.x, Node fs sync APIs. Imports use `.js` extensions despite `.ts` source (NodeNext ESM resolution).

**Reference spec:** `docs/superpowers/specs/2026-05-07-skill-export-design.md`

**Key design decisions (post multi-agent review)** that depart from a naive implementation:

- **No changes to `PipelineResult`** — CLI computes effective params using the already-public `resolveParams` and reads preset descriptions through the already-public `Registry`. No new pipeline surface.
- **`presetName` source is `agent.preset ?? agent.name`**, never `agent.displayName` (the latter is free-form prose and would fail slug validation).
- **Static imports** in `cli/build.ts` for `registry`, `RenderedParam`, etc. — avoids the action callback going async unnecessarily and the invalid `type` destructuring of `await import`.
- **CLI integration tests use a checked-in fixture root** (`tests/fixtures/cli-integration/`) — never executes against the project's real `presets/` or writes to the project root's `.mcp.json`.
- **YAML-safe description rendering** in skill frontmatter — uses `js-yaml`'s `dump` for the value to handle prose containing `:`, `#`, leading `-`, or newlines safely.
- **Atomicity is genuinely tested** — uses `vi.spyOn(fs, 'renameSync')` to simulate a mid-write failure, not a pre-write validation error.
- **`--set` launchParams flow through to skill params** so override values rendered in the `## Parameters` section reflect what was actually passed.

---

## Phase 1 — Scaffolding & Bundle Migration

### Task 1: Create renderer interface and empty registry

**Files:**
- Create: `src/renderers/index.ts`

- [ ] **Step 1: Create the file**

```ts
// src/renderers/index.ts
import type { AssembledOutput } from '../types.js';

export interface RenderedParam {
  name: string;
  type: string; // matches BehaviorSchema param `type` enum: 'string'|'number'|'boolean'|'string[]'|'number[]'
  description?: string;
  required: boolean;
  /** Effective default after preset/agent/launch overrides; undefined when required and no default */
  effectiveDefault?: unknown;
}

export interface RenderContext {
  /** Skill folder name + frontmatter `name`. Bundle ignores. Source: agent.preset ?? agent.name. */
  presetName: string;
  /** Frontmatter `description` for skill mode. Bundle ignores. */
  description?: string;
  /** `## Parameters` section content for skill mode. Bundle ignores. */
  params?: RenderedParam[];
  /** Bundle uses to merge `.mcp.json` at the project root. Skill ignores. */
  projectRoot?: string;
}

export interface RenderResult {
  warnings: string[];
}

export interface Renderer {
  target: string;
  render(output: AssembledOutput, destDir: string, ctx: RenderContext): RenderResult;
}

// Registry populated as renderers land. After Task 2 + 8 it contains 'bundle' and 'skill'.
export const registry: Record<string, Renderer> = {};
```

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/renderers/index.ts
git commit -m "feat(renderers): scaffold Renderer interface, RenderContext, and empty registry"
```

---

### Task 2: Migrate writer logic to `renderers/bundle.ts`, register, keep shim

**Files:**
- Create: `src/renderers/bundle.ts`
- Modify: `src/renderers/index.ts` (register `bundle`)
- Modify: `src/writer.ts` (becomes shim)

- [ ] **Step 1: Capture green baseline**

Run: `npm test`
Expected: all tests pass. Note count.

- [ ] **Step 2: Create `src/renderers/bundle.ts`**

```ts
// src/renderers/bundle.ts
import { mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import type { AssembledOutput } from '../types.js';
import { mergeMcpConfig } from '../assemble.js';
import type { Renderer, RenderContext, RenderResult } from './index.js';

export const bundleRenderer: Renderer = {
  target: 'bundle',
  render(output: AssembledOutput, destDir: string, ctx: RenderContext): RenderResult {
    const tmpDir = `${destDir}.tmp.${Date.now()}`;

    try {
      mkdirSync(join(tmpDir, 'generated-hooks'), { recursive: true });
      writeFileSync(join(tmpDir, 'generated-prompt.md'), output.prompt, 'utf-8');

      for (const [lifecycle, content] of Object.entries(output.hooks)) {
        writeFileSync(
          join(tmpDir, 'generated-hooks', `${lifecycle}.sh`),
          content,
          { encoding: 'utf-8', mode: 0o755 },
        );
      }

      writeFileSync(
        join(tmpDir, 'generated-mcp.json'),
        JSON.stringify({ mcpTools: output.mcpTools }, null, 2),
        'utf-8',
      );

      const envContent = Object.entries(output.envVars)
        .map(([k, v]) => `export ${k}="${v}"`)
        .join('\n');
      writeFileSync(join(tmpDir, '.coordinator-env'), envContent, 'utf-8');

      if (existsSync(destDir)) rmSync(destDir, { recursive: true });
      renameSync(tmpDir, destDir);

      if (ctx.projectRoot) {
        const mcpJsonPath = join(ctx.projectRoot, '.mcp.json');
        let existing: Record<string, unknown> = {};
        if (existsSync(mcpJsonPath)) {
          existing = JSON.parse(readFileSync(mcpJsonPath, 'utf-8'));
        }
        const coordinatorUrl = output.envVars['COORDINATOR_URL'] ?? 'http://localhost:3100';
        const merged = mergeMcpConfig(existing, output.mcpTools, coordinatorUrl);
        writeFileSync(mcpJsonPath, JSON.stringify(merged, null, 2), 'utf-8');
      }
    } catch (err) {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
      throw err;
    }

    return { warnings: [] };
  },
};
```

- [ ] **Step 3: Register and re-export from `src/renderers/index.ts`**

Append to the file:

```ts
import { bundleRenderer } from './bundle.js';
registry.bundle = bundleRenderer;
export { bundleRenderer };
```

- [ ] **Step 4: Replace `src/writer.ts` with the shim**

```ts
// src/writer.ts — backward-compat shim. New code should use bundleRenderer.render directly.
import { bundleRenderer } from './renderers/bundle.js';
import type { AssembledOutput } from './types.js';

/**
 * @deprecated Use `bundleRenderer.render(output, dir, { presetName, projectRoot })`.
 * Kept because this symbol is part of the public API surface (re-exported from src/index.ts).
 */
export function writeOutput(
  targetDir: string,
  output: AssembledOutput,
  projectRoot?: string,
): void {
  bundleRenderer.render(output, targetDir, { presetName: '', projectRoot });
}
```

- [ ] **Step 5: Verify regression-free**

Run: `npm test`
Expected: same passing test count as Step 1.

- [ ] **Step 6: Commit**

```bash
git add src/renderers/bundle.ts src/renderers/index.ts src/writer.ts
git commit -m "refactor(renderers): relocate writer logic to bundleRenderer with shim"
```

---

### Task 3: Migrate writer test block to `tests/renderers/bundle.test.ts`

**Files:**
- Create: `tests/renderers/bundle.test.ts` (the `tests/renderers/` subdir is a deliberate convention break — see plan note below)
- Modify: `tests/coverage.test.ts` (remove writer block)

> **Convention note:** existing `tests/` is flat. This plan introduces `tests/renderers/` because (a) renderers will accumulate at least 3 test files (`bundle`, `skill`, `index`), (b) renderer test fixtures may follow, (c) the corresponding `src/renderers/` subdir already exists. This is a documented departure from convention; future renderer-related tests go in `tests/renderers/`.

- [ ] **Step 1: Create `tests/renderers/bundle.test.ts`** (verbatim migration of `tests/coverage.test.ts` lines 50-248 with adapted call signatures)

```ts
// tests/renderers/bundle.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { resolve, join } from 'path';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { bundleRenderer } from '../../src/renderers/bundle.js';
import type { AssembledOutput } from '../../src/types.js';

function tmpPath(suffix: string): string {
  return join(tmpdir(), `pw-bundle-test-${Date.now()}-${Math.random().toString(36).slice(2)}-${suffix}`);
}

describe('bundleRenderer.render', () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    for (const dir of cleanupDirs) {
      try { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); } catch { /* ignore EBUSY on Windows */ }
    }
    // Sweep only OUR test prefix's tmp siblings, never the entire os.tmpdir().
    for (const dir of [...cleanupDirs]) {
      const parent = resolve(dir, '..');
      try {
        const entries = readdirSync(parent);
        for (const e of entries) {
          if (e.startsWith('pw-bundle-test-') && e.includes('.tmp.')) {
            try { rmSync(join(parent, e), { recursive: true, force: true }); } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
    }
    cleanupDirs.length = 0;
  });

  const minimalOutput: AssembledOutput = {
    prompt: '# Test prompt\nHello world.',
    phases: [],
    hooks: {},
    mcpTools: [],
    envVars: {},
  };

  it('writes prompt, mcp json, and env file to target dir', () => {
    const targetDir = tmpPath('write-basic');
    cleanupDirs.push(targetDir);

    bundleRenderer.render(minimalOutput, targetDir, { presetName: 'test' });

    expect(existsSync(targetDir)).toBe(true);
    expect(readFileSync(join(targetDir, 'generated-prompt.md'), 'utf-8')).toBe(minimalOutput.prompt);
    expect(readFileSync(join(targetDir, 'generated-mcp.json'), 'utf-8')).toBe(
      JSON.stringify({ mcpTools: [] }, null, 2),
    );
    expect(readFileSync(join(targetDir, '.coordinator-env'), 'utf-8')).toBe('');
  });

  it('writes hook scripts to generated-hooks/', () => {
    const targetDir = tmpPath('write-hooks');
    cleanupDirs.push(targetDir);

    const output: AssembledOutput = {
      ...minimalOutput,
      hooks: {
        'session-start': '#!/bin/bash\necho start',
        'pre-tool-use': '#!/bin/bash\necho pre',
      },
    };

    bundleRenderer.render(output, targetDir, { presetName: 'test' });

    expect(readFileSync(join(targetDir, 'generated-hooks', 'session-start.sh'), 'utf-8')).toBe('#!/bin/bash\necho start');
    expect(readFileSync(join(targetDir, 'generated-hooks', 'pre-tool-use.sh'), 'utf-8')).toBe('#!/bin/bash\necho pre');
  });

  it('writes env vars in export format', () => {
    const targetDir = tmpPath('write-env');
    cleanupDirs.push(targetDir);

    const output: AssembledOutput = {
      ...minimalOutput,
      envVars: { FOO: 'bar', BAZ: 'qux' },
    };

    bundleRenderer.render(output, targetDir, { presetName: 'test' });

    const content = readFileSync(join(targetDir, '.coordinator-env'), 'utf-8');
    expect(content).toContain('export FOO="bar"');
    expect(content).toContain('export BAZ="qux"');
  });

  it('replaces existing target dir atomically', () => {
    const targetDir = tmpPath('write-replace');
    cleanupDirs.push(targetDir);

    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'old-file.txt'), 'old');

    bundleRenderer.render(minimalOutput, targetDir, { presetName: 'test' });

    expect(existsSync(join(targetDir, 'old-file.txt'))).toBe(false);
    expect(existsSync(join(targetDir, 'generated-prompt.md'))).toBe(true);
  });

  it('merges .mcp.json at project root when projectRoot is provided', () => {
    const targetDir = tmpPath('write-mcp-merge');
    const projectRoot = tmpPath('write-project-root');
    cleanupDirs.push(targetDir, projectRoot);
    mkdirSync(projectRoot, { recursive: true });

    const output: AssembledOutput = {
      ...minimalOutput,
      mcpTools: ['tool_a', 'tool_b'],
      envVars: { COORDINATOR_URL: 'http://localhost:4000' },
    };

    bundleRenderer.render(output, targetDir, { presetName: 'test', projectRoot });

    const mcpJson = JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf-8'));
    expect(mcpJson.mcpServers._bce_coordinator).toBeDefined();
    expect(mcpJson.mcpServers._bce_coordinator.url).toBe('http://localhost:4000/mcp');
    expect(mcpJson.mcpServers._bce_coordinator._bce_tools).toEqual(['tool_a', 'tool_b']);
  });

  it('merges with existing .mcp.json preserving non-bce servers', () => {
    const targetDir = tmpPath('write-mcp-preserve');
    const projectRoot = tmpPath('write-project-preserve');
    cleanupDirs.push(targetDir, projectRoot);
    mkdirSync(projectRoot, { recursive: true });

    const existingMcp = {
      mcpServers: {
        'my-server': { type: 'http', url: 'http://my-server' },
        '_bce_old': { type: 'http', url: 'http://old' },
      },
    };
    writeFileSync(join(projectRoot, '.mcp.json'), JSON.stringify(existingMcp));

    const output: AssembledOutput = {
      ...minimalOutput,
      mcpTools: ['tool_x'],
      envVars: {},
    };

    bundleRenderer.render(output, targetDir, { presetName: 'test', projectRoot });

    const mcpJson = JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf-8'));
    expect(mcpJson.mcpServers['my-server']).toBeDefined();
    expect(mcpJson.mcpServers['_bce_old']).toBeUndefined();
    expect(mcpJson.mcpServers['_bce_coordinator']).toBeDefined();
  });

  it('defaults to localhost:3100 when COORDINATOR_URL is not in envVars', () => {
    const targetDir = tmpPath('write-default-url');
    const projectRoot = tmpPath('write-default-url-root');
    cleanupDirs.push(targetDir, projectRoot);
    mkdirSync(projectRoot, { recursive: true });

    const output: AssembledOutput = {
      ...minimalOutput,
      mcpTools: ['tool_y'],
      envVars: {},
    };

    bundleRenderer.render(output, targetDir, { presetName: 'test', projectRoot });

    const mcpJson = JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf-8'));
    expect(mcpJson.mcpServers._bce_coordinator.url).toBe('http://localhost:3100/mcp');
  });

  it('cleans up tmp dir on error', () => {
    const targetDir = tmpPath('write-error');
    cleanupDirs.push(targetDir);

    const circularObj: Record<string, unknown> = {};
    circularObj.self = circularObj;

    const output: AssembledOutput = {
      prompt: 'test',
      phases: [],
      hooks: {},
      mcpTools: circularObj as unknown as string[],
      envVars: {},
    };

    expect(() => bundleRenderer.render(output, targetDir, { presetName: 'test' })).toThrow();
  });
});
```

- [ ] **Step 2: Remove the writer block from `tests/coverage.test.ts`**

Delete lines **50-248 inclusive** (the comment block at 50-53, the entire `describe('writer.ts — writeOutput', ...)` block ending at line 248). Also remove `import { writeOutput } from '../src/writer.js';` at line 15. Leave the rest of `coverage.test.ts` intact.

- [ ] **Step 3: Verify regression-free**

Run: `npm test`
Expected: same passing test count as Task 2 Step 1.

- [ ] **Step 4: Commit**

```bash
git add tests/renderers/bundle.test.ts tests/coverage.test.ts
git commit -m "test(renderers): migrate writer test block to tests/renderers/bundle.test.ts"
```

---

### Task 4: Add bundle characterization tests (shim equivalence + idempotence)

**Files:**
- Modify: `tests/renderers/bundle.test.ts`

> **Note (TDD-N/A):** these are characterization tests pinning behavior already implemented. They are expected to PASS on the first run; the goal is filet de sécurité against future regressions, not test-driven design.

- [ ] **Step 1: Append the two characterization tests inside the existing `describe`**

Insert just before the closing `});`:

```ts
  it('writeOutput shim produces output identical to bundleRenderer.render (characterization)', async () => {
    const targetA = tmpPath('shim-a');
    const targetB = tmpPath('shim-b');
    const projectRootA = tmpPath('shim-root-a');
    const projectRootB = tmpPath('shim-root-b');
    cleanupDirs.push(targetA, targetB, projectRootA, projectRootB);
    mkdirSync(projectRootA, { recursive: true });
    mkdirSync(projectRootB, { recursive: true });

    const output: AssembledOutput = {
      prompt: 'shim test',
      phases: [],
      hooks: { 'session-start': '#!/bin/bash\necho hi' },
      mcpTools: ['tool_a'],
      envVars: { K: 'v' },
    };

    bundleRenderer.render(output, targetA, { presetName: 'test', projectRoot: projectRootA });
    const { writeOutput } = await import('../../src/writer.js');
    writeOutput(targetB, output, projectRootB);

    for (const f of ['generated-prompt.md', 'generated-mcp.json', '.coordinator-env']) {
      expect(readFileSync(join(targetA, f), 'utf-8')).toBe(readFileSync(join(targetB, f), 'utf-8'));
    }
    expect(readFileSync(join(targetA, 'generated-hooks', 'session-start.sh'), 'utf-8'))
      .toBe(readFileSync(join(targetB, 'generated-hooks', 'session-start.sh'), 'utf-8'));
    expect(readFileSync(join(projectRootA, '.mcp.json'), 'utf-8'))
      .toBe(readFileSync(join(projectRootB, '.mcp.json'), 'utf-8'));
  });

  it('produces byte-for-byte identical output across consecutive renders (characterization)', () => {
    const target = tmpPath('idempotence');
    cleanupDirs.push(target);

    const output: AssembledOutput = {
      ...minimalOutput,
      hooks: { 'session-start': 'echo a' },
      envVars: { A: '1', B: '2' },
    };

    bundleRenderer.render(output, target, { presetName: 'test' });
    const first = readFileSync(join(target, 'generated-prompt.md'), 'utf-8');
    const firstEnv = readFileSync(join(target, '.coordinator-env'), 'utf-8');

    bundleRenderer.render(output, target, { presetName: 'test' });
    const second = readFileSync(join(target, 'generated-prompt.md'), 'utf-8');
    const secondEnv = readFileSync(join(target, '.coordinator-env'), 'utf-8');

    expect(first).toBe(second);
    expect(firstEnv).toBe(secondEnv);
  });
```

- [ ] **Step 2: Verify and commit**

Run: `npm test`
Expected: 2 new tests pass.

```bash
git add tests/renderers/bundle.test.ts
git commit -m "test(renderers): pin shim equivalence and idempotence for bundle"
```

---

### Task 5: Public API exports

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Update `src/index.ts`**

```ts
// src/index.ts (full file)
export const BCE_VERSION = '0.1.0';
export { Registry } from './registry.js';
export { resolveBehaviors, resolveParams } from './resolve.js';
export { validateBehaviors } from './validate.js';
export { applyCompositionRules, matchRules } from './compose.js';
export { assemblePrompt, assembleHooks, assembleMcpTools, assembleEnvVars } from './assemble.js';
export { generateWarnings } from './warnings.js';
export { runPipeline } from './pipeline.js';
export { writeOutput } from './writer.js';
export { bundleRenderer, registry } from './renderers/index.js';
export type { Renderer, RenderContext, RenderResult, RenderedParam } from './renderers/index.js';
export type * from './types.js';
```

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit && npm test`
Expected: no errors, all tests green.

```bash
git add src/index.ts
git commit -m "feat(api): export Renderer, RenderContext, RenderedParam, registry, bundleRenderer"
```

---

## Phase 2 — Skill Renderer

### Task 6: Skill renderer minimal — frontmatter, slug error, empty prompt error

**Files:**
- Create: `src/renderers/skill.ts`
- Modify: `src/renderers/index.ts` (register `skill`)
- Create: `tests/renderers/skill.test.ts`

- [ ] **Step 1: Write the failing test for valid frontmatter generation**

```ts
// tests/renderers/skill.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'path';
import { mkdirSync, readFileSync, rmSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { skillRenderer } from '../../src/renderers/skill.js';
import type { AssembledOutput } from '../../src/types.js';
import { resolve } from 'path';

function tmpPath(suffix: string): string {
  return join(tmpdir(), `pw-skill-test-${Date.now()}-${Math.random().toString(36).slice(2)}-${suffix}`);
}

describe('skillRenderer.render', () => {
  const cleanup: string[] = [];
  afterEach(() => {
    for (const d of cleanup) {
      try { if (existsSync(d)) rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    for (const d of [...cleanup]) {
      const parent = resolve(d, '..');
      try {
        const entries = readdirSync(parent);
        for (const e of entries) {
          if (e.startsWith('pw-skill-test-') && e.includes('.tmp.')) {
            try { rmSync(join(parent, e), { recursive: true, force: true }); } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
    }
    cleanup.length = 0;
  });

  const minimalOutput: AssembledOutput = {
    prompt: '## Mission\nDo the thing.',
    phases: [],
    hooks: {},
    mcpTools: [],
    envVars: {},
  };

  it('writes SKILL.md with frontmatter using preset name and description', () => {
    const dest = tmpPath('frontmatter-basic');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    skillRenderer.render(minimalOutput, dest, {
      presetName: 'my-translator',
      description: 'Use when translating text into another language',
    });

    const skillPath = join(dest, 'my-translator', 'SKILL.md');
    expect(existsSync(skillPath)).toBe(true);
    const content = readFileSync(skillPath, 'utf-8');
    expect(content.startsWith('---\n')).toBe(true);
    expect(content).toMatch(/^---\nname: my-translator\ndescription: ['"]?Use when translating text into another language['"]?\n---\n/);
  });
});
```

- [ ] **Step 2: Run — expect failure (skill.ts does not exist yet)**

Run: `npx vitest run tests/renderers/skill.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/renderers/skill.ts` (skeleton only — frontmatter + slug + empty prompt)**

```ts
// src/renderers/skill.ts
import { mkdirSync, writeFileSync, renameSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import type { AssembledOutput } from '../types.js';
import type { Renderer, RenderContext, RenderResult } from './index.js';

const SLUG_PATTERN = /^[a-z0-9-]+$/;

function buildFrontmatter(name: string, description: string): string {
  // Use yaml.dump for the description value to safely escape ':' '#' '\n' '-' etc.
  // yaml.dump returns a complete YAML document; we extract just the value portion.
  // For simplicity, dump as a single-key object and parse the result.
  const dumped = yaml.dump({ name, description }, { lineWidth: -1, noRefs: true }).trimEnd();
  return `---\n${dumped}\n---`;
}

export const skillRenderer: Renderer = {
  target: 'skill',
  render(output: AssembledOutput, destDir: string, ctx: RenderContext): RenderResult {
    const warnings: string[] = [];

    if (!SLUG_PATTERN.test(ctx.presetName)) {
      throw new Error(
        `skill target requires preset name to match ^[a-z0-9-]+$ (got: '${ctx.presetName}')`,
      );
    }

    if (output.prompt.trim().length === 0) {
      throw new Error(
        `skill target requires at least one section in composed behaviors; preset '${ctx.presetName}' produces empty prompt`,
      );
    }

    const description = ctx.description ?? '';
    const frontmatter = buildFrontmatter(ctx.presetName, description);

    const stripped = output.prompt.replace(/\s+$/, '');
    const content = `${frontmatter}\n\n${stripped}\n`;

    const skillFolder = join(destDir, ctx.presetName);
    const tmpFolder = `${skillFolder}.tmp.${Date.now()}`;

    try {
      mkdirSync(tmpFolder, { recursive: true });
      writeFileSync(join(tmpFolder, 'SKILL.md'), content, { encoding: 'utf-8', mode: 0o644 });

      if (existsSync(skillFolder)) rmSync(skillFolder, { recursive: true });
      renameSync(tmpFolder, skillFolder);
    } catch (err) {
      if (existsSync(tmpFolder)) rmSync(tmpFolder, { recursive: true });
      throw err;
    }

    return { warnings };
  },
};
```

- [ ] **Step 4: Register the skill renderer**

Append to `src/renderers/index.ts`:

```ts
import { skillRenderer } from './skill.js';
registry.skill = skillRenderer;
export { skillRenderer };
```

- [ ] **Step 5: Verify the frontmatter test passes**

Run: `npx vitest run tests/renderers/skill.test.ts`
Expected: 1 passing test.

- [ ] **Step 6: Add slug-validation failing test**

```ts
  it('throws on non-slug preset name', () => {
    const dest = tmpPath('slug-fail');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    expect(() =>
      skillRenderer.render(minimalOutput, dest, { presetName: 'Mon Skill!', description: 'd' }),
    ).toThrow(/^skill target requires preset name to match \^\[a-z0-9-\]\+\$ \(got: 'Mon Skill!'\)$/);
  });
```

Run: `npx vitest run tests/renderers/skill.test.ts -t "non-slug"`
Expected: PASS (already implemented in Step 3).

- [ ] **Step 7: Add empty-prompt failing test**

```ts
  it('throws when output.prompt is empty', () => {
    const dest = tmpPath('empty-prompt');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    const output: AssembledOutput = { ...minimalOutput, prompt: '' };
    expect(() =>
      skillRenderer.render(output, dest, { presetName: 'empty', description: 'd' }),
    ).toThrow(/produces empty prompt/);
  });
```

Run: `npx vitest run tests/renderers/skill.test.ts -t "empty"`
Expected: PASS.

- [ ] **Step 8: Add YAML escaping test (description with special characters)**

```ts
  it('escapes description containing : # newlines and leading -', () => {
    const dest = tmpPath('escape-desc');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    skillRenderer.render(minimalOutput, dest, {
      presetName: 'esc',
      description: 'Use when: input has # markers\nor multi-line - prose',
    });

    const content = readFileSync(join(dest, 'esc', 'SKILL.md'), 'utf-8');
    // Round-trip parse: ensure the frontmatter is valid YAML
    const match = content.match(/^---\n([\s\S]+?)\n---\n/);
    expect(match).not.toBeNull();
    const parsed = yaml.load(match![1]) as { description: string };
    expect(parsed.description).toBe('Use when: input has # markers\nor multi-line - prose');
  });
```

Add at top of test file: `import yaml from 'js-yaml';`

Run: `npx vitest run tests/renderers/skill.test.ts -t "escapes description"`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/renderers/skill.ts src/renderers/index.ts tests/renderers/skill.test.ts
git commit -m "feat(renderers): skill renderer with frontmatter, slug check, empty-prompt check, YAML escaping"
```

---

### Task 7: Skill renderer — body whitespace rules

**Files:**
- Modify: `tests/renderers/skill.test.ts`

The whitespace rules from the spec are already implemented in Task 6 step 3 (trailing-whitespace strip + single trailing newline). This task adds explicit assertions.

- [ ] **Step 1: Add the test (already-implemented behavior)**

```ts
  it('exactly one blank line between frontmatter and body, single trailing newline', () => {
    const dest = tmpPath('whitespace');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    const output: AssembledOutput = {
      ...minimalOutput,
      prompt: '## Mission\nDo the thing.\n\n\n   ',  // trailing whitespace + extra newlines
    };

    skillRenderer.render(output, dest, { presetName: 'ws', description: 'd' });

    const content = readFileSync(join(dest, 'ws', 'SKILL.md'), 'utf-8');
    // Closing `---` then exactly one blank line then body
    expect(content).toMatch(/---\n\n## Mission/);
    // Body trailing whitespace stripped, single trailing newline at EOF
    expect(content).toMatch(/Do the thing\.\n$/);
    expect(content.endsWith('\n')).toBe(true);
    expect(content.endsWith('\n\n')).toBe(false);
  });
```

- [ ] **Step 2: Verify and commit**

Run: `npx vitest run tests/renderers/skill.test.ts -t "whitespace"`
Expected: PASS.

```bash
git add tests/renderers/skill.test.ts
git commit -m "test(renderers): pin skill body whitespace rules (blank line, trailing newline)"
```

---

### Task 8: Skill renderer — drop-and-warn for hooks

**Files:**
- Modify: `src/renderers/skill.ts`
- Modify: `tests/renderers/skill.test.ts`

> **Spec deviation note:** spec §5 says warnings list "behavior names". `AssembledOutput` does not preserve per-behavior provenance for hooks/mcp/etc. — the merge is lossy. v1 lists the field keys (hook lifecycle names) instead. This is documented as Known Limitation #7 (added below); a future pipeline change would surface provenance.

- [ ] **Step 1: Write the failing test**

```ts
  it('warns and drops hooks declared by composing behaviors', () => {
    const dest = tmpPath('drop-hooks');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    const output: AssembledOutput = {
      ...minimalOutput,
      hooks: { 'session-start': '#!/bin/bash\necho start' },
    };

    const result = skillRenderer.render(output, dest, { presetName: 'p', description: 'd' });
    expect(result.warnings).toEqual([
      '[render] skill target ignores hooks declared by behaviors: session-start',
    ]);

    const content = readFileSync(join(dest, 'p', 'SKILL.md'), 'utf-8');
    expect(content).not.toContain('echo start');
  });
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run tests/renderers/skill.test.ts -t "drops hooks"`
Expected: FAIL (warnings array is empty).

- [ ] **Step 3: Add hooks drop-warn in `skill.ts`** (insert after empty-prompt check)

```ts
    const hookKeys = Object.keys(output.hooks);
    if (hookKeys.length > 0) {
      warnings.push(`[render] skill target ignores hooks declared by behaviors: ${hookKeys.join(', ')}`);
    }
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run tests/renderers/skill.test.ts -t "drops hooks"`

- [ ] **Step 5: Commit**

```bash
git add src/renderers/skill.ts tests/renderers/skill.test.ts
git commit -m "feat(renderers): warn-and-drop hooks in skill mode"
```

---

### Task 9: Skill renderer — drop-and-warn for mcp_tools

**Files:**
- Modify: `src/renderers/skill.ts`
- Modify: `tests/renderers/skill.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
  it('warns and drops mcpTools declared by composing behaviors', () => {
    const dest = tmpPath('drop-mcp');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    const output: AssembledOutput = { ...minimalOutput, mcpTools: ['some_tool'] };

    const result = skillRenderer.render(output, dest, { presetName: 'p', description: 'd' });
    expect(result.warnings).toEqual([
      '[render] skill target ignores mcp_tools declared by behaviors: some_tool',
    ]);
  });
```

- [ ] **Step 2: Run — expect FAIL → Implement → expect PASS**

Add in `skill.ts`:

```ts
    if (output.mcpTools.length > 0) {
      warnings.push(`[render] skill target ignores mcp_tools declared by behaviors: ${output.mcpTools.join(', ')}`);
    }
```

Run: `npx vitest run tests/renderers/skill.test.ts -t "drops mcpTools"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderers/skill.ts tests/renderers/skill.test.ts
git commit -m "feat(renderers): warn-and-drop mcp_tools in skill mode"
```

---

### Task 10: Skill renderer — drop-and-warn for phases

**Files:**
- Modify: `src/renderers/skill.ts`
- Modify: `tests/renderers/skill.test.ts`

- [ ] **Step 1: Failing test**

```ts
  it('warns when phases are declared', () => {
    const dest = tmpPath('drop-phases');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    const output: AssembledOutput = {
      ...minimalOutput,
      phases: [{ name: 'discover', prompt: 'p', toolsMode: 'read_only', loop: false }],
    };

    const result = skillRenderer.render(output, dest, { presetName: 'p', description: 'd' });
    expect(result.warnings).toContain('[render] skill target ignores phases declared by behaviors: discover');
  });
```

- [ ] **Step 2: Implement → run → commit**

Add in `skill.ts`:

```ts
    if (output.phases.length > 0) {
      warnings.push(`[render] skill target ignores phases declared by behaviors: ${output.phases.map((p) => p.name).join(', ')}`);
    }
```

Run: `npx vitest run tests/renderers/skill.test.ts -t "phases are declared"`. Expected: PASS.

```bash
git add src/renderers/skill.ts tests/renderers/skill.test.ts
git commit -m "feat(renderers): warn-and-drop phases in skill mode"
```

---

### Task 11: Skill renderer — drop-and-warn for envVars

**Files:**
- Modify: `src/renderers/skill.ts`
- Modify: `tests/renderers/skill.test.ts`

- [ ] **Step 1: Failing test**

```ts
  it('warns when envVars are declared', () => {
    const dest = tmpPath('drop-env');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    const output: AssembledOutput = { ...minimalOutput, envVars: { FOO: 'bar' } };

    const result = skillRenderer.render(output, dest, { presetName: 'p', description: 'd' });
    expect(result.warnings).toContain('[render] skill target ignores envVars declared by behaviors: FOO');
  });
```

- [ ] **Step 2: Implement → run → commit**

Add in `skill.ts`:

```ts
    const envKeys = Object.keys(output.envVars);
    if (envKeys.length > 0) {
      warnings.push(`[render] skill target ignores envVars declared by behaviors: ${envKeys.join(', ')}`);
    }
```

Run: `npx vitest run tests/renderers/skill.test.ts -t "envVars"`. Expected: PASS.

```bash
git add src/renderers/skill.ts tests/renderers/skill.test.ts
git commit -m "feat(renderers): warn-and-drop envVars in skill mode"
```

---

### Task 12: Skill renderer — frontmatter prefix collision warning

**Files:**
- Modify: `src/renderers/skill.ts`
- Modify: `tests/renderers/skill.test.ts`

- [ ] **Step 1: Failing test**

```ts
  it('warns when output.prompt starts with frontmatter delimiter', () => {
    const dest = tmpPath('prompt-collision');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    const output: AssembledOutput = { ...minimalOutput, prompt: '---\nweird: value\n---\nactual content' };

    const result = skillRenderer.render(output, dest, { presetName: 'p', description: 'd' });
    expect(result.warnings).toContain('[render] composed prompt starts with frontmatter delimiter; rendered SKILL.md may have ambiguous frontmatter parsing');
    expect(existsSync(join(dest, 'p', 'SKILL.md'))).toBe(true);
  });
```

- [ ] **Step 2: Implement → run → commit**

Add in `skill.ts` (after envVars check):

```ts
    if (output.prompt.startsWith('---\n')) {
      warnings.push('[render] composed prompt starts with frontmatter delimiter; rendered SKILL.md may have ambiguous frontmatter parsing');
    }
```

```bash
git add src/renderers/skill.ts tests/renderers/skill.test.ts
git commit -m "feat(renderers): warn on frontmatter delimiter collision in composed prompt"
```

---

### Task 13: Skill renderer — Parameters section (basic case)

**Files:**
- Modify: `src/renderers/skill.ts`
- Modify: `tests/renderers/skill.test.ts`

- [ ] **Step 1: Failing test**

```ts
  it('renders ## Parameters section when params are provided', () => {
    const dest = tmpPath('params-basic');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    skillRenderer.render(minimalOutput, dest, {
      presetName: 'p',
      description: 'd',
      params: [
        { name: 'target_language', type: 'string', description: 'Language to translate into', required: false, effectiveDefault: 'français' },
      ],
    });

    const content = readFileSync(join(dest, 'p', 'SKILL.md'), 'utf-8');
    expect(content).toContain('## Parameters');
    expect(content).toContain('- `target_language` (string, default: `"français"`): Language to translate into');
  });
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement param rendering helpers in `skill.ts`**

Add helpers near the top of `skill.ts`:

```ts
import type { RenderedParam } from './index.js';

function renderParam(p: RenderedParam): string {
  const namePart = `\`${p.name}\``;
  const required = p.required && p.effectiveDefault === undefined;
  const tail = required
    ? `(${p.type}, required)`
    : `(${p.type}, default: \`${JSON.stringify(p.effectiveDefault)}\`)`;
  const desc = p.description ? `: ${p.description}` : '';
  return `- ${namePart} ${tail}${desc}`;
}

function renderParamsSection(params: RenderedParam[]): string {
  return `## Parameters\n\n${params.map(renderParam).join('\n')}`;
}
```

Update content composition (replace the `const content = ...` line):

```ts
    const stripped = output.prompt.replace(/\s+$/, '');
    const paramsSection = (ctx.params && ctx.params.length > 0) ? renderParamsSection(ctx.params) : null;
    const bodyParts = paramsSection ? [stripped, paramsSection] : [stripped];
    const content = `${frontmatter}\n\n${bodyParts.join('\n\n')}\n`;
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/renderers/skill.ts tests/renderers/skill.test.ts
git commit -m "feat(renderers): basic ## Parameters section rendering"
```

---

### Task 14: Skill renderer — Parameters section special cases

**Files:**
- Modify: `tests/renderers/skill.test.ts`

- [ ] **Step 1: Add 3 tests for special-case formats**

```ts
  it('renders required param without default as (type, required)', () => {
    const dest = tmpPath('params-req');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    skillRenderer.render(minimalOutput, dest, {
      presetName: 'p', description: 'd',
      params: [{ name: 'tone', type: 'string', description: 'Translation register', required: true }],
    });

    const content = readFileSync(join(dest, 'p', 'SKILL.md'), 'utf-8');
    expect(content).toContain('- `tone` (string, required): Translation register');
  });

  it('omits description when not provided', () => {
    const dest = tmpPath('params-nodesc');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    skillRenderer.render(minimalOutput, dest, {
      presetName: 'p', description: 'd',
      params: [{ name: 'flag', type: 'boolean', required: false, effectiveDefault: false }],
    });

    const content = readFileSync(join(dest, 'p', 'SKILL.md'), 'utf-8');
    expect(content).toMatch(/- `flag` \(boolean, default: `false`\)\n/);
  });

  it('omits ## Parameters when no params declared', () => {
    const dest = tmpPath('params-none');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    skillRenderer.render(minimalOutput, dest, { presetName: 'p', description: 'd' });

    const content = readFileSync(join(dest, 'p', 'SKILL.md'), 'utf-8');
    expect(content).not.toContain('## Parameters');
  });

  it('renders params in declared order, not alphabetical', () => {
    const dest = tmpPath('params-order');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    skillRenderer.render(minimalOutput, dest, {
      presetName: 'p', description: 'd',
      params: [
        { name: 'zebra', type: 'string', required: false, effectiveDefault: 'z' },
        { name: 'alpha', type: 'string', required: false, effectiveDefault: 'a' },
        { name: 'middle', type: 'string', required: false, effectiveDefault: 'm' },
      ],
    });

    const content = readFileSync(join(dest, 'p', 'SKILL.md'), 'utf-8');
    expect(content.indexOf('`zebra`')).toBeLessThan(content.indexOf('`alpha`'));
    expect(content.indexOf('`alpha`')).toBeLessThan(content.indexOf('`middle`'));
  });
```

- [ ] **Step 2: Verify and commit**

Run: `npx vitest run tests/renderers/skill.test.ts`
Expected: 4 new tests pass (already-implemented behavior — characterization).

```bash
git add tests/renderers/skill.test.ts
git commit -m "test(renderers): pin Parameters special cases (required, no-desc, omit, order)"
```

---

### Task 15: Skill renderer — atomicity (real test with fs spy)

**Files:**
- Modify: `tests/renderers/skill.test.ts`

- [ ] **Step 1: Add a real atomicity test using `vi.spyOn`**

Add `vi` to imports: `import { describe, it, expect, afterEach, vi } from 'vitest';`

```ts
  it('preserves prior skill folder when renameSync fails mid-write', async () => {
    const dest = tmpPath('atomicity');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    // First render succeeds — creates dest/p/SKILL.md
    skillRenderer.render({ ...minimalOutput, prompt: 'first version' }, dest, {
      presetName: 'p',
      description: 'd',
    });
    const firstContent = readFileSync(join(dest, 'p', 'SKILL.md'), 'utf-8');
    expect(firstContent).toContain('first version');

    // Spy on renameSync to throw on the next call only
    const fs = await import('fs');
    const spy = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('simulated rename failure');
    });

    // Second render fails mid-write
    expect(() =>
      skillRenderer.render({ ...minimalOutput, prompt: 'second version' }, dest, {
        presetName: 'p',
        description: 'd',
      }),
    ).toThrow(/simulated rename failure/);

    spy.mockRestore();

    // Original folder content must be intact
    expect(readFileSync(join(dest, 'p', 'SKILL.md'), 'utf-8')).toBe(firstContent);

    // No tmp dir left behind
    const entries = readdirSync(dest);
    const tmpEntries = entries.filter((e) => e.startsWith('p.tmp.'));
    expect(tmpEntries).toEqual([]);
  });
```

- [ ] **Step 2: Run and commit**

Run: `npx vitest run tests/renderers/skill.test.ts -t "atomicity"`
Expected: PASS.

```bash
git add tests/renderers/skill.test.ts
git commit -m "test(renderers): real atomicity test for skill renderer using fs spy"
```

---

### Task 16: Skill renderer — encoding, permissions, idempotence, output-dir, round-trip

**Files:**
- Modify: `tests/renderers/skill.test.ts`

- [ ] **Step 1: Add 5 invariant tests**

```ts
  it('writes file with UTF-8 encoding (BOM-free, valid for non-ASCII content)', () => {
    const dest = tmpPath('encoding');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    skillRenderer.render({ ...minimalOutput, prompt: 'Bonjour — ça va? 中文' }, dest, {
      presetName: 'enc', description: 'desc with é and 中',
    });

    const buf = readFileSync(join(dest, 'enc', 'SKILL.md'));
    // No UTF-8 BOM (EF BB BF)
    expect(buf[0]).not.toBe(0xEF);
    // Round-trip via utf-8 yields the original prose
    const text = buf.toString('utf-8');
    expect(text).toContain('Bonjour — ça va? 中文');
  });

  it('uses LF line endings on all platforms (no CRLF in written content)', () => {
    const dest = tmpPath('lf');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    skillRenderer.render({ ...minimalOutput, prompt: 'line1\nline2\nline3' }, dest, {
      presetName: 'lf', description: 'd',
    });

    const buf = readFileSync(join(dest, 'lf', 'SKILL.md'));
    expect(buf.includes(0x0D)).toBe(false); // no carriage returns
  });

  it('produces byte-for-byte identical SKILL.md across consecutive renders', () => {
    const dest = tmpPath('skill-idempotence');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    const args = {
      presetName: 'p',
      description: 'd',
      params: [{ name: 'lang', type: 'string', required: false, effectiveDefault: 'fr' }],
    } as const;

    skillRenderer.render(minimalOutput, dest, args);
    const first = readFileSync(join(dest, 'p', 'SKILL.md'), 'utf-8');

    skillRenderer.render(minimalOutput, dest, args);
    const second = readFileSync(join(dest, 'p', 'SKILL.md'), 'utf-8');

    expect(first).toBe(second);
  });

  it('writes SKILL.md to <destDir>/<presetName>/SKILL.md', () => {
    const dest = tmpPath('output-dir');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    skillRenderer.render(minimalOutput, dest, { presetName: 'my-skill', description: 'd' });

    expect(existsSync(join(dest, 'my-skill', 'SKILL.md'))).toBe(true);
  });

  it('produces valid YAML frontmatter that round-trips via js-yaml.load', async () => {
    const dest = tmpPath('roundtrip');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    skillRenderer.render(minimalOutput, dest, {
      presetName: 'rt',
      description: 'Use when you need to test round-trip',
    });

    const content = readFileSync(join(dest, 'rt', 'SKILL.md'), 'utf-8');
    const match = content.match(/^---\n([\s\S]+?)\n---\n/);
    expect(match).not.toBeNull();

    const parsed = yaml.load(match![1]) as { name: string; description: string };
    expect(parsed.name).toBe('rt');
    expect(parsed.description).toBe('Use when you need to test round-trip');
  });
```

- [ ] **Step 2: Verify and commit**

Run: `npx vitest run tests/renderers/skill.test.ts`
Expected: 5 new tests pass.

```bash
git add tests/renderers/skill.test.ts
git commit -m "test(renderers): pin encoding, LF, idempotence, output-dir, round-trip invariants"
```

---

### Task 17: Registry sanity tests

**Files:**
- Create: `tests/renderers/index.test.ts`

- [ ] **Step 1: Write the tests**

```ts
// tests/renderers/index.test.ts
import { describe, it, expect } from 'vitest';
import { registry, bundleRenderer, skillRenderer } from '../../src/renderers/index.js';

describe('renderers/index — registry', () => {
  it('contains exactly bundle and skill', () => {
    expect(Object.keys(registry).sort()).toEqual(['bundle', 'skill']);
  });

  it('bundle entry is bundleRenderer', () => {
    expect(registry.bundle).toBe(bundleRenderer);
  });

  it('skill entry is skillRenderer', () => {
    expect(registry.skill).toBe(skillRenderer);
  });

  it('every registered renderer conforms to Renderer interface', () => {
    for (const [key, r] of Object.entries(registry)) {
      expect(typeof r.target).toBe('string');
      expect(r.target.length).toBeGreaterThan(0);
      expect(typeof r.render).toBe('function');
      expect(r.target).toBe(key);
    }
  });
});
```

- [ ] **Step 2: Verify and commit**

Run: `npx vitest run tests/renderers/index.test.ts`
Expected: 4 tests pass.

```bash
git add tests/renderers/index.test.ts
git commit -m "test(renderers): registry sanity"
```

---

## Phase 3 — CLI Fixtures (isolation for integration tests)

### Task 18: Create CLI integration test fixture root

**Files:**
- Create: `tests/fixtures/cli-integration/behaviors/translation.yaml`
- Create: `tests/fixtures/cli-integration/behaviors/no-params.yaml`
- Create: `tests/fixtures/cli-integration/behaviors/with-hooks.yaml`
- Create: `tests/fixtures/cli-integration/presets/translator.yaml`
- Create: `tests/fixtures/cli-integration/presets/inspector.yaml`

These fixtures isolate the CLI integration tests from the project's real `behaviors/`/`presets/` and prevent the bundle renderer from polluting the project root's `.mcp.json` (the integration tests run with `cwd` set to a tmp dir, never the repo root).

- [ ] **Step 1: Create `tests/fixtures/cli-integration/behaviors/translation.yaml`**

```yaml
name: translation
description: "Translation behavior for skill export tests"
category: mission

params:
  target_language:
    type: string
    default: "français"
    description: "Language to translate into"
  tone:
    type: string
    required: true
    description: "Translation register"

sections:
  "030-mission":
    prompt: |
      ## Mission
      Translate input into {{params.target_language}} using a {{params.tone}} tone.
```

- [ ] **Step 2: Create `tests/fixtures/cli-integration/behaviors/no-params.yaml`**

```yaml
name: no-params
description: "Behavior with no params for skill export tests"
category: mission

sections:
  "040-instructions":
    prompt: |
      ## Instructions
      Follow the user's request precisely.
```

- [ ] **Step 3: Create `tests/fixtures/cli-integration/behaviors/with-hooks.yaml`**

```yaml
name: with-hooks
description: "Behavior with hooks for skill warning tests"
category: workspace

sections:
  "010-setup":
    prompt: |
      ## Workspace
      Initialize workspace.

hooks:
  session-start:
    script: setup.sh
    blocking: true
    order: 10
```

- [ ] **Step 4: Create `tests/fixtures/cli-integration/presets/translator.yaml`**

```yaml
name: translator
description: "Use when translating text from one language to another"
behaviors:
  - translation
params:
  translation:
    tone: "neutral"
```

- [ ] **Step 5: Create `tests/fixtures/cli-integration/presets/inspector.yaml`**

```yaml
name: inspector
description: "Use when inspecting projects (includes hooks for testing warnings)"
behaviors:
  - no-params
  - with-hooks
```

- [ ] **Step 6: Smoke-test the fixtures via CLI**

Run: `npx tsx cli/index.ts validate --all --root tests/fixtures/cli-integration`
Expected: validation passes for all 3 behaviors and 2 presets.

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures/cli-integration/
git commit -m "test(fixtures): isolated CLI integration fixture root"
```

---

## Phase 4 — CLI Dispatch

### Task 19: Add `--target` flag scaffolding to `cli/build.ts`

**Files:**
- Modify: `cli/build.ts`

This task only adds the flag and the validation, dispatching to `bundleRenderer` exactly as today. Skill dispatch lands in Task 20.

- [ ] **Step 1: Read current `cli/build.ts`** to refresh on structure (lines 1-86).

- [ ] **Step 2: Add static imports at the top of `cli/build.ts`**

```ts
import { registry } from "../src/renderers/index.js";
import type { RenderedParam } from "../src/renderers/index.js";
```

- [ ] **Step 3: Add the `--target` option** (in the `.option(...)` chain, after `--output`)

```ts
    .option("--target <type>", "Output target: 'bundle' (default) or 'skill'", "bundle")
```

- [ ] **Step 4: Update action signature**

```ts
    .action((agentName: string, opts: { root?: string; dryRun?: boolean; set: string[]; output?: string; target: string }) => {
```

- [ ] **Step 5: Add target validation at the start of the action body** (after `const root = resolveRoot(opts.root);`)

```ts
      const target = opts.target;
      const renderer = registry[target];
      if (!renderer) {
        console.error(`Unknown target '${target}'. Valid: ${Object.keys(registry).join(', ')}`);
        process.exit(1);
      }
```

- [ ] **Step 6: Replace the existing `writeOutput(outputDir, result.output)` call** in the non-dry-run branch with a renderer dispatch (bundle path only — skill path lands in Task 20):

```ts
      } else {
        const defaultOutput = target === 'skill'
          ? resolve(process.cwd(), '.claude', 'skills')
          : resolve(process.cwd(), '.claude', 'promptweave');
        const outputDir = opts.output ?? defaultOutput;

        const renderResult = renderer.render(result.output, outputDir, {
          presetName: agent.preset ?? agent.name,
          projectRoot: process.cwd(),
        });

        console.log(`OK Output written to ${outputDir}`);

        for (const w of result.warnings) console.log(`  ! [pipeline] ${w}`);
        for (const w of renderResult.warnings) console.log(`  ${w}`); // already prefixed with [render]
      }
```

- [ ] **Step 7: Run all tests + smoke test bundle target**

Run: `npm test`
Expected: all tests pass.

Run: `npx tsx cli/index.ts build dev`
Expected: `OK Output written to <cwd>/.claude/promptweave`. Folder content matches the pre-task baseline.

- [ ] **Step 8: Commit**

```bash
git add cli/build.ts
git commit -m "feat(cli): add --target flag and dispatch via renderer registry (bundle only)"
```

---

### Task 20: Wire skill target — description + params resolution

**Files:**
- Modify: `cli/build.ts`

CLI must compute the `description` (from preset) and `params` (from behaviors + preset/agent overrides + launchParams) and pass them via `RenderContext`. Uses the already-public `Registry` and `resolveParams` — no new pipeline surface.

- [ ] **Step 1: Add imports at the top of `cli/build.ts`**

```ts
import { Registry } from "../src/registry.js";
import { resolveParams } from "../src/resolve.js";
```

- [ ] **Step 2: Extract a helper to build skill render context**

Add this function inside the same module (above `createBuildCommand`):

```ts
function buildSkillContext(
  agent: { name: string; preset?: string; params?: Record<string, Record<string, unknown>> },
  behaviors: Array<{ name: string; params?: Record<string, { type: string; default?: unknown; required?: boolean; description?: string }> }>,
  registryInstance: Registry,
  launchParams: Record<string, Record<string, unknown>>,
): { description?: string; params: RenderedParam[] } {
  const presetSlug = agent.preset ?? agent.name;
  const preset = registryInstance.presets.get(presetSlug);
  const description = preset?.description;

  // Resolve params with full precedence: behavior default → preset override → agent override → launchParams override
  const resolvedParams = resolveParams(behaviors as never, preset, agent as never, launchParams);

  const params: RenderedParam[] = [];
  for (const b of behaviors) {
    for (const [pname, pdef] of Object.entries(b.params ?? {})) {
      const effectiveDefault = resolvedParams[b.name]?.[pname] ?? pdef.default;
      params.push({
        name: pname,
        type: pdef.type,
        description: pdef.description,
        required: pdef.required ?? false,
        effectiveDefault,
      });
    }
  }
  return { description, params };
}
```

> **Note:** the cast `behaviors as never` and `agent as never` are pragmatic — `resolveParams`'s exported signature uses the strict zod-inferred types from `src/types.ts`. If TS complains during implementation, refine the helper's parameter types to match exactly. The intent is documented; precise type plumbing is a small refinement during the actual edit.

- [ ] **Step 3: Replace the renderer-dispatch block in the non-dry-run branch** (from Task 19 step 6) with target-aware context-building:

```ts
      } else {
        const defaultOutput = target === 'skill'
          ? resolve(process.cwd(), '.claude', 'skills')
          : resolve(process.cwd(), '.claude', 'promptweave');
        const outputDir = opts.output ?? defaultOutput;

        let ctx: import("../src/renderers/index.js").RenderContext;
        if (target === 'skill') {
          const registryInstance = Registry.load(root);
          const { description, params } = buildSkillContext(agent, result.behaviors, registryInstance, launchParams);
          ctx = {
            presetName: agent.preset ?? agent.name,
            description,
            params,
          };
        } else {
          ctx = {
            presetName: agent.preset ?? agent.name,
            projectRoot: process.cwd(),
          };
        }

        const renderResult = renderer.render(result.output, outputDir, ctx);

        console.log(`OK Output written to ${outputDir}`);
        for (const w of result.warnings) console.log(`  ! [pipeline] ${w}`);
        for (const w of renderResult.warnings) console.log(`  ${w}`);
      }
```

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: all green.

- [ ] **Step 5: Smoke test skill target**

Run: `npx tsx cli/index.ts build translator --target skill --root tests/fixtures/cli-integration --output ./_smoke-skill`
Expected: `OK Output written to ...`; `./_smoke-skill/translator/SKILL.md` exists with frontmatter `name: translator`, body containing the translation mission, `## Parameters` listing `target_language` and `tone`.

Cleanup: `rm -rf _smoke-skill`

- [ ] **Step 6: Commit**

```bash
git add cli/build.ts
git commit -m "feat(cli): wire skill target context (description + resolved params)"
```

---

### Task 21: CLI dry-run for skill mode

**Files:**
- Modify: `cli/build.ts`

- [ ] **Step 1: Locate the dry-run branch** (currently `if (opts.dryRun) { ... }` block).

- [ ] **Step 2: Make the dry-run branch target-aware**

Replace the entire dry-run block with:

```ts
      if (opts.dryRun) {
        console.log("=== Resolution ===");
        console.log(`Agent: ${result.agent.id} (profile: ${result.agent.profile}, model: ${result.agent.model})`);
        console.log(`Behaviors: [${result.behaviors.map((b) => b.name).join(", ")}]`);

        console.log("\n=== Composition rules applied ===");
        if (result.compositionRulesApplied.length === 0) {
          console.log("  (none)");
        } else {
          for (const r of result.compositionRulesApplied) console.log(`  + ${r}`);
        }

        if (target === 'skill') {
          // Render to a tmp dir so we can read the produced SKILL.md and print it
          const { tmpdir } = await import("os");
          const { rmSync, readFileSync, mkdirSync } = await import("fs");
          const tmpDest = join(tmpdir(), `pw-dryrun-${Date.now()}-${Math.random().toString(36).slice(2)}`);
          mkdirSync(tmpDest, { recursive: true });

          const registryInstance = Registry.load(root);
          const { description, params } = buildSkillContext(agent, result.behaviors, registryInstance, launchParams);
          let renderResult;
          try {
            renderResult = renderer.render(result.output, tmpDest, {
              presetName: agent.preset ?? agent.name,
              description,
              params,
            });

            console.log("\n=== Warnings ===");
            const all = [
              ...result.warnings.map((w) => `  ! [pipeline] ${w}`),
              ...renderResult.warnings.map((w) => `  ${w}`),
            ];
            if (all.length === 0) console.log("  (none)");
            else for (const w of all) console.log(w);

            console.log("\n=== SKILL.md ===");
            const skillContent = readFileSync(join(tmpDest, agent.preset ?? agent.name, "SKILL.md"), "utf-8");
            console.log(skillContent);
          } finally {
            try { rmSync(tmpDest, { recursive: true, force: true }); } catch { /* ignore */ }
          }
          return;
        }

        // Bundle dry-run (existing logic preserved verbatim)
        console.log("\n=== Warnings ===");
        if (result.warnings.length === 0) {
          console.log("  (none)");
        } else {
          for (const w of result.warnings) console.log(`  ! ${w}`);
        }

        console.log("\n=== Assembled prompt ===");
        for (const entry of result.sectionTrace) {
          const override = entry.overriddenBy ? `, overridden by rule ${entry.overriddenBy}` : "";
          const prefix = `[${String(entry.number).padStart(3, "0")}] (${entry.behaviorName}${override})`;
          console.log(`${prefix} ${entry.prompt.trim().split("\n")[0]}...`);
        }

        console.log("\n=== Hooks ===");
        for (const [lifecycle, content] of Object.entries(result.output.hooks)) {
          const lines = content.split("\n").filter((l) => l.startsWith("# From"));
          console.log(`  ${lifecycle}: ${lines.map((l) => l.replace("# From behavior: ", "")).join(", ")}`);
        }

        console.log("\n=== MCP tools ===");
        console.log(`  ${result.output.mcpTools.join(", ")}`);

        if (result.output.phases.length > 0) {
          console.log("\n=== Phases ===");
          for (const phase of result.output.phases) {
            const effort = phase.effort ?? "(auto)";
            console.log(`  ${phase.name.padEnd(10)} tools=${phase.toolsMode.padEnd(9)} loop=${String(phase.loop).padEnd(5)} effort=${effort}`);
          }
        }
      }
```

- [ ] **Step 3: Mark the action async** (the `await import` calls in the skill dry-run branch require it)

```ts
    .action(async (agentName: string, opts: { root?: string; dryRun?: boolean; set: string[]; output?: string; target: string }) => {
```

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: all green.

- [ ] **Step 5: Smoke test dry-run skill mode**

Run: `npx tsx cli/index.ts build translator --target skill --dry-run --root tests/fixtures/cli-integration`
Expected output structure:

```
=== Resolution ===
Agent: translator (profile: ..., model: ...)
Behaviors: [translation]

=== Composition rules applied ===
  (none)

=== Warnings ===
  (none)

=== SKILL.md ===
---
name: translator
description: Use when translating text from one language to another
---

## Mission
Translate input into français using a neutral tone.

## Parameters

- `target_language` (string, default: `"français"`): Language to translate into
- `tone` (string, default: `"neutral"`): Translation register
```

- [ ] **Step 6: Commit**

```bash
git add cli/build.ts
git commit -m "feat(cli): target-aware dry-run for skill mode"
```

---

### Task 22: CLI integration tests (using fixture root)

**Files:**
- Create: `tests/cli/build.test.ts`

These tests use the fixture root from Task 18 and an isolated `cwd` to prevent any pollution of the real project's `.mcp.json` or `presets/`.

- [ ] **Step 1: Write the tests**

```ts
// tests/cli/build.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import { mkdirSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const FIXTURE_ROOT = resolve(REPO_ROOT, 'tests', 'fixtures', 'cli-integration');

function runCli(
  args: string,
  opts?: { cwd?: string; expectFail?: boolean },
): { stdout: string; stderr: string; code: number } {
  const cliPath = join(REPO_ROOT, 'cli', 'index.ts');
  // Quote paths to survive any future spaces in temp directories
  const cmd = `npx tsx "${cliPath}" ${args}`;
  try {
    const stdout = execSync(cmd, {
      cwd: opts?.cwd ?? REPO_ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    if (!opts?.expectFail) throw err;
    return {
      stdout: typeof e.stdout === 'string' ? e.stdout : (e.stdout?.toString() ?? ''),
      stderr: typeof e.stderr === 'string' ? e.stderr : (e.stderr?.toString() ?? ''),
      code: e.status ?? 1,
    };
  }
}

function tmpDir(prefix: string): string {
  return join(tmpdir(), `pw-cli-test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

describe('cli/build — --target dispatch (fixture-isolated)', () => {
  const cleanup: string[] = [];
  afterEach(() => {
    for (const d of cleanup) {
      try { if (existsSync(d)) rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    cleanup.length = 0;
  });

  it('--target skill writes SKILL.md to <output>/<presetName>/SKILL.md', () => {
    const out = tmpDir('skill-out');
    const cwd = tmpDir('skill-cwd');
    cleanup.push(out, cwd);
    mkdirSync(out, { recursive: true });
    mkdirSync(cwd, { recursive: true });

    runCli(`build translator --target skill --root "${FIXTURE_ROOT}" --output "${out}"`, { cwd });

    const skillPath = join(out, 'translator', 'SKILL.md');
    expect(existsSync(skillPath)).toBe(true);
    const content = readFileSync(skillPath, 'utf-8');
    expect(content).toMatch(/^---\nname: translator/);
    expect(content).toContain('## Parameters');
  });

  it('--target bundle (explicit) produces same prompt content as no flag', () => {
    const outA = tmpDir('bundle-explicit');
    const outB = tmpDir('bundle-default');
    const cwdA = tmpDir('cwd-a');
    const cwdB = tmpDir('cwd-b');
    cleanup.push(outA, outB, cwdA, cwdB);
    mkdirSync(cwdA, { recursive: true });
    mkdirSync(cwdB, { recursive: true });

    runCli(`build inspector --target bundle --root "${FIXTURE_ROOT}" --output "${outA}"`, { cwd: cwdA });
    runCli(`build inspector --root "${FIXTURE_ROOT}" --output "${outB}"`, { cwd: cwdB });

    const promptA = readFileSync(join(outA, 'generated-prompt.md'), 'utf-8');
    const promptB = readFileSync(join(outB, 'generated-prompt.md'), 'utf-8');
    expect(promptA).toBe(promptB);
  });

  it('--target unknown-value exits non-zero and lists valid targets', () => {
    const cwd = tmpDir('unknown-cwd');
    cleanup.push(cwd);
    mkdirSync(cwd, { recursive: true });

    const result = runCli(`build translator --target nonexistent --root "${FIXTURE_ROOT}"`, { cwd, expectFail: true });
    expect(result.code).not.toBe(0);
    const combined = result.stderr + result.stdout;
    expect(combined).toMatch(/Unknown target 'nonexistent'/);
    expect(combined).toMatch(/bundle/);
    expect(combined).toMatch(/skill/);
  });

  it('--dry-run --target skill prints SKILL.md to stdout and writes nothing', () => {
    const out = tmpDir('dryrun-out');
    const cwd = tmpDir('dryrun-cwd');
    cleanup.push(out, cwd);
    mkdirSync(out, { recursive: true });
    mkdirSync(cwd, { recursive: true });

    const result = runCli(`build translator --target skill --dry-run --root "${FIXTURE_ROOT}" --output "${out}"`, { cwd });

    expect(result.stdout).toContain('=== Resolution ===');
    expect(result.stdout).toContain('=== SKILL.md ===');
    expect(result.stdout).toContain('name: translator');

    expect(existsSync(join(out, 'translator'))).toBe(false);
  });

  it('--target skill with hooks-bearing preset emits dropped-hooks warning', () => {
    const out = tmpDir('hooks-out');
    const cwd = tmpDir('hooks-cwd');
    cleanup.push(out, cwd);
    mkdirSync(out, { recursive: true });
    mkdirSync(cwd, { recursive: true });

    const result = runCli(`build inspector --target skill --root "${FIXTURE_ROOT}" --output "${out}"`, { cwd });

    expect(result.stdout).toMatch(/\[render\] skill target ignores hooks/);
  });
});
```

- [ ] **Step 2: Run the integration tests**

Run: `npx vitest run tests/cli/build.test.ts`
Expected: 5 tests pass. Slower than unit tests (~15-30s total because of the tsx subshells).

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 4: Verify no `.mcp.json` pollution at repo root**

Run: `git status`
Expected: no modification to `.mcp.json` at the repo root caused by tests. (Bundle tests use isolated `cwd` paths under `tmpdir()`.)

- [ ] **Step 5: Commit**

```bash
git add tests/cli/build.test.ts
git commit -m "test(cli): integration tests for --target dispatch using fixture root"
```

---

## Phase 5 — Documentation & Final Smoke

### Task 23: Update README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the CLI reference table** — find the `build` row and replace with:

```markdown
| `promptweave build <preset> [--root PATH] [--dry-run] [--target TARGET] [--output DIR] [--set k=v]` | Assemble a preset into output files (target: `bundle` default, or `skill`) |
```

- [ ] **Step 2: Add a `## Skill export` section after the CLI reference**

```markdown
## Skill export

`promptweave` can emit Claude Code skills directly from your presets. Use this when you want to maintain a catalog of skills with shared building blocks: extract recurring patterns into `behaviors/`, group them into one preset per skill, and regenerate `SKILL.md` files reproducibly.

```bash
promptweave build my-translator --target skill
# Writes .claude/skills/my-translator/SKILL.md
```

The `--target skill` flag produces a single `SKILL.md` per preset, with:

- **Frontmatter** — `name` (slug-validated, must match `^[a-z0-9-]+$`) and `description` (verbatim from the preset, YAML-safely escaped).
- **Body** — the fully composed prompt from your behaviors.
- **`## Parameters` section** (auto-generated when params are declared) — lists every param declared by composing behaviors with type, effective default (after preset/agent/`--set` overrides), and description.

Fields that don't fit the skill format (hooks, MCP tools, phases, env vars) are dropped with explicit warnings on stdout.

**Caveat:** the output directory is destroyed and rewritten on each build. Manual edits to a generated `SKILL.md` are lost — treat the YAML behaviors and presets as the source of truth.
```

- [ ] **Step 3: Add a use-case bullet in `## Use cases`**

```markdown
- **Skill catalog maintenance.** Extract recurring instruction patterns from existing Claude Code skills into reusable behaviors. Compose presets matching each skill, regenerate `SKILL.md` files reproducibly, and propagate fixes from a single behavior file across every skill that includes it.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): document --target skill flag and skill export use case"
```

---

### Task 24: Final regression and manual smoke

**Files:** none

- [ ] **Step 1: Run the full test suite from clean state**

Run: `npm test`
Expected: all tests green.

- [ ] **Step 2: Smoke test bundle target unchanged**

Run: `npx tsx cli/index.ts build dev`
Expected: output to `<cwd>/.claude/promptweave/`. Compare key files against the pre-refactor baseline if a copy was kept.

- [ ] **Step 3: Smoke test skill target with bundled `inspect` preset**

Run: `npx tsx cli/index.ts build inspect --target skill`
Expected: `.claude/skills/inspect/SKILL.md` exists; frontmatter is valid YAML; body has the composed prompt; warnings about dropped hooks were printed at build time.

- [ ] **Step 4: Verify slug validation hard-fails on non-conforming names**

Create `presets/_smoketest.yaml` with:

```yaml
name: "Bad Name!"
description: "smoke test"
behaviors: [project-context]
```

Run: `npx tsx cli/index.ts build _smoketest --target skill`
Expected: exit code 1; error message matches `skill target requires preset name to match ^[a-z0-9-]+$ (got: 'Bad Name!')`.

Cleanup: `rm presets/_smoketest.yaml`.

- [ ] **Step 5: Verify unknown target hard-fails**

Run: `npx tsx cli/index.ts build inspect --target nope`
Expected: exit code 1; stderr/stdout contains `Unknown target 'nope'. Valid: bundle, skill`.

- [ ] **Step 6: No commit needed** — implementation is complete. If anything failed, file an issue or roll back the relevant task; do not paper over a regression.

---

## Summary

After all 24 tasks:
- `src/renderers/{index,bundle,skill}.ts` exist with a minimal `Renderer` interface and two implementations.
- `src/writer.ts` is a thin shim — public API surface preserved.
- `cli/build.ts` dispatches by `--target` using **static imports** (no dynamic `await import`); skill mode populates `RenderContext` via `Registry.load` + `resolveParams` (no pipeline surface change).
- Test coverage:
  - Bundle migration (8 tests + 2 characterization)
  - Skill renderer (~25 tests covering frontmatter, slug, empty prompt, drop-and-warn × 4, frontmatter collision, Parameters basic + special cases, real atomicity via fs spy, encoding, LF, idempotence, output-dir, round-trip)
  - Registry (4 tests)
  - CLI integration (5 tests using isolated fixture root)
- Fixtures isolate CLI integration tests from project state — no `.mcp.json` pollution.
- README documents the new flag, use case, and overwrite caveat.

Total commits: 24, each landing a coherent unit of work.

---

## Known Limitations Carried Forward

These are documented in the spec (`§10`) but worth re-stating here so they're not "discovered" during implementation:

1. No behavior-level target affinity (`targets:` field) — future work.
2. Composition rules are target-agnostic — authorial concern.
3. No round-trip parsing (skill → preset).
4. Single-file output only.
5. Manual edits to generated `SKILL.md` are silently overwritten.
6. Build-time-only params (e.g., `project-context`'s `language`) surface in `## Parameters` of any skill that includes them.
7. **Drop-warning text lists field keys, not behavior names** (spec §5 says behavior names; v1 lists hook lifecycle names / mcpTool names / etc. because `AssembledOutput` does not preserve per-behavior provenance). This is an acknowledged spec deviation; lifting it requires pipeline changes (out of v1 scope).
