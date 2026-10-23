// Tier-1 plugin pins (design: loop/proposals/plugin-tier1-design-20261020.md v9).
// The plugin ships uncompiled, so its pure logic lives in a marker-delimited
// plain-JS section; these tests extract that section and exercise it directly.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pluginBytes = readFileSync(path.join(repoRoot, "plugin", "abathur.ts"), "utf8");

interface Kit {
  sha256hex(text: string): string;
  parseProcStartJiffies(statText: string): number | null;
  boottimeFromProcStat(text: string): number | null;
  procStartEpochSec(statText: string, btimeSec: number | null): number | null;
  judgeLock(payload: unknown, ctx: Record<string, unknown>): { verdict: string; reason: string };
  parseCmdline(buf: Buffer): string[];
  locateExecArgs(argv: string[], binRealpath: string, binBasename: string, realpathFn: (p: string) => string): string[] | null;
  matchWriteCommands(args: string[], writeCommands: readonly (readonly string[])[]): readonly string[] | null;
  splitLedgerEntries(text: string): { startLine: number; header: string; text: string; t4: null | { tsIso: string; kind: string; session: string; prev: string } }[];
  t4Entries(entries: ReturnType<Kit["splitLedgerEntries"]>): ReturnType<Kit["splitLedgerEntries"]>;
  verifyChainTail(entries: ReturnType<Kit["splitLedgerEntries"]>, k: number): { ok: boolean; brokenAtLine?: number };
  buildT4Entry(o: { tsIso: string; kind: string; session: string; prev: string; bodyLines: string[] }): string;
  buildBoundaryEntry(o: { tsIso: string; session: string }): string;
  detectTornTail(text: string): { repaired: string; removed: string };
  findApprovalLine(text: string, refHex: string, needles: string[], nowMs: number, maxAgeMs: number): { ok: boolean; reason?: string; line?: string };
  filterEnvSpec(spec: Record<string, unknown>): { accepted: Record<string, string>; rejected: string[] };
  INJECTABLE_KEYS: string[];
  T4_KINDS: string[];
}

function loadKit(): Kit {
  const m = pluginBytes.match(/\/\/ == ABATHUR-KIT BEGIN[^\n]*\n([\s\S]*?)\n\/\/ == ABATHUR-KIT END ==/);
  assert.ok(m !== null, "ABATHUR-KIT marker section must exist in plugin/abathur.ts");
  const factory = new Function("createHash", `${m[1]}\nreturn createAbathurKit(createHash);`) as (d: unknown) => Kit;
  return factory(createHash);
}

const kit = loadKit();

// ------------------------------------------------------------------ /proc parsing

test("kit.parseProcStartJiffies: comm with spaces and parens still yields field 22", () => {
  const fields4to21 = Array.from({ length: 18 }, (_, i) => String(i + 4));
  const stat = `12345 (weird (name) with space) S ${fields4to21.join(" ")} 987654321 rest`;
  assert.equal(kit.parseProcStartJiffies(stat), 987654321);
});

test("kit.parseProcStartJiffies: malformed input returns null", () => {
  assert.equal(kit.parseProcStartJiffies("no parens at all"), null);
  assert.equal(kit.parseProcStartJiffies("1 (x) S 2 3"), null);
});

test("kit.procStartEpochSec: boot + jiffies/CLK_TCK", () => {
  const fields4to21 = Array.from({ length: 18 }, () => "0");
  const stat = `7 (init) S ${fields4to21.join(" ")} 200 x`;
  assert.equal(kit.procStartEpochSec(stat, 1000), 1002);
});

// ------------------------------------------------------------------ lock judgment

const BASE_CTX = { pidAlive: true, eperm: false, procStartEpoch: 1000, mtimeMs: 0, nowMs: 0 };

function lockPayload(overrides: Record<string, unknown> = {}) {
  return { pid: 123, startedAt: new Date(1_001_000).toISOString(), runId: "r", engineVersion: "0.4.0", ...overrides };
}

test("kit.judgeLock: fresh lock with matching start is occupied", () => {
  const ctx = { ...BASE_CTX, procStartEpoch: 1000, mtimeMs: 10 * 60 * 1000, nowMs: 10 * 60 * 1000 };
  assert.equal(kit.judgeLock(lockPayload(), ctx).verdict, "occupied");
});

test("kit.judgeLock: dead pid is a stale candidate (never trust pid alone downstream)", () => {
  const ctx = { ...BASE_CTX, pidAlive: false, nowMs: 0, mtimeMs: 0 };
  assert.equal(kit.judgeLock(lockPayload(), ctx).verdict, "stale-candidate");
});

test("kit.judgeLock: EPERM counts as alive (cross-user honesty)", () => {
  const ctx = { ...BASE_CTX, pidAlive: false, eperm: true, procStartEpoch: 1000, nowMs: 0, mtimeMs: 0 };
  assert.equal(kit.judgeLock(lockPayload(), ctx).verdict, "occupied");
});

test("kit.judgeLock: unreadable /proc start-time is pending, not idle", () => {
  const ctx = { ...BASE_CTX, procStartEpoch: null, nowMs: 0, mtimeMs: 0 };
  assert.equal(kit.judgeLock(lockPayload(), ctx).verdict, "pending");
});

test("kit.judgeLock: alive but heartbeat silent >15min is pending", () => {
  const ctx = { ...BASE_CTX, procStartEpoch: 1000, mtimeMs: 0, nowMs: 16 * 60 * 1000 };
  assert.equal(kit.judgeLock(lockPayload(), ctx).verdict, "pending");
});

test("kit.judgeLock: start-time mismatch beyond ±5s is a stale candidate (pid reuse)", () => {
  const ctx = { ...BASE_CTX, procStartEpoch: 500, nowMs: 0, mtimeMs: 0 };
  assert.equal(kit.judgeLock(lockPayload(), ctx).verdict, "stale-candidate");
});

test("kit.judgeLock: corrupt payload is fail-closed occupied", () => {
  assert.equal(kit.judgeLock(null, BASE_CTX).verdict, "occupied");
  assert.equal(kit.judgeLock({ pid: "not-a-number" }, BASE_CTX).verdict, "occupied");
});

// ------------------------------------------------------------------ disproof matching

const WRITE_COMMANDS = [["run"], ["genome", "add"], ["promote"]];

function fakeRealpath(mapping: Record<string, string>) {
  return (p: string): string => {
    if (p in mapping) return mapping[p] as string;
    throw new Error(`ENOENT: ${p}`);
  };
}

test("kit.locateExecArgs+matchWriteCommands: node <script> run form matches", () => {
  const rp = fakeRealpath({ "/pkg/dist/cli.js": "/pkg/dist/cli.js" });
  const argv = ["node", "/pkg/dist/cli.js", "run", "historian", "--gen", "G9"];
  const args = kit.locateExecArgs(argv, "/pkg/dist/cli.js", "abathur", rp);
  assert.ok(args !== null);
  assert.deepEqual(kit.matchWriteCommands(args, WRITE_COMMANDS), ["run"]);
});

test("kit.locateExecArgs: symlinked bin resolves through realpath", () => {
  const rp = fakeRealpath({ "/home/u/.npm-global/bin/abathur": "/pkg/dist/cli.js" });
  const argv = ["/home/u/.npm-global/bin/abathur", "genome", "add", "x.json"];
  const args = kit.locateExecArgs(argv, "/pkg/dist/cli.js", "abathur", rp);
  assert.ok(args !== null);
  assert.deepEqual(kit.matchWriteCommands(args, WRITE_COMMANDS), ["genome", "add"]);
});

test("kit.locateExecArgs: bare basename at argv[0] matches", () => {
  const argv = ["abathur", "run"];
  const args = kit.locateExecArgs(argv, "/pkg/dist/cli.js", "abathur", fakeRealpath({}));
  assert.deepEqual(kit.matchWriteCommands(args ?? [], WRITE_COMMANDS), ["run"]);
});

test("kit.locateExecArgs: readonly subcommand does not match the write set", () => {
  const rp = fakeRealpath({ "/pkg/dist/cli.js": "/pkg/dist/cli.js" });
  const argv = ["node", "/pkg/dist/cli.js", "status", "abathur-self"];
  const args = kit.locateExecArgs(argv, "/pkg/dist/cli.js", "abathur", rp);
  assert.equal(kit.matchWriteCommands(args ?? [], WRITE_COMMANDS), null);
});

test("kit.locateExecArgs: unrelated process carrying the words as data does not match", () => {
  const rp = fakeRealpath({ "/pkg/dist/cli.js": "/pkg/dist/cli.js" });
  const argv = ["code", "/tmp/abathur run notes.txt"];
  assert.equal(kit.locateExecArgs(argv, "/pkg/dist/cli.js", "abathur", rp), null);
});

// ------------------------------------------------------------------ T4 chain

test("kit T4: boundary + entries chain-verify; tamper is located by line", () => {
  const boundary = kit.buildBoundaryEntry({ tsIso: "2026-10-22T00:00:00+00:00", session: "s1" });
  const e1 = kit.buildT4Entry({
    tsIso: "2026-10-22T00:01:00+00:00",
    kind: "declaration",
    session: "s1",
    prev: kit.sha256hex(boundary),
    bodyLines: ["- first"],
  });
  const e2 = kit.buildT4Entry({
    tsIso: "2026-10-22T00:02:00+00:00",
    kind: "evidence-note",
    session: "s1",
    prev: kit.sha256hex(e1),
    bodyLines: ["- second"],
  });
  const okText = boundary + "\n" + e1 + "\n" + e2;
  const entries = kit.splitLedgerEntries(okText);
  assert.equal(kit.t4Entries(entries).length, 3);
  assert.equal(kit.verifyChainTail(entries, 3).ok, true);

  const tampered = okText.replace("- first", "- first (edited)");
  const bad = kit.verifyChainTail(kit.splitLedgerEntries(tampered), 3);
  assert.equal(bad.ok, false);
  assert.equal(typeof bad.brokenAtLine, "number");
});

test("kit T4: legacy entries before the boundary are reported, never chained", () => {
  const legacy = "## [2026-10-01T00:00:00+08:00] 旧条目\n- 无链区\n";
  const boundary = kit.buildBoundaryEntry({ tsIso: "2026-10-22T00:00:00+00:00", session: "s1" });
  const entries = kit.splitLedgerEntries(legacy + boundary);
  assert.equal(entries.length, 2);
  assert.equal(kit.t4Entries(entries).length, 1);
  assert.equal(kit.verifyChainTail(entries, 3).ok, true);
});

test("kit.detectTornTail: trailing partial line is identified for repair", () => {
  const good = "line one\nline two\n";
  assert.deepEqual(kit.detectTornTail(good), { repaired: good, removed: "" });
  const torn = "line one\nline tw";
  const r = kit.detectTornTail(torn);
  assert.equal(r.repaired, "line one\n");
  assert.equal(r.removed, "line tw");
});

// ------------------------------------------------------------------ override verification

test("kit.findApprovalLine: hash-located, ≤24h, must name the target", () => {
  const ts = new Date(Date.now() - 60 * 1000).toISOString();
  const line = `- ${ts} [人类批准条目] 机主逐字「批准 override loop/bank.py 修题」`;
  const ref = kit.sha256hex(line);
  const ledger = `## [x] 世代\n${line}\n`;
  const ok = kit.findApprovalLine(ledger, ref, ["loop/bank.py"], Date.now(), 24 * 3600 * 1000);
  assert.equal(ok.ok, true);
  const wrongTarget = kit.findApprovalLine(ledger, ref, ["loop/draw.py"], Date.now(), 24 * 3600 * 1000);
  assert.equal(wrongTarget.ok, false);
  assert.equal(wrongTarget.reason, "approval-does-not-name-target");
  const stale = kit.findApprovalLine(ledger, ref, ["loop/bank.py"], Date.now() + 48 * 3600 * 1000, 24 * 3600 * 1000);
  assert.equal(stale.ok, false);
});

// ------------------------------------------------------------------ T3 whitelist

test("kit.filterEnvSpec: closed five-key whitelist; everything else rejected", () => {
  const { accepted, rejected } = kit.filterEnvSpec({
    PATH: "/opt/bin",
    ABATHUR_CONFIG: "/x/c.json",
    ABATHUR_SELF_REPO: "/x",
    ABATHUR_HISTORIAN_REPO: "/y",
    ABATHUR_DEBUG: "1",
    AWS_SECRET_ACCESS_KEY: "no",
    ABATHUR_GRADER_STATE: "not-injectable",
  });
  assert.deepEqual(Object.keys(accepted).sort(), ["ABATHUR_CONFIG", "ABATHUR_DEBUG", "ABATHUR_HISTORIAN_REPO", "ABATHUR_SELF_REPO", "PATH"]);
  assert.deepEqual(rejected.sort(), ["ABATHUR_GRADER_STATE", "AWS_SECRET_ACCESS_KEY"]);
});

// ------------------------------------------------------------------ packaging pins

test("skills/abathur-loop ships in the npm package (T6)", () => {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { files: string[] };
  assert.ok(pkg.files.includes("skills"), 'package.json "files" must include "skills"');
  const skill = readFileSync(path.join(repoRoot, "skills", "abathur-loop", "SKILL.md"), "utf8");
  assert.ok(skill.includes("name: abathur-loop"), "skill frontmatter names abathur-loop");
});

test("plugin FALLBACK_WRITE_COMMANDS equals the built engine registry (single source)", () => {
  const registry = JSON.parse(readFileSync(path.join(repoRoot, "dist", "engine-registry.json"), "utf8")) as {
    writeCommands: string[][];
  };
  const m = pluginBytes.match(/const FALLBACK_WRITE_COMMANDS[^=]*= \[([\s\S]*?)\];/);
  assert.ok(m !== null, "FALLBACK_WRITE_COMMANDS literal must exist");
  const fallback: string[][] = [];
  for (const row of m[1]!.matchAll(/\[([^\]]*)\]/g)) {
    const toks = row[1]!.split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter((s) => s.length > 0);
    fallback.push(toks);
  }
  assert.deepEqual(fallback, registry.writeCommands);
});
