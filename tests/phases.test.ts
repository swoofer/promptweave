// tests/unit/bce-phases.test.ts
import { describe, it, expect } from 'vitest';
import { assemblePhases } from '../src/phases.js';
import type { Behavior, AgentContext } from '../src/types.js';

const agent: AgentContext = { id: 'test', displayName: 'Test', profile: 'codeur', model: 'opus' };

function makeBehavior(overrides: Partial<Behavior> & { name: string }): Behavior {
  return {
    description: 'test',
    category: 'mission',
    sections: { '030-mission': { prompt: `${overrides.name} prompt` } },
    params: {},
    hooks: {},
    mcp_tools: [],
    requires: { behaviors: [], infrastructure: [] },
    conflicts_with: [],
    suggests: [],
    ...overrides,
  } as Behavior;
}

describe('assemblePhases', () => {
  it('returns empty array when no behaviors have phases (one-shot compat)', () => {
    const behaviors = new Map([
      ['b1', makeBehavior({ name: 'b1' })],
      ['b2', makeBehavior({ name: 'b2' })],
    ]);
    const result = assemblePhases(behaviors, new Map(), new Map(), agent, {});
    expect(result).toEqual([]);
  });

  it('groups sections by phase name (main prepended as context)', () => {
    const behaviors = new Map([
      ['ctx', makeBehavior({ name: 'ctx', sections: { '000-ctx': { prompt: 'context' } } })],
      ['disc', makeBehavior({ name: 'disc', phase: { name: 'discover', tools_mode: 'read_only', loop: false }, sections: { '030-disc': { prompt: 'discover stuff' } } })],
      ['exec', makeBehavior({ name: 'exec', phase: { name: 'execute', tools_mode: 'full', loop: true }, sections: { '030-exec': { prompt: 'execute stuff' } } })],
    ]);
    const result = assemblePhases(behaviors, new Map(), new Map(), agent, {});
    expect(result).toHaveLength(2); // discover + execute (main prepended to each)
    expect(result.map((p) => p.name)).toEqual(['discover', 'execute']);
    // main context is prepended to each named phase
    expect(result[0].prompt).toContain('context');
    expect(result[0].prompt).toContain('discover stuff');
    expect(result[1].prompt).toContain('context');
    expect(result[1].prompt).toContain('execute stuff');
    expect(result[0].toolsMode).toBe('read_only');
    expect(result[0].loop).toBe(false);
    expect(result[1].toolsMode).toBe('full');
    expect(result[1].loop).toBe(true);
  });

  it('sorts sections by number within each phase', () => {
    const behaviors = new Map([
      ['a', makeBehavior({ name: 'a', phase: { name: 'discover', tools_mode: 'read_only', loop: false }, sections: { '050-later': { prompt: 'second' }, '010-first': { prompt: 'first' } } })],
    ]);
    const result = assemblePhases(behaviors, new Map(), new Map(), agent, {});
    expect(result[0].prompt).toBe('first\n\nsecond');
  });

  it('respects overridden sections', () => {
    const behaviors = new Map([
      ['b', makeBehavior({ name: 'b', phase: { name: 'discover', tools_mode: 'read_only', loop: false } })],
    ]);
    const overrides = new Map([['b:030-mission', 'some-rule']]);
    const result = assemblePhases(behaviors, new Map(), overrides, agent, {});
    expect(result[0].prompt).toBe(''); // section was overridden/skipped
  });

  it('prepends injected sections (via main) into each named phase', () => {
    const behaviors = new Map([
      ['b', makeBehavior({ name: 'b', phase: { name: 'discover', tools_mode: 'read_only', loop: false } })],
    ]);
    const injected = new Map([['015-bridge', { prompt: 'injected bridge', source: 'test-rule' }]]);
    const result = assemblePhases(behaviors, injected, new Map(), agent, {});
    // No standalone main phase — injected content is prepended to named phases
    expect(result.find((p) => p.name === 'main')).toBeUndefined();
    expect(result[0].name).toBe('discover');
    expect(result[0].prompt).toContain('injected bridge');
    expect(result[0].prompt).toContain('b prompt');
  });

  it('propagates effort from resolvedParams to PhasePrompt', () => {
    const behaviors = new Map([
      ['disc', makeBehavior({
        name: 'disc',
        phase: { name: 'discover', tools_mode: 'read_only', loop: false },
        sections: { '030-disc': { prompt: 'discover stuff' } },
        params: {
          effort: { type: 'string', default: 'low', required: false },
        },
      })],
    ]);
    const resolvedParams = { disc: { effort: 'low' } };
    const result = assemblePhases(behaviors, new Map(), new Map(), agent, resolvedParams);
    expect(result).toHaveLength(1);
    expect(result[0].effort).toBe('low');
  });

  it('leaves effort undefined when not in resolvedParams', () => {
    const behaviors = new Map([
      ['disc', makeBehavior({
        name: 'disc',
        phase: { name: 'discover', tools_mode: 'read_only', loop: false },
      })],
    ]);
    const result = assemblePhases(behaviors, new Map(), new Map(), agent, {});
    expect(result[0].effort).toBeUndefined();
  });

  it('uses the effort from the phase-owning behavior (not main)', () => {
    const behaviors = new Map([
      ['ctx', makeBehavior({ name: 'ctx', sections: { '000-ctx': { prompt: 'context' } } })],
      ['disc', makeBehavior({
        name: 'disc',
        phase: { name: 'discover', tools_mode: 'read_only', loop: false },
      })],
    ]);
    const resolvedParams = {
      ctx: { effort: 'max' },       // main phase behavior — ignored
      disc: { effort: 'mid' },      // discover phase behavior — used
    };
    const result = assemblePhases(behaviors, new Map(), new Map(), agent, resolvedParams);
    expect(result).toHaveLength(1);
    expect(result[0].effort).toBe('mid');
  });

  it('propagates model, thinking, maxTurns overrides from resolvedParams', () => {
    const behaviors = new Map([
      ['disc', makeBehavior({
        name: 'disc',
        phase: { name: 'discover', tools_mode: 'read_only', loop: false },
      })],
    ]);
    const resolvedParams = {
      disc: {
        effort: 'low',
        model: 'claude-opus-4-6',
        thinking: 'ultrathink',
        maxTurns: 20,
      },
    };
    const result = assemblePhases(behaviors, new Map(), new Map(), agent, resolvedParams);
    expect(result[0].effort).toBe('low');
    expect(result[0].model).toBe('claude-opus-4-6');
    expect(result[0].thinking).toBe('ultrathink');
    expect(result[0].maxTurns).toBe(20);
  });

  it('treats empty-string model/thinking as unset (do not override profile)', () => {
    const behaviors = new Map([
      ['disc', makeBehavior({
        name: 'disc',
        phase: { name: 'discover', tools_mode: 'read_only', loop: false },
      })],
    ]);
    const resolvedParams = {
      disc: { effort: 'low', model: '', thinking: '' },
    };
    const result = assemblePhases(behaviors, new Map(), new Map(), agent, resolvedParams);
    expect(result[0].model).toBeUndefined();
    expect(result[0].thinking).toBeUndefined();
  });

  it('treats maxTurns=0 (resolveParams empty-number default) as unset', () => {
    // resolveParams fills number params with no `default` and `required: false` with 0.
    // If we captured that literal 0, it would leak past `??` in agent-loop and bypass
    // the effort-profile default. Must be treated as unset.
    const behaviors = new Map([
      ['disc', makeBehavior({
        name: 'disc',
        phase: { name: 'discover', tools_mode: 'read_only', loop: false },
      })],
    ]);
    const resolvedParams = { disc: { effort: 'low', maxTurns: 0 } };
    const result = assemblePhases(behaviors, new Map(), new Map(), agent, resolvedParams);
    expect(result[0].maxTurns).toBeUndefined();
  });

  it('captures explicit maxTurns > 0 as override', () => {
    const behaviors = new Map([
      ['disc', makeBehavior({
        name: 'disc',
        phase: { name: 'discover', tools_mode: 'read_only', loop: false },
      })],
    ]);
    const resolvedParams = { disc: { effort: 'low', maxTurns: 25 } };
    const result = assemblePhases(behaviors, new Map(), new Map(), agent, resolvedParams);
    expect(result[0].maxTurns).toBe(25);
  });

  it('treats empty-string effort as unset (do not override)', () => {
    const behaviors = new Map([
      ['disc', makeBehavior({
        name: 'disc',
        phase: { name: 'discover', tools_mode: 'read_only', loop: false },
      })],
    ]);
    const resolvedParams = { disc: { effort: '' } };
    const result = assemblePhases(behaviors, new Map(), new Map(), agent, resolvedParams);
    expect(result[0].effort).toBeUndefined();
  });

  it('filters main-phase sections out of target phases whose tools_mode is not in applies_when', () => {
    // `coord` has no phase — it goes into main, normally prepended to every phase.
    // But it declares applies_when.phase_tools_mode: [full], so it should only
    // appear in `execute` (full), not in `discover` (read_only).
    const behaviors = new Map([
      ['coord', makeBehavior({
        name: 'coord',
        sections: { '005-rule': { prompt: 'COORD RULE' } },
        applies_when: { phase_tools_mode: ['full'] },
      })],
      ['disc', makeBehavior({
        name: 'disc',
        phase: { name: 'discover', tools_mode: 'read_only', loop: false },
        sections: { '030-disc': { prompt: 'DISC BODY' } },
      })],
      ['exec', makeBehavior({
        name: 'exec',
        phase: { name: 'execute', tools_mode: 'full', loop: true },
        sections: { '030-exec': { prompt: 'EXEC BODY' } },
      })],
    ]);
    const result = assemblePhases(behaviors, new Map(), new Map(), agent, {});
    const byName = Object.fromEntries(result.map((p) => [p.name, p]));
    expect(byName.discover.prompt).not.toContain('COORD RULE');
    expect(byName.discover.prompt).toContain('DISC BODY');
    expect(byName.execute.prompt).toContain('COORD RULE');
    expect(byName.execute.prompt).toContain('EXEC BODY');
  });

  it('includes main-phase sections in all phases when applies_when is absent (default behavior)', () => {
    const behaviors = new Map([
      ['coord', makeBehavior({
        name: 'coord',
        sections: { '005-rule': { prompt: 'COORD RULE' } },
        // no applies_when → applies everywhere
      })],
      ['disc', makeBehavior({
        name: 'disc',
        phase: { name: 'discover', tools_mode: 'read_only', loop: false },
      })],
      ['exec', makeBehavior({
        name: 'exec',
        phase: { name: 'execute', tools_mode: 'full', loop: true },
      })],
    ]);
    const result = assemblePhases(behaviors, new Map(), new Map(), agent, {});
    expect(result.find((p) => p.name === 'discover')!.prompt).toContain('COORD RULE');
    expect(result.find((p) => p.name === 'execute')!.prompt).toContain('COORD RULE');
  });

  it('applies_when with multiple tools_modes lets the section through only matching phases', () => {
    const behaviors = new Map([
      ['coord', makeBehavior({
        name: 'coord',
        sections: { '005-rule': { prompt: 'COORD RULE' } },
        applies_when: { phase_tools_mode: ['full', 'none'] },
      })],
      ['disc', makeBehavior({
        name: 'disc',
        phase: { name: 'discover', tools_mode: 'read_only', loop: false },
      })],
      ['rev', makeBehavior({
        name: 'rev',
        phase: { name: 'review', tools_mode: 'none', loop: false },
      })],
      ['exec', makeBehavior({
        name: 'exec',
        phase: { name: 'execute', tools_mode: 'full', loop: true },
      })],
    ]);
    const result = assemblePhases(behaviors, new Map(), new Map(), agent, {});
    const byName = Object.fromEntries(result.map((p) => [p.name, p]));
    expect(byName.discover.prompt).not.toContain('COORD RULE');  // read_only not in list
    expect(byName.review.prompt).toContain('COORD RULE');         // none in list
    expect(byName.execute.prompt).toContain('COORD RULE');        // full in list
  });
});
