import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { after } from 'node:test';
import { loadEngineContract, shellEnvFor } from '../plugin/abathur.js';

// ── fixtures ────────────────────────────────────────────────────────────────
const roots: string[] = [];
function freshRoot(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `abathur-plugintest-${tag}-`));
  roots.push(dir);
  return dir;
}
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

/** Fake installed engine mirroring the real npm-global layout:
 * <root>/bin/abathur → SYMLINK → <root>/pkg/dist/cli.js (exec) + <root>/pkg/dist/engine-registry.json.
 * locateRegistry walks up from realpath(bin), so the symlink-to-dist shape is load-bearing. */
function fakeEngine(root: string, opts: { version?: string; registry?: unknown; noVersionFlag?: boolean } = {}): { bin: string; registryPath: string } {
  const binDir = path.join(root, 'bin');
  const distDir = path.join(root, 'pkg', 'dist');
  mkdirSync(binDir, { recursive: true });
  mkdirSync(distDir, { recursive: true });
  const bin = path.join(binDir, 'abathur');
  const cli = path.join(distDir, 'cli.js');
  const version = opts.version ?? '0.4.0';
  const body = opts.noVersionFlag
    ? '#!/bin/sh\necho "abathur: unknown option --version" >&2\nexit 64\n'
    : `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi\nexit 0\n`;
  writeFileSync(cli, body, { mode: 0o755 });
  execFileSync('ln', ['-s', cli, bin]);
  const registryPath = path.join(distDir, 'engine-registry.json');
  if (opts.registry !== undefined) {
    writeFileSync(registryPath, typeof opts.registry === 'string' ? opts.registry : JSON.stringify(opts.registry));
  }
  return { bin, registryPath };
}

function defaultRegistry() {
  return {
    schemaVersion: 1,
    writeCommands: [['promote']],
    readonlyPrefixes: [['status']],
    envKeys: ['ABATHUR_CONFIG', 'ABATHUR_SELF_REPO'],
    injectableAllowlist: ['PATH', 'ABATHUR_CONFIG', 'ABATHUR_SELF_REPO', 'ABATHUR_HISTORIAN_REPO', 'ABATHUR_DEBUG'],
  };
}

// ── loadEngineContract ──────────────────────────────────────────────────────
test('contract: probe success + readable registry → full mode with parsed registry', () => {
  const root = freshRoot('full');
  const { bin } = fakeEngine(root, { version: '0.4.0', registry: defaultRegistry() });
  const warns: string[] = [];
  const c = loadEngineContract({ binPath: bin, now: () => new Date(), warn: (m: string) => warns.push(m) });
  assert.equal(c.mode, 'full');
  assert.equal(c.engineVersion, '0.4.0');
  assert.ok(c.registry);
  assert.equal(c.registry.schemaVersion, 1);
  assert.deepEqual(c.registry.injectableAllowlist, defaultRegistry().injectableAllowlist);
  assert.deepEqual(warns, []);
});

test('contract: engine without --version flag (pre-0.4.0 train) → fallback-probe, no throw', () => {
  const root = freshRoot('old');
  const { bin } = fakeEngine(root, { noVersionFlag: true, registry: defaultRegistry() });
  const warns: string[] = [];
  const c = loadEngineContract({ binPath: bin, now: () => new Date(), warn: (m: string) => warns.push(m) });
  assert.equal(c.mode, 'fallback-probe');
  assert.match(warns.join('\n'), /FALLBACK-PROBE/i);
});

test('contract: registry corrupt → fallback-probe with corruption warning (fail-closed on keys)', () => {
  const root = freshRoot('corrupt');
  const { bin } = fakeEngine(root, { registry: '{not json' });
  const warns: string[] = [];
  const c = loadEngineContract({ binPath: bin, now: () => new Date(), warn: (m: string) => warns.push(m) });
  assert.equal(c.mode, 'fallback-probe');
  assert.match(warns.join('\n'), /engine-registry/i);
});

test('contract: registry missing injectableAllowlist → static five-key fallback + warning', () => {
  const root = freshRoot('partial');
  const reg = defaultRegistry() as Record<string, unknown>;
  delete reg['injectableAllowlist'];
  const { bin } = fakeEngine(root, { registry: reg });
  const warns: string[] = [];
  const c = loadEngineContract({ binPath: bin, now: () => new Date(), warn: (m: string) => warns.push(m) });
  assert.equal(c.mode, 'full');
  assert.deepEqual(c.injectableAllowlist, ['PATH', 'ABATHUR_CONFIG', 'ABATHUR_SELF_REPO', 'ABATHUR_HISTORIAN_REPO', 'ABATHUR_DEBUG']);
  assert.match(warns.join('\n'), /allowlist/i);
});

test('contract: TTL cache — second call within window does not re-probe', () => {
  const root = freshRoot('ttl');
  const { bin } = fakeEngine(root, { registry: defaultRegistry() });
  let t = Date.UTC(2026, 9, 22, 12, 0, 0);
  const c1 = loadEngineContract({ binPath: bin, now: () => new Date(t) });
  assert.equal(c1.mode, 'full');
  // break the engine after first probe; cached contract must survive within TTL
  writeFileSync(bin, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const c2 = loadEngineContract({ binPath: bin, now: () => new Date(t + 59_000) });
  assert.equal(c2.mode, 'full');
  // after TTL expiry the broken engine is re-probed → fallback
  const c3 = loadEngineContract({ binPath: bin, now: () => new Date(t + 61_000) });
  assert.equal(c3.mode, 'fallback-probe');
});

// ── shellEnvFor (T3) ────────────────────────────────────────────────────────
const SHELL_ENV_REL = path.join('.config', 'opencode', 'abathur-shell-env.json');

function writeManifest(home: string, manifest: unknown): void {
  const p = path.join(home, SHELL_ENV_REL);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
}

test('T3: pinned repoRoot + matching directory → allowlisted keys injected, PATH prepended', () => {
  const home = freshRoot('t3ok');
  const repo = freshRoot('t3repo');
  writeManifest(home, { repoRoot: repo, env: { PATH: '/opt/tool/bin', ABATHUR_SELF_REPO: repo, SECRET_TOKEN: 'nope' } });
  const warns: string[] = [];
  const out = shellEnvFor({ home, directory: repo, warn: (m: string) => warns.push(m) });
  assert.ok(out);
  assert.equal(out['PATH'], `/opt/tool/bin:${process.env['PATH'] ?? ''}`);
  assert.equal(out['ABATHUR_SELF_REPO'], repo);
  assert.equal('SECRET_TOKEN' in out, false, 'non-allowlisted key must be rejected');
  assert.match(warns.join('\n'), /SECRET_TOKEN/, 'rejected key must be warned');
});

test('T3: directory ≠ pinned repoRoot (realpath) → null (injection scoped to the pinned repo only)', () => {
  const home = freshRoot('t3mismatch');
  const repo = freshRoot('t3repo2');
  const other = freshRoot('t3other');
  writeManifest(home, { repoRoot: repo, env: { ABATHUR_DEBUG: '1' } });
  const out = shellEnvFor({ home, directory: other });
  assert.equal(out, null);
});

test('T3: repoRoot not pinned → null (no ambient injection without explicit pin)', () => {
  const home = freshRoot('t3nopin');
  writeManifest(home, { env: { ABATHUR_DEBUG: '1' } });
  assert.equal(shellEnvFor({ home, directory: home }), null);
});

test('T3: malformed manifest → null + warning, never throws', () => {
  const home = freshRoot('t3bad');
  writeManifest(home, ']{broken');
  const warns: string[] = [];
  const out = shellEnvFor({ home, directory: home, warn: (m: string) => warns.push(m) });
  assert.equal(out, null);
  assert.match(warns.join('\n'), /abathur-shell-env/i);
});

test('T3: symlinked directory resolves via realpath against pinned root', () => {
  const home = freshRoot('t3link');
  const repo = freshRoot('t3repo3');
  const linkParent = freshRoot('t3linkparent');
  const link = path.join(linkParent, 'repo-link');
  execFileSync('ln', ['-s', repo, link]);
  writeManifest(home, { repoRoot: repo, env: { ABATHUR_DEBUG: '1' } });
  const out = shellEnvFor({ home, directory: link });
  assert.ok(out);
  assert.equal(out['ABATHUR_DEBUG'], '1');
});

test('T3: non-string env values rejected per-key with warning', () => {
  const home = freshRoot('t3type');
  const repo = freshRoot('t3typerepo');
  writeManifest(home, { repoRoot: repo, env: { ABATHUR_DEBUG: 42, ABATHUR_CONFIG: '/x' } });
  const warns: string[] = [];
  const out = shellEnvFor({ home, directory: repo, warn: (m: string) => warns.push(m) });
  assert.ok(out);
  assert.equal(out['ABATHUR_CONFIG'], '/x');
  assert.equal('ABATHUR_DEBUG' in out, false);
  assert.match(warns.join('\n'), /ABATHUR_DEBUG/);
});
