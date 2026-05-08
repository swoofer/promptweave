import { z } from 'zod';

// --- Section key must match pattern "NNN-name" ---
const sectionKeyPattern = /^\d{3}-[\w-]+$/;

const SectionSchema = z.object({
  prompt: z.string().min(1),
});

const SectionsSchema = z.record(z.string(), SectionSchema).refine(
  (sections) => Object.keys(sections).every((key) => sectionKeyPattern.test(key)),
  { message: 'Section keys must match pattern "NNN-name" (e.g. "020-before-coding")' }
);

const ParamDefSchema = z.object({
  type: z.enum(['string', 'number', 'boolean', 'string[]', 'number[]']),
  default: z.unknown().optional(),
  required: z.boolean().optional().default(false),
  description: z.string().optional(),
});

const HookSchema = z.object({
  script: z.string(),
  args: z.array(z.string()).optional().default([]),
  blocking: z.boolean().optional().default(false),
  order: z.number().optional().default(0),
});

const PhaseSchema = z.object({
  name: z.string(),
  tools_mode: z.enum(['read_only', 'full', 'none']).default('full'),
  loop: z.boolean().default(false),
});

// Scope filter — lets a behavior restrict itself to phases with matching properties.
// Example: applies_when: { phase_tools_mode: [full] } — only included in full-tools phases.
// When omitted (the common case), the behavior applies to every phase as before.
const AppliesWhenSchema = z.object({
  phase_tools_mode: z.array(z.enum(['read_only', 'full', 'none'])).optional(),
}).optional();

export const BehaviorSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(['workspace', 'coordination', 'mission', 'safety', 'tone']).optional(),
  requires: z.object({
    behaviors: z.array(z.string()).optional().default([]),
    infrastructure: z.array(z.string()).optional().default([]),
  }).optional().default({ behaviors: [], infrastructure: [] }),
  conflicts_with: z.array(z.string()).optional().default([]),
  suggests: z.array(z.string()).optional().default([]),
  params: z.record(z.string(), ParamDefSchema).optional().default({}),
  sections: SectionsSchema,
  hooks: z.record(
    z.enum(['session-start', 'pre-tool-use', 'post-tool-use', 'session-stop']),
    HookSchema
  ).optional().default({}),
  mcp_tools: z.array(z.string()).optional().default([]),
  phase: PhaseSchema.optional(),
  applies_when: AppliesWhenSchema,
});

export const PresetSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  profile: z.enum(['codeur', 'communicant']).optional(),
  model: z.string().optional(),
  behaviors: z.array(z.string()).min(1),
  params: z.record(z.string(), z.record(z.string(), z.unknown())).optional().default({}),
  frontmatter: z.record(z.string(), z.unknown()).optional().default({}),
});

export const AgentSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().optional(),
  preset: z.string().optional(),
  profile: z.enum(['codeur', 'communicant']).optional(),
  model: z.string().optional(),
  behaviors: z.array(z.string()).optional(),
  add: z.array(z.string()).optional().default([]),
  remove: z.array(z.string()).optional().default([]),
  params: z.record(z.string(), z.record(z.string(), z.unknown())).optional().default({}),
}).refine(
  (agent) => agent.preset || (agent.behaviors && agent.behaviors.length > 0),
  { message: 'Agent must have either a preset or a behaviors list' }
);

const OverrideSectionAction = z.object({
  behavior: z.string(),
  section: z.string(),
  prompt: z.string(),
});

const InjectedSectionSchema = z.object({
  prompt: z.string(),
});

const OverrideParamsAction = z.object({
  behavior: z.string(),
  params: z.record(z.string(), z.unknown()),
});

const WhenCondition = z.object({
  all: z.array(z.string()).optional().default([]),
  any: z.array(z.string()).optional().default([]),
  none: z.array(z.string()).optional().default([]),
  params_match: z.record(
    z.string(),
    z.record(z.string(), z.unknown())
  ).optional().default({}),
}).refine(
  (w) => w.all.length > 0 || w.any.length > 0,
  { message: 'when must have at least one "all" or "any" condition' }
);

const InjectSectionsSchema = z.record(z.string(), InjectedSectionSchema).refine(
  (sections) => Object.keys(sections).every((key) => sectionKeyPattern.test(key)),
  { message: 'inject_sections keys must match pattern "NNN-name" (e.g. "015-bridge")' }
).optional().default({});

const ActionsSchema = z.object({
  override_sections: z.array(OverrideSectionAction).optional().default([]),
  inject_sections: InjectSectionsSchema,
  override_params: z.array(OverrideParamsAction).optional().default([]),
  disable_behaviors: z.array(z.string()).optional().default([]),
});

export const CompositionRuleSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  priority: z.number().optional().default(0),
  when: WhenCondition,
  actions: ActionsSchema,
});

// --- Inferred TypeScript types ---
export type Behavior = z.infer<typeof BehaviorSchema>;
export type Preset = z.infer<typeof PresetSchema>;
export type Agent = z.infer<typeof AgentSchema>;
export type CompositionRule = z.infer<typeof CompositionRuleSchema>;
export type ParamDef = z.infer<typeof ParamDefSchema>;
export type Hook = z.infer<typeof HookSchema>;
export type Section = z.infer<typeof SectionSchema>;
export type WhenCond = z.infer<typeof WhenCondition>;
export type Actions = z.infer<typeof ActionsSchema>;

// --- Pipeline types ---
export interface AgentContext {
  /** Internal stable handle — from Agent.name */
  id: string;
  /** Human-readable name — from Agent.displayName, falls back to Agent.name */
  displayName: string;
  profile: 'codeur' | 'communicant';
  model: string;
}

/** Params resolved for each behavior, keyed by behavior name */
export type ResolvedParams = Record<string, Record<string, unknown>>;

export interface PhasePrompt {
  name: string;
  prompt: string;
  toolsMode: 'read_only' | 'full' | 'none';
  loop: boolean;
  // Intentionally `string`, not strict enums — bce/engine cannot import client/agent-loop.
  // Validation of concrete values happens downstream in agent-loop.
  effort?: string;
  model?: string;
  thinking?: string;
  maxTurns?: number;
}

export interface AssembledOutput {
  prompt: string;                  // backward compat — full assembled prompt
  phases: PhasePrompt[];           // empty = one-shot mode, populated = phased mode
  hooks: Record<string, string>;   // lifecycle-point → shell script content
  mcpTools: string[];
  envVars: Record<string, string>;
}

export interface PipelineResult {
  agent: AgentContext;
  behaviors: Behavior[];
  compositionRulesApplied: string[];
  output: AssembledOutput;
  warnings: string[];
  sectionTrace: Array<{
    key: string;
    number: number;
    behaviorName: string;
    prompt: string;
    overriddenBy?: string;
  }>;
}
