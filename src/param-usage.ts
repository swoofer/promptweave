import Handlebars from "handlebars";
import type { Behavior, CompositionRule } from "./types.js";

/**
 * Effort knobs read off the resolved params by `assemblePhases`, not by the
 * templates. They only take effect on a behavior that owns a NAMED phase —
 * see phases.ts, which skips the implicit "main" phase.
 */
const PHASE_KNOBS: ReadonlySet<string> = new Set([
  "effort",
  "model",
  "thinking",
  "maxTurns",
  "requireFailingTest",
]);

export interface UnusedParam {
  behavior: string;
  param: string;
}

/**
 * Param names a template reads under `params.`.
 *
 * Parsed with Handlebars itself rather than matched with a regexp: a naive
 * `{{params.x}}` scan misses `{{#each params.x}}` and `{{#if params.x}}`, where
 * the path is an argument of a helper rather than the mustache's own path.
 * "Referenced" here means exactly what the interpolator would resolve.
 */
function referencedParams(template: string): Set<string> {
  const found = new Set<string>();

  let ast: unknown;
  try {
    ast = Handlebars.parse(template);
  } catch {
    // A template that does not even parse is already surfaced as a load error by
    // the registry. Lint reports what it can see instead of taking the catalog
    // down with it.
    return found;
  }

  // Generic walk rather than a per-node-type visitor: every Handlebars node kind
  // (mustache, block, sub-expression, hash pair, partial) can carry a
  // PathExpression, and enumerating them is how you miss one.
  const seen = new Set<object>();
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }

    const record = node as Record<string, unknown>;
    if (record.type === "PathExpression" && Array.isArray(record.parts)) {
      const parts = record.parts as string[];
      // Depth (`../`) is deliberately ignored. Inside `{{#each params.items}}`
      // the context is the item, so reaching the behavior's own params requires
      // `{{../params.x}}` — the root frame IS `{ agent, params }`. Treating a
      // non-zero depth as "not ours" reports a param that is genuinely read.
      if (parts[0] === "params" && parts.length > 1) {
        found.add(parts[1]);
      }
    }

    for (const value of Object.values(record)) walk(value);
  };

  walk(ast);
  return found;
}

/** Every param a behavior can actually consume, across all channels. */
function consumedParams(
  behavior: Behavior,
  compositions: Iterable<CompositionRule>,
): Set<string> {
  const consumed = new Set<string>();
  const absorb = (template: string): void => {
    for (const name of referencedParams(template)) consumed.add(name);
  };

  for (const section of Object.values(behavior.sections))
    absorb(section.prompt);
  for (const hook of Object.values(behavior.hooks)) {
    for (const arg of hook.args) absorb(arg);
  }
  for (const content of Object.values(behavior.side_car_files ?? {}))
    absorb(content);

  if (behavior.phase?.name && behavior.phase.name !== "main") {
    for (const knob of PHASE_KNOBS) consumed.add(knob);
  }

  for (const rule of compositions) {
    for (const param of Object.keys(
      rule.when.params_match?.[behavior.name] ?? {},
    )) {
      consumed.add(param);
    }
    for (const override of rule.actions.override_sections) {
      // An override's `{{params.x}}` resolves against the params of the behavior
      // it REPLACES a section in — not of whoever else is active.
      if (override.behavior === behavior.name) absorb(override.prompt);
    }
    // `inject_sections` is deliberately not a channel: assemblePrompt interpolates
    // injected sections with an empty `params`, so a param reference there resolves
    // to nothing (and throws under strict mode).
  }

  return consumed;
}

/**
 * Params a behavior declares but nothing can read.
 *
 * The value set for such a param is schema-validated and then dropped at
 * assembly — silent by construction, which is why it needs reporting rather
 * than trusting authors to notice.
 *
 * Not exhaustive by design, and therefore a warning rather than an error:
 * `assembleEnvVars` publishes every resolved param through `BCE_PARAMS`, so a
 * hook script can read one without any static trace.
 */
export function findUnusedParams(
  behaviors: Map<string, Behavior>,
  compositions: Iterable<CompositionRule>,
): UnusedParam[] {
  const rules = [...compositions];
  const unused: UnusedParam[] = [];

  for (const [name, behavior] of behaviors) {
    const declared = Object.keys(behavior.params);
    if (declared.length === 0) continue;

    const consumed = consumedParams(behavior, rules);
    for (const param of declared) {
      if (!consumed.has(param)) unused.push({ behavior: name, param });
    }
  }

  return unused;
}
