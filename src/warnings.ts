import type { Behavior } from './types.js';
import type { Registry } from './registry.js';
import { findUnusedParams } from './param-usage.js';

const DEFAULT_PROMPT_SIZE_THRESHOLD = 32000;

export function generateWarnings(
  behaviors: Map<string, Behavior>,
  appliedRules: string[],
  registry: Registry,
  assembledPrompt: string,
  promptSizeThreshold: number = DEFAULT_PROMPT_SIZE_THRESHOLD,
  /**
   * Params a caller actually provided (preset + agent + launch), keyed by
   * behavior. Only these are reported when unused: a param nobody set is dead
   * catalog weight, which is lint's business, not every launch's.
   */
  setParams: Record<string, Record<string, unknown>> = {},
): string[] {
  const warnings: string[] = [];
  const activeNames = new Set(behaviors.keys());

  // 1. Section collisions — only suppress if a rule covers THAT specific pair
  const coveredPairs = new Set<string>();
  for (const ruleName of appliedRules) {
    const rule = registry.getComposition(ruleName);
    if (rule) {
      for (const a of rule.when.all) {
        for (const b of rule.when.all) {
          if (a !== b) {
            coveredPairs.add([a, b].sort().join(':'));
          }
        }
      }
    }
  }

  const sectionNumbers = new Map<number, string[]>();
  for (const [name, behavior] of behaviors) {
    for (const key of Object.keys(behavior.sections)) {
      const num = parseInt(key.substring(0, 3), 10);
      if (!sectionNumbers.has(num)) {
        sectionNumbers.set(num, []);
      }
      sectionNumbers.get(num)!.push(name);
    }
  }
  for (const [num, names] of sectionNumbers) {
    if (names.length > 1) {
      let allCovered = true;
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const pairKey = [names[i], names[j]].sort().join(':');
          if (!coveredPairs.has(pairKey)) {
            allCovered = false;
          }
        }
      }
      if (!allCovered) {
        const padded = String(num).padStart(3, '0');
        warnings.push(
          `Section collision: ${names.map((n) => `"${n}"`).join(' et ')} ` +
          `contribuent à la section ${padded}. ` +
          `Considérer une composition rule si l'ordre importe.`
        );
      }
    }
  }

  // 2. Missing suggests
  for (const [name, behavior] of behaviors) {
    for (const suggested of behavior.suggests) {
      if (!activeNames.has(suggested)) {
        warnings.push(
          `"${name}" suggests "${suggested}" qui n'est pas actif.`
        );
      }
    }
  }

  // 3. Params set by the caller that no channel can read.
  //
  // Silent by construction otherwise: the schema accepts the value, the assembler
  // ignores it, and a dry-run looks perfectly normal unless you happen to compare
  // prompt sizes (essaim#79).
  for (const { behavior, param } of findUnusedParams(behaviors, registry.compositions.values())) {
    if (setParams[behavior]?.[param] === undefined) continue;
    warnings.push(
      `Param "${behavior}.${param}" est fourni mais jamais consommé : aucune section, ` +
      `hook ou side_car_file ne l'interpole, ce n'est pas un knob de phase, et aucune ` +
      `composition ne s'en sert. La valeur sera ignorée à l'assemblage.`
    );
  }

  // 4. Prompt size
  if (assembledPrompt.length > promptSizeThreshold) {
    warnings.push(
      `Taille du prompt assemblé (${assembledPrompt.length} chars) dépasse le seuil ` +
      `(${promptSizeThreshold} chars). Considérer réduire le nombre de behaviors.`
    );
  }

  return warnings;
}
