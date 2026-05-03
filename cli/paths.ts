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
