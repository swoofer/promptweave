import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { Registry } from '../src/registry.js';
import { applyCompositionRules, matchRules } from '../src/compose.js';
import type { Behavior } from '../src/types.js';

const FIXTURES = resolve(import.meta.dirname, './fixtures');

describe('matchRules', () => {
  const registry = Registry.load(FIXTURES);

  it('matches a rule when all conditions are met', () => {
    const active = new Set(['announce-before-write', 'sequential-pipeline']);
    const matched = matchRules(active, registry);
    expect(matched.map((r) => r.name)).toContain('announce-after-relay');
  });

  it('does not match when conditions are not met', () => {
    const active = new Set(['worktree-isolation', 'bug-hunting']);
    const matched = matchRules(active, registry);
    expect(matched).toEqual([]);
  });
});

describe('applyCompositionRules', () => {
  const registry = Registry.load(FIXTURES);

  it('overrides a section when rule matches', () => {
    const behaviorsMap = new Map<string, Behavior>();
    behaviorsMap.set('announce-before-write', registry.getBehavior('announce-before-write')!);
    behaviorsMap.set('sequential-pipeline', registry.getBehavior('sequential-pipeline')!);

    const result = applyCompositionRules(behaviorsMap, registry);

    const modified = result.behaviors.get('announce-before-write')!;
    expect(modified.sections['020-before-coding'].prompt).toContain('relay');
    expect(result.appliedRules).toContain('announce-after-relay');
  });

  it('tracks overridden sections', () => {
    const behaviorsMap = new Map<string, Behavior>();
    behaviorsMap.set('announce-before-write', registry.getBehavior('announce-before-write')!);
    behaviorsMap.set('sequential-pipeline', registry.getBehavior('sequential-pipeline')!);

    const result = applyCompositionRules(behaviorsMap, registry);
    expect(result.overriddenSections.get('announce-before-write:020-before-coding')).toBe('announce-after-relay');
  });

  it('does nothing when no rules match', () => {
    const behaviorsMap = new Map<string, Behavior>();
    behaviorsMap.set('worktree-isolation', registry.getBehavior('worktree-isolation')!);
    behaviorsMap.set('bug-hunting', registry.getBehavior('bug-hunting')!);

    const result = applyCompositionRules(behaviorsMap, registry);
    expect(result.appliedRules).toEqual([]);
    expect(result.overriddenSections.size).toBe(0);
  });

  it('does not mutate original behaviors', () => {
    const original = registry.getBehavior('announce-before-write')!;
    const originalPrompt = original.sections['020-before-coding'].prompt;

    const behaviorsMap = new Map<string, Behavior>();
    behaviorsMap.set('announce-before-write', original);
    behaviorsMap.set('sequential-pipeline', registry.getBehavior('sequential-pipeline')!);

    applyCompositionRules(behaviorsMap, registry);

    // Original should not have been mutated
    expect(original.sections['020-before-coding'].prompt).toBe(originalPrompt);
  });
});

describe('params_match', () => {
  it('matches when params equal expected values', () => {
    const registry = Registry.load(FIXTURES);
    // Add a composition rule with params_match inline for testing
    registry.compositions.set('params-test', {
      name: 'params-test',
      description: 'test',
      priority: 0,
      when: {
        all: ['announce-before-write'],
        any: [],
        none: [],
        params_match: {
          'announce-before-write': { announce_threshold: 5 },
        },
      },
      actions: {
        override_sections: [],
        inject_sections: {},
        override_params: [],
        disable_behaviors: [],
      },
    });

    const active = new Set(['announce-before-write', 'conflict-resolution']);

    // Should NOT match — param doesn't equal expected
    const noMatch = matchRules(active, registry, {
      'announce-before-write': { announce_threshold: 1 },
    });
    expect(noMatch.some(r => r.name === 'params-test')).toBe(false);

    // Should match — param equals expected
    const match = matchRules(active, registry, {
      'announce-before-write': { announce_threshold: 5 },
    });
    expect(match.some(r => r.name === 'params-test')).toBe(true);

    // Cleanup
    registry.compositions.delete('params-test');
  });

  it('matches when params_match is empty (default)', () => {
    const registry = Registry.load(FIXTURES);
    const active = new Set(['announce-before-write', 'sequential-pipeline']);
    // The announce-after-relay rule has no params_match, should still match
    const matched = matchRules(active, registry, {});
    expect(matched.some(r => r.name === 'announce-after-relay')).toBe(true);
  });
});
