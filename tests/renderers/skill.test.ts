// tests/renderers/skill.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { join, resolve } from 'path';
import { mkdirSync, readFileSync, rmSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import yaml from 'js-yaml';
import { skillRenderer } from '../../src/renderers/skill.js';
import type { AssembledOutput } from '../../src/types.js';

// vi.hoisted ensures this object is initialised before vi.mock factories run.
// The mock factory closes over the returned object so tests can arm failures:
//   renameControl.fail = true          → fail on the very next renameSync call (one-shot)
//   renameControl.failOnCall = N (> 0) → fail on the N-th renameSync call in this render (one-shot, resets after trigger)
const renameControl = vi.hoisted(() => ({ fail: false, failOnCall: 0, _callCount: 0 }));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    renameSync: (oldPath: string, newPath: string) => {
      // Step-1 one-shot: fail immediately on next call
      if (renameControl.fail) {
        renameControl.fail = false;
        throw new Error('simulated rename failure');
      }
      // Step-N one-shot: count calls, fail on the N-th
      if (renameControl.failOnCall > 0) {
        renameControl._callCount++;
        if (renameControl._callCount >= renameControl.failOnCall) {
          renameControl.failOnCall = 0;
          renameControl._callCount = 0;
          throw new Error('simulated step-2 rename failure');
        }
      }
      actual.renameSync(oldPath, newPath);
    },
  };
});

function tmpPath(suffix: string): string {
  return join(tmpdir(), `pw-skill-test-${Date.now()}-${Math.random().toString(36).slice(2)}-${suffix}`);
}

describe('skillRenderer.render', () => {
  const cleanup: string[] = [];
  afterEach(() => {
    for (const d of cleanup) {
      try { if (existsSync(d)) rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    const parentsSeen = new Set<string>();
    for (const d of cleanup) {
      const parent = resolve(d, '..');
      if (parentsSeen.has(parent)) continue;
      parentsSeen.add(parent);
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

  it('throws on non-slug preset name', () => {
    const dest = tmpPath('slug-fail');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    expect(() =>
      skillRenderer.render(minimalOutput, dest, { presetName: 'Mon Skill!', description: 'd' }),
    ).toThrow(/^skill target requires preset name to match \^\[a-z0-9-\]\+\$ \(got: 'Mon Skill!'\)$/);
  });

  it('throws when output.prompt is empty', () => {
    const dest = tmpPath('empty-prompt');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    const output: AssembledOutput = { ...minimalOutput, prompt: '' };
    expect(() =>
      skillRenderer.render(output, dest, { presetName: 'empty', description: 'd' }),
    ).toThrow(/produces empty prompt/);
  });

  it('escapes description containing : # newlines and leading -', () => {
    const dest = tmpPath('escape-desc');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    skillRenderer.render(minimalOutput, dest, {
      presetName: 'esc',
      description: 'Use when: input has # markers\nor multi-line - prose',
    });

    const content = readFileSync(join(dest, 'esc', 'SKILL.md'), 'utf-8');
    const match = content.match(/^---\n([\s\S]+?)\n---\n/);
    expect(match).not.toBeNull();
    const parsed = yaml.load(match![1]) as { description: string };
    expect(parsed.description).toBe('Use when: input has # markers\nor multi-line - prose');
  });

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

  it('warns when envVars are declared', () => {
    const dest = tmpPath('drop-env');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    const output: AssembledOutput = { ...minimalOutput, envVars: { FOO: 'bar' } };

    const result = skillRenderer.render(output, dest, { presetName: 'p', description: 'd' });
    expect(result.warnings).toContain('[render] skill target ignores envVars declared by behaviors: FOO');
  });

  it('warns when output.prompt starts with frontmatter delimiter', () => {
    const dest = tmpPath('prompt-collision');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    const output: AssembledOutput = { ...minimalOutput, prompt: '---\nweird: value\n---\nactual content' };

    const result = skillRenderer.render(output, dest, { presetName: 'p', description: 'd' });
    expect(result.warnings).toContain('[render] composed prompt starts with frontmatter delimiter; rendered SKILL.md may have ambiguous frontmatter parsing');
    expect(existsSync(join(dest, 'p', 'SKILL.md'))).toBe(true);
  });

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

  it('preserves prior skill folder when renameSync fails mid-write', () => {
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

    // Arm the one-shot renameSync failure injected via vi.mock factory above
    renameControl.fail = true;

    // Second render fails mid-write
    expect(() =>
      skillRenderer.render({ ...minimalOutput, prompt: 'second version' }, dest, {
        presetName: 'p',
        description: 'd',
      }),
    ).toThrow(/simulated rename failure/);

    // Original folder content must be intact
    expect(readFileSync(join(dest, 'p', 'SKILL.md'), 'utf-8')).toBe(firstContent);

    // No tmp dir left behind
    const entries = readdirSync(dest);
    const tmpEntries = entries.filter((e) => e.startsWith('p.tmp.'));
    expect(tmpEntries).toEqual([]);
  });

  it('restores backup when renameSync fails AFTER backup was created (step 2 failure)', () => {
    const dest = tmpPath('atomicity-step2');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    // First render succeeds — creates dest/p/SKILL.md
    skillRenderer.render({ ...minimalOutput, prompt: 'first version' }, dest, {
      presetName: 'p',
      description: 'd',
    });
    const firstContent = readFileSync(join(dest, 'p', 'SKILL.md'), 'utf-8');
    expect(firstContent).toContain('first version');

    // Arm: fail on the SECOND renameSync call within the next render
    // (first call: skillFolder → backupFolder succeeds; second call: tmp → skillFolder fails)
    renameControl.failOnCall = 2;
    renameControl._callCount = 0;

    // Second render should attempt step 1 (success), then step 2 (fail), then restore backup
    expect(() =>
      skillRenderer.render({ ...minimalOutput, prompt: 'second version' }, dest, {
        presetName: 'p',
        description: 'd',
      }),
    ).toThrow(/step-2 rename failure/);

    // Original folder content must be intact (restored from backup)
    expect(readFileSync(join(dest, 'p', 'SKILL.md'), 'utf-8')).toBe(firstContent);

    // No tmp dir, no .bak dir left behind
    const entries = readdirSync(dest);
    const stale = entries.filter((e) => e.startsWith('p.tmp.') || e.startsWith('p.bak.'));
    expect(stale).toEqual([]);
  });

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
    };

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

  it('produces valid YAML frontmatter that round-trips via js-yaml.load', () => {
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

  it('merges extraFrontmatter into the YAML frontmatter', () => {
    const dest = tmpPath('extra-frontmatter');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    skillRenderer.render(minimalOutput, dest, {
      presetName: 'p',
      description: 'd',
      extraFrontmatter: {
        'argument-hint': '1-5 | step-name',
        'allowed-tools': ['Read', 'Edit'],
        'disable-model-invocation': true,
      },
    });

    const content = readFileSync(join(dest, 'p', 'SKILL.md'), 'utf-8');
    const match = content.match(/^---\n([\s\S]+?)\n---\n/);
    expect(match).not.toBeNull();
    const parsed = yaml.load(match![1]) as Record<string, unknown>;

    expect(parsed.name).toBe('p');
    expect(parsed.description).toBe('d');
    expect(parsed['argument-hint']).toBe('1-5 | step-name');
    expect(parsed['allowed-tools']).toEqual(['Read', 'Edit']);
    expect(parsed['disable-model-invocation']).toBe(true);
  });

  it('preset name and description always win over conflicting extraFrontmatter keys', () => {
    const dest = tmpPath('extra-conflict');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    skillRenderer.render(minimalOutput, dest, {
      presetName: 'real-name',
      description: 'real description',
      extraFrontmatter: {
        name: 'fake-name',
        description: 'fake description',
        'argument-hint': 'hint',
      },
    });

    const content = readFileSync(join(dest, 'real-name', 'SKILL.md'), 'utf-8');
    const match = content.match(/^---\n([\s\S]+?)\n---\n/);
    const parsed = yaml.load(match![1]) as Record<string, string>;

    expect(parsed.name).toBe('real-name');
    expect(parsed.description).toBe('real description');
    expect(parsed['argument-hint']).toBe('hint');
  });

  it('omits extra frontmatter when preset declares none', () => {
    const dest = tmpPath('extra-none');
    cleanup.push(dest);
    mkdirSync(dest, { recursive: true });

    skillRenderer.render(minimalOutput, dest, { presetName: 'p', description: 'd' });

    const content = readFileSync(join(dest, 'p', 'SKILL.md'), 'utf-8');
    const match = content.match(/^---\n([\s\S]+?)\n---\n/);
    const parsed = yaml.load(match![1]) as Record<string, unknown>;

    // Only name and description, nothing else
    expect(Object.keys(parsed).sort()).toEqual(['description', 'name']);
  });
});
