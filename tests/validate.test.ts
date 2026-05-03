import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { Registry } from '../src/registry.js';
import { validateBehaviors } from '../src/validate.js';

const FIXTURES = resolve(import.meta.dirname, './fixtures');

describe('validateBehaviors', () => {
  const registry = Registry.load(FIXTURES);

  it('passes for a valid behavior set', () => {
    const errors = validateBehaviors(
      ['worktree-isolation', 'conflict-resolution'],
      registry,
      {},
    );
    expect(errors).toEqual([]);
  });

  it('errors when a required behavior is missing', () => {
    const errors = validateBehaviors(
      ['announce-before-write'],
      registry,
      {},
    );
    expect(errors.some((e) => e.includes('conflict-resolution'))).toBe(true);
  });

  it('errors when conflicting behaviors are both present', () => {
    const errors = validateBehaviors(
      ['announce-before-write', 'conflict-resolution', 'silent-mode'],
      registry,
      {},
    );
    expect(errors.some((e) => e.includes('conflicts_with') || e.includes('silent-mode'))).toBe(true);
  });

  it('errors on unknown behavior', () => {
    const errors = validateBehaviors(
      ['nonexistent-behavior'],
      registry,
      {},
    );
    expect(errors.some((e) => e.includes('nonexistent-behavior'))).toBe(true);
  });

  it('detects circular dependencies', () => {
    const circularBehaviorA = {
      name: 'circ-a',
      description: 'test',
      requires: { behaviors: ['circ-b'], infrastructure: [] },
      conflicts_with: [],
      suggests: [],
      params: {},
      sections: { '010-test': { prompt: 'test' } },
      hooks: {},
      mcp_tools: [],
    };
    const circularBehaviorB = {
      name: 'circ-b',
      description: 'test',
      requires: { behaviors: ['circ-a'], infrastructure: [] },
      conflicts_with: [],
      suggests: [],
      params: {},
      sections: { '010-test': { prompt: 'test' } },
      hooks: {},
      mcp_tools: [],
    };

    const mockRegistry = Registry.load(FIXTURES);
    mockRegistry.behaviors.set('circ-a', circularBehaviorA as any);
    mockRegistry.behaviors.set('circ-b', circularBehaviorB as any);

    const errors = validateBehaviors(
      ['circ-a', 'circ-b'],
      mockRegistry,
      {},
    );
    expect(errors.some((e) => /circulaire|circular/i.test(e))).toBe(true);
  });

  it('validates param types', () => {
    const errors = validateBehaviors(
      ['announce-before-write', 'conflict-resolution'],
      registry,
      { 'announce-before-write': { announce_threshold: 'not-a-number' } },
    );
    expect(errors.some((e) => e.includes('announce_threshold'))).toBe(true);
  });

  it('errors on required param not provided', () => {
    const errors = validateBehaviors(['bug-hunting'], registry, {});
    expect(errors).toEqual([]);
  });

  it('warns on unavailable infrastructure', () => {
    const errors = validateBehaviors(
      ['announce-before-write', 'conflict-resolution'],
      registry,
      {},
      { 'mcp-coordinator': false },
    );
    expect(errors.some((e) => e.includes('mcp-coordinator'))).toBe(true);
  });

  it('passes when infrastructure is available', () => {
    const errors = validateBehaviors(
      ['announce-before-write', 'conflict-resolution'],
      registry,
      {},
      { 'mcp-coordinator': true },
    );
    expect(errors).toEqual([]);
  });
});
