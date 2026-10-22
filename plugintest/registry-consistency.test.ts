// Batch 6 — engine/plugin consistency tripwires (design v9 §consistency pins).
// Single resolution source: the plugin's contract loader probing an engine binary.
// Two groups, because the installed engine and this worktree's build are different
// capability generations until the human publish/install gate moves:
//   A) installed engine (PATH-resolved): adaptive — full mode ⇒ hard pins (npm-global
//      path, drift vs worktree); pre-0.4.0 ⇒ fallback-probe sanity pins + skip note.
//      The design's "registry absent ⇒ red" applies to an engine that ANSWERS --version
//      but lacks the registry — that case is a hard red inside loadEngineContract itself
//      (reason: 'has no dist/engine-registry.json'), covered by contract.test.ts.
//   B) worktree build (dist/cli.js): must always answer full mode — this is the release
//      face the 0.4.0 train ships; all semantic pins run against it unconditionally.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test, { before } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  STATIC_INJECTABLE_ALLOWLIST,
  loadEngineContract,
  resetContractCache,
  type EngineContract,
  type EngineRegistry,
} from '../plugin/abathur.js';

const here = path.dirname(fileURLToPath(import.meta.url)); // <repo>/.plugintest-dist/plugintest
const repoRoot = path.resolve(here, '..', '..');
const worktreeCli = path.join(repoRoot, 'dist', 'cli.js');
const worktreeRegistryPath = path.join(repoRoot, 'dist', 'engine-registry.json');

function sha256File(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}
const sorted = (xs: readonly string[]): string[] => [...xs].sort();

let installed: EngineContract;
let worktreeFull: Extract<EngineContract, { mode: 'full' }>;

before(() => {
  delete process.env['ABATHUR_BIN'];
  delete process.env['ABATHUR_SELF_REPO'];

  resetContractCache();
  installed = loadEngineContract({ warn: () => {} });

  assert.ok(existsSync(worktreeCli), `worktree not built: ${worktreeCli} — run npm run build`);
  chmodSync(worktreeCli, 0o755); // probe spawns the bin directly; tsc emits 644
  resetContractCache();
  const wt = loadEngineContract({ binPath: worktreeCli, warn: () => {} });
  if (wt.mode !== 'full') {
    assert.fail(`worktree build must answer full mode, got fallback-probe: ${wt.reason}`);
  }
  worktreeFull = wt;
});

// ── group A: installed engine (adaptive to its capability generation) ──

test('installed engine: full mode ⇒ npm-global install face pins; pre-0.4.0 ⇒ fallback sanity', (t) => {
  if (installed.mode === 'full') {
    const p = installed.registryPath;
    assert.ok(existsSync(p), `registryPath does not exist: ${p}`);
    assert.ok(!p.includes('/workspace/'), `registry resolved into a workspace tree (dev-link?): ${p}`);
    assert.ok(!p.startsWith('/tmp/'), `registry resolved into /tmp (worktree/dev-link?): ${p}`);
    assert.ok(p.includes(`${path.sep}node_modules${path.sep}`), `registry not under a node_modules install: ${p}`);
    assert.match(installed.engineVersion, /^\d+\.\d+\.\d+/);
    console.log(`[registry-receipt] installed=${p} sha256=${sha256File(p)} version=${installed.engineVersion}`);
    return;
  }
  // pre-0.4.0 installed engine: the plugin's degraded behavior is the pin
  // (implementation contract: --version failure keeps binRealpath — the found binary's
  // realpath — and leaves cliRealpath null; engine identity is full-mode-only)
  assert.match(installed.reason, /--version|not found on PATH/);
  if (installed.binRealpath !== null) {
    assert.ok(
      installed.binRealpath.includes(`${path.sep}node_modules${path.sep}`) || !installed.binRealpath.startsWith('/tmp/'),
      `binRealpath should be an install face, not a worktree: ${installed.binRealpath}`,
    );
  }
  assert.equal(installed.cliRealpath, null);
  t.diagnostic(
    'installed engine is pre-0.4.0 (fallback-probe). Full-mode install-face pins deferred ' +
      'until the human publish/install gate moves; worktree group B covers the release face.',
  );
});

test('installed engine full mode: registry must deep-equal the worktree build (drift tripwire)', (t) => {
  if (installed.mode !== 'full') {
    t.skip('installed engine pre-0.4.0 — no registry to compare');
    return;
  }
  const installedReg = JSON.parse(readFileSync(installed.registryPath, 'utf8')) as EngineRegistry;
  assert.deepEqual(installedReg, worktreeFull.registry, 'registry drift: installed engine vs worktree build');
});

// ── group B: worktree build (the 0.4.0 release face) — unconditional pins ──

test('worktree build: registryPath is its own dist and parses to the contract registry', () => {
  assert.equal(worktreeFull.registryPath, worktreeRegistryPath);
  const onDisk = JSON.parse(readFileSync(worktreeRegistryPath, 'utf8')) as EngineRegistry;
  assert.deepEqual(onDisk, worktreeFull.registry);
  assert.equal(onDisk.schemaVersion, 1);
});

test('worktree build: allowlist pins agree — static == contract == registry', () => {
  assert.deepEqual(sorted(worktreeFull.injectableAllowlist), sorted(STATIC_INJECTABLE_ALLOWLIST));
  const regList = worktreeFull.registry.injectableAllowlist;
  if (regList !== undefined) {
    assert.deepEqual(sorted(regList), sorted(STATIC_INJECTABLE_ALLOWLIST));
  }
  // regList undefined ⇒ contract already fell back to the static five (asserted above)
});

test('worktree build: semantic pin — `run` is a write-face command, never readonly', () => {
  const hasRun = worktreeFull.registry.writeCommands.some((p) => p.length === 1 && p[0] === 'run');
  assert.ok(hasRun, 'writeCommands must contain ["run"] (campaigns hold the write face)');
  const readonlyRun = worktreeFull.registry.readonlyPrefixes.some((p) => p.length === 1 && p[0] === 'run');
  assert.equal(readonlyRun, false, 'readonlyPrefixes must not contain ["run"]');
});

test('worktree build receipt: registry sha256 printed for the ledger', () => {
  const sha = sha256File(worktreeRegistryPath);
  assert.match(sha, /^[0-9a-f]{64}$/);
  console.log(`[registry-receipt] worktree=${worktreeRegistryPath} sha256=${sha}`);
});
