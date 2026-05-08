import type { AssembledOutput } from '../types.js';

export interface RenderedParam {
  name: string;
  type: string; // matches BehaviorSchema param `type` enum: 'string'|'number'|'boolean'|'string[]'|'number[]'
  description?: string;
  required: boolean;
  /** Effective default after preset/agent/launch overrides; undefined when required and no default */
  effectiveDefault?: unknown;
}

export interface RenderContext {
  /** Skill folder name + frontmatter `name`. Bundle ignores. Source: agent.preset ?? agent.name. */
  presetName: string;
  /** Frontmatter `description` for skill mode. Bundle ignores. */
  description?: string;
  /** `## Parameters` section content for skill mode. Bundle ignores. */
  params?: RenderedParam[];
  /** Bundle uses to merge `.mcp.json` at the project root. Skill ignores. */
  projectRoot?: string;
}

export interface RenderResult {
  warnings: string[];
}

export interface Renderer {
  target: string;
  render(output: AssembledOutput, destDir: string, ctx: RenderContext): RenderResult;
}

// Registry populated as renderers land. After Task 2 + 8 it contains 'bundle' and 'skill'.
export const registry: Record<string, Renderer> = {};
