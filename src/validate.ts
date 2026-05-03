import type { Behavior } from './types.js';
import type { Registry } from './registry.js';

export function validateBehaviors(
  behaviorNames: string[],
  registry: Registry,
  resolvedParams: Record<string, Record<string, unknown>>,
  infraStatus: Record<string, boolean> = {},
): string[] {
  const errors: string[] = [];
  const activeSet = new Set(behaviorNames);

  // Check all behaviors exist
  for (const name of behaviorNames) {
    if (!registry.getBehavior(name)) {
      errors.push(`Behavior "${name}" not found in registry. Available: ${[...registry.behaviors.keys()].join(', ')}`);
    }
  }

  if (errors.length > 0) return errors;

  // Check requires.behaviors
  for (const name of behaviorNames) {
    const behavior = registry.getBehavior(name)!;
    for (const req of behavior.requires.behaviors) {
      if (!activeSet.has(req)) {
        errors.push(
          `"${name}" requires behavior "${req}" but it is not active. ` +
          `Options: add "${req}" or remove "${name}".`
        );
      }
    }
  }

  // Check requires.infrastructure
  for (const name of behaviorNames) {
    const behavior = registry.getBehavior(name)!;
    for (const infra of behavior.requires.infrastructure) {
      if (infraStatus[infra] === false) {
        errors.push(
          `"${name}" requires infrastructure "${infra}" but it is not available. ` +
          `Ensure ${infra} is running before launching.`
        );
      }
    }
  }

  // Check conflicts_with (deduplicate symmetric pairs)
  const reportedConflicts = new Set<string>();
  for (const name of behaviorNames) {
    const behavior = registry.getBehavior(name)!;
    for (const conflict of behavior.conflicts_with) {
      if (activeSet.has(conflict)) {
        const pairKey = [name, conflict].sort().join(':');
        if (!reportedConflicts.has(pairKey)) {
          reportedConflicts.add(pairKey);
          errors.push(
            `"${name}" conflicts_with "${conflict}" but both are active. ` +
            `Options: remove "${name}" or remove "${conflict}".`
          );
        }
      }
    }
  }

  // Detect circular dependencies
  const cycleErrors = detectCycles(behaviorNames, registry);
  errors.push(...cycleErrors);

  // Validate param types
  const paramErrors = validateParamTypes(behaviorNames, registry, resolvedParams);
  errors.push(...paramErrors);

  return errors;
}

function detectCycles(behaviorNames: string[], registry: Registry): string[] {
  const errors: string[] = [];
  const globalVisited = new Set<string>();

  function dfs(name: string, path: string[], inStack: Set<string>): void {
    if (inStack.has(name)) {
      const cycleStart = path.indexOf(name);
      const cycle = [...path.slice(cycleStart), name].join(' → ');
      errors.push(`Dépendance circulaire détectée: ${cycle}`);
      return;
    }
    if (globalVisited.has(name)) return;

    globalVisited.add(name);
    inStack.add(name);

    const behavior = registry.getBehavior(name);
    if (behavior) {
      for (const dep of behavior.requires.behaviors) {
        dfs(dep, [...path, name], new Set(inStack));
      }
    }

    inStack.delete(name);
  }

  for (const name of behaviorNames) {
    dfs(name, [], new Set());
  }

  return errors;
}

function validateParamTypes(
  behaviorNames: string[],
  registry: Registry,
  resolvedParams: Record<string, Record<string, unknown>>,
): string[] {
  const errors: string[] = [];

  for (const name of behaviorNames) {
    const behavior = registry.getBehavior(name);
    if (!behavior) continue;

    const params = resolvedParams[name] ?? {};

    for (const [paramName, paramDef] of Object.entries(behavior.params)) {
      const value = params[paramName];

      if (paramDef.required && value === undefined && paramDef.default === undefined) {
        errors.push(
          `Behavior "${name}": param "${paramName}" is required but not provided.`
        );
        continue;
      }

      if (value === undefined) continue;

      const typeError = checkType(value, paramDef.type);
      if (typeError) {
        errors.push(
          `Behavior "${name}": param "${paramName}" expected type "${paramDef.type}" ` +
          `but got ${typeof value} (${JSON.stringify(value)}).`
        );
      }
    }
  }

  return errors;
}

function checkType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case 'string':
      return typeof value !== 'string';
    case 'number':
      return typeof value !== 'number';
    case 'boolean':
      return typeof value !== 'boolean';
    case 'string[]':
      return !Array.isArray(value) || !value.every((v) => typeof v === 'string');
    case 'number[]':
      return !Array.isArray(value) || !value.every((v) => typeof v === 'number');
    default:
      return false;
  }
}
