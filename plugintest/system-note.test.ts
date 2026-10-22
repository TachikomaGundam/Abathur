// T1 (startup-state note) unit tests + hook-level smoke.
// Contract pinned from plugin/abathur.ts buildSystemNote (read 2026-10-22):
//   header '[abathur] 开工状态注入 …', '模式: full (engine X)' | 'FALLBACK-PROBE (…)',
//   '占用: <state> — <reason> [<lockDesc|无锁>]', optional '反证命中: …',
//   '账本尾 3 条:' + up to 3 '## [' title lines; error → '[abathur] 状态未取到';
//   cap 2048 bytes → slice + '\n[truncated]'; noteCache keyed by repoRoot, TTL 60s.
// Gate lives in the transform hook: injection only when <dir>/.omo/evidence/INTENT-LEDGER.md exists.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, beforeEach } from 'node:test';
import type { Hooks } from '@opencode-ai/plugin';
import abathurPlugin, {
  buildSystemNote,
  resetNoteCache,
  type EngineContract,
  type LockPayload,
} from '../plugin/abathur.js';

const roots: string[] = [];
function freshRoot(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `abathur-note-${tag}-`));
  roots.push(dir);
  return dir;
}
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});
beforeEach(() => resetNoteCache());

/** Marker repo = directory carrying the ledger file (T1 gate + guard-root identity marker). */
function markerRepo(tag: string, ledgerBody = '# genesis\n'): string {
  const repo = freshRoot(tag);
  const ev = path.join(repo, '.omo', 'evidence');
  mkdirSync(ev, { recursive: true });
  writeFileSync(path.join(ev, 'INTENT-LEDGER.md'), ledgerBody);
  return repo;
}

/** Full-mode contract fixture: real files on disk so disproof realpath matching is exercised. */
function contractFixture(tag: string): EngineContract {
  const root = freshRoot(tag);
  const bin = path.join(root, 'abathur');
  const cli = path.join(root, 'cli.js');
  writeFileSync(bin, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(cli, '// cli\n', { mode: 0o755 });
  return {
    mode: 'full',
    engineVersion: '0.4.0',
    registry: {
      schemaVersion: 1,
      writeCommands: [['run'], ['promote']],
      readonlyPrefixes: [['status']],
      envKeys: [],
      injectableAllowlist: ['PATH'],
    },
    binRealpath: bin,
    cliRealpath: cli,
    registryPath: path.join(root, 'engine-registry.json'),
    injectableAllowlist: ['PATH'],
  };
}

const warns: string[] = [];
const collectWarn = (m: string): void => {
  warns.push(m);
};

function noteFor(repo: string, contract: EngineContract, now: () => Date): string {
  return buildSystemNote({ repoRoot: repo, directory: repo, contract, now, warn: collectWarn });
}

/** This process's own start time, computed exactly like realProcFacts does
 * (/proc/<pid>/stat field 22 ÷ CLK_TCK + btime). Used to forge a LIVE occupied lock
 * without depending on any external process. */
function selfProcStartMs(): number {
  const stat = readFileSync('/proc/self/stat', 'utf8');
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const starttimeTicks = Number(fields[19]); // field 22 (1-based); after comm, field 3 = index 0
  const btime = Number(/btime (\d+)/.exec(readFileSync('/proc/stat', 'utf8'))?.[1] ?? '');
  const hz = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
  return (btime + starttimeTicks / hz) * 1000;
}

/** Lock held by THIS process with a start-time inside the 5s tolerance ⇒ state=occupied. */
function writeLiveLock(repo: string, nowMs: number, over: Partial<LockPayload> = {}): void {
  const lockPath = path.join(repo, '.omo', 'evidence', 'campaign.lock.json');
  const payload: LockPayload = {
    pid: process.pid,
    startedAt: new Date(selfProcStartMs() + 1000).toISOString(),
    runId: 'campaign-note-test',
    engineVersion: '0.4.0',
    ...over,
  };
  writeFileSync(lockPath, JSON.stringify(payload));
  const t = new Date(nowMs - 1000); // heartbeat 1s old at nowMs ⇒ fresh
  utimesSync(lockPath, t, t);
}

test('note: header + mode line + idle occupancy + last 3 ledger titles', () => {
  const repo = markerRepo(
    'idle',
    ['# ledger', '## [title-alpha]', 'x', '## [title-beta]', '## [title-gamma]', '## [title-delta]', ''].join('\n'),
  );
  const note = noteFor(repo, contractFixture('idle'), () => new Date());
  assert.match(note, /^\[abathur] 开工状态注入/);
  assert.match(note, /模式: full \(engine 0\.4\.0\)/);
  assert.match(note, /占用: idle/);
  assert.match(note, /账本尾 3 条:/);
  assert.match(note, /## \[title-beta]/);
  assert.match(note, /## \[title-delta]/);
  assert.doesNotMatch(note, /title-alpha/); // tail = LAST 3, not first 3
});

test('note: live self-held lock surfaces 占用: occupied with pid', () => {
  const repo = markerRepo('occ');
  const nowMs = Date.now();
  writeLiveLock(repo, nowMs);
  const note = noteFor(repo, contractFixture('occ'), () => new Date(nowMs));
  assert.match(note, /占用: occupied —/);
  assert.match(note, new RegExp(`pid=${String(process.pid)}`));
  assert.match(note, /runId=campaign-note-test/);
});

test('note: 60s display cache — same now ⇒ identical text; +61s ⇒ rebuilt', () => {
  const repo = markerRepo('ttl');
  const t0 = Date.now();
  writeLiveLock(repo, t0);
  let clock = t0;
  const now = (): Date => new Date(clock);
  const first = noteFor(repo, contractFixture('ttl'), now);
  assert.match(first, /占用: occupied/);
  rmSync(path.join(repo, '.omo', 'evidence', 'campaign.lock.json')); // world changes…
  const cached = noteFor(repo, contractFixture('ttl'), now);
  assert.equal(cached, first); // …but within TTL the note is frozen (display cache)
  clock += 61_000;
  const fresh = noteFor(repo, contractFixture('ttl'), now);
  assert.notEqual(fresh, first);
  assert.match(fresh, /占用: idle/);
});

test('note: 2048-byte cap — oversized lockDesc truncates with [truncated]', () => {
  const repo = markerRepo('cap');
  // dead pid ⇒ stale-idle (lock payload retained in lockDesc); giant runId blows the cap
  writeLiveLock(repo, Date.now(), { pid: 4194300, runId: 'x'.repeat(3000) });
  const note = noteFor(repo, contractFixture('cap'), () => new Date());
  assert.ok(Buffer.byteLength(note, 'utf8') <= 2048, `note is ${String(Buffer.byteLength(note))} bytes`);
  assert.match(note, /\[truncated]$/);
});

test('note: internal failure degrades to the placeholder line', () => {
  const repo = markerRepo('err');
  writeLiveLock(repo, Date.now());
  let calls = 0;
  const now = (): Date => {
    calls += 1;
    if (calls > 1) throw new Error('clock exploded'); // atMs passes, occupancy now() throws
    return new Date();
  };
  const note = noteFor(repo, contractFixture('err'), now);
  assert.equal(note, '[abathur] 状态未取到');
});

// ── hook-level smoke: the transform gate (marker ⇒ merge into system[0] ONLY) ──

interface ServerShape {
  server(input: unknown): Promise<Hooks>;
}
type TransformHook = (input: unknown, output: { system: string[] }) => Promise<void>;
type BeforeHook = (
  input: { tool: string; sessionID: string; callID: string },
  output: { args: Record<string, unknown> },
) => Promise<void>;

function fakePluginInput(directory: string): unknown {
  return { directory, client: {}, project: '', worktree: false, experimental_workspace: false, serverUrl: '', $: {} };
}

async function hooksFor(directory: string): Promise<Hooks> {
  return (abathurPlugin as unknown as ServerShape).server(fakePluginInput(directory));
}

function transformOf(hooks: Hooks): TransformHook {
  const hook = hooks['experimental.chat.system.transform'];
  assert.ok(hook !== undefined, 'transform hook must be registered');
  return hook as unknown as TransformHook;
}

test('hook T1: marker directory merges note into system[0], never a second message', async () => {
  const repo = markerRepo('hook-merge');
  const hooks = await hooksFor(repo);
  const output = { system: ['BASE SYSTEM LINE'] };
  await transformOf(hooks)({}, output);
  assert.equal(output.system.length, 1); // S2 hard constraint: ONE system message
  assert.match(output.system[0] ?? '', /^BASE SYSTEM LINE\n\n\[abathur] 开工状态注入/);
});

test('hook T1: empty system array ⇒ note becomes system[0]', async () => {
  const repo = markerRepo('hook-empty');
  const hooks = await hooksFor(repo);
  const output = { system: [] as string[] };
  await transformOf(hooks)({}, output);
  assert.equal(output.system.length, 1);
  assert.match(output.system[0] ?? '', /^\[abathur] /);
});

test('hook T1: non-marker directory ⇒ zero injection', async () => {
  const plain = freshRoot('hook-plain'); // no ledger marker
  const hooks = await hooksFor(plain);
  const output = { system: ['UNTouched'] };
  await transformOf(hooks)({}, output);
  assert.deepEqual(output.system, ['UNTouched']);
});

test('hook T2 smoke: guarded write while occupied throws the block text; idle passes', async () => {
  const repo = markerRepo('hook-block');
  const hooks = await hooksFor(repo);
  const before = hooks['tool.execute.before'] as unknown as BeforeHook;
  assert.ok(before !== undefined);
  const ledgerFile = path.join(repo, '.omo', 'evidence', 'INTENT-LEDGER.md');

  // idle (no lock): the same call must pass through untouched
  await before({ tool: 'write', sessionID: 'ses_smoke', callID: 'c0' }, { args: { filePath: ledgerFile, content: 'x' } });

  // occupied by a live self-held lock: refuse with the T2 block text
  writeLiveLock(repo, Date.now());
  await assert.rejects(
    before({ tool: 'write', sessionID: 'ses_smoke', callID: 'c1' }, { args: { filePath: ledgerFile, content: 'x' } }),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      assert.match(msg, /abathur guard \(T2\): REFUSED write to guard-surface file/);
      assert.match(msg, /occupancy=occupied/);
      assert.match(msg, /override attempt failed:/);
      return true;
    },
  );
});
