import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { Registry } from '../src/registry.js';
import { resolveBehaviors, resolveParams } from '../src/resolve.js';
import type { Agent } from '../src/types.js';

const FIXTURES = resolve(import.meta.dirname, './fixtures');

describe('resolveBehaviors', () => {
  const registry = Registry.load(FIXTURES);

  it('resolves a preset into a flat behavior list', () => {
    const agent: Agent = { name: 'test', preset: 'raid', add: [], remove: [], params: {} };
    const result = resolveBehaviors(agent, registry);
    expect(result.behaviors).toEqual([
      'worktree-isolation',
      'announce-before-write',
      'conflict-resolution',
      'bug-hunting',
    ]);
  });

  it('applies add', () => {
    const agent: Agent = {
      name: 'test',
      preset: 'raid',
      add: ['formal-tone'],
      remove: [],
      params: {},
    };
    const result = resolveBehaviors(agent, registry);
    expect(result.behaviors).toContain('formal-tone');
  });

  it('applies remove', () => {
    const agent: Agent = {
      name: 'test',
      preset: 'raid',
      add: [],
      remove: ['bug-hunting'],
      params: {},
    };
    const result = resolveBehaviors(agent, registry);
    expect(result.behaviors).not.toContain('bug-hunting');
  });

  it('resolves direct behaviors (no preset)', () => {
    const agent: Agent = {
      name: 'test',
      behaviors: ['worktree-isolation', 'bug-hunting'],
      add: [],
      remove: [],
      params: {},
    };
    const result = resolveBehaviors(agent, registry);
    expect(result.behaviors).toEqual(['worktree-isolation', 'bug-hunting']);
  });

  it('errors on unknown preset', () => {
    const agent: Agent = { name: 'test', preset: 'nonexistent', add: [], remove: [], params: {} };
    expect(() => resolveBehaviors(agent, registry)).toThrow(/preset.*nonexistent.*not found/i);
  });

  it('does not add duplicates', () => {
    const agent: Agent = {
      name: 'test',
      preset: 'raid',
      add: ['worktree-isolation'],
      remove: [],
      params: {},
    };
    const result = resolveBehaviors(agent, registry);
    const count = result.behaviors.filter((b) => b === 'worktree-isolation').length;
    expect(count).toBe(1);
  });
});

describe('resolveParams', () => {
  const registry = Registry.load(FIXTURES);

  it('merges params with precedence: launch > agent > preset > default', () => {
    const result = resolveParams(
      ['announce-before-write'],
      registry,
      { 'announce-before-write': { announce_threshold: 5 } },
      { 'announce-before-write': { announce_threshold: 10 } },
      { 'announce-before-write': { announce_threshold: 20 } },
    );
    expect(result['announce-before-write']?.announce_threshold).toBe(20);
  });

  it('falls back to default when no override', () => {
    const result = resolveParams(
      ['announce-before-write'],
      registry,
      {},
      {},
      {},
    );
    expect(result['announce-before-write']?.announce_threshold).toBe(1);
  });

  it('fills optional params without defaults with empty values by type', () => {
    const result = resolveParams(
      ['bug-hunting'],
      registry,
      {},
      {},
      {},
    );
    expect(result['bug-hunting']?.modules).toEqual([]);
  });

  it('skips behaviors not found in registry', () => {
    const result = resolveParams(
      ['nonexistent-behavior', 'announce-before-write'],
      registry,
      {},
      {},
      {},
    );
    expect(result['nonexistent-behavior']).toBeUndefined();
    expect(result['announce-before-write']?.announce_threshold).toBe(1);
  });
});

