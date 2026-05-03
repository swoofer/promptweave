import type { Behavior } from './types.js';
import type { Registry } from './registry.js';

const DEFAULT_PROMPT_SIZE_THRESHOLD = 32000;

export function generateWarnings(
  behaviors: Map<string, Behavior>,
  appliedRules: string[],
  registry: Registry,
  assembledPrompt: string,
  promptSizeThreshold: number = DEFAULT_PROMPT_SIZE_THRESHOLD,
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

  // 3. Prompt size
  if (assembledPrompt.length > promptSizeThreshold) {
    warnings.push(
      `Taille du prompt assemblé (${assembledPrompt.length} chars) dépasse le seuil ` +
      `(${promptSizeThreshold} chars). Considérer réduire le nombre de behaviors.`
    );
  }

  return warnings;
}
