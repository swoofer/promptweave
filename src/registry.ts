import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import {
  BehaviorSchema,
  PresetSchema,
  CompositionRuleSchema,
  type Behavior,
  type Preset,
  type CompositionRule,
} from './types.js';

export interface LoadError {
  file: string;
  message: string;
}

export class Registry {
  readonly behaviors: Map<string, Behavior>;
  readonly presets: Map<string, Preset>;
  readonly compositions: Map<string, CompositionRule>;
  readonly errors: LoadError[];

  private constructor(
    behaviors: Map<string, Behavior>,
    presets: Map<string, Preset>,
    compositions: Map<string, CompositionRule>,
    errors: LoadError[],
  ) {
    this.behaviors = behaviors;
    this.presets = presets;
    this.compositions = compositions;
    this.errors = errors;
  }

  getBehavior(name: string): Behavior | undefined {
    return this.behaviors.get(name);
  }

  getPreset(name: string): Preset | undefined {
    return this.presets.get(name);
  }

  getComposition(name: string): CompositionRule | undefined {
    return this.compositions.get(name);
  }

  static load(basePath: string): Registry {
    const errors: LoadError[] = [];

    const behaviors = loadDir(
      join(basePath, 'behaviors'),
      BehaviorSchema,
      errors,
    );

    const presets = loadDir(
      join(basePath, 'presets'),
      PresetSchema,
      errors,
    );

    const compositions = loadDir(
      join(basePath, 'compositions'),
      CompositionRuleSchema,
      errors,
    );

    return new Registry(behaviors, presets, compositions, errors);
  }
}

function loadDir<T extends { name: string }>(
  dirPath: string,
  schema: { safeParse: (data: unknown) => { success: boolean; data?: T; error?: { message: string } } },
  errors: LoadError[],
): Map<string, T> {
  const map = new Map<string, T>();

  if (!existsSync(dirPath)) {
    return map;
  }

  const files = readdirSync(dirPath).filter(
    (f) => f.endsWith('.yaml') || f.endsWith('.yml'),
  );

  for (const file of files) {
    const filePath = join(dirPath, file);
    try {
      const content = readFileSync(filePath, 'utf-8');
      const raw = yaml.load(content);
      const result = schema.safeParse(raw);

      if (result.success && result.data) {
        map.set(result.data.name, result.data);
      } else {
        const msg = result.error?.message ?? 'Unknown validation error';
        errors.push({ file: filePath, message: msg });
      }
    } catch (err) {
      errors.push({
        file: filePath,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return map;
}
