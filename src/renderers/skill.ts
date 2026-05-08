// src/renderers/skill.ts
import { mkdirSync, writeFileSync, renameSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import type { AssembledOutput } from '../types.js';
import type { Renderer, RenderContext, RenderResult } from './index.js';

const SLUG_PATTERN = /^[a-z0-9-]+$/;

function buildFrontmatter(name: string, description: string): string {
  // Use yaml.dump for safe serialization — handles ':' '#' '\n' '-' in values automatically.
  const dumped = yaml.dump({ name, description }, { lineWidth: -1, noRefs: true }).trimEnd();
  return `---\n${dumped}\n---`;
}

export const skillRenderer: Renderer = {
  target: 'skill',
  render(output: AssembledOutput, destDir: string, ctx: RenderContext): RenderResult {
    const warnings: string[] = [];

    if (!SLUG_PATTERN.test(ctx.presetName)) {
      throw new Error(
        `skill target requires preset name to match ^[a-z0-9-]+$ (got: '${ctx.presetName}')`,
      );
    }

    if (output.prompt.trim().length === 0) {
      throw new Error(
        `skill target requires at least one section in composed behaviors; preset '${ctx.presetName}' produces empty prompt`,
      );
    }

    const hookKeys = Object.keys(output.hooks);
    if (hookKeys.length > 0) {
      warnings.push(`[render] skill target ignores hooks declared by behaviors: ${hookKeys.join(', ')}`);
    }

    if (output.mcpTools.length > 0) {
      warnings.push(`[render] skill target ignores mcp_tools declared by behaviors: ${output.mcpTools.join(', ')}`);
    }

    if (output.phases.length > 0) {
      warnings.push(`[render] skill target ignores phases declared by behaviors: ${output.phases.map((p) => p.name).join(', ')}`);
    }

    const envKeys = Object.keys(output.envVars);
    if (envKeys.length > 0) {
      warnings.push(`[render] skill target ignores envVars declared by behaviors: ${envKeys.join(', ')}`);
    }

    const description = ctx.description ?? '';
    const frontmatter = buildFrontmatter(ctx.presetName, description);

    const stripped = output.prompt.replace(/\s+$/, '');
    const content = `${frontmatter}\n\n${stripped}\n`;

    const skillFolder = join(destDir, ctx.presetName);
    const tmpFolder = `${skillFolder}.tmp.${Date.now()}`;

    try {
      mkdirSync(tmpFolder, { recursive: true });
      writeFileSync(join(tmpFolder, 'SKILL.md'), content, { encoding: 'utf-8', mode: 0o644 });

      if (existsSync(skillFolder)) rmSync(skillFolder, { recursive: true });
      renameSync(tmpFolder, skillFolder);
    } catch (err) {
      if (existsSync(tmpFolder)) rmSync(tmpFolder, { recursive: true });
      throw err;
    }

    return { warnings };
  },
};
