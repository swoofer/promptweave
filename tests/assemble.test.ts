// tests/unit/bce-assemble.test.ts
import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { Registry } from '../src/registry.js';
import { assemblePrompt, assembleHooks, assembleMcpTools, assembleEnvVars, assembleSideCarFiles } from '../src/assemble.js';
import type { AgentContext, Behavior } from '../src/types.js';

const FIXTURES = resolve(import.meta.dirname, './fixtures');

const agentCtx: AgentContext = {
  id: 'chasseur-alpha',
  displayName: 'Chasseur Alpha',
  profile: 'codeur',
  model: 'claude-opus-4-6',
};

const noOverrides = new Map<string, string>();

describe('assemblePrompt', () => {
  const registry = Registry.load(FIXTURES);

  it('assembles sections in order by section number', () => {
    const behaviors = new Map<string, Behavior>();
    behaviors.set('worktree-isolation', registry.getBehavior('worktree-isolation')!);
    behaviors.set('bug-hunting', registry.getBehavior('bug-hunting')!);

    const { prompt } = assemblePrompt(behaviors, new Map(), noOverrides, agentCtx, {});
    const lines = prompt.split('\n');
    const worktreeIdx = lines.findIndex((l) => l.includes('worktree'));
    const bugIdx = lines.findIndex((l) => l.includes('bugs') || l.includes('mission'));
    expect(worktreeIdx).toBeLessThan(bugIdx);
  });

  it('breaks ties alphabetically by behavior name', () => {
    const behaviors = new Map<string, Behavior>();
    behaviors.set('announce-before-write', registry.getBehavior('announce-before-write')!);
    behaviors.set('sequential-pipeline', registry.getBehavior('sequential-pipeline')!);

    const { prompt } = assemblePrompt(behaviors, new Map(), noOverrides, agentCtx, {});
    const announceIdx = prompt.indexOf('announce_work');
    const seqIdx = prompt.indexOf('relais') >= 0 ? prompt.indexOf('relais') : prompt.indexOf('Vérifie');
    expect(announceIdx).toBeLessThan(seqIdx);
  });

  it('includes injected sections in order', () => {
    const behaviors = new Map<string, Behavior>();
    behaviors.set('worktree-isolation', registry.getBehavior('worktree-isolation')!);

    const injected = new Map<string, { prompt: string; source: string }>();
    injected.set('015-bridge', { prompt: 'Bridge instruction.', source: 'test-rule' });

    const { prompt } = assemblePrompt(behaviors, injected, noOverrides, agentCtx, {});
    const worktreeIdx = prompt.indexOf('worktree');
    const bridgeIdx = prompt.indexOf('Bridge');
    const afterIdx = prompt.indexOf('Commite');
    expect(worktreeIdx).toBeLessThan(bridgeIdx);
    expect(bridgeIdx).toBeLessThan(afterIdx);
  });

  it('interpolates {{agent.id}} and {{params.x}}', () => {
    const behaviors = new Map<string, Behavior>();
    behaviors.set('worktree-isolation', registry.getBehavior('worktree-isolation')!);
    behaviors.set('bug-hunting', registry.getBehavior('bug-hunting')!);

    const params = { 'bug-hunting': { modules: ['src/auth'] } };
    const { prompt } = assemblePrompt(behaviors, new Map(), noOverrides, agentCtx, params);
    expect(prompt).toContain('src/auth');
  });

  it('populates sectionTrace with overriddenBy from composition rules', () => {
    const behaviors = new Map<string, Behavior>();
    behaviors.set('announce-before-write', registry.getBehavior('announce-before-write')!);

    const overrides = new Map<string, string>();
    overrides.set('announce-before-write:020-before-coding', 'test-rule');

    const { sectionTrace } = assemblePrompt(behaviors, new Map(), overrides, agentCtx, {});
    const overridden = sectionTrace.find((s) => s.key === '020-before-coding');
    expect(overridden?.overriddenBy).toBe('test-rule');
  });
});

describe('assembleHooks', () => {
  const registry = Registry.load(FIXTURES);

  it('merges hooks by lifecycle point, sorted by order', () => {
    const behaviors = new Map<string, Behavior>();
    behaviors.set('worktree-isolation', registry.getBehavior('worktree-isolation')!);
    behaviors.set('announce-before-write', registry.getBehavior('announce-before-write')!);

    const hooks = assembleHooks(behaviors, agentCtx, {});
    expect(hooks['session-start']).toBeDefined();
    expect(hooks['pre-tool-use']).toBeDefined();
  });
});

describe('assembleMcpTools', () => {
  const registry = Registry.load(FIXTURES);

  it('unions all mcp_tools', () => {
    const behaviors = new Map<string, Behavior>();
    behaviors.set('announce-before-write', registry.getBehavior('announce-before-write')!);
    behaviors.set('conflict-resolution', registry.getBehavior('conflict-resolution')!);

    const tools = assembleMcpTools(behaviors);
    expect(tools).toContain('announce_work');
    expect(tools).toContain('post_to_thread');
    expect(tools).toContain('propose_resolution');
    expect(tools).toContain('approve_resolution');
    expect(new Set(tools).size).toBe(tools.length);
  });
});

describe('assembleEnvVars', () => {
  it('includes agent context and resolved params', () => {
    const env = assembleEnvVars(agentCtx, { 'bug-hunting': { modules: ['src/auth'] } });
    expect(env['COORDINATOR_AGENT_ID']).toBe('chasseur-alpha');
    expect(env['COORDINATOR_AGENT_NAME']).toBe('Chasseur Alpha');
    expect(env['COORDINATOR_AGENT_PROFILE']).toBe('codeur');
    expect(env['COORDINATOR_AGENT_MODEL']).toBe('claude-opus-4-6');
  });
});

describe('assembleSideCarFiles', () => {
  it('collects side-car files from all behaviors', () => {
    const behaviors = [
      { name: 'a', side_car_files: { 'modes/local.md': 'local mode content' } },
      { name: 'b', side_car_files: { 'references/std.md': 'standards content' } },
    ] as never;

    const { sideCarFiles, warnings } = assembleSideCarFiles(behaviors, {});
    expect(sideCarFiles).toEqual({
      'modes/local.md': 'local mode content',
      'references/std.md': 'standards content',
    });
    expect(warnings).toEqual([]);
  });

  it('warns on conflicting paths and applies last-write-wins', () => {
    const behaviors = [
      { name: 'a', side_car_files: { 'shared.md': 'from a' } },
      { name: 'b', side_car_files: { 'shared.md': 'from b' } },
    ] as never;

    const { sideCarFiles, warnings } = assembleSideCarFiles(behaviors, {});
    expect(sideCarFiles['shared.md']).toBe('from b');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/shared\.md.*'a' and 'b'.*last write wins/);
  });

  it('interpolates {{params.x}} in side-car content', () => {
    const behaviors = [
      { name: 'a', side_car_files: { 'config.md': 'lang={{params.lang}}' } },
    ] as never;

    const { sideCarFiles } = assembleSideCarFiles(behaviors, { a: { lang: 'rust' } });
    expect(sideCarFiles['config.md']).toBe('lang=rust');
  });

  it('returns empty when no behaviors declare side_car_files', () => {
    const behaviors = [{ name: 'a' }, { name: 'b' }] as never;
    const { sideCarFiles, warnings } = assembleSideCarFiles(behaviors, {});
    expect(sideCarFiles).toEqual({});
    expect(warnings).toEqual([]);
  });
});
