import { describe, it, expect } from 'vitest';
import { Registry } from '../src/registry.js';
import { resolve } from 'path';

const FIXTURES = resolve(import.meta.dirname, './fixtures');

describe('Registry', () => {
  it('loads all valid behaviors from a directory', () => {
    const registry = Registry.load(FIXTURES);
    expect(registry.behaviors.has('worktree-isolation')).toBe(true);
    expect(registry.behaviors.has('announce-before-write')).toBe(true);
    expect(registry.behaviors.has('conflict-resolution')).toBe(true);
    expect(registry.behaviors.has('bug-hunting')).toBe(true);
  });

  it('reports errors for invalid behaviors', () => {
    const registry = Registry.load(FIXTURES);
    expect(registry.errors.length).toBeGreaterThan(0);
    expect(registry.errors.some((e) => e.file.includes('invalid.yaml'))).toBe(true);
  });

  it('does not include invalid behaviors in the index', () => {
    const registry = Registry.load(FIXTURES);
    expect(registry.behaviors.has('invalid')).toBe(false);
  });

  it('loads presets', () => {
    const registry = Registry.load(FIXTURES);
    expect(registry.presets.has('raid')).toBe(true);
    const raid = registry.presets.get('raid')!;
    expect(raid.behaviors).toContain('worktree-isolation');
    expect(raid.behaviors).toContain('bug-hunting');
  });

  it('loads composition rules', () => {
    const registry = Registry.load(FIXTURES);
    expect(registry.compositions.has('announce-after-relay')).toBe(true);
  });

  it('getBehavior returns the behavior or undefined', () => {
    const registry = Registry.load(FIXTURES);
    expect(registry.getBehavior('worktree-isolation')).toBeDefined();
    expect(registry.getBehavior('nonexistent')).toBeUndefined();
  });

  it('getPreset returns the preset or undefined', () => {
    const registry = Registry.load(FIXTURES);
    expect(registry.getPreset('raid')).toBeDefined();
    expect(registry.getPreset('nonexistent')).toBeUndefined();
  });
});
