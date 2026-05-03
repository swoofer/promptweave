import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { runPipeline } from '../src/pipeline.js';
import type { Agent } from '../src/types.js';

const FIXTURES = resolve(import.meta.dirname, './fixtures');
const BCE_DIR = resolve(import.meta.dirname, '..');

describe('runPipeline', () => {
  it('produces a complete result for a preset-based agent', () => {
    const agent: Agent = { name: 'chasseur-alpha', preset: 'raid', add: [], remove: [], params: {} };
    const result = runPipeline(agent, FIXTURES, {});

    expect(result.agent.id).toBe('chasseur-alpha');
    expect(result.agent.profile).toBe('codeur');
    expect(result.output.prompt).toContain('worktree');
    expect(result.output.mcpTools).toContain('announce_work');
    expect(result.output.envVars['COORDINATOR_AGENT_ID']).toBe('chasseur-alpha');
    expect(result.warnings).toBeDefined();
    expect(result.sectionTrace.length).toBeGreaterThan(0);
  });

  it('produces a result for a direct-behaviors agent', () => {
    const agent: Agent = {
      name: 'simple',
      behaviors: ['worktree-isolation', 'bug-hunting'],
      add: [],
      remove: [],
      params: {},
    };
    const result = runPipeline(agent, FIXTURES, {});

    expect(result.agent.id).toBe('simple');
    expect(result.output.prompt).toContain('worktree');
  });

  it('applies composition rules', () => {
    const agent: Agent = {
      name: 'sequential-test',
      behaviors: ['announce-before-write', 'conflict-resolution', 'sequential-pipeline'],
      add: [],
      remove: [],
      params: {},
    };
    const result = runPipeline(agent, FIXTURES, {});

    expect(result.compositionRulesApplied).toContain('announce-after-relay');
    expect(result.output.prompt).toContain('relay');
  });

  it('errors on validation failure', () => {
    const agent: Agent = {
      name: 'bad',
      behaviors: ['announce-before-write'],
      add: [],
      remove: [],
      params: {},
    };
    expect(() => runPipeline(agent, FIXTURES, {})).toThrow(/conflict-resolution/);
  });

  it('errors on post-composition validation when disable breaks requires', () => {
    const agent: Agent = {
      name: 'post-validate-test',
      behaviors: ['announce-before-write', 'conflict-resolution'],
      add: [],
      remove: [],
      params: {},
    };
    expect(() => runPipeline(agent, FIXTURES, {})).toThrow(/post-composition/i);
  });

  it('passes launch params through', () => {
    const agent: Agent = {
      name: 'with-params',
      behaviors: ['bug-hunting'],
      add: [],
      remove: [],
      params: {},
    };
    const result = runPipeline(agent, FIXTURES, {
      'bug-hunting': { modules: ['src/payments'] },
    });

    expect(result.output.prompt).toContain('src/payments');
  });
});

