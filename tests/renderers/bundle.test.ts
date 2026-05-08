// tests/renderers/bundle.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { resolve, join } from 'path';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { bundleRenderer } from '../../src/renderers/bundle.js';
import type { AssembledOutput } from '../../src/types.js';

function tmpPath(suffix: string): string {
  return join(tmpdir(), `pw-bundle-test-${Date.now()}-${Math.random().toString(36).slice(2)}-${suffix}`);
}

describe('bundleRenderer.render', () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    for (const dir of cleanupDirs) {
      try { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); } catch { /* ignore EBUSY on Windows */ }
    }
    // Sweep only OUR test prefix's tmp siblings, never the entire os.tmpdir().
    for (const dir of [...cleanupDirs]) {
      const parent = resolve(dir, '..');
      try {
        const entries = readdirSync(parent);
        for (const e of entries) {
          if (e.startsWith('pw-bundle-test-') && e.includes('.tmp.')) {
            try { rmSync(join(parent, e), { recursive: true, force: true }); } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
    }
    cleanupDirs.length = 0;
  });

  const minimalOutput: AssembledOutput = {
    prompt: '# Test prompt\nHello world.',
    phases: [],
    hooks: {},
    mcpTools: [],
    envVars: {},
  };

  it('writes prompt, mcp json, and env file to target dir', () => {
    const targetDir = tmpPath('write-basic');
    cleanupDirs.push(targetDir);

    bundleRenderer.render(minimalOutput, targetDir, { presetName: 'test' });

    expect(existsSync(targetDir)).toBe(true);
    expect(readFileSync(join(targetDir, 'generated-prompt.md'), 'utf-8')).toBe(minimalOutput.prompt);
    expect(readFileSync(join(targetDir, 'generated-mcp.json'), 'utf-8')).toBe(
      JSON.stringify({ mcpTools: [] }, null, 2),
    );
    expect(readFileSync(join(targetDir, '.coordinator-env'), 'utf-8')).toBe('');
  });

  it('writes hook scripts to generated-hooks/', () => {
    const targetDir = tmpPath('write-hooks');
    cleanupDirs.push(targetDir);

    const output: AssembledOutput = {
      ...minimalOutput,
      hooks: {
        'session-start': '#!/bin/bash\necho start',
        'pre-tool-use': '#!/bin/bash\necho pre',
      },
    };

    bundleRenderer.render(output, targetDir, { presetName: 'test' });

    expect(readFileSync(join(targetDir, 'generated-hooks', 'session-start.sh'), 'utf-8')).toBe('#!/bin/bash\necho start');
    expect(readFileSync(join(targetDir, 'generated-hooks', 'pre-tool-use.sh'), 'utf-8')).toBe('#!/bin/bash\necho pre');
  });

  it('writes env vars in export format', () => {
    const targetDir = tmpPath('write-env');
    cleanupDirs.push(targetDir);

    const output: AssembledOutput = {
      ...minimalOutput,
      envVars: { FOO: 'bar', BAZ: 'qux' },
    };

    bundleRenderer.render(output, targetDir, { presetName: 'test' });

    const content = readFileSync(join(targetDir, '.coordinator-env'), 'utf-8');
    expect(content).toContain('export FOO="bar"');
    expect(content).toContain('export BAZ="qux"');
  });

  it('replaces existing target dir atomically', () => {
    const targetDir = tmpPath('write-replace');
    cleanupDirs.push(targetDir);

    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'old-file.txt'), 'old');

    bundleRenderer.render(minimalOutput, targetDir, { presetName: 'test' });

    expect(existsSync(join(targetDir, 'old-file.txt'))).toBe(false);
    expect(existsSync(join(targetDir, 'generated-prompt.md'))).toBe(true);
  });

  it('merges .mcp.json at project root when projectRoot is provided', () => {
    const targetDir = tmpPath('write-mcp-merge');
    const projectRoot = tmpPath('write-project-root');
    cleanupDirs.push(targetDir, projectRoot);
    mkdirSync(projectRoot, { recursive: true });

    const output: AssembledOutput = {
      ...minimalOutput,
      mcpTools: ['tool_a', 'tool_b'],
      envVars: { COORDINATOR_URL: 'http://localhost:4000' },
    };

    bundleRenderer.render(output, targetDir, { presetName: 'test', projectRoot });

    const mcpJson = JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf-8'));
    expect(mcpJson.mcpServers._bce_coordinator).toBeDefined();
    expect(mcpJson.mcpServers._bce_coordinator.url).toBe('http://localhost:4000/mcp');
    expect(mcpJson.mcpServers._bce_coordinator._bce_tools).toEqual(['tool_a', 'tool_b']);
  });

  it('merges with existing .mcp.json preserving non-bce servers', () => {
    const targetDir = tmpPath('write-mcp-preserve');
    const projectRoot = tmpPath('write-project-preserve');
    cleanupDirs.push(targetDir, projectRoot);
    mkdirSync(projectRoot, { recursive: true });

    const existingMcp = {
      mcpServers: {
        'my-server': { type: 'http', url: 'http://my-server' },
        '_bce_old': { type: 'http', url: 'http://old' },
      },
    };
    writeFileSync(join(projectRoot, '.mcp.json'), JSON.stringify(existingMcp));

    const output: AssembledOutput = {
      ...minimalOutput,
      mcpTools: ['tool_x'],
      envVars: {},
    };

    bundleRenderer.render(output, targetDir, { presetName: 'test', projectRoot });

    const mcpJson = JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf-8'));
    expect(mcpJson.mcpServers['my-server']).toBeDefined();
    expect(mcpJson.mcpServers['_bce_old']).toBeUndefined();
    expect(mcpJson.mcpServers['_bce_coordinator']).toBeDefined();
  });

  it('defaults to localhost:3100 when COORDINATOR_URL is not in envVars', () => {
    const targetDir = tmpPath('write-default-url');
    const projectRoot = tmpPath('write-default-url-root');
    cleanupDirs.push(targetDir, projectRoot);
    mkdirSync(projectRoot, { recursive: true });

    const output: AssembledOutput = {
      ...minimalOutput,
      mcpTools: ['tool_y'],
      envVars: {},
    };

    bundleRenderer.render(output, targetDir, { presetName: 'test', projectRoot });

    const mcpJson = JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf-8'));
    expect(mcpJson.mcpServers._bce_coordinator.url).toBe('http://localhost:3100/mcp');
  });

  it('cleans up tmp dir on error', () => {
    const targetDir = tmpPath('write-error');
    cleanupDirs.push(targetDir);

    const circularObj: Record<string, unknown> = {};
    circularObj.self = circularObj;

    const output: AssembledOutput = {
      prompt: 'test',
      phases: [],
      hooks: {},
      mcpTools: circularObj as unknown as string[],
      envVars: {},
    };

    expect(() => bundleRenderer.render(output, targetDir, { presetName: 'test' })).toThrow();
  });
});
