// bce/engine/writer.ts
import { mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import type { AssembledOutput } from './types.js';
import { mergeMcpConfig } from './assemble.js';

export function writeOutput(
  targetDir: string,
  output: AssembledOutput,
  projectRoot?: string,
): void {
  const tmpDir = `${targetDir}.tmp.${Date.now()}`;

  try {
    mkdirSync(join(tmpDir, 'generated-hooks'), { recursive: true });

    writeFileSync(
      join(tmpDir, 'generated-prompt.md'),
      output.prompt,
      'utf-8',
    );

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

    // Atomic swap
    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true });
    }
    renameSync(tmpDir, targetDir);

    // Merge .mcp.json at project root
    if (projectRoot) {
      const mcpJsonPath = join(projectRoot, '.mcp.json');
      let existing: Record<string, unknown> = {};
      if (existsSync(mcpJsonPath)) {
        existing = JSON.parse(readFileSync(mcpJsonPath, 'utf-8'));
      }
      const coordinatorUrl = output.envVars['COORDINATOR_URL'] ?? 'http://localhost:3100';
      const merged = mergeMcpConfig(existing, output.mcpTools, coordinatorUrl);
      writeFileSync(mcpJsonPath, JSON.stringify(merged, null, 2), 'utf-8');
    }
  } catch (err) {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true });
    }
    throw err;
  }
}
