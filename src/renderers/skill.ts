// src/renderers/skill.ts
import { mkdirSync, writeFileSync, renameSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import yaml from 'js-yaml';
import type { AssembledOutput } from '../types.js';
import type { Renderer, RenderContext, RenderResult, RenderedParam } from './index.js';

const SLUG_PATTERN = /^[a-z0-9-]+$/;

function renderParam(p: RenderedParam): string {
  const namePart = `\`${p.name}\``;
  const required = p.required && p.effectiveDefault === undefined;
  const tail = required
    ? `(${p.type}, required)`
    : `(${p.type}, default: \`${JSON.stringify(p.effectiveDefault)}\`)`;
  const desc = p.description ? `: ${p.description}` : '';
  return `- ${namePart} ${tail}${desc}`;
}

function renderParamsSection(params: RenderedParam[]): string {
  return `## Parameters\n\n${params.map(renderParam).join('\n')}`;
}

function buildFrontmatter(name: string, description: string, extra: Record<string, unknown> = {}): string {
  // Use yaml.dump for safe serialization — handles ':' '#' '\n' '-' in values automatically.
  // name and description always win, even if extra declares them.
  const merged = { ...extra, name, description };
  const dumped = yaml.dump(merged, { lineWidth: -1, noRefs: true }).trimEnd();
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

    if (output.prompt.startsWith('---\n')) {
      warnings.push('[render] composed prompt starts with frontmatter delimiter; rendered SKILL.md may have ambiguous frontmatter parsing');
    }

    const description = ctx.description ?? '';
    const frontmatter = buildFrontmatter(ctx.presetName, description, ctx.extraFrontmatter);

    const stripped = output.prompt.replace(/\s+$/, '');
    const emitParams = ctx.emitParameters !== false && ctx.params && ctx.params.length > 0;
    const paramsSection = emitParams ? renderParamsSection(ctx.params!) : null;
    const bodyParts = paramsSection ? [stripped, paramsSection] : [stripped];
    const content = `${frontmatter}\n\n${bodyParts.join('\n\n')}\n`;

    const skillFolder = join(destDir, ctx.presetName);
    const tmpFolder = `${skillFolder}.tmp.${Date.now()}`;
    const backupFolder = `${skillFolder}.bak.${Date.now()}`;

    try {
      mkdirSync(tmpFolder, { recursive: true });
      writeFileSync(join(tmpFolder, 'SKILL.md'), content, { encoding: 'utf-8', mode: 0o644 });

      // Write side-car files alongside SKILL.md inside the tmp folder (covered by the atomic swap).
      for (const [relPath, sideCarContent] of Object.entries(output.sideCarFiles)) {
        const fullPath = join(tmpFolder, relPath);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, sideCarContent, { encoding: 'utf-8', mode: 0o644 });
      }

      // Atomically swap: rename existing folder to backup, then rename tmp into place.
      // If renameSync fails the original folder is still at backupFolder and is restored below.
      const hadExisting = existsSync(skillFolder);
      if (hadExisting) renameSync(skillFolder, backupFolder);
      try {
        renameSync(tmpFolder, skillFolder);
      } catch (swapErr) {
        // The swap failed — restore original from backup so no data is lost.
        if (hadExisting && existsSync(backupFolder)) renameSync(backupFolder, skillFolder);
        throw swapErr;
      }
      // Swap succeeded — remove backup and tmp (tmp is already renamed, backup is leftover old data).
      if (existsSync(backupFolder)) rmSync(backupFolder, { recursive: true });
    } catch (err) {
      if (existsSync(tmpFolder)) rmSync(tmpFolder, { recursive: true });
      throw err;
    }

    return { warnings };
  },
};
