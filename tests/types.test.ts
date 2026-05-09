import { describe, it, expect } from 'vitest';
import {
  BehaviorSchema,
  PresetSchema,
  AgentSchema,
  CompositionRuleSchema,
} from '../src/types.js';
import { BCE_VERSION } from '../src/index.js';

describe('index exports', () => {
  it('exports BCE_VERSION', () => {
    expect(BCE_VERSION).toBe('0.1.0');
  });
});

describe('BehaviorSchema', () => {
  it('validates a minimal behavior', () => {
    const result = BehaviorSchema.safeParse({
      name: 'test-behavior',
      description: 'A test',
      category: 'coordination',
      sections: {
        '020-before-coding': {
          prompt: 'Do something before coding.',
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('validates a full behavior with all fields', () => {
    const result = BehaviorSchema.safeParse({
      name: 'announce-before-write',
      description: 'Announce intentions before modifying code',
      category: 'coordination',
      requires: {
        behaviors: ['conflict-resolution'],
        infrastructure: ['mcp-coordinator'],
      },
      conflicts_with: ['silent-mode'],
      suggests: ['worktree-isolation'],
      params: {
        announce_threshold: {
          type: 'number',
          default: 1,
          required: false,
          description: 'Min files before announcing',
        },
      },
      sections: {
        '020-before-coding': {
          prompt: 'AVANT de modifier du code, appelle announce_work.',
        },
        '050-after-coding': {
          prompt: 'Reporte tes modifications.',
        },
      },
      hooks: {
        'pre-tool-use': {
          script: 'check_announce.sh',
          args: ['{{agent.id}}'],
          blocking: true,
          order: 20,
        },
      },
      mcp_tools: ['announce_work', 'post_to_thread'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a behavior without name', () => {
    const result = BehaviorSchema.safeParse({
      description: 'Missing name',
      sections: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid section number format', () => {
    const result = BehaviorSchema.safeParse({
      name: 'bad-sections',
      description: 'Bad',
      sections: {
        'no-number': { prompt: 'test' },
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts behavior with phase field', () => {
    const result = BehaviorSchema.parse({
      name: 'test-phase',
      description: 'test',
      sections: { '030-mission': { prompt: 'do stuff' } },
      phase: { name: 'discover', tools_mode: 'read_only' },
    });
    expect(result.phase?.name).toBe('discover');
    expect(result.phase?.tools_mode).toBe('read_only');
    expect(result.phase?.loop).toBe(false);
  });

  it('accepts behavior without phase field (backward compat)', () => {
    const result = BehaviorSchema.parse({
      name: 'test-legacy',
      description: 'test',
      sections: { '030-mission': { prompt: 'do stuff' } },
    });
    expect(result.phase).toBeUndefined();
  });

  it('validates phase tools_mode enum', () => {
    expect(() => BehaviorSchema.parse({
      name: 'bad',
      description: 'test',
      sections: { '030-x': { prompt: 'x' } },
      phase: { name: 'x', tools_mode: 'invalid' },
    })).toThrow();
  });
});

describe('BehaviorSchema side_car_files validation', () => {
  it('accepts relative forward-slash paths', () => {
    const result = BehaviorSchema.safeParse({
      name: 'b', description: 'd', sections: { '010-x': { prompt: 'x' } },
      side_car_files: { 'references/std.md': 'content' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects absolute paths', () => {
    const result = BehaviorSchema.safeParse({
      name: 'b', description: 'd', sections: { '010-x': { prompt: 'x' } },
      side_car_files: { '/etc/passwd': 'evil' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects Windows-absolute paths', () => {
    const result = BehaviorSchema.safeParse({
      name: 'b', description: 'd', sections: { '010-x': { prompt: 'x' } },
      side_car_files: { 'C:/evil': 'evil' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects paths containing ..', () => {
    const result = BehaviorSchema.safeParse({
      name: 'b', description: 'd', sections: { '010-x': { prompt: 'x' } },
      side_car_files: { '../escape.md': 'evil' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects backslash paths', () => {
    const result = BehaviorSchema.safeParse({
      name: 'b', description: 'd', sections: { '010-x': { prompt: 'x' } },
      side_car_files: { 'references\\std.md': 'evil' },
    });
    expect(result.success).toBe(false);
  });
});

describe('PresetSchema', () => {
  it('validates a preset', () => {
    const result = PresetSchema.safeParse({
      name: 'raid',
      description: 'Bug hunting',
      profile: 'codeur',
      behaviors: ['worktree-isolation', 'bug-hunting'],
    });
    expect(result.success).toBe(true);
  });

  it('validates a preset with params', () => {
    const result = PresetSchema.safeParse({
      name: 'raid',
      description: 'Bug hunting',
      profile: 'codeur',
      behaviors: ['worktree-isolation', 'bug-hunting'],
      params: {
        'bug-hunting': { modules: ['src/auth'] },
      },
    });
    expect(result.success).toBe(true);
  });
});

describe('AgentSchema', () => {
  it('validates an agent with preset', () => {
    const result = AgentSchema.safeParse({
      name: 'chasseur-alpha',
      preset: 'raid',
    });
    expect(result.success).toBe(true);
  });

  it('validates an agent with direct behaviors', () => {
    const result = AgentSchema.safeParse({
      name: 'analyseur',
      profile: 'communicant',
      model: 'claude-sonnet-4-6',
      behaviors: ['read-only-mode', 'quality-analysis'],
    });
    expect(result.success).toBe(true);
  });

  it('validates an agent with preset + overrides', () => {
    const result = AgentSchema.safeParse({
      name: 'custom',
      preset: 'raid',
      add: ['formal-tone'],
      remove: ['bug-hunting'],
      params: {
        'announce-before-write': { announce_threshold: 3 },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects agent without name', () => {
    const result = AgentSchema.safeParse({ preset: 'raid' });
    expect(result.success).toBe(false);
  });

  it('rejects agent without preset AND without behaviors', () => {
    const result = AgentSchema.safeParse({ name: 'orphan' });
    expect(result.success).toBe(false);
  });
});

describe('CompositionRuleSchema', () => {
  it('validates a composition rule', () => {
    const result = CompositionRuleSchema.safeParse({
      name: 'announce-after-relay',
      description: 'Announce comes after relay in sequential pipeline',
      priority: 0,
      when: {
        all: ['announce-before-write', 'sequential-pipeline'],
      },
      actions: {
        override_sections: [
          {
            behavior: 'announce-before-write',
            section: '020-before-coding',
            prompt: 'Wait for relay, then announce.',
          },
        ],
        inject_sections: {
          '015-bridge': { prompt: 'Relay then announce then code.' },
        },
      },
    });
    expect(result.success).toBe(true);
  });
});
