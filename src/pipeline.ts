// bce/engine/pipeline.ts
import { Registry } from './registry.js';
import { resolveBehaviors, resolveParams } from './resolve.js';
import { validateBehaviors } from './validate.js';
import { applyCompositionRules } from './compose.js';
import { assemblePrompt, assembleHooks, assembleMcpTools, assembleEnvVars, assembleSideCarFiles } from './assemble.js';
import { assemblePhases } from './phases.js';
import { generateWarnings } from './warnings.js';
import type { Agent, AgentContext, Behavior, PipelineResult } from './types.js';

export function runPipeline(
  agent: Agent,
  registryPath: string | string[],
  launchParams: Record<string, Record<string, unknown>>,
  infraStatus: Record<string, boolean> = {},
): PipelineResult {
  const registry = Registry.load(registryPath);

  // Step 1: Resolve behavior names
  const resolved = resolveBehaviors(agent, registry);

  // Build behaviors map
  const behaviorsMap = new Map<string, Behavior>();
  for (const name of resolved.behaviors) {
    const behavior = registry.getBehavior(name);
    if (behavior) {
      behaviorsMap.set(name, behavior);
    }
  }

  // Step 2: Pre-validate
  const preValidateParams = resolveParams(
    resolved.behaviors, registry,
    agent.preset ? (registry.getPreset(agent.preset)?.params ?? {}) : {},
    agent.params, launchParams,
  );
  const errors = validateBehaviors(resolved.behaviors, registry, preValidateParams, infraStatus);
  if (errors.length > 0) {
    throw new Error(
      `Validation errors for agent "${agent.name}":\n` +
      errors.map((e) => `  - ${e}`).join('\n')
    );
  }

  // Step 3: Compose + post-validate
  const composed = applyCompositionRules(behaviorsMap, registry, preValidateParams);

  if (composed.disabledBehaviors.length > 0) {
    const remainingNames = [...composed.behaviors.keys()];
    const postErrors = validateBehaviors(remainingNames, registry, preValidateParams);
    if (postErrors.length > 0) {
      throw new Error(
        `Post-composition validation errors:\n` +
        postErrors.map((e) => `  - ${e}`).join('\n')
      );
    }
  }

  // Step 3b: Resolve params AFTER composition (override_params may have changed defaults)
  const presetParams = agent.preset
    ? (registry.getPreset(agent.preset)?.params ?? {})
    : {};

  // Registry view backed by the COMPOSED behaviors (composition may have changed
  // param defaults). Object.create, not a spread: `{...registry}` copies own
  // fields but drops the prototype, so every method — and every field added later
  // (roots, sources, overrides…) — is silently lost behind the `as Registry` cast.
  const composedRegistry: Registry = Object.create(registry, {
    getBehavior: {
      value: (n: string) => composed.behaviors.get(n) ?? registry.getBehavior(n),
    },
  });

  const resolvedParams = resolveParams(
    [...composed.behaviors.keys()],
    composedRegistry,
    presetParams,
    agent.params,
    launchParams,
  );

  // Build agent context
  const agentCtx: AgentContext = {
    id: agent.name,
    displayName: agent.displayName ?? agent.name,
    profile: resolved.profile,
    model: resolved.model,
  };

  // Step 4: Assemble
  const { prompt, sectionTrace } = assemblePrompt(
    composed.behaviors, composed.injectedSections, composed.overriddenSections, agentCtx, resolvedParams
  );
  const phases = assemblePhases(
    composed.behaviors, composed.injectedSections, composed.overriddenSections, agentCtx, resolvedParams,
  );
  const hooks = assembleHooks(composed.behaviors, agentCtx, resolvedParams);
  const mcpTools = assembleMcpTools(composed.behaviors);
  const envVars = assembleEnvVars(agentCtx, resolvedParams);
  const { sideCarFiles, warnings: sideCarWarnings } = assembleSideCarFiles(
    [...composed.behaviors.values()],
    resolvedParams,
    agentCtx,
  );

  // Step 5: Warnings
  //
  // Catalog load errors MUST surface here. A YAML with a typo is pushed into
  // `registry.errors`, nothing is inserted, and the lookup silently falls back to
  // whichever root defined that name earlier — a "successful" build with the
  // wrong prompt. Nobody read `errors` before (only `validate --all` did), which
  // made an overlay a permanent trap: the file you edited simply had no effect,
  // without a word.
  const loadWarnings = registry.errors.map(
    (e) => `Catalog entry ignored (invalid): ${e.file} — ${e.message.split('\n')[0]}`,
  );

  const warnings = [
    ...loadWarnings,
    ...generateWarnings(
      composed.behaviors,
      composed.appliedRules,
      registry,
      prompt,
    ),
    ...sideCarWarnings,
  ];

  return {
    agent: agentCtx,
    behaviors: [...composed.behaviors.values()],
    compositionRulesApplied: composed.appliedRules,
    output: { prompt, phases, hooks, mcpTools, envVars, sideCarFiles },
    warnings,
    sectionTrace,
  };
}
