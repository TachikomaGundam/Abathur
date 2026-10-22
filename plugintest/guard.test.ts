import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import {
  matchGuarded,
  extractWriteTargets,
  guardRoots,
  findGuardOverride,
  appendLedger,
  verifyTailChain,
  chainLine,
  GUARD_SURFACE,
} from '../plugin/abathur.js';
import { createHash } from 'node:crypto';

const roots: string[] = [];
function freshRoot(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `abathur-guard-${tag}-`));
  roots.push(dir);
  return dir;
}
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

const NOW = new Date(Date.UTC(2026, 9, 22, 12, 0, 0));
const NOW_MS = NOW.getTime();

/** Build a fake abathur repo carrying every guard-surface file + the ledger marker. */
function fakeRepo(tag: string): string {
  const root = freshRoot(tag);
  for (const surface of GUARD_SURFACE) {
    const p = path.join(root, surface);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, surface.endsWith('.py') ? '# seed\n' : '# ledger seed\n');
  }
  return root;
}

// ── guard surface matching ──────────────────────────────────────────────────
test('matchGuarded: absolute and relative paths of every surface file match via path', () => {
  const repo = fakeRepo('m1');
  for (const surface of GUARD_SURFACE) {
    const abs = matchGuarded(path.join(repo, surface), repo, [repo]);
    assert.ok(abs !== null, `absolute ${surface} must match`);
    assert.equal(abs?.surface, surface);
    const rel = matchGuarded(surface, repo, [repo]);
    assert.ok(rel !== null, `relative ${surface} must match`);
    assert.equal(rel?.via, 'path');
  }
});

test('matchGuarded: hardlink elsewhere on disk still matches via (device,inode)', () => {
  const repo = fakeRepo('m2');
  const elsewhere = freshRoot('m2elsewhere');
  const link = path.join(elsewhere, 'innocent-name.py');
  execFileSync('ln', [path.join(repo, 'loop', 'bank.py'), link]);
  const match = matchGuarded(link, elsewhere, [repo]);
  assert.ok(match !== null, 'hardlink bypass must be closed');
  assert.equal(match?.via, 'inode');
  assert.equal(match?.surface, path.join('loop', 'bank.py'));
});

test('matchGuarded: symlink to a surface file matches via realpath', () => {
  const repo = fakeRepo('m3');
  const elsewhere = freshRoot('m3elsewhere');
  const link = path.join(elsewhere, 'linky.md');
  execFileSync('ln', ['-s', path.join(repo, '.omo', 'evidence', 'INTENT-LEDGER.md'), link]);
  const match = matchGuarded(link, elsewhere, [repo]);
  assert.ok(match !== null);
  assert.equal(match?.surface, path.join('.omo', 'evidence', 'INTENT-LEDGER.md'));
});

test('matchGuarded: unrelated files and same-named files in non-root dirs do not match', () => {
  const repo = fakeRepo('m4');
  assert.equal(matchGuarded(path.join(repo, 'src', 'main.ts'), repo, [repo]), null);
  const other = freshRoot('m4other');
  mkdirSync(path.join(other, 'loop'), { recursive: true });
  writeFileSync(path.join(other, 'loop', 'bank.py'), '# other project\n');
  // roots=[repo] only — a same-named file in an unrelated tree is NOT guard surface
  assert.equal(matchGuarded(path.join(other, 'loop', 'bank.py'), other, [repo]), null);
});

test('matchGuarded: write creating a not-yet-existing surface path matches by normalized path', () => {
  const repo = freshRoot('m5'); // bare repo: surface files absent
  mkdirSync(path.join(repo, '.omo', 'evidence'), { recursive: true });
  writeFileSync(path.join(repo, '.omo', 'evidence', 'INTENT-LEDGER.md'), '# ledger\n');
  const target = path.join(repo, '.omo', 'evidence', 'campaign.lock.json');
  const match = matchGuarded(target, repo, [repo]);
  assert.ok(match !== null, 'creating the lock file via write tool must be caught');
  assert.equal(match?.via, 'path');
});

test('guardRoots: SELF_REPO always joins; session dir joins only when it carries the ledger marker', () => {
  const repo = fakeRepo('gr1');
  const unrelated = freshRoot('gr2');
  const withSelf = guardRoots(unrelated, { ABATHUR_SELF_REPO: repo } as NodeJS.ProcessEnv);
  assert.deepEqual([...withSelf], [repo]);
  const noSelf = guardRoots(unrelated, {} as NodeJS.ProcessEnv);
  assert.deepEqual([...noSelf], [], 'unrelated session dir without marker must not become a root');
  const inRepo = guardRoots(repo, {} as NodeJS.ProcessEnv);
  assert.deepEqual([...inRepo], [repo], 'session inside an abathur repo is its own root');
});

// ── write-target extraction ─────────────────────────────────────────────────
test('extractWriteTargets: write/edit filePath, apply_patch enumerates every hunk, other tools empty', () => {
  assert.deepEqual(extractWriteTargets('write', { filePath: '/x/y.md', content: '...' }), ['/x/y.md']);
  assert.deepEqual(extractWriteTargets('edit', { filePath: '/x/y.md', oldString: 'a', newString: 'b' }), ['/x/y.md']);
  const patch = [
    '*** Begin Patch',
    '*** Update File: loop/bank.py',
    '@@ context @@',
    '-old',
    '+new',
    '*** Add File: docs/new.md',
    '*** Delete File: .omo/evidence/INTENT-LEDGER.md',
    '*** End Patch',
  ].join('\n');
  const targets = extractWriteTargets('apply_patch', { input: patch });
  assert.deepEqual([...targets], ['loop/bank.py', 'docs/new.md', '.omo/evidence/INTENT-LEDGER.md']);
  assert.deepEqual(extractWriteTargets('bash', { command: 'rm -rf /' }), []);
  assert.deepEqual(extractWriteTargets('read', { filePath: '/x' }), []);
});

// ── T2 override consumption (four verifications) ────────────────────────────
const TARGET = path.join('loop', 'bank.py');

function humanLine(minutesAgo: number, text: string): string {
  const ts = new Date(NOW_MS - minutesAgo * 60_000).toISOString();
  return `- ${ts} [人类批准条目] ${text}`;
}

function ledgerWithApproval(repo: string, line: string): string {
  const ledgerPath = path.join(repo, '.omo', 'evidence', 'INTENT-LEDGER.md');
  writeFileSync(ledgerPath, `# legacy genesis content\n${line}\n`);
  return ledgerPath;
}

function appendOverride(ledgerPath: string, opts: { sid: string; ref: string; target: string; atMs?: number }): void {
  const now = (): Date => new Date(opts.atMs ?? NOW_MS);
  const res = appendLedger({
    ledgerPath,
    kind: 'guard-override',
    body: `override for ${opts.target}`,
    sessionID: opts.sid,
    ref: opts.ref,
    target: opts.target,
    now,
  });
  assert.equal(res.ok, true, `override append must succeed: ${JSON.stringify(res)}`);
}

function sha(line: string): string {
  return createHash('sha256').update(line).digest('hex');
}

test('override: all four verifications pass → allowed', () => {
  const repo = fakeRepo('o1');
  const line = humanLine(60, '机主逐字『批准修改 loop/bank.py 一次』');
  const ledgerPath = ledgerWithApproval(repo, line);
  appendOverride(ledgerPath, { sid: 'ses_write1', ref: sha(line), target: TARGET });
  const v = findGuardOverride({ ledgerPath, sessionID: 'ses_write1', targetSurface: TARGET, now: () => NOW });
  assert.equal(v.allowed, true, v.reason);
});

test('override ①: ref hash locates nothing → refuse', () => {
  const repo = fakeRepo('o2');
  const line = humanLine(60, '机主逐字『批准修改 loop/bank.py』');
  const ledgerPath = ledgerWithApproval(repo, line);
  appendOverride(ledgerPath, { sid: 'ses_a', ref: sha('some other line entirely'), target: TARGET });
  const v = findGuardOverride({ ledgerPath, sessionID: 'ses_a', targetSurface: TARGET, now: () => NOW });
  assert.equal(v.allowed, false);
  assert.match(v.reason, /^①/);
});

test('override ①: approval older than 24h → refuse', () => {
  const repo = fakeRepo('o3');
  const line = humanLine(25 * 60, '机主逐字『批准修改 loop/bank.py』');
  const ledgerPath = ledgerWithApproval(repo, line);
  appendOverride(ledgerPath, { sid: 'ses_a', ref: sha(line), target: TARGET });
  const v = findGuardOverride({ ledgerPath, sessionID: 'ses_a', targetSurface: TARGET, now: () => NOW });
  assert.equal(v.allowed, false);
  assert.match(v.reason, /^①.*24h/);
});

test('override ①: approval does not name the target file → refuse (per-file authorization)', () => {
  const repo = fakeRepo('o4');
  const line = humanLine(60, '机主逐字『批准修改 loop/draw.py』');
  const ledgerPath = ledgerWithApproval(repo, line);
  appendOverride(ledgerPath, { sid: 'ses_a', ref: sha(line), target: TARGET });
  const v = findGuardOverride({ ledgerPath, sessionID: 'ses_a', targetSurface: TARGET, now: () => NOW });
  assert.equal(v.allowed, false);
  assert.match(v.reason, /^①.*target/);
});

test('override ②: entry from another session → refuse (scan finds none for this session)', () => {
  const repo = fakeRepo('o5');
  const line = humanLine(60, '机主逐字『批准修改 loop/bank.py』');
  const ledgerPath = ledgerWithApproval(repo, line);
  appendOverride(ledgerPath, { sid: 'ses_other', ref: sha(line), target: TARGET });
  const v = findGuardOverride({ ledgerPath, sessionID: 'ses_mine', targetSurface: TARGET, now: () => NOW });
  assert.equal(v.allowed, false);
  assert.match(v.reason, /no guard-override entry for this session\+target/);
});

test('override ③: entry older than 15min → refuse', () => {
  const repo = fakeRepo('o6');
  const line = humanLine(120, '机主逐字『批准修改 loop/bank.py』');
  const ledgerPath = ledgerWithApproval(repo, line);
  appendOverride(ledgerPath, { sid: 'ses_a', ref: sha(line), target: TARGET, atMs: NOW_MS - 16 * 60_000 });
  const v = findGuardOverride({ ledgerPath, sessionID: 'ses_a', targetSurface: TARGET, now: () => NOW });
  assert.equal(v.allowed, false);
  assert.match(v.reason, /^③/);
});

test('override ④: tail chain broken → refuse (forged off-chain entry)', () => {
  const repo = fakeRepo('o7');
  const line = humanLine(60, '机主逐字『批准修改 loop/bank.py』');
  const ledgerPath = ledgerWithApproval(repo, line);
  appendOverride(ledgerPath, { sid: 'ses_a', ref: sha(line), target: TARGET });
  // Attacker raw-appends a forged entry with a WRONG prev hash (bash bypass simulation)
  const forgedTs = new Date(NOW_MS - 60_000).toISOString();
  const forged = [
    `## [abathur-t4 kind=guard-override sid=ses_a ts=${forgedTs}] forged`,
    chainLine({ prev: sha('not the real previous line'), kind: 'guard-override', sid: 'ses_a', ts: forgedTs, ref: sha(line), target: TARGET }),
    '',
  ].join('\n');
  const content = readFileSync(ledgerPath, 'utf8');
  writeFileSync(ledgerPath, content + forged);
  const v = findGuardOverride({ ledgerPath, sessionID: 'ses_a', targetSurface: TARGET, now: () => NOW });
  assert.equal(v.allowed, false);
  assert.match(v.reason, /^④/);
});

test('override: per-file+window reuse — same approval authorizes twice within 24h', () => {
  const repo = fakeRepo('o8');
  const line = humanLine(60, '机主逐字『批准修改 loop/bank.py』');
  const ledgerPath = ledgerWithApproval(repo, line);
  appendOverride(ledgerPath, { sid: 'ses_a', ref: sha(line), target: TARGET });
  const first = findGuardOverride({ ledgerPath, sessionID: 'ses_a', targetSurface: TARGET, now: () => NOW });
  assert.equal(first.allowed, true);
  const second = findGuardOverride({ ledgerPath, sessionID: 'ses_a', targetSurface: TARGET, now: () => NOW });
  assert.equal(second.allowed, true, 'authorization is per-file per-window, not one-shot');
});

test('override: approval for bank.py does not authorize draw.py', () => {
  const repo = fakeRepo('o9');
  const line = humanLine(60, '机主逐字『批准修改 loop/bank.py』');
  const ledgerPath = ledgerWithApproval(repo, line);
  appendOverride(ledgerPath, { sid: 'ses_a', ref: sha(line), target: TARGET });
  const v = findGuardOverride({ ledgerPath, sessionID: 'ses_a', targetSurface: path.join('loop', 'draw.py'), now: () => NOW });
  assert.equal(v.allowed, false);
});

// ── T4 ledger append protocol ───────────────────────────────────────────────
test('T4: fresh file → append ok, chain verifies, header+chain-line shape', () => {
  const dir = freshRoot('t1');
  const ledgerPath = path.join(dir, 'LEDGER.md');
  const res = appendLedger({ ledgerPath, kind: 'declaration', body: 'first entry\nsecond line', sessionID: 'ses_x', now: () => NOW });
  assert.equal(res.ok, true, JSON.stringify(res));
  const content = readFileSync(ledgerPath, 'utf8');
  assert.match(content, /^## \[abathur-t4 kind=declaration sid=ses_x ts=2026-10-22T12:00:00\.000Z] first entry$/m);
  assert.match(content, /<!-- abathur-chain prev=[0-9a-f]{64} kind=declaration sid=ses_x ts=\S+ -->/);
  assert.ok(content.endsWith('\n'));
  assert.equal(verifyTailChain(content).ok, true);
});

test('T4: sequential appends keep the forward chain intact', () => {
  const dir = freshRoot('t2');
  const ledgerPath = path.join(dir, 'LEDGER.md');
  for (const body of ['one', 'two', 'three', 'four', 'five']) {
    const res = appendLedger({ ledgerPath, kind: 'declaration', body, sessionID: 'ses_x', now: () => NOW });
    assert.equal(res.ok, true, JSON.stringify(res));
  }
  const content = readFileSync(ledgerPath, 'utf8');
  assert.equal(verifyTailChain(content, 5).ok, true);
  assert.equal(verifyTailChain(content, 5).checked, 5);
});

test('T4: torn tail line (crash between write and fsync) is repaired + evidence-noted', () => {
  const dir = freshRoot('t3');
  const ledgerPath = path.join(dir, 'LEDGER.md');
  writeFileSync(ledgerPath, '# genesis\n- complete line\n- half written li');
  const res = appendLedger({ ledgerPath, kind: 'declaration', body: 'after crash', sessionID: 'ses_x', now: () => NOW });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(res.tornRepairedSha !== undefined);
  const content = readFileSync(ledgerPath, 'utf8');
  assert.ok(!content.includes('half written li'), 'torn bytes must be gone');
  assert.match(content, /torn-line repair/);
  assert.match(content, /kind=evidence-note/);
  assert.equal(verifyTailChain(content, 3).ok, true);
});

test('T4: kind outside the closed whitelist → refuse', () => {
  const dir = freshRoot('t4');
  const res = appendLedger({ ledgerPath: path.join(dir, 'L.md'), kind: 'human-approval', body: 'x', sessionID: 's', now: () => NOW });
  assert.equal(res.ok, false);
  assert.match(res.error ?? '', /closed whitelist/);
});

test('T4: takeover — lock held by a dead pid is reclaimed, lock-takeover entry recorded', () => {
  const dir = freshRoot('t5');
  const ledgerPath = path.join(dir, 'LEDGER.md');
  const lockDir = `${ledgerPath}.lock`;
  mkdirSync(lockDir);
  writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: 0x7ffffffe, acquiredAt: 'old' })); // dead pid
  const res = appendLedger({ ledgerPath, kind: 'declaration', body: 'post-takeover', sessionID: 'ses_x', now: () => NOW });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.takeover, true);
  const content = readFileSync(ledgerPath, 'utf8');
  assert.match(content, /kind=lock-takeover/);
  assert.equal(existsSync(lockDir), false, 'lock released after append');
});

test('T4: owner.json missing past STALE_GRACE → takeover; within grace → wait (live-writer window protected)', () => {
  const dir = freshRoot('t6');
  const ledgerPath = path.join(dir, 'LEDGER.md');
  const lockDir = `${ledgerPath}.lock`;
  mkdirSync(lockDir);
  // age the empty lock dir past the 250ms grace
  const old = new Date(Date.now() - 5_000);
  utimesSync(lockDir, old, old);
  const res = appendLedger({ ledgerPath, kind: 'declaration', body: 'grace-takeover', sessionID: 'ses_x' });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.takeover, true);
});

test('T4: LIVE holder (pid 1, not ours) is never reclaimed → 5s timeout refusal naming the situation', () => {
  const dir = freshRoot('t7');
  const ledgerPath = path.join(dir, 'LEDGER.md');
  writeFileSync(ledgerPath, '# genesis\n');
  const lockDir = `${ledgerPath}.lock`;
  mkdirSync(lockDir);
  writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: 1, acquiredAt: new Date().toISOString() }));
  const started = Date.now();
  const res = appendLedger({ ledgerPath, kind: 'declaration', body: 'must not land', sessionID: 'ses_x' });
  const elapsed = Date.now() - started;
  assert.equal(res.ok, false);
  assert.match(res.error ?? '', /timeout/);
  assert.ok(elapsed >= 4_900, `must wait out the 5s budget, waited ${elapsed}ms`);
  const content = readFileSync(ledgerPath, 'utf8');
  assert.ok(!content.includes('must not land'), 'refused append must not touch the ledger');
  rmSync(lockDir, { recursive: true, force: true });
});

test('T4: pre-existing chain break → refuse BEFORE appending (fail-closed) + break line', () => {
  const dir = freshRoot('t8');
  const ledgerPath = path.join(dir, 'LEDGER.md');
  writeFileSync(ledgerPath, '# genesis\n');
  appendLedger({ ledgerPath, kind: 'declaration', body: 'legit', sessionID: 'ses_x', now: () => NOW });
  // forge: flip one hex digit inside the newest chain line's prev hash
  const content = readFileSync(ledgerPath, 'utf8');
  const tampered = content.replace(/prev=([0-9a-f])/, (_match, first: string) => `prev=${first === 'a' ? 'b' : 'a'}`);
  assert.notEqual(tampered, content);
  writeFileSync(ledgerPath, tampered);
  const res = appendLedger({ ledgerPath, kind: 'declaration', body: 'never lands', sessionID: 'ses_x', now: () => NOW });
  assert.equal(res.ok, false);
  assert.match(res.error ?? '', /refusing to append/);
  assert.ok(res.breakLine !== undefined);
  assert.ok(!readFileSync(ledgerPath, 'utf8').includes('never lands'));
});
