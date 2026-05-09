// tests/cli/build.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import { mkdirSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const FIXTURE_ROOT = resolve(REPO_ROOT, 'tests', 'fixtures', 'cli-integration');

function runCli(
  args: string,
  opts?: { cwd?: string; expectFail?: boolean },
): { stdout: string; stderr: string; code: number } {
  const cliPath = join(REPO_ROOT, 'cli', 'index.ts');
  // Quote paths to survive any future spaces in temp directories
  const cmd = `npx tsx "${cliPath}" ${args}`;
  try {
    const stdout = execSync(cmd, {
      cwd: opts?.cwd ?? REPO_ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    if (!opts?.expectFail) throw err;
    return {
      stdout: typeof e.stdout === 'string' ? e.stdout : (e.stdout?.toString() ?? ''),
      stderr: typeof e.stderr === 'string' ? e.stderr : (e.stderr?.toString() ?? ''),
      code: e.status ?? 1,
    };
  }
}

function tmpDir(prefix: string): string {
  return join(tmpdir(), `pw-cli-test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

describe('cli/build — --target dispatch (fixture-isolated)', () => {
  const cleanup: string[] = [];
  afterEach(() => {
    for (const d of cleanup) {
      try { if (existsSync(d)) rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    cleanup.length = 0;
  });

  it('--target skill writes SKILL.md to <output>/<presetName>/SKILL.md', () => {
    const out = tmpDir('skill-out');
    const cwd = tmpDir('skill-cwd');
    cleanup.push(out, cwd);
    mkdirSync(out, { recursive: true });
    mkdirSync(cwd, { recursive: true });

    runCli(`build translator --target skill --root "${FIXTURE_ROOT}" --output "${out}"`, { cwd });

    const skillPath = join(out, 'translator', 'SKILL.md');
    expect(existsSync(skillPath)).toBe(true);
    const content = readFileSync(skillPath, 'utf-8');
    expect(content).toMatch(/^---\nname: translator/);
    expect(content).toContain('## Parameters');
  });

  it('--target bundle (explicit) produces same prompt content as no flag', () => {
    const outA = tmpDir('bundle-explicit');
    const outB = tmpDir('bundle-default');
    const cwdA = tmpDir('cwd-a');
    const cwdB = tmpDir('cwd-b');
    cleanup.push(outA, outB, cwdA, cwdB);
    mkdirSync(cwdA, { recursive: true });
    mkdirSync(cwdB, { recursive: true });

    runCli(`build inspector --target bundle --root "${FIXTURE_ROOT}" --output "${outA}"`, { cwd: cwdA });
    runCli(`build inspector --root "${FIXTURE_ROOT}" --output "${outB}"`, { cwd: cwdB });

    const promptA = readFileSync(join(outA, 'generated-prompt.md'), 'utf-8');
    const promptB = readFileSync(join(outB, 'generated-prompt.md'), 'utf-8');
    expect(promptA).toBe(promptB);
  });

  it('--target unknown-value exits non-zero and lists valid targets', () => {
    const cwd = tmpDir('unknown-cwd');
    cleanup.push(cwd);
    mkdirSync(cwd, { recursive: true });

    const result = runCli(`build translator --target nonexistent --root "${FIXTURE_ROOT}"`, { cwd, expectFail: true });
    expect(result.code).not.toBe(0);
    const combined = result.stderr + result.stdout;
    expect(combined).toMatch(/Unknown target 'nonexistent'/);
    expect(combined).toMatch(/bundle/);
    expect(combined).toMatch(/skill/);
  });

  it('--dry-run --target skill prints SKILL.md to stdout and writes nothing', () => {
    const out = tmpDir('dryrun-out');
    const cwd = tmpDir('dryrun-cwd');
    cleanup.push(out, cwd);
    mkdirSync(out, { recursive: true });
    mkdirSync(cwd, { recursive: true });

    const result = runCli(`build translator --target skill --dry-run --root "${FIXTURE_ROOT}" --output "${out}"`, { cwd });

    expect(result.stdout).toContain('=== Resolution ===');
    expect(result.stdout).toContain('=== SKILL.md ===');
    expect(result.stdout).toContain('name: translator');

    expect(existsSync(join(out, 'translator'))).toBe(false);
  });

  it('--target skill with hooks-bearing preset emits dropped-hooks warning', () => {
    const out = tmpDir('hooks-out');
    const cwd = tmpDir('hooks-cwd');
    cleanup.push(out, cwd);
    mkdirSync(out, { recursive: true });
    mkdirSync(cwd, { recursive: true });

    const result = runCli(`build inspector --target skill --root "${FIXTURE_ROOT}" --output "${out}"`, { cwd });

    expect(result.stdout).toMatch(/\[render\] skill target ignores hooks/);
  });

  it('--target skill propagates preset.frontmatter to SKILL.md frontmatter', () => {
    const out = tmpDir('extra-fm-out');
    const cwd = tmpDir('extra-fm-cwd');
    cleanup.push(out, cwd);
    mkdirSync(out, { recursive: true });
    mkdirSync(cwd, { recursive: true });

    runCli(`build translator-with-frontmatter --target skill --root "${FIXTURE_ROOT}" --output "${out}"`, { cwd });

    const content = readFileSync(join(out, 'translator-with-frontmatter', 'SKILL.md'), 'utf-8');
    expect(content).toMatch(/argument-hint:/);
    expect(content).toMatch(/disable-model-invocation: true/);
  });

  it('--target skill writes declared side-car files alongside SKILL.md', () => {
    const out = tmpDir('sidecar-out');
    const cwd = tmpDir('sidecar-cwd');
    cleanup.push(out, cwd);
    mkdirSync(out, { recursive: true });
    mkdirSync(cwd, { recursive: true });

    runCli(`build sidecar-skill --target skill --root "${FIXTURE_ROOT}" --output "${out}"`, { cwd });

    expect(existsSync(join(out, 'sidecar-skill', 'SKILL.md'))).toBe(true);
    const sidecar = readFileSync(join(out, 'sidecar-skill', 'references', 'standards.md'), 'utf-8');
    expect(sidecar).toContain('Always use snake_case');
  });
});
