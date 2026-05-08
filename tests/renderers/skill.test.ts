// tests/renderers/skill.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { join, resolve } from 'path';
import { mkdirSync, readFileSync, rmSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import yaml from 'js-yaml';
import { skillRenderer } from '../../src/renderers/skill.js';
import type { AssembledOutput } from '../../src/types.js';

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
});
