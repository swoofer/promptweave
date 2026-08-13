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

describe('generateWarnings — params posés puis jetés', () => {
  const registry = Registry.load(FIXTURES);

  function behavior(overrides: Partial<Behavior> & { name: string }): Map<string, Behavior> {
    const b = {
      description: 'test',
      category: 'mission',
      sections: { '030-mission': { prompt: 'statique' } },
      params: {},
      hooks: {},
      mcp_tools: [],
      side_car_files: {},
      requires: { behaviors: [], infrastructure: [] },
      conflicts_with: [],
      suggests: [],
      ...overrides,
    } as Behavior;
    return new Map([[b.name, b]]);
  }

  const CATEGORIES = { categories: { type: 'string[]' as const, required: false } };

  it('avertit quand une valeur fournie ne peut atteindre aucun canal', () => {
    const behaviors = behavior({ name: 'quality-audit', params: CATEGORIES });

    const warnings = generateWarnings(behaviors, [], registry, '', undefined, {
      'quality-audit': { categories: ['custom'] },
    });

    expect(warnings.some((w) => w.includes('quality-audit') && w.includes('categories'))).toBe(true);
  });

  it('n\'avertit pas quand la valeur fournie est bien interpolée', () => {
    const behaviors = behavior({
      name: 'quality-audit',
      params: CATEGORIES,
      sections: { '030-mission': { prompt: '{{#each params.categories}}- {{this}}{{/each}}' } },
    });

    const warnings = generateWarnings(behaviors, [], registry, '', undefined, {
      'quality-audit': { categories: ['custom'] },
    });

    expect(warnings).toEqual([]);
  });

  it('reste silencieux sur un param mort que personne n\'a réglé', () => {
    // Le runtime ne parle que quand un appelant est effectivement ignoré.
    // L'hygiène du catalogue est le travail du lint, pas de chaque lancement.
    const behaviors = behavior({ name: 'quality-audit', params: CATEGORIES });

    expect(generateWarnings(behaviors, [], registry, '', undefined, {})).toEqual([]);
    expect(generateWarnings(behaviors, [], registry, '')).toEqual([]);
  });

  it('n\'avertit pas sur un param fourni pour un behavior inactif', () => {
    // --set porte sur tout le catalogue ; viser un behavior absent du preset
    // n'est pas la même erreur, et le dire ici serait du bruit.
    const behaviors = behavior({ name: 'quality-audit', params: CATEGORIES });

    const warnings = generateWarnings(behaviors, [], registry, '', undefined, {
      'un-autre-behavior': { peu_importe: 1 },
    });

    expect(warnings).toEqual([]);
  });

  it('n\'avertit pas sur une clé fournie qui n\'est pas un param déclaré', () => {
    // Une faute de frappe dans --set est un autre défaut ; le dire ici mélangerait
    // deux diagnostics dans un message qui parle de canal d'assemblage.
    const behaviors = behavior({ name: 'quality-audit', params: CATEGORIES });

    const warnings = generateWarnings(behaviors, [], registry, '', undefined, {
      'quality-audit': { categorie: ['faute de frappe'] },
    });

    expect(warnings).toEqual([]);
  });
});
