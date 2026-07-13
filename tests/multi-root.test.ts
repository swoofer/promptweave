// tests/multi-root.test.ts — catalogue multi-racines (overlay)
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Registry } from '../src/registry.js';
import { runPipeline } from '../src/pipeline.js';
import type { Agent } from '../src/types.js';

const made: string[] = [];
afterEach(() => {
  for (const p of made) rmSync(p, { recursive: true, force: true });
  made.length = 0;
});

function tmpRoot(suffix: string): string {
  const root = join(tmpdir(), `pw-multi-${Date.now()}-${Math.random().toString(36).slice(2)}-${suffix}`);
  for (const d of ['behaviors', 'presets', 'compositions']) {
    mkdirSync(join(root, d), { recursive: true });
  }
  made.push(root);
  return root;
}

function write(root: string, dir: string, file: string, body: string): void {
  writeFileSync(join(root, dir, file), body, 'utf-8');
}

function behavior(name: string, prompt: string): string {
  return `name: ${name}
description: "b"
sections:
  "010-main":
    prompt: "${prompt}"`;
}

const AGENT: Agent = { name: 'a', preset: 'p', add: [], remove: [], params: {} };

// ── La sémantique d'override ────────────────────────────────────────────────
// Granularité = DOCUMENT ENTIER, clé = le champ `name` du YAML (pas le nom de
// fichier), dernier root gagne. Pas de deep-merge des sections/params : un
// deep-merge de prompts Handlebars serait indébuggable — on ne saurait plus dire
// quel prompt part réellement.

describe('Registry.load — plusieurs racines', () => {
  it('accepte toujours une racine unique (non-régression)', () => {
    const a = tmpRoot('solo');
    write(a, 'behaviors', 'x.yaml', behavior('x', 'de A'));

    const reg = Registry.load(a);
    expect(reg.getBehavior('x')?.sections?.['010-main'].prompt).toBe('de A');
  });

  it('cumule les entrées non conflictuelles des deux racines', () => {
    const a = tmpRoot('a');
    const b = tmpRoot('b');
    write(a, 'behaviors', 'x.yaml', behavior('x', 'de A'));
    write(b, 'behaviors', 'y.yaml', behavior('y', 'de B'));

    const reg = Registry.load([a, b]);
    expect(reg.getBehavior('x')).toBeDefined();
    expect(reg.getBehavior('y')).toBeDefined();
  });

  it('la DERNIÈRE racine gagne sur un même `name`', () => {
    const a = tmpRoot('a');
    const b = tmpRoot('b');
    write(a, 'behaviors', 'x.yaml', behavior('x', 'de A'));
    write(b, 'behaviors', 'x.yaml', behavior('x', 'de B'));

    const reg = Registry.load([a, b]);
    expect(reg.getBehavior('x')?.sections?.['010-main'].prompt).toBe('de B');
  });

  it('la clé est le champ `name` du YAML, PAS le nom de fichier', () => {
    // Piège contre-intuitif à verrouiller : un fichier nommé autrement mais
    // déclarant le même `name` écrase quand même.
    const a = tmpRoot('a');
    const b = tmpRoot('b');
    write(a, 'behaviors', 'original.yaml', behavior('x', 'de A'));
    write(b, 'behaviors', 'tout-autre-nom.yaml', behavior('x', 'de B'));

    const reg = Registry.load([a, b]);
    expect(reg.getBehavior('x')?.sections?.['010-main'].prompt).toBe('de B');
  });

  it('override aussi les presets', () => {
    const a = tmpRoot('a');
    const b = tmpRoot('b');
    write(a, 'behaviors', 'x.yaml', behavior('x', 'de A'));
    write(a, 'presets', 'p.yaml', `name: p\ndescription: "de A"\nbehaviors: [x]`);
    write(b, 'presets', 'p.yaml', `name: p\ndescription: "de B"\nbehaviors: [x]`);

    const reg = Registry.load([a, b]);
    expect(reg.getPreset('p')?.description).toBe('de B');
    expect(reg.overrides).toContainEqual({ kind: 'preset', name: 'p', from: a, by: b });
  });

  it('une racine inexistante ou sans sous-dossiers ne fait pas exploser le chargement', () => {
    const a = tmpRoot('a');
    write(a, 'behaviors', 'x.yaml', behavior('x', 'de A'));

    const reg = Registry.load([a, join(tmpdir(), 'racine-qui-nexiste-pas-xyz')]);
    expect(reg.getBehavior('x')).toBeDefined();
  });

  it('cumule les erreurs des deux racines, discriminables par leur chemin', () => {
    const a = tmpRoot('a');
    const b = tmpRoot('b');
    write(a, 'behaviors', 'casse.yaml', 'name: [ceci nest pas un behavior valide');
    write(b, 'behaviors', 'casse.yaml', 'name: 42');

    const reg = Registry.load([a, b]);
    expect(reg.errors.length).toBe(2);
    expect(reg.errors.some((e) => e.file.startsWith(a))).toBe(true);
    expect(reg.errors.some((e) => e.file.startsWith(b))).toBe(true);
  });
});

// ── Traçabilité ─────────────────────────────────────────────────────────────
// Sans ça, l'overlay est un piège permanent : on ne peut pas savoir d'où vient
// réellement le prompt qui part.

describe('Registry — traçabilité de l\'origine', () => {
  it('expose la racine d\'origine de chaque entrée', () => {
    const a = tmpRoot('a');
    const b = tmpRoot('b');
    write(a, 'behaviors', 'x.yaml', behavior('x', 'de A'));
    write(b, 'behaviors', 'y.yaml', behavior('y', 'de B'));

    const reg = Registry.load([a, b]);
    expect(reg.sourceOf('behavior', 'x')).toBe(a);
    expect(reg.sourceOf('behavior', 'y')).toBe(b);
  });

  it('liste les écrasements — un override silencieux est un bug qui attend', () => {
    const a = tmpRoot('a');
    const b = tmpRoot('b');
    write(a, 'behaviors', 'x.yaml', behavior('x', 'de A'));
    write(b, 'behaviors', 'x.yaml', behavior('x', 'de B'));

    const reg = Registry.load([a, b]);
    expect(reg.overrides).toHaveLength(1);
    expect(reg.overrides[0]).toMatchObject({ kind: 'behavior', name: 'x', from: a, by: b });
  });

  it('sans écrasement, la liste est vide', () => {
    const a = tmpRoot('a');
    write(a, 'behaviors', 'x.yaml', behavior('x', 'de A'));
    expect(Registry.load(a).overrides).toHaveLength(0);
  });

  it('expose les racines chargées', () => {
    const a = tmpRoot('a');
    const b = tmpRoot('b');
    expect(Registry.load([a, b]).roots).toEqual([a, b]);
  });
});

// ── runPipeline ─────────────────────────────────────────────────────────────

describe('runPipeline — overlay', () => {
  function baseRoot(): string {
    const r = tmpRoot('base');
    write(r, 'behaviors', 'x.yaml', behavior('x', 'de la base'));
    write(r, 'presets', 'p.yaml', `name: p\ndescription: "preset"\nbehaviors: [x]`);
    return r;
  }

  it('accepte une racine unique (non-régression)', () => {
    const prompt = runPipeline(AGENT, baseRoot(), {}).output.prompt;
    expect(prompt).toContain('de la base');
  });

  it('le prompt de l\'overlay gagne', () => {
    const base = baseRoot();
    const over = tmpRoot('over');
    write(over, 'behaviors', 'x.yaml', behavior('x', "de l'overlay"));

    const prompt = runPipeline(AGENT, [base, over], {}).output.prompt;
    expect(prompt).toContain("de l'overlay");
    expect(prompt).not.toContain('de la base');
  });

  it('un preset de l\'overlay peut référencer un behavior de la BASE — le cas qui échoue aujourd\'hui', () => {
    const base = baseRoot();
    const over = tmpRoot('over');
    write(over, 'behaviors', 'maison.yaml', behavior('maison', 'behavior maison'));
    write(over, 'presets', 'p-maison.yaml', `name: p-maison\ndescription: "maison"\nbehaviors: [x, maison]`);

    const agent: Agent = { name: 'a', preset: 'p-maison', add: [], remove: [], params: {} };
    const prompt = runPipeline(agent, [base, over], {}).output.prompt;

    expect(prompt).toContain('de la base');      // behavior bundlé
    expect(prompt).toContain('behavior maison'); // behavior maison
  });

  it('un YAML d\'overlay invalide REMONTE EN WARNING au lieu de retomber en silence sur la base', () => {
    // LE piège n°1 de l'overlay : Registry.load pousse l'erreur zod dans
    // `errors`, n'insère rien, et runPipeline ne lisait JAMAIS `errors`. Résultat :
    // retour silencieux sur la version de base, build "réussi", prompt faux.
    const base = baseRoot();
    const over = tmpRoot('over');
    write(over, 'behaviors', 'x.yaml', 'name: x\nsections: "ceci nest pas un objet"');

    const result = runPipeline(AGENT, [base, over], {});

    expect(result.output.prompt).toContain('de la base'); // repli, mais...
    expect(result.warnings.join('\n')).toMatch(/x\.yaml/);  // ...on le DIT
  });
});
