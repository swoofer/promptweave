import type { Agent } from './types.js';
import type { Registry } from './registry.js';

export interface ResolveResult {
  behaviors: string[];
  profile: 'codeur' | 'communicant';
  model: string;
  presetName: string | null;
}

export function resolveBehaviors(agent: Agent, registry: Registry): ResolveResult {
  let behaviorNames: string[];
  let presetName: string | null = null;
  let profile = agent.profile ?? 'codeur';
  let model = agent.model ?? 'claude-opus-4-6';

  if (agent.preset) {
    const preset = registry.getPreset(agent.preset);
    if (!preset) {
      throw new Error(
        `Preset "${agent.preset}" not found in registry. Available: ${[...registry.presets.keys()].join(', ')}`,
      );
    }
    presetName = preset.name;
    behaviorNames = [...preset.behaviors];
    profile = agent.profile ?? preset.profile ?? 'codeur';
    model = agent.model ?? preset.model ?? 'claude-opus-4-6';
  } else if (agent.behaviors) {
    behaviorNames = [...agent.behaviors];
  } else {
    throw new Error(`Agent "${agent.name}" must have either a preset or a behaviors list.`);
  }

  for (const name of agent.remove) {
    const idx = behaviorNames.indexOf(name);
    if (idx !== -1) {
      behaviorNames.splice(idx, 1);
    }
  }

  for (const name of agent.add) {
    if (!behaviorNames.includes(name)) {
      behaviorNames.push(name);
    }
  }

  return { behaviors: behaviorNames, profile, model, presetName };
}

export function resolveParams(
  behaviorNames: string[],
  registry: Registry,
  presetParams: Record<string, Record<string, unknown>>,
  agentParams: Record<string, Record<string, unknown>>,
  launchParams: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const name of behaviorNames) {
    const behavior = registry.getBehavior(name);
    if (!behavior) continue;

    const merged: Record<string, unknown> = {};

    for (const [paramName, paramDef] of Object.entries(behavior.params)) {
      if (paramDef.default !== undefined) {
        merged[paramName] = paramDef.default;
      } else if (!paramDef.required) {
        merged[paramName] = emptyValueForType(paramDef.type);
      }
    }

    if (presetParams[name]) {
      Object.assign(merged, presetParams[name]);
    }
    if (agentParams[name]) {
      Object.assign(merged, agentParams[name]);
    }
    if (launchParams[name]) {
      Object.assign(merged, launchParams[name]);
    }

    result[name] = merged;
  }

  return result;
}

function emptyValueForType(type: string): unknown {
  switch (type) {
    case 'string':
      return '';
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'string[]':
      return [];
    case 'number[]':
      return [];
    default:
      return '';
  }
}
