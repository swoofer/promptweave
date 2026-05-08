// src/renderers/bundle.ts
import { mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import type { AssembledOutput } from '../types.js';
import { mergeMcpConfig } from '../assemble.js';
import type { Renderer, RenderContext, RenderResult } from './index.js';

export const bundleRenderer: Renderer = {
  target: 'bundle',
  render(output: AssembledOutput, destDir: string, ctx: RenderContext): RenderResult {
    const tmpDir = `${destDir}.tmp.${Date.now()}`;

    try {
      mkdirSync(join(tmpDir, 'generated-hooks'), { recursive: true });
      writeFileSync(join(tmpDir, 'generated-prompt.md'), output.prompt, 'utf-8');

      for (const [lifecycle, content] of Object.entries(output.hooks)) {
        writeFileSync(
          join(tmpDir, 'generated-hooks', `${lifecycle}.sh`),
          content,
          { encoding: 'utf-8', mode: 0o755 },
        );
      }

      writeFileSync(
        join(tmpDir, 'generated-mcp.json'),
        JSON.stringify({ mcpTools: output.mcpTools }, null, 2),
        'utf-8',
      );

      const envContent = Object.entries(output.envVars)
        .map(([k, v]) => `export ${k}="${v}"`)
        .join('\n');
      writeFileSync(join(tmpDir, '.coordinator-env'), envContent, 'utf-8');

      // Atomically swap: rename existing dir to backup, then rename tmp into place.
      // If renameSync fails after backup, restore original so no data is lost.
      const backupDir = `${destDir}.bak.${Date.now()}`;
      const hadExisting = existsSync(destDir);
      if (hadExisting) renameSync(destDir, backupDir);
      try {
        renameSync(tmpDir, destDir);
      } catch (swapErr) {
        // The swap failed — restore original from backup so no data is lost.
        if (hadExisting && existsSync(backupDir)) renameSync(backupDir, destDir);
        throw swapErr;
      }
      // Swap succeeded — remove backup (tmp is already renamed into place).
      if (existsSync(backupDir)) rmSync(backupDir, { recursive: true });

      if (ctx.projectRoot) {
        const mcpJsonPath = join(ctx.projectRoot, '.mcp.json');
        let existing: Record<string, unknown> = {};
        if (existsSync(mcpJsonPath)) {
          existing = JSON.parse(readFileSync(mcpJsonPath, 'utf-8'));
        }
        const coordinatorUrl = output.envVars['COORDINATOR_URL'] ?? 'http://localhost:3100';
        const merged = mergeMcpConfig(existing, output.mcpTools, coordinatorUrl);
        writeFileSync(mcpJsonPath, JSON.stringify(merged, null, 2), 'utf-8');
      }
    } catch (err) {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
      throw err;
    }

    return { warnings: [] };
  },
};
