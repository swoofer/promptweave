// bce/engine/phases.ts
import type { Behavior, AgentContext, PhasePrompt } from './types.js';
import { interpolate } from './template.js';

/**
 * Group behavior sections by phase. Behaviors without a phase field
 * go into a default "main" phase (backward compat).
 * Returns phases in declaration order. Empty array = one-shot mode.
 */
export function assemblePhases(
  behaviors: Map<string, Behavior>,
  injectedSections: Map<string, { prompt: string; source: string }>,
  overriddenSections: Map<string, string>,
  agent: AgentContext,
  resolvedParams: Record<string, Record<string, unknown>>,
): PhasePrompt[] {
  const phaseMap = new Map<string, {
    toolsMode: 'read_only' | 'full' | 'none';
    loop: boolean;
    effort?: string;
    model?: string;
    thinking?: string;
    maxTurns?: number;
    sections: Array<{ number: number; behaviorName: string; prompt: string }>;
  }>();
  const phaseOrder: string[] = [];

  for (const [behaviorName, behavior] of behaviors) {
    const phaseName = behavior.phase?.name ?? 'main';
    const toolsMode = behavior.phase?.tools_mode ?? 'full';
    const loop = behavior.phase?.loop ?? false;

    if (!phaseMap.has(phaseName)) {
      phaseMap.set(phaseName, { toolsMode, loop, sections: [] });
      phaseOrder.push(phaseName);
    }

    const phase = phaseMap.get(phaseName)!;
    const params = resolvedParams[behaviorName] ?? {};

    // Capture effort/model/thinking/maxTurns from the phase-owning behavior.
    // First-wins per named phase; "main" has no effort knobs (it's a context-only phase).
    // resolveParams fills missing-and-defaulted params with empty values ("" for string,
    // 0 for number) — treat those as unset so the effort-profile default is used.
    if (phaseName !== 'main') {
      if (phase.effort === undefined && typeof params.effort === 'string' && params.effort !== '') {
        phase.effort = params.effort;
      }
      if (phase.model === undefined && typeof params.model === 'string' && params.model !== '') {
        phase.model = params.model;
      }
      if (phase.thinking === undefined && typeof params.thinking === 'string' && params.thinking !== '') {
        phase.thinking = params.thinking;
      }
      if (phase.maxTurns === undefined && typeof params.maxTurns === 'number' && params.maxTurns > 0) {
        phase.maxTurns = params.maxTurns;
      }
    }

    const context = { agent, params };

    for (const [key, section] of Object.entries(behavior.sections)) {
      const number = parseInt(key.substring(0, 3), 10);
      const overrideKey = `${behaviorName}:${key}`;
      if (overriddenSections.has(overrideKey)) continue;
      const prompt = interpolate(section.prompt, context, `${behaviorName}:${key}`);
      phase.sections.push({ number, behaviorName, prompt });
    }
  }

  // Add injected sections to "main" phase
  if (!phaseMap.has('main')) {
    phaseMap.set('main', { toolsMode: 'full', loop: false, sections: [] });
    if (!phaseOrder.includes('main')) phaseOrder.push('main');
  }
  for (const [key, injected] of injectedSections) {
    const number = parseInt(key.substring(0, 3), 10);
    const prompt = interpolate(injected.prompt, { agent, params: {} });
    phaseMap.get('main')!.sections.push({ number, behaviorName: `_rule:${injected.source}`, prompt });
  }

  // If only "main" phase → one-shot compat (return empty)
  if (phaseOrder.length === 1 && phaseOrder[0] === 'main') {
    return [];
  }

  // Get main phase sections (context to prepend to each named phase).
  // The filter for applies_when runs per-target-phase below, so we only sort here.
  const mainPhase = phaseMap.get('main');
  if (mainPhase) mainPhase.sections.sort((a, b) => a.number - b.number);

  // Build named phases with main context prepended. The main prompt is recomputed
  // for each target phase because a behavior may declare applies_when constraints
  // (e.g. "only full-tools phases") that filter its sections out of some targets.
  return phaseOrder
    .filter((name) => name !== 'main')
    .map((name) => {
      const phase = phaseMap.get(name)!;
      phase.sections.sort((a, b) => a.number - b.number);
      const phasePrompt = phase.sections.map((s) => s.prompt.trim()).join('\n\n');

      const mainPromptForPhase = mainPhase
        ? mainPhase.sections
            .filter((s) => sectionAppliesToPhase(s.behaviorName, phase.toolsMode, behaviors))
            .map((s) => s.prompt.trim())
            .join('\n\n')
        : '';

      return {
        name,
        prompt: mainPromptForPhase ? `${mainPromptForPhase}\n\n${phasePrompt}` : phasePrompt,
        toolsMode: phase.toolsMode,
        loop: phase.loop,
        effort: phase.effort,
        model: phase.model,
        thinking: phase.thinking,
        maxTurns: phase.maxTurns,
      };
    });
}

// Injected sections (from composition rules) use `_rule:<source>` as their behaviorName
// and have no associated behavior entry. They always apply — rules opt into their own
// targeting via composition `when` conditions, not per-phase scope.
function sectionAppliesToPhase(
  behaviorName: string,
  toolsMode: 'read_only' | 'full' | 'none',
  behaviors: Map<string, Behavior>,
): boolean {
  const beh = behaviors.get(behaviorName);
  const scope = beh?.applies_when?.phase_tools_mode;
  if (!scope || scope.length === 0) return true;
  return scope.includes(toolsMode);
}
