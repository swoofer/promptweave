import { Command } from "commander";
import { resolve, join } from "path";
import { existsSync, readFileSync } from "fs";
import yaml from "js-yaml";
import { runPipeline } from "../src/pipeline.js";
import { AgentSchema } from "../src/types.js";
import type { Behavior } from "../src/types.js";
import { resolveRoot } from "./paths.js";
import { collect, parseSetParams } from "./params.js";
import { registry } from "../src/renderers/index.js";
import type { RenderedParam } from "../src/renderers/index.js";
import { Registry } from "../src/registry.js";
import { resolveParams } from "../src/resolve.js";

function buildSkillContext(
  agent: { name: string; preset?: string; params?: Record<string, Record<string, unknown>> },
  behaviors: Behavior[],
  registryInstance: Registry,
  launchParams: Record<string, Record<string, unknown>>,
): { description?: string; params: RenderedParam[] } {
  const presetSlug = agent.preset ?? agent.name;
  const preset = registryInstance.presets.get(presetSlug);
  const description = preset?.description;

  const behaviorNames = behaviors.map((b) => b.name);
  const presetParams = preset?.params ?? {};
  const agentParams = agent.params ?? {};

  // Resolve params with full precedence: behavior default → preset override → agent override → launchParams
  const resolvedParams = resolveParams(behaviorNames, registryInstance, presetParams, agentParams, launchParams);

  const params: RenderedParam[] = [];
  for (const b of behaviors) {
    for (const [pname, pdef] of Object.entries(b.params ?? {})) {
      const effectiveDefault = resolvedParams[b.name]?.[pname] ?? pdef.default;
      params.push({
        name: pname,
        type: pdef.type,
        description: pdef.description,
        required: pdef.required ?? false,
        effectiveDefault,
      });
    }
  }
  return { description, params };
}

export function createBuildCommand(): Command {
  return new Command("build")
    .description("Assemble a prompt from a preset (or agent) using bundled or user-supplied behaviors")
    .argument("<agent>", "Agent name or preset")
    .option("--root <path>", "Use behaviors/presets/compositions from this directory instead of bundled")
    .option("--dry-run", "Print the assembled output to stdout without writing files")
    .option("--set <key=value>", "Parameter override, repeatable (e.g., --set bug-hunting.modules='[\"src/auth\"]')", collect, [])
    .option("--output <dir>", "Output directory (default: .claude/promptweave in cwd)")
    .option("--target <type>", "Output target: 'bundle' (default) or 'skill'", "bundle")
    .action(async (agentName: string, opts: { root?: string; dryRun?: boolean; set: string[]; output?: string; target: string }) => {
      const root = resolveRoot(opts.root);
      const target = opts.target;
      const renderer = registry[target];
      if (!renderer) {
        console.error(`Unknown target '${target}'. Valid: ${Object.keys(registry).join(', ')}`);
        process.exit(1);
      }
      const agentPath = resolve(root, "agents", `${agentName}.yaml`);

      let agent;
      if (existsSync(agentPath)) {
        const content = readFileSync(agentPath, "utf-8");
        agent = AgentSchema.parse(yaml.load(content));
      } else {
        agent = AgentSchema.parse({ name: agentName, preset: agentName });
      }

      const launchParams = parseSetParams(opts.set);
      const result = runPipeline(agent, root, launchParams);

      if (opts.dryRun) {
        console.log("=== Resolution ===");
        console.log(`Agent: ${result.agent.id} (profile: ${result.agent.profile}, model: ${result.agent.model})`);
        console.log(`Behaviors: [${result.behaviors.map((b) => b.name).join(", ")}]`);

        console.log("\n=== Composition rules applied ===");
        if (result.compositionRulesApplied.length === 0) {
          console.log("  (none)");
        } else {
          for (const r of result.compositionRulesApplied) console.log(`  + ${r}`);
        }

        if (target === 'skill') {
          // Render to a tmp dir so we can read the produced SKILL.md and print it
          const { tmpdir } = await import("os");
          const { rmSync, readFileSync, mkdirSync } = await import("fs");
          const tmpDest = join(tmpdir(), `pw-dryrun-${Date.now()}-${Math.random().toString(36).slice(2)}`);
          mkdirSync(tmpDest, { recursive: true });

          const registryInstance = Registry.load(root);
          const { description, params } = buildSkillContext(agent, result.behaviors, registryInstance, launchParams);
          let renderResult;
          try {
            renderResult = renderer.render(result.output, tmpDest, {
              presetName: agent.preset ?? agent.name,
              description,
              params,
            });

            console.log("\n=== Warnings ===");
            const all = [
              ...result.warnings.map((w) => `  ! [pipeline] ${w}`),
              ...renderResult.warnings.map((w) => `  ${w}`),
            ];
            if (all.length === 0) console.log("  (none)");
            else for (const w of all) console.log(w);

            console.log("\n=== SKILL.md ===");
            const skillContent = readFileSync(join(tmpDest, agent.preset ?? agent.name, "SKILL.md"), "utf-8");
            console.log(skillContent);
          } finally {
            try { rmSync(tmpDest, { recursive: true, force: true }); } catch { /* ignore */ }
          }
          return;
        }

        // Bundle dry-run: preserve existing behavior verbatim.
        console.log("\n=== Warnings ===");
        if (result.warnings.length === 0) {
          console.log("  (none)");
        } else {
          for (const w of result.warnings) console.log(`  ! ${w}`);
        }

        console.log("\n=== Assembled prompt ===");
        for (const entry of result.sectionTrace) {
          const override = entry.overriddenBy ? `, overridden by rule ${entry.overriddenBy}` : "";
          const prefix = `[${String(entry.number).padStart(3, "0")}] (${entry.behaviorName}${override})`;
          console.log(`${prefix} ${entry.prompt.trim().split("\n")[0]}...`);
        }

        console.log("\n=== Hooks ===");
        for (const [lifecycle, content] of Object.entries(result.output.hooks)) {
          const lines = content.split("\n").filter((l) => l.startsWith("# From"));
          console.log(`  ${lifecycle}: ${lines.map((l) => l.replace("# From behavior: ", "")).join(", ")}`);
        }

        console.log("\n=== MCP tools ===");
        console.log(`  ${result.output.mcpTools.join(", ")}`);

        if (result.output.phases.length > 0) {
          console.log("\n=== Phases ===");
          for (const phase of result.output.phases) {
            const effort = phase.effort ?? "(auto)";
            console.log(`  ${phase.name.padEnd(10)} tools=${phase.toolsMode.padEnd(9)} loop=${String(phase.loop).padEnd(5)} effort=${effort}`);
          }
        }
      } else {
        const defaultOutput = target === 'skill'
          ? resolve(process.cwd(), '.claude', 'skills')
          : resolve(process.cwd(), '.claude', 'promptweave');
        const outputDir = opts.output ?? defaultOutput;

        let ctx: import("../src/renderers/index.js").RenderContext;
        if (target === 'skill') {
          const registryInstance = Registry.load(root);
          const { description, params } = buildSkillContext(agent, result.behaviors, registryInstance, launchParams);
          ctx = {
            presetName: agent.preset ?? agent.name,
            description,
            params,
          };
        } else {
          ctx = {
            presetName: agent.preset ?? agent.name,
            projectRoot: process.cwd(),
          };
        }

        const renderResult = renderer.render(result.output, outputDir, ctx);

        console.log(`OK Output written to ${outputDir}`);

        for (const w of result.warnings) console.log(`  ! [pipeline] ${w}`);
        for (const w of renderResult.warnings) console.log(`  ${w}`); // already prefixed with [render]
      }
    });
}
