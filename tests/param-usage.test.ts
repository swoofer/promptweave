// tests/param-usage.test.ts
import { describe, it, expect } from 'vitest';
import { findUnusedParams } from '../src/param-usage.js';
import * as publicApi from '../src/index.js';
import type { Behavior, CompositionRule } from '../src/types.js';

function makeBehavior(overrides: Partial<Behavior> & { name: string }): Behavior {
  return {
    description: 'test',
    category: 'mission',
    sections: { '030-mission': { prompt: `${overrides.name} prompt` } },
    params: {},
    hooks: {},
    mcp_tools: [],
    side_car_files: {},
    requires: { behaviors: [], infrastructure: [] },
    conflicts_with: [],
    suggests: [],
    ...overrides,
  } as Behavior;
}

function makeRule(overrides: Partial<CompositionRule> & { name: string }): CompositionRule {
  return {
    description: 'test rule',
    priority: 0,
    when: { all: ['whatever'], any: [], none: [], params_match: {} },
    actions: {
      override_sections: [],
      inject_sections: {},
      override_params: [],
      disable_behaviors: [],
    },
    ...overrides,
  } as CompositionRule;
}

function map(...behaviors: Behavior[]): Map<string, Behavior> {
  return new Map(behaviors.map((b) => [b.name, b]));
}

const OPTIONAL = { type: 'string' as const, required: false };
const OPTIONAL_LIST = { type: 'string[]' as const, required: false };

describe('findUnusedParams', () => {
  it('ne signale pas un param interpolé dans une section', () => {
    const b = makeBehavior({
      name: 'audit',
      params: { focus: OPTIONAL },
      sections: { '030-mission': { prompt: 'Regarde {{params.focus}}.' } },
    });

    expect(findUnusedParams(map(b), [])).toEqual([]);
  });

  it('signale un param qu\'aucune section ne référence — le bug essaim #79', () => {
    const b = makeBehavior({
      name: 'quality-audit',
      params: { categories: OPTIONAL_LIST },
      sections: { '030-mission': { prompt: 'Six catégories en dur, zéro placeholder.' } },
    });

    expect(findUnusedParams(map(b), [])).toEqual([
      { behavior: 'quality-audit', param: 'categories' },
    ]);
  });

  it('compte {{#if}} et {{#each}} comme des références, pas seulement {{x}}', () => {
    // Le piège du regex naïf : `{{params.x}}` se voit, `{{#each params.x}}` non.
    const b = makeBehavior({
      name: 'listing',
      params: { items: OPTIONAL_LIST, flag: OPTIONAL },
      sections: {
        '030-mission': {
          prompt: '{{#if params.flag}}{{#each params.items}}- {{this}}\n{{/each}}{{/if}}',
        },
      },
    });

    expect(findUnusedParams(map(b), [])).toEqual([]);
  });

  it('ne signale pas un param utilisé uniquement dans un argument de hook', () => {
    const b = makeBehavior({
      name: 'tracker',
      params: { interval: OPTIONAL },
      hooks: {
        'session-start': { script: 'track.sh', args: ['{{params.interval}}'], blocking: false, order: 0 },
      },
    });

    expect(findUnusedParams(map(b), [])).toEqual([]);
  });

  it('ne signale pas un param utilisé uniquement dans un side_car_file', () => {
    const b = makeBehavior({
      name: 'writer',
      params: { title: OPTIONAL },
      side_car_files: { 'NOTES.md': '# {{params.title}}' },
    });

    expect(findUnusedParams(map(b), [])).toEqual([]);
  });

  it('ne signale pas les knobs de phase quand le behavior déclare un bloc phase', () => {
    // assemblePhases les lit depuis les params résolus — ils n'ont aucune raison
    // d'apparaître dans le prompt.
    const b = makeBehavior({
      name: 'phase-execute',
      phase: { name: 'execute', tools_mode: 'full', loop: true },
      params: {
        effort: OPTIONAL,
        model: OPTIONAL,
        thinking: OPTIONAL,
        maxTurns: { type: 'number', required: false },
      },
    });

    expect(findUnusedParams(map(b), [])).toEqual([]);
  });

  it('signale les mêmes knobs quand le behavior n\'a PAS de bloc phase', () => {
    // Sans phase nommée, assemblePhases ne les lira jamais : le knob est inerte.
    const b = makeBehavior({
      name: 'audit-specialist',
      params: { effort: OPTIONAL },
    });

    expect(findUnusedParams(map(b), [])).toEqual([
      { behavior: 'audit-specialist', param: 'effort' },
    ]);
  });

  it('ne signale pas un param sur lequel une composition fait params_match', () => {
    const b = makeBehavior({
      name: 'coordinator-rules',
      params: { solo_mode: { type: 'boolean', required: false } },
    });
    const rule = makeRule({
      name: 'solo-mode-strip',
      when: { all: ['coordinator-rules'], any: [], none: [], params_match: { 'coordinator-rules': { solo_mode: true } } },
    });

    expect(findUnusedParams(map(b), [rule])).toEqual([]);
  });

  it('ne signale pas un param référencé par une override_section qui vise ce behavior', () => {
    const b = makeBehavior({
      name: 'greeter',
      params: { who: OPTIONAL },
      sections: { '030-mission': { prompt: 'statique' } },
    });
    const rule = makeRule({
      name: 'personalise',
      actions: {
        override_sections: [{ behavior: 'greeter', section: '030-mission', prompt: 'Salut {{params.who}}' }],
        inject_sections: {},
        override_params: [],
        disable_behaviors: [],
      },
    });

    expect(findUnusedParams(map(b), [rule])).toEqual([]);
  });

  it('une override_section qui vise un AUTRE behavior n\'excuse pas le param', () => {
    // `{{params.who}}` dans l'override de `other` se résout contre les params de
    // `other`, pas ceux de `greeter`.
    const greeter = makeBehavior({ name: 'greeter', params: { who: OPTIONAL } });
    const other = makeBehavior({ name: 'other', sections: { '030-mission': { prompt: 'x' } } });
    const rule = makeRule({
      name: 'ailleurs',
      actions: {
        override_sections: [{ behavior: 'other', section: '030-mission', prompt: '{{params.who}}' }],
        inject_sections: {},
        override_params: [],
        disable_behaviors: [],
      },
    });

    expect(findUnusedParams(map(greeter, other), [rule])).toEqual([
      { behavior: 'greeter', param: 'who' },
    ]);
  });

  it('une inject_section n\'excuse aucun param — elle est interpolée avec params vides', () => {
    // assemblePrompt interpole les sections injectées avec `params: {}` ; en mode
    // strict Handlebars, {{params.who}} y lèverait. Ce n'est pas un canal.
    const b = makeBehavior({ name: 'greeter', params: { who: OPTIONAL } });
    const rule = makeRule({
      name: 'injecte',
      actions: {
        override_sections: [],
        inject_sections: { '015-bridge': { prompt: '{{params.who}}' } },
        override_params: [],
        disable_behaviors: [],
      },
    });

    expect(findUnusedParams(map(b), [rule])).toEqual([
      { behavior: 'greeter', param: 'who' },
    ]);
  });

  it('un param homonyme consommé par un AUTRE behavior reste signalé', () => {
    // `focus` vit dans deux behaviors ; seul celui de `a` est interpolé.
    const a = makeBehavior({
      name: 'a',
      params: { focus: OPTIONAL },
      sections: { '030-mission': { prompt: '{{params.focus}}' } },
    });
    const b = makeBehavior({ name: 'b', params: { focus: OPTIONAL } });

    expect(findUnusedParams(map(a, b), [])).toEqual([{ behavior: 'b', param: 'focus' }]);
  });

  it('compte {{../params.x}} — depuis un #each, le frame parent EST le contexte racine', () => {
    // assemblePrompt interpole avec `{ agent, params }` : dans un #each, `../`
    // remonte à cette racine, donc `../params.x` lit bien les params du behavior.
    const b = makeBehavior({
      name: 'nested',
      params: { items: OPTIONAL_LIST, suffix: OPTIONAL },
      sections: {
        '030-mission': { prompt: '{{#each params.items}}- {{this}} {{../params.suffix}}\n{{/each}}' },
      },
    });

    expect(findUnusedParams(map(b), [])).toEqual([]);
  });

  it('un behavior sans params ne produit rien', () => {
    expect(findUnusedParams(map(makeBehavior({ name: 'vide' })), [])).toEqual([]);
  });

  it('est joignable depuis l\'entrée du paquet', () => {
    // Un consommateur (essaim) linte son catalogue avec cette fonction plutôt que
    // de redéfinir « consommé » de son côté — c'est donc de la surface publique.
    expect(publicApi.findUnusedParams).toBe(findUnusedParams);
  });

  it('une section au template invalide ne fait pas exploser le lint', () => {
    // Un YAML cassé est déjà signalé ailleurs (registry.errors) ; le lint ne doit
    // pas transformer ça en crash et masquer tout le reste du catalogue.
    const b = makeBehavior({
      name: 'cassé',
      params: { x: OPTIONAL },
      sections: { '030-mission': { prompt: '{{#if params.x}}jamais fermé' } },
    });

    expect(() => findUnusedParams(map(b), [])).not.toThrow();
  });
});
