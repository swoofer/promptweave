import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { join } from "path";
import { getBundledRoot } from "../cli/paths.js";

describe("getBundledRoot", () => {
  it("returns a directory that contains bundled behaviors, presets, compositions", () => {
    const root = getBundledRoot();
    expect(existsSync(join(root, "behaviors"))).toBe(true);
    expect(existsSync(join(root, "presets"))).toBe(true);
    expect(existsSync(join(root, "compositions"))).toBe(true);
  });
});
