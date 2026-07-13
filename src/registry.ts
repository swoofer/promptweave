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

export type EntryKind = 'behavior' | 'preset' | 'composition';

/** An entry from one root shadowed by an entry of the same `name` in a later root. */
export interface Override {
  kind: EntryKind;
  name: string;
  from: string; // root that had it first
  by: string;   // root that took over
}

export class Registry {
  readonly behaviors: Map<string, Behavior>;
  readonly presets: Map<string, Preset>;
  readonly compositions: Map<string, CompositionRule>;
  readonly errors: LoadError[];

  /** Catalog roots this registry was loaded from, in precedence order (last wins). */
  readonly roots: string[];
  /** Which root each entry actually came from, keyed `${kind}:${name}`. */
  readonly sources: Map<string, string>;
  /**
   * Every entry shadowed by a later root.
   *
   * Not cosmetic: the override key is the YAML `name`, not the file name, so an
   * overlay can silently replace a bundled behavior it never meant to touch. An
   * override nobody can see is a bug waiting to happen — callers are expected to
   * surface this (`list`, `validate`).
   */
  readonly overrides: Override[];

  private constructor(
    behaviors: Map<string, Behavior>,
    presets: Map<string, Preset>,
    compositions: Map<string, CompositionRule>,
    errors: LoadError[],
    roots: string[],
    sources: Map<string, string>,
    overrides: Override[],
  ) {
    this.behaviors = behaviors;
    this.presets = presets;
    this.compositions = compositions;
    this.errors = errors;
    this.roots = roots;
    this.sources = sources;
    this.overrides = overrides;
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

  /** The catalog root an entry was loaded from, or undefined if unknown. */
  sourceOf(kind: EntryKind, name: string): string | undefined {
    return this.sources.get(`${kind}:${name}`);
  }

  /**
   * Load a catalog from one root, or overlay several.
   *
   * Roots are applied in order and **the last one wins**: an entry whose YAML
   * `name` already exists replaces it wholesale. Granularity is the WHOLE
   * document — no deep-merge of `sections`/`params`, because a deep-merge of
   * Handlebars prompts is undebuggable: nobody could say which prompt actually
   * shipped.
   *
   * A missing root, or a root missing some of the three sub-directories, is not
   * an error here — an overlay has no reason to replicate the full structure.
   * Callers that take a root from the user are the ones who must reject a path
   * that does not exist (a typo must not degrade into a silent no-op).
   */
  static load(basePath: string | string[]): Registry {
    const roots = Array.isArray(basePath) ? basePath : [basePath];
    const errors: LoadError[] = [];
    const sources = new Map<string, string>();
    const overrides: Override[] = [];

    const behaviors = new Map<string, Behavior>();
    const presets = new Map<string, Preset>();
    const compositions = new Map<string, CompositionRule>();

    const dirs: Array<{ kind: EntryKind; dir: string; schema: Schema<{ name: string }>; map: Map<string, { name: string }> }> = [
      { kind: 'behavior', dir: 'behaviors', schema: BehaviorSchema as Schema<Behavior>, map: behaviors as Map<string, { name: string }> },
      { kind: 'preset', dir: 'presets', schema: PresetSchema as Schema<Preset>, map: presets as Map<string, { name: string }> },
      { kind: 'composition', dir: 'compositions', schema: CompositionRuleSchema as Schema<CompositionRule>, map: compositions as Map<string, { name: string }> },
    ];

    for (const root of roots) {
      for (const { kind, dir, schema, map } of dirs) {
        loadDirInto(map, join(root, dir), schema, errors, kind, root, sources, overrides);
      }
    }

    return new Registry(behaviors, presets, compositions, errors, roots, sources, overrides);
  }
}

interface Schema<T> {
  safeParse: (data: unknown) => { success: boolean; data?: T; error?: { message: string } };
}

function loadDirInto<T extends { name: string }>(
  map: Map<string, T>,
  dirPath: string,
  schema: Schema<T>,
  errors: LoadError[],
  kind: EntryKind,
  root: string,
  sources: Map<string, string>,
  overrides: Override[],
): void {
  if (!existsSync(dirPath)) return;

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
        const name = result.data.name;
        const key = `${kind}:${name}`;
        const previousRoot = sources.get(key);
        // Only a DIFFERENT root shadowing counts as an override. Two files of the
        // same root declaring the same name is a pre-existing (and separate)
        // footgun — last-in-readdir wins, as it always has.
        if (previousRoot !== undefined && previousRoot !== root) {
          overrides.push({ kind, name, from: previousRoot, by: root });
        }
        map.set(name, result.data);
        sources.set(key, root);
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
}
