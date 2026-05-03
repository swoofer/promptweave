import type { Behavior, CompositionRule } from './types.js';
import type { Registry } from './registry.js';

export interface ComposeResult {
  behaviors: Map<string, Behavior>;
  injectedSections: Map<string, { prompt: string; source: string }>;
  appliedRules: string[];
  disabledBehaviors: string[];
  overriddenSections: Map<string, string>;
}

export function matchRules(
  activeBehaviors: Set<string>,
  registry: Registry,
  resolvedParams: Record<string, Record<string, unknown>> = {},
): CompositionRule[] {
  const matched: CompositionRule[] = [];

  for (const rule of registry.compositions.values()) {
    const { all, any, none } = rule.when;

    const allMet = all.every((b) => activeBehaviors.has(b));
    const anyMet = any.length === 0 || any.some((b) => activeBehaviors.has(b));
    const noneMet = none.every((b) => !activeBehaviors.has(b));

    // Check params_match
    const paramsMet = Object.entries(rule.when.params_match ?? {}).every(
      ([behavior, expected]) => {
        const actual = resolvedParams[behavior] ?? {};
        return Object.entries(expected as Record<string, unknown>).every(
          ([key, value]) => actual[key] === value
        );
      }
    );

    if (allMet && anyMet && noneMet && paramsMet) {
      matched.push(rule);
    }
  }

  matched.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  for (let i = 0; i < matched.length - 1; i++) {
    const a = matched[i];
    const b = matched[i + 1];
    if ((a.priority ?? 0) === (b.priority ?? 0)) {
      const aKey = [...a.when.all].sort().join(',');
      const bKey = [...b.when.all].sort().join(',');
      if (aKey === bKey) {
        throw new Error(
          `Composition rules "${a.name}" and "${b.name}" have same priority (${a.priority}) ` +
          `for the same combination [${aKey}]. Give one a higher priority.`
        );
      }
    }
  }

  return matched;
}

export function applyCompositionRules(
  behaviorsMap: Map<string, Behavior>,
  registry: Registry,
  resolvedParams: Record<string, Record<string, unknown>> = {},
): ComposeResult {
  const activeBehaviors = new Set(behaviorsMap.keys());
  const rules = matchRules(activeBehaviors, registry, resolvedParams);

  const appliedRules: string[] = [];
  const injectedSections = new Map<string, { prompt: string; source: string }>();
  const disabledBehaviors: string[] = [];
  const overriddenSections = new Map<string, string>();

  const cloned = new Map<string, Behavior>();
  for (const [name, behavior] of behaviorsMap) {
    cloned.set(name, structuredClone(behavior));
  }

  for (const rule of rules) {
    appliedRules.push(rule.name);

    for (const override of rule.actions.override_sections) {
      const behavior = cloned.get(override.behavior);
      if (!behavior) {
        throw new Error(
          `Composition rule "${rule.name}": behavior "${override.behavior}" not active.`
        );
      }
      if (!(override.section in behavior.sections)) {
        const available = Object.keys(behavior.sections).join(', ');
        throw new Error(
          `Composition rule "${rule.name}": section "${override.section}" ` +
          `not found in behavior "${override.behavior}". Available: [${available}]`
        );
      }
      behavior.sections[override.section] = { prompt: override.prompt };
      overriddenSections.set(`${override.behavior}:${override.section}`, rule.name);
    }

    for (const [sectionKey, section] of Object.entries(rule.actions.inject_sections)) {
      injectedSections.set(sectionKey, { prompt: section.prompt, source: rule.name });
    }

    for (const name of rule.actions.disable_behaviors) {
      cloned.delete(name);
      disabledBehaviors.push(name);
    }

    for (const paramOverride of rule.actions.override_params) {
      const behavior = cloned.get(paramOverride.behavior);
      if (behavior) {
        for (const [key, value] of Object.entries(paramOverride.params)) {
          if (behavior.params[key]) {
            behavior.params[key] = { ...behavior.params[key], default: value };
          }
        }
      }
    }
  }

  return { behaviors: cloned, injectedSections, appliedRules, disabledBehaviors, overriddenSections };
}
