import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { Registry } from '../src/registry.js';
import { generateWarnings } from '../src/warnings.js';
import type { Behavior } from '../src/types.js';

const FIXTURES = resolve(import.meta.dirname, './fixtures');

describe('generateWarnings', () => {
  const registry = Registry.load(FIXTURES);

  it('warns on section collisions without a composition rule', () => {
    const behaviors = new Map<string, Behavior>();
    behaviors.set('announce-before-write', registry.getBehavior('announce-before-write')!);
    behaviors.set('sequential-pipeline', registry.getBehavior('sequential-pipeline')!);

    const warnings = generateWarnings(behaviors, [], registry, '');
    expect(warnings.some((w) => w.includes('020') && w.includes('collision'))).toBe(true);
  });

  it('does not warn on collision if a composition rule covers that pair', () => {
    const behaviors = new Map<string, Behavior>();
    behaviors.set('announce-before-write', registry.getBehavior('announce-before-write')!);
    behaviors.set('sequential-pipeline', registry.getBehavior('sequential-pipeline')!);

    const warnings = generateWarnings(
      behaviors,
      ['announce-after-relay'],
      registry,
      '',
    );
    expect(warnings.some((w) => w.includes('020') && w.includes('collision'))).toBe(false);
  });

  it('still warns on collision for an unrelated pair even if another rule was applied', () => {
    const behaviors = new Map<string, Behavior>();
    behaviors.set('announce-before-write', registry.getBehavior('announce-before-write')!);
    behaviors.set('sequential-pipeline', registry.getBehavior('sequential-pipeline')!);

    const warnings = generateWarnings(
      behaviors,
      ['some-unrelated-rule'],
      registry,
      '',
    );
    expect(warnings.some((w) => w.includes('020') && w.includes('collision'))).toBe(true);
  });

  it('warns on missing suggests', () => {
    const behaviors = new Map<string, Behavior>();
    behaviors.set('announce-before-write', registry.getBehavior('announce-before-write')!);
    behaviors.set('conflict-resolution', registry.getBehavior('conflict-resolution')!);

    const warnings = generateWarnings(behaviors, [], registry, '');
    expect(warnings.some((w) => w.includes('worktree-isolation') && w.includes('suggests'))).toBe(true);
  });

  it('warns on oversized prompt', () => {
    const behaviors = new Map<string, Behavior>();
    behaviors.set('worktree-isolation', registry.getBehavior('worktree-isolation')!);

    const bigPrompt = 'x'.repeat(50000);
    const warnings = generateWarnings(behaviors, [], registry, bigPrompt, 1000);
    expect(warnings.some((w) => /taille|size/i.test(w))).toBe(true);
  });

  it('returns empty for a clean setup', () => {
    const behaviors = new Map<string, Behavior>();
    behaviors.set('worktree-isolation', registry.getBehavior('worktree-isolation')!);
    behaviors.set('bug-hunting', registry.getBehavior('bug-hunting')!);

    const warnings = generateWarnings(behaviors, [], registry, 'short prompt');
    expect(warnings).toEqual([]);
  });
});
