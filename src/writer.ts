// src/writer.ts — backward-compat shim. New code should use bundleRenderer.render directly.
import { bundleRenderer } from './renderers/bundle.js';
import type { AssembledOutput } from './types.js';

/**
 * @deprecated Use `bundleRenderer.render(output, dir, { presetName, projectRoot })`.
 * Kept because this symbol is part of the public API surface (re-exported from src/index.ts).
 */
export function writeOutput(
  targetDir: string,
  output: AssembledOutput,
  projectRoot?: string,
): void {
  bundleRenderer.render(output, targetDir, { presetName: '', projectRoot });
}
