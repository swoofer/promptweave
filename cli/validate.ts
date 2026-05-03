import { Command } from "commander";
import { resolve } from "path";
import { readFileSync } from "fs";
import yaml from "js-yaml";
import { Registry } from "../src/registry.js";
import {
  AgentSchema,
  BehaviorSchema,
  PresetSchema,
  CompositionRuleSchema,
} from "../src/types.js";
import { resolveRoot } from "./paths.js";

export function createValidateCommand(): Command {
  return new Command("validate")
    .description("Validate BCE YAML files (single file, or entire registry with --all)")
    .argument("[file]", "YAML file to validate")
    .option("--all", "Validate the bundled (or --root) registry")
    .option("--root <path>", "Use this directory's behaviors/presets/compositions instead of bundled (only with --all)")
    .action((file: string | undefined, opts: { all?: boolean; root?: string }) => {
      if (!opts.all && !file) {
        console.error("Usage: promptweave validate <file.yaml>  OR  promptweave validate --all [--root PATH]");
        process.exit(1);
      }
      if (opts.all) {
        validateAll(resolveRoot(opts.root));
      } else {
        validateFile(file!);
      }
    });
}

function validateAll(root: string): void {
  const registry = Registry.load(root);
  let hasErrors = false;

  if (registry.errors.length > 0) {
    console.error("YAML validation errors:");
    for (const err of registry.errors) {
      console.error(`  ${err.file}: ${err.message}`);
    }
    hasErrors = true;
  }

  for (const rule of registry.compositions.values()) {
    for (const override of rule.actions.override_sections) {
      const behavior = registry.getBehavior(override.behavior);
      if (!behavior) {
        console.error(`  Rule "${rule.name}": behavior "${override.behavior}" not found.`);
        hasErrors = true;
      } else if (!(override.section in behavior.sections)) {
        console.error(
          `  Rule "${rule.name}": section "${override.section}" not found in behavior "${override.behavior}". ` +
            `Available: [${Object.keys(behavior.sections).join(", ")}]`,
        );
        hasErrors = true;
      }
    }
    for (const key of Object.keys(rule.actions.inject_sections)) {
      if (!/^\d{3}-[\w-]+$/.test(key)) {
        console.error(`  Rule "${rule.name}": inject_sections key "${key}" does not match pattern "NNN-name".`);
        hasErrors = true;
      }
    }
  }

  if (hasErrors) process.exit(1);
  console.log(
    `OK ${registry.behaviors.size} behaviors, ${registry.presets.size} presets, ${registry.compositions.size} compositions - all valid.`,
  );
}

function validateFile(file: string): void {
  try {
    const content = readFileSync(resolve(file), "utf-8");
    const raw = yaml.load(content);
    const schemas = [
      ["behavior", BehaviorSchema],
      ["preset", PresetSchema],
      ["agent", AgentSchema],
      ["composition rule", CompositionRuleSchema],
    ] as const;
    for (const [name, schema] of schemas) {
      const result = (schema as { safeParse: (data: unknown) => { success: boolean } }).safeParse(raw);
      if (result.success) {
        console.log(`OK Valid ${name}: "${(raw as { name?: string }).name ?? "(unnamed)"}"`);
        return;
      }
    }
    console.error("Validation failed against all known schemas.");
    process.exit(1);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
