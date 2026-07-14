import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { existsSync } from "fs";

export function getBundledRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // In source mode (tsx): cli/paths.ts -> repo root is one level up.
  // In published mode (dist): dist/cli/paths.js -> repo root is two levels up.
  // Walk up until we find a directory containing all three marker subdirs.
  return resolveUp(here, ["behaviors", "presets", "compositions"]);
}

function resolveUp(start: string, markers: string[]): string {
  let dir = start;
  while (dir !== dirname(dir)) {
    if (markers.every((m) => existsSync(resolve(dir, m)))) return dir;
    dir = dirname(dir);
  }
  throw new Error(
    `promptweave: could not locate bundled defaults from ${start} (looking for ${markers.join(", ")})`,
  );
}

export function resolveRoot(rootArg: string | undefined): string {
  if (rootArg) {
    return resolve(rootArg);
  }
  return getBundledRoot();
}

/**
 * Catalog roots, in precedence order — the last one wins.
 *
 * No `--root` → the bundled catalog. One or more `--root` → exactly those, in the
 * order given (they REPLACE the bundled catalog; to overlay on top of it, pass it
 * explicitly as the first root). Deliberately no implicit base layer:
 * `getBundledRoot()` walks up the tree and can already land on the wrong directory
 * in a monorepo — turning that into a phantom base layer would produce prompts
 * assembled from a catalog nobody chose, and no way to tell.
 *
 * A root that does not exist is a HARD ERROR. `Registry.load` tolerates a missing
 * directory (an overlay has no reason to carry all three), but a path the user
 * typed must never degrade into a silent no-op — that is a typo turning into a
 * wrong prompt two screens later.
 */
export function resolveRoots(rootArgs: string[] | undefined): string[] {
  if (!rootArgs || rootArgs.length === 0) return [getBundledRoot()];
  return rootArgs.map((r) => {
    const p = resolve(r);
    if (!existsSync(p)) {
      throw new Error(`promptweave: --root does not exist: ${p}`);
    }
    return p;
  });
}
