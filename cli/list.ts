import { Command } from "commander";
import { Registry } from "../src/registry.js";
import { resolveRoots } from "./paths.js";
import { collect } from "./params.js";

export function createListCommand(): Command {
  return new Command("list")
    .description("List bundled (or user) behaviors / presets / compositions")
    .argument("[type]", "behaviors | presets | compositions")
    .option("--root <path>", "Catalog root; repeatable — later roots override earlier ones", collect, [])
    .option("--category <cat>", "Filter behaviors by category")
    .action((type: string | undefined, opts: { root: string[]; category?: string }) => {
      if (!type) {
        console.error("Usage: promptweave list <behaviors|presets|compositions> [--category X] [--root PATH]");
        process.exit(1);
      }
      const registry = Registry.load(resolveRoots(opts.root));

      switch (type) {
        case "behaviors": {
          let items = [...registry.behaviors.values()];
          if (opts.category) {
            items = items.filter((b) => b.category === opts.category);
          }
          console.log(`Behaviors (${items.length}):`);
          for (const b of items) {
            console.log(`  ${b.name.padEnd(30)} ${b.category ?? ""}\t${b.description}`);
          }
          break;
        }
        case "presets": {
          console.log(`Presets (${registry.presets.size}):`);
          for (const p of registry.presets.values()) {
            console.log(`  ${p.name.padEnd(20)} ${p.description} [${p.behaviors.join(", ")}]`);
          }
          break;
        }
        case "compositions": {
          console.log(`Composition rules (${registry.compositions.size}):`);
          for (const c of registry.compositions.values()) {
            console.log(`  ${c.name.padEnd(30)} priority:${c.priority}\t${c.description}`);
          }
          break;
        }
        default:
          console.error("Usage: promptweave list <behaviors|presets|compositions> [--category X] [--root PATH]");
          process.exit(1);
      }
    });
}
