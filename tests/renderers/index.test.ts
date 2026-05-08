import { describe, it, expect } from 'vitest';
import { registry, bundleRenderer, skillRenderer } from '../../src/renderers/index.js';

describe('renderers/index — registry', () => {
  it('contains exactly bundle and skill', () => {
    expect(Object.keys(registry).sort()).toEqual(['bundle', 'skill']);
  });

  it('bundle entry is bundleRenderer', () => {
    expect(registry.bundle).toBe(bundleRenderer);
  });

  it('skill entry is skillRenderer', () => {
    expect(registry.skill).toBe(skillRenderer);
  });

  it('every registered renderer conforms to Renderer interface', () => {
    for (const [key, r] of Object.entries(registry)) {
      expect(typeof r.target).toBe('string');
      expect(r.target.length).toBeGreaterThan(0);
      expect(typeof r.render).toBe('function');
      expect(r.target).toBe(key);
    }
  });
});
