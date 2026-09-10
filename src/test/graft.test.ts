// Todo 13 AC pins (plan lines 173-180): `graft` — cross-instance crystallization
// merge with a LOCAL re-bench.
//   AC(a) honest bundle from a second "machine" (same absolute genome path,
//         different config home + different git history) ⇒ digest gates pass ⇒
//         fresh worktree + LOCAL bench per LOCAL spec ⇒ nominated/culled per
//         LOCAL score; ledger carries imported:true + source fingerprint EVEN
//         when the bundle's claimed verdict/reps differ (peer claims are
//         peerClaim only, never nomination math);
//   AC(b) tampered benchDigest (tree member mutated, files[] re-pinned, manifest
//         digest stale) ⇒ quarantined: ONE graft_import row, ZERO worktrees,
//         ZERO bench, status lists it naming the gate with expected vs actual;
//   AC(c) genome not registered ⇒ pending-bench: queue file under
//         <configDir>/graft-queue/, status reports the real depth + entry lines,
//         ZERO bench runs; registering the genome and re-running graft resolves
//         the queue entry;
//   plus: wrong-genome fingerprint quarantine, requires[] probe quarantine,
//         duplicate-graft refusal (stale_state), malformed containers exit 2
//         clean, prompt_injection sanitization, dirty_worktree immunity,
//         local-settings-rule (bundle reps=99 benches at local reps), promote
//         chain consumes the graft nomination at the human gate, and structural
//         no-promote-import / no --force pins.

import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";

import { Ledger } from "../core/ledger.js";
import { fingerprint } from "../core/ids.js";
import { registerGenome, requireGenomesByLabel } from "../core/genome.js";
import type { RegistryEntry } from "../core/genome.js";
import { decodeGenerationRecord, type GenerationRowData } from "../core/evolve/run-bench.js";
import { runEvolution } from "../core/evolve/run-loop.js";
import { prepareToyGenome } from "../bench/toy.js";
import { loadGenomeSpecFile } from "../core/spec.js";
import { exportBundle } from "../core/bundle-export.js";
import { readTar, writeTar, type TarMember } from "../core/bundle-tar.js";
import { sha256Hex } from "../core/bundle-common.js";
import { INCUMBENT_BRANCH } from "../core/incumbent.js";
import {
  LEDGER_KIND_GRAFT_IMPORT,
  graftQueueDir,
  graftQueuePath,
  decodeGraftImport,
  listGraftQueue,
} from "../core/graft-support.js";

const CLI = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const ADD_ANCHOR = "return a - b; // seeded bug: must be `return a + b;`";
const STUB_SOURCE = `#!/usr/bin/env node
import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const mode = opt("--mode");
const dir = opt("--dir");
const read = (f) => readFileSync(dir + "/" + f, "utf8");
function lineDiff(file, anchor, replacement) {
  const lines = read(file).split("\\n");
  const i = lines.findIndex((l) => l.includes(anchor));
  if (i < 0) { process.stderr.write("stub: no anchor in " + file + "\\n"); process.exit(1); }
  const changed = lines[i].replace(anchor, replacement);
  return "--- a/" + file + "\\n+++ b/" + file + "\\n@@ -" + String(i + 1) + ",1 +" + String(i + 1) + ",1 @@\\n-" + lines[i] + "\\n+" + changed + "\\n";
}
const FIX = ${JSON.stringify(ADD_ANCHOR)};
const out = (candidates) => process.stdout.write(JSON.stringify({ candidates }) + "\\n");
if (mode === "three") {
  out([
    { id: "annotate-add", rationale: "annotate add()", diffs: [lineDiff("units/add.mjs", "export function add(", "export function add /* patched */(")] },
    { id: "fix-add", rationale: "fix add(): subtraction to addition", diffs: [lineDiff("units/add.mjs", FIX, "return a + b;")] },
  ]);
} else {
  process.stderr.write("stub: unknown mode\\n");
  process.exit(2);
}
`;

// ------------------------------------------------------------------ fixture

interface Instance {
  readonly root: string;
  readonly name: string;
  readonly configDir: string;
  readonly repo: string;
  readonly entry: RegistryEntry | null;
  readonly cliEnv: NodeJS.ProcessEnv;
  readonly xdgCache: string;
}

interface Suite {
  readonly root: string;
  readonly stub: string;
  /** Shared genome path: the "same absolute path, different machine" trick —
   *  toy fingerprints embed repoPath, so both instances use this exact path
   *  while config homes and git histories differ. */
  readonly genomePath: string;
}

let instanceSeq = 0;

async function suite(t: TestContext): Promise<Suite> {
  const root = await mkdtemp(path.join(os.tmpdir(), "abathur-graft-"));
  t.after(() => {
    // frozen snapshot dirs need u+w before rm -rf (todo-3 lesson)
    spawnSync("chmod", ["-R", "u+w", root]);
    spawnSync("rm", ["-rf", root]);
  });
  const stub = path.join(root, "stub.mjs");
  writeFileSync(stub, STUB_SOURCE, "utf8");
  chmodSync(stub, 0o755);
  return { root, stub, genomePath: path.join(root, "shared", "genome") };
}

async function makeInstance(
  s: Suite,
  name: string,
  opts: { readonly requires?: readonly { readonly cmd: string; readonly args?: readonly string[]; readonly probeExit: number }[]; readonly minEffect?: number } = {},
): Promise<Instance> {
  instanceSeq += 1;
  const configDir = path.join(s.root, `cfg-${name}`);
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path.join(configDir, "config.jsonc"), '{ "opencodeBin": null }\n', "utf8");
  const repo = await prepareToyGenome(s.genomePath);
  if (opts.requires !== undefined || opts.minEffect !== undefined) {
    const spec = loadGenomeSpecFile(path.join(repo, "genome.jsonc"));
    const edited = {
      ...spec,
      bench: opts.minEffect === undefined ? spec.bench : { ...spec.bench, stats: { ...spec.bench.stats, minEffect: opts.minEffect } },
      ...(opts.requires === undefined ? {} : { requires: opts.requires }),
    };
    writeFileSync(path.join(repo, "genome.jsonc"), `${JSON.stringify(edited, null, 2)}\n`, "utf8");
    gitC(repo, "-c", "user.name=abathur", "-c", "user.email=abathur@harness.local", "commit", "-am", "graft fixture: spec edit");
  }
  registerGenome(configDir, path.join(repo, "genome.jsonc"));
  const entry = requireGenomesByLabel(configDir, "toy-smoke").entries[0];
  if (entry === undefined) throw new Error(`fixture ${name}: toy-smoke registration vanished`);
  const xdgCache = path.join(s.root, `xdg-${name}`);
  return {
    root: s.root,
    name,
    configDir,
    repo,
    entry,
    xdgCache,
    cliEnv: {
      ...process.env,
      ABATHUR_CONFIG: path.join(configDir, "config.jsonc"),
      HOME: path.join(s.root, `home-${name}`),
      XDG_CACHE_HOME: xdgCache,
    },
  };
}

function cli(inst: Instance, ...args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [CLI, ...args], { env: inst.cliEnv, encoding: "utf8", cwd: inst.root });
}

function gitC(repo: string, ...args: string[]): string {
  const run = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout.trim();
}

interface Row {
  readonly genId: string;
  readonly data: GenerationRowData;
}

function genRows(repo: string): readonly Row[] {
  return Ledger.open(repo)
    .readAll()
    .filter((r) => r.kind === "generation_complete" && r.genId !== undefined)
    .map((r) => ({ genId: r.genId as string, data: decodeGenerationRecord(r) }));
}

function graftRows(repo: string) {
  return Ledger.open(repo)
    .readAll()
    .filter((r) => r.kind === LEDGER_KIND_GRAFT_IMPORT)
    .map((r) => ({ record: r, row: decodeGraftImport(r.data) }));
}

/** Real evolution on the source instance; returns its candidate rows. */
async function evolveSource(inst: Instance): Promise<readonly Row[]> {
  if (inst.entry === null) throw new Error("fixture: source instance lacks a registry entry");
  const outcome = await runEvolution({
    entry: inst.entry,
    configDir: inst.configDir,
    mutatorCommand: `node ${inst.root}/stub.mjs --mode three --dir {worktree} --brief {brief}`,
    env: { XDG_CACHE_HOME: inst.xdgCache, HOME: path.join(inst.root, `home-${inst.name}`) },
    sandboxRoot: path.join(inst.configDir, "bench-sandboxes"),
  });
  assert.equal(outcome.exitCode, 0, `source evolution must succeed: ${outcome.lines.join("\n")}`);
  return genRows(inst.repo);
}

async function exportFrom(inst: Instance, genId: string): Promise<string> {
  if (inst.entry === null) throw new Error("fixture: source instance lacks a registry entry");
  const outDir = path.join(inst.root, `bundles-${inst.name}`);
  const outcome = await exportBundle({
    entry: inst.entry,
    configDir: inst.configDir,
    select: { genIds: [genId] },
    outDir,
    home: os.homedir(),
  });
  assert.ok(existsSync(outcome.bundlePath), "bundle written");
  return outcome.bundlePath;
}

// --------------------------------------------------------- bundle surgery

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

function bundleMembers(bundlePath: string): TarMember[] {
  return readTar(new Uint8Array(gunzipSync(readFileSync(bundlePath))));
}

function repack(bundlePath: string, members: readonly TarMember[]): void {
  writeFileSync(bundlePath, new Uint8Array(gzipSync(writeTar(members))));
}

function manifestDoc(members: readonly TarMember[]): Record<string, unknown> {
  const raw = members.find((m) => m.path === "manifest.json");
  if (raw === undefined) throw new Error("bundle has no manifest.json");
  return JSON.parse(new TextDecoder().decode(raw.content)) as Record<string, unknown>;
}

/** Edit manifest.json only (it is not sha-pinned in files[]) — claims stay schema-valid. */
function tamperManifest(bundlePath: string, edit: (doc: Record<string, unknown>) => void): void {
  const members = bundleMembers(bundlePath);
  const doc = manifestDoc(members);
  edit(doc);
  repack(bundlePath, members.map((m) => (m.path === "manifest.json" ? { path: m.path, content: enc(`${JSON.stringify(doc, null, 2)}\n`) } : m)));
}

function primaryTreeGen(members: readonly TarMember[]): string {
  const ids = new Set<string>();
  for (const m of members) {
    if (!m.path.startsWith("trees/")) continue;
    ids.add(m.path.slice("trees/".length).split("/")[0] as string);
  }
  return [...ids].sort().at(-1) as string;
}

/**
 * AC(b) tamper: mutate a digest-bearing tree member (units/mul.mjs), re-pin its
 * files[] entry (byte-consistent repack) and leave manifest.benchDigest STALE.
 */
function tamperTreeStaleDigest(bundlePath: string): void {
  const members = bundleMembers(bundlePath);
  const primary = primaryTreeGen(members);
  const target = `trees/${primary}/units/mul.mjs`;
  const member = members.find((m) => m.path === target);
  if (member === undefined) throw new Error(`bundle has no ${target}`);
  const content = enc(`${new TextDecoder().decode(member.content)}\n// tampered after export\n`);
  const next = members.map((m) => (m.path === target ? { path: m.path, content } : m));
  const doc = manifestDoc(members);
  const files = doc.files as { path: string; sha256: string; len: number }[];
  const pin = files.find((f) => f.path === target);
  if (pin === undefined) throw new Error(`manifest does not pin ${target}`);
  pin.sha256 = sha256Hex(content);
  pin.len = content.length;
  repack(bundlePath, next.map((m) => (m.path === "manifest.json" ? { path: m.path, content: enc(`${JSON.stringify(doc, null, 2)}\n`) } : m)));
}

/** Hand-built evil tar: writeTar refuses traversal, so craft the raw header. */
function tarWithRawHeader(badName: string): Uint8Array {
  const header = new Uint8Array(512);
  header.set(enc(badName), 0);
  header.set(enc("0000644\0"), 100);
  header.set(enc("0000000\0"), 108);
  header.set(enc("0000000\0"), 116);
  header.set(enc("00000000001\0"), 124);
  header.set(enc("00000000000\0"), 136);
  header.set(new Uint8Array(8).fill(0x20), 148);
  header[156] = 0x30;
  header.set(enc("ustar\0"), 257);
  header.set(enc("00"), 263);
  let sum = 0;
  for (const b of header) sum += b;
  header.set(enc(`${(sum & 0o777777).toString(8).padStart(6, "0")}\0 `), 148);
  const out = new Uint8Array(512 * 4);
  out.set(header, 0);
  out.set(new Uint8Array(512).fill(0x78), 512);
  return out;
}

function bundleSha(bundlePath: string): string {
  return sha256Hex(new Uint8Array(readFileSync(bundlePath)));
}

function incumbentSha(inst: Instance): string | null {
  const run = spawnSync("git", ["-C", inst.repo, "rev-parse", "--verify", "-q", `refs/heads/${INCUMBENT_BRANCH}`], { encoding: "utf8" });
  return run.status === 0 ? run.stdout.trim() : null;
}

/** Build the AC(a) pair: evolved source instance + honest bundle + fresh twin. */
async function crossInstanceBundle(
  s: Suite,
  pick: "nominated" | "culled",
): Promise<{ readonly bundlePath: string; readonly sourceFingerprint: string }> {
  const src = await makeInstance(s, "src");
  assert.ok(src.entry !== null, "source instance registered");
  const rows = await evolveSource(src);
  const wanted = rows.find((r) => r.data.source === "candidate" && r.data.verdict === pick);
  assert.ok(wanted !== undefined && wanted.data.commitSha !== undefined, `source produced a ${pick} candidate`);
  const bundlePath = await exportFrom(src, wanted.genId);
  const sourceFingerprint = fingerprint(src.entry.spec);
  // The twin instance: same absolute genome path, wiped git, different config home.
  rmSync(s.genomePath, { recursive: true, force: true });
  return { bundlePath, sourceFingerprint };
}

// ---------------------------------------------------------------- AC (a)

test("AC(a): honest cross-instance graft re-benches LOCALLY and nominates; peer claims are peerClaim-only", async (t) => {
  const s = await suite(t);
  const { bundlePath, sourceFingerprint } = await crossInstanceBundle(s, "nominated");
  const dst = await makeInstance(s, "dst");

  // peer claims DIFFERENTLY than the local truth will say: inconclusive @ reps 99
  tamperManifest(bundlePath, (doc) => {
    (doc.stats as Record<string, unknown>).verdict = "inconclusive";
    (doc.benchProvenance as Record<string, unknown>).nRepeats = 99;
  });

  const run = cli(dst, "graft", bundlePath, "--genome", "toy-smoke");
  assert.equal(run.status, 0, `graft must nominate: ${run.stdout}${run.stderr}`);
  assert.match(run.stdout, /nominated/i);
  assert.match(run.stdout, /promote/i, "nomination must point at the human gate");

  const imports = graftRows(dst.repo);
  assert.equal(imports.length, 1, "exactly one graft_import row");
  const row = imports[0]?.row;
  assert.ok(row !== null && row !== undefined);
  assert.equal(row.decision, "nominated");
  assert.equal(row.imported, true);
  assert.equal(row.sourceGenomeFingerprint, sourceFingerprint);
  assert.match(row.sourceBenchDigest ?? "", /^[0-9a-f]{64}$/);
  assert.equal(row.bundleSha256, bundleSha(bundlePath));
  assert.equal(row.genomeLabel, "toy-smoke");
  // the lying claim survives only as peerClaim metadata:
  assert.equal(row.peerClaim?.verdict, "inconclusive");
  assert.equal(row.peerClaim?.nRepeats, 99);

  // LOCAL re-bench record: reps = local clampReps(undefined, initial=2), NOT 99
  const gens = genRows(dst.repo);
  const candidate = gens.find((g) => g.data.source === "candidate");
  assert.ok(candidate !== undefined, "graft candidate generation row exists");
  assert.equal(candidate.data.verdict, "nominated");
  assert.equal(candidate.data.reps, 2, "local nReps.initial rules, never the bundle's 99");
  const add = candidate.data.units.find((u) => u.unitId === "add");
  assert.ok(add !== undefined && add.scores.length === 2, "2 local replicates sampled");
  assert.equal(candidate.data.headCommit, gitC(dst.repo, "rev-parse", "HEAD"));
  assert.equal(candidate.genId, imports[0]?.record.genId, "graft_import and generation rows share the graft genId");

  // sealed graft tree == bundle bytes: units/add.mjs fixed, grader untouched
  const fixedAdd = gitC(dst.repo, "show", `${String(candidate.data.commitSha)}:units/add.mjs`);
  assert.match(fixedAdd, /return a \+ b;/);
  assert.doesNotMatch(fixedAdd, /seeded bug/);

  // human gate consumes the nomination (graft itself promoted NOTHING):
  assert.equal(incumbentSha(dst), null, "graft never auto-promotes");
  const promote = cli(dst, "promote", "toy-smoke", candidate.genId);
  assert.equal(promote.status, 0, `promote the graft nomination: ${promote.stderr}`);
  assert.equal(incumbentSha(dst), candidate.data.commitSha);

  const st = cli(dst, "status", "toy-smoke");
  assert.equal(st.status, 0);
  assert.match(st.stdout, /graft decisions: 1/);
  assert.match(st.stdout, /nominated/);
  assert.match(st.stdout, /pending-bench graft queue: 0/);
});

test("AC(a-culled): neutral patch loses on LOCAL minEffect ⇒ culled even when the peer claims nominated", async (t) => {
  const s = await suite(t);
  const { bundlePath } = await crossInstanceBundle(s, "culled"); // annotate-add comment patch
  tamperManifest(bundlePath, (doc) => {
    (doc.stats as Record<string, unknown>).verdict = "nominated"; // lie the other way
  });
  const dst = await makeInstance(s, "dst");
  const run = cli(dst, "graft", bundlePath, "--genome", "toy-smoke");
  assert.equal(run.status, 1, "neutral graft loses locally");
  assert.match(run.stdout + run.stderr, /culled/i);
  const imports = graftRows(dst.repo);
  assert.equal(imports.length, 1);
  assert.equal(imports[0]?.row?.decision, "culled");
  assert.equal(imports[0]?.row?.peerClaim?.verdict, "nominated", "peer claim recorded, not obeyed");
  assert.ok(genRows(dst.repo).some((g) => g.data.source === "candidate" && g.data.verdict === "culled"));
  assert.equal(incumbentSha(dst), null, "a culled graft touches no ref");
});

// ---------------------------------------------------------------- AC (b)

test("AC(b): tampered benchDigest ⇒ quarantined with expected-vs-actual, ZERO worktrees, ZERO bench, status lists it", async (t) => {
  const s = await suite(t);
  const { bundlePath, sourceFingerprint } = await crossInstanceBundle(s, "nominated");
  tamperTreeStaleDigest(bundlePath); // member bytes changed + re-pinned, manifest digest stale
  const dst = await makeInstance(s, "dst");

  const run = cli(dst, "graft", bundlePath, "--genome", "toy-smoke");
  assert.equal(run.status, 1, "integrity mismatch blocks");
  const out = run.stdout + run.stderr;
  assert.match(out, /quarantined/i, "names the quarantine decision");
  assert.match(out, /benchDigest/i, "names WHICH gate failed");
  assert.match(out, /[0-9a-f]{64}.*[0-9a-f]{64}/s, "shows expected vs actual digests");

  const imports = graftRows(dst.repo);
  assert.equal(imports.length, 1, "exactly one graft_import row");
  assert.equal(imports[0]?.row?.decision, "quarantined");
  assert.equal(imports[0]?.row?.imported, true);
  assert.equal(imports[0]?.row?.sourceGenomeFingerprint, sourceFingerprint);
  assert.equal(imports[0]?.row?.bundleSha256, bundleSha(bundlePath));

  assert.ok(!existsSync(path.join(dst.xdgCache, "abathur", "worktrees")), "ZERO worktrees created");
  assert.ok(!existsSync(path.join(dst.configDir, "bench-sandboxes")), "ZERO benches launched");
  const gens = genRows(dst.repo);
  assert.ok(!gens.some((g) => g.data.source === "candidate"), "no graft candidate generation row");

  const st = cli(dst, "status", "toy-smoke");
  assert.equal(st.status, 0);
  assert.match(st.stdout, /graft decisions: 1/);
  assert.match(st.stdout, /quarantined/);
});

test("wrong-genome gate: local spec fingerprint differs from the bundle's genome ⇒ quarantined naming fingerprints", async (t) => {
  const s = await suite(t);
  const { bundlePath } = await crossInstanceBundle(s, "nominated");
  // different local bench config ⇒ different fingerprint, same label + path
  const dst = await makeInstance(s, "dst", { minEffect: 0.6 });
  const run = cli(dst, "graft", bundlePath, "--genome", "toy-smoke");
  assert.equal(run.status, 1);
  const out = run.stdout + run.stderr;
  assert.match(out, /quarantined/i);
  assert.match(out, /fingerprint/i, "names the genome-fingerprint gate");
  const imports = graftRows(dst.repo);
  assert.equal(imports.length, 1);
  assert.equal(imports[0]?.row?.decision, "quarantined");
  assert.ok(!existsSync(path.join(dst.xdgCache, "abathur", "worktrees")), "gate 1 quarantines before any worktree");
});

// ---------------------------------------------------------------- AC (c)

test("AC(c): genome not registered ⇒ pending-bench queue + status depth, ZERO bench; register + re-run resolves", async (t) => {
  const s = await suite(t);
  const { bundlePath, sourceFingerprint } = await crossInstanceBundle(s, "nominated");
  // config home with NO genome registered at all:
  const bare = path.join(s.root, "cfg-bare");
  mkdirSync(bare, { recursive: true });
  writeFileSync(path.join(bare, "config.jsonc"), '{ "opencodeBin": null }\n', "utf8");
  const ghost: Instance = {
    root: s.root, name: "bare", configDir: bare, repo: s.genomePath,
    entry: null, xdgCache: path.join(s.root, "xdg-bare"),
    cliEnv: { ...process.env, ABATHUR_CONFIG: path.join(bare, "config.jsonc"), HOME: path.join(s.root, "home-bare"), XDG_CACHE_HOME: path.join(s.root, "xdg-bare") },
  };

  const run = cli(ghost, "graft", bundlePath, "--genome", "toy-smoke");
  assert.equal(run.status, 1, "pending-bench is a blocked decision, not a crash");
  assert.match(run.stdout + run.stderr, /pending-bench/i);
  const queueFile = graftQueuePath(bare, bundleSha(bundlePath));
  assert.ok(existsSync(queueFile), "explicit queue entry persisted");
  const entry = JSON.parse(readFileSync(queueFile, "utf8")) as Record<string, unknown>;
  assert.equal(entry.genomeLabel, "toy-smoke");
  assert.equal(entry.bundlePath, bundlePath);
  assert.equal(entry.sourceGenomeFingerprint, sourceFingerprint);

  const st = cli(ghost, "status", "toy-smoke");
  assert.equal(st.status, 0, "status renders the queue for an unregistered label");
  assert.match(st.stdout, /pending-bench graft queue: 1/);
  assert.match(st.stdout, new RegExp(bundleSha(bundlePath).slice(0, 12)));

  assert.ok(!existsSync(path.join(bare, "bench-sandboxes")), "ZERO bench runs launched");
  assert.ok(!existsSync(path.join(s.root, "xdg-bare", "abathur", "worktrees")), "ZERO worktrees");
  assert.ok(!existsSync(path.join(s.genomePath, ".state")), "no genome repo ⇒ no ledger touched");

  // operator registers the genome (in the SAME config home that holds the queue),
  // re-runs graft: gates pass, queue entry consumed by the success-path decision.
  const twin = await prepareToyGenome(s.genomePath);
  registerGenome(bare, path.join(twin, "genome.jsonc"));
  const again = cli(ghost, "graft", bundlePath, "--genome", "toy-smoke");
  assert.equal(again.status, 0, `re-run grafts: ${again.stdout}${again.stderr}`);
  assert.ok(!existsSync(queueFile), "queue entry consumed by the success-path decision");
  // the resolved graft benched in the REAL per-genome cache dir (worktree.ts:4:
  // $XDG_CACHE_HOME/abathur/worktrees/<genomeFp>/<genId>) — asserting a made-up
  // child of the parent would be vacuously true.
  const bareFp = requireGenomesByLabel(bare, "toy-smoke").entries[0]?.fingerprint;
  assert.ok(bareFp !== undefined, "bare instance carries the registered fingerprint");
  assert.ok(
    existsSync(path.join(s.root, "xdg-bare", "abathur", "worktrees", bareFp)),
    "resolved graft created its worktree under the per-genome cache dir",
  );
  const st2 = cli(ghost, "status", "toy-smoke");
  assert.match(st2.stdout, /pending-bench graft queue: 0/);
  assert.match(st2.stdout, /graft decisions: 1/);
});

test("requires[] probe failure ⇒ pending-bench row + queue + exit 2, ZERO bench; probe satisfied re-run grafts", async (t) => {
  const s = await suite(t);
  const marker = path.join(s.root, "probe-marker.mjs");
  const requires = [{ cmd: "node", args: [marker], probeExit: 0 }];
  writeFileSync(marker, "process.exit(0);\n", "utf8");
  const src = await makeInstance(s, "src", { requires });
  const rows = await evolveSource(src);
  const fix = rows.find((r) => r.data.source === "candidate" && r.data.verdict === "nominated");
  assert.ok(fix !== undefined);
  const bundlePath = await exportFrom(src, fix.genId);
  rmSync(s.genomePath, { recursive: true, force: true });
  rmSync(marker); // the twin machine lacks the prerequisite

  const dst = await makeInstance(s, "dst", { requires });
  const run = cli(dst, "graft", bundlePath, "--genome", "toy-smoke");
  assert.equal(run.status, 2, "probe failure cannot-answer");
  assert.match(run.stdout + run.stderr, /pending-bench/i);
  assert.match(run.stdout + run.stderr, /probe|prerequisite/i);
  const imports = graftRows(dst.repo);
  assert.equal(imports.length, 1);
  assert.equal(imports[0]?.row?.decision, "pending-bench");
  assert.ok(existsSync(graftQueuePath(dst.configDir, bundleSha(bundlePath))), "queue entry parked for the operator");
  assert.ok(!existsSync(path.join(dst.xdgCache, "abathur", "worktrees")), "probe runs BEFORE any worktree");
  assert.ok(!existsSync(path.join(dst.configDir, "bench-sandboxes")), "probe runs BEFORE any bench");

  writeFileSync(marker, "process.exit(0);\n", "utf8");
  const again = cli(dst, "graft", bundlePath, "--genome", "toy-smoke");
  assert.equal(again.status, 0, `satisfied probe grafts through: ${again.stdout}${again.stderr}`);
  assert.ok(!existsSync(graftQueuePath(dst.configDir, bundleSha(bundlePath))), "queue consumed");
  const decisions = graftRows(dst.repo).map((x) => x.row?.decision);
  assert.deepEqual(decisions, ["pending-bench", "nominated"], "pending rows do not trip the duplicate rule; terminal does");
});

// ------------------------------------------------------------ stale_state

test("stale_state: the same bundle grafts once — a second attempt refuses 'already grafted'", async (t) => {
  const s = await suite(t);
  const { bundlePath } = await crossInstanceBundle(s, "nominated");
  const dst = await makeInstance(s, "dst");
  assert.equal(cli(dst, "graft", bundlePath, "--genome", "toy-smoke").status, 0);
  const twice = cli(dst, "graft", bundlePath, "--genome", "toy-smoke");
  assert.equal(twice.status, 1);
  assert.match(twice.stdout + twice.stderr, /already grafted/i);
  assert.equal(graftRows(dst.repo).length, 1, "still exactly one decision row for the bundle");
  assert.equal(genRows(dst.repo).filter((g) => g.data.source === "candidate").length, 1, "no second bench");
});

// --------------------------------------------------------- malformed_input

test("malformed_input: garbage container, stripped/invalid manifest, traversal tar ⇒ exit 2 clean, no state", async (t) => {
  const s = await suite(t);
  const { bundlePath } = await crossInstanceBundle(s, "nominated");
  const dst = await makeInstance(s, "dst");

  const junk = path.join(s.root, "junk.tgz");
  writeFileSync(junk, "this is not a gzip stream at all\n", "utf8");
  const r1 = cli(dst, "graft", junk, "--genome", "toy-smoke");
  assert.equal(r1.status, 2);
  assert.ok(!r1.stderr.includes("    at "), `no stack trace: ${r1.stderr}`);

  const stripped = path.join(s.root, "stripped.bundle.tgz");
  writeFileSync(stripped, new Uint8Array(gzipSync(writeTar(bundleMembers(bundlePath).filter((m) => m.path !== "manifest.json")))));
  const r2 = cli(dst, "graft", stripped, "--genome", "toy-smoke");
  assert.equal(r2.status, 2, "manifest missing cannot-answer");

  const evil = path.join(s.root, "evil", "e1.bundle.tgz");
  mkdirSync(path.dirname(evil), { recursive: true });
  writeFileSync(evil, new Uint8Array(gzipSync(tarWithRawHeader(`../abathur-graft-evil-${process.pid}`))));
  const r3 = cli(dst, "graft", evil, "--genome", "toy-smoke");
  assert.equal(r3.status, 2, "traversal member refused end-to-end");
  assert.ok(!existsSync(path.join(s.root, `abathur-graft-evil-${process.pid}`)), "evil member never materialised");

  const badFlag = cli(dst, "graft", bundlePath, "--genome", "toy-smoke", "--force");
  assert.equal(badFlag.status, 2, "no bypass flag exists");
  const noLabel = cli(dst, "graft", bundlePath);
  assert.equal(noLabel.status, 2);
  const missing = cli(dst, "graft", path.join(s.root, "nope.tgz"), "--genome", "toy-smoke");
  assert.equal(missing.status, 2);

  // r1..missing each had their exit code asserted above; nothing left to loop over.
  assert.equal(graftRows(dst.repo).length, 0, "integrity-garbage leaves no graft_import row (cannot-answer class)");
  assert.ok(!existsSync(graftQueueDir(dst.configDir)), "garbage never queues pending-bench");
});

// --------------------------------------------------------- prompt_injection

test("prompt_injection: hostile bundle strings never forge status/echo lines", async (t) => {
  const s = await suite(t);
  const { bundlePath } = await crossInstanceBundle(s, "culled");
  tamperManifest(bundlePath, (doc) => {
    doc.rationale = "evil\n\u001b[31mred\u001b[0m fake: graft queue: 999";
    const stats = doc.stats as { matrix: { failures: string[] }[] };
    if (stats.matrix[0] !== undefined) stats.matrix[0].failures = ["\u001b[31mOWNED\u001b[0m\nquarantine depth: 999"];
  });
  const dst = await makeInstance(s, "dst");
  const run = cli(dst, "graft", bundlePath, "--genome", "toy-smoke");
  assert.equal(run.status, 1, "culled locally regardless of injected strings");
  assert.ok(!run.stdout.includes("\u001b"), "raw ANSI never reaches stdout");
  assert.ok(!run.stderr.includes("\u001b"), "raw ANSI never reaches stderr");
  assert.doesNotMatch(run.stdout, /OWNED/, "bundle stats matrix is never echoed");
  for (const line of run.stdout.split("\n").filter((l) => l.length > 0)) {
    assert.ok(!(line === "quarantine depth: 999" || line === "fake: graft queue: 999"), `injected line echoed: ${line}`);
  }
  const raw = readFileSync(path.join(dst.repo, ".state", "abathur", "ledger.jsonl"), "utf8");
  assert.ok(!raw.includes("\u001b"), "ledger text carries no raw ESC byte (canonicalJson escapes)");

  const st = cli(dst, "status", "toy-smoke");
  assert.equal(st.status, 0);
  assert.ok(!st.stdout.includes("\u001b"), "status stays escape-free rendering graft rows");
});

// ------------------------------------------------------------ dirty_worktree

test("dirty_worktree: local dirt never rides into the graft bench — the sealed bundle tree wins", async (t) => {
  const s = await suite(t);
  const { bundlePath } = await crossInstanceBundle(s, "nominated");
  const dst = await makeInstance(s, "dst");
  const headMul = gitC(dst.repo, "show", "HEAD:units/mul.mjs");
  writeFileSync(path.join(dst.repo, "units", "mul.mjs"), `${headMul}\n// operator dirt, uncommitted\n`, "utf8");
  writeFileSync(path.join(dst.repo, "untracked-dirt.txt"), "junk\n", "utf8");

  const run = cli(dst, "graft", bundlePath, "--genome", "toy-smoke");
  assert.equal(run.status, 0, `dirty worktree does not block graft: ${run.stdout}${run.stderr}`);
  const candidate = genRows(dst.repo).find((g) => g.data.source === "candidate");
  assert.ok(candidate !== undefined && candidate.data.commitSha !== undefined);
  const sealedMul = gitC(dst.repo, "show", `${candidate.data.commitSha}:units/mul.mjs`);
  assert.equal(sealedMul, headMul, "graft tree = bundle bytes, not the dirty worktree");
  assert.doesNotMatch(sealedMul, /operator dirt/);
  const status = gitC(dst.repo, "status", "--porcelain");
  assert.match(status, /units\/mul\.mjs/, "operator dirt left exactly as found");
});

test("queue listing is fail-closed: absent dir ⇒ empty, unreadable dir ⇒ rethrow (F2 A3)", async (t) => {
  const cfg = await mkdtemp(path.join(os.tmpdir(), "abathur-queue-failclosed-"));
  t.after(() => rmSync(cfg, { recursive: true, force: true }));
  assert.deepEqual(listGraftQueue(cfg), [], "no queue yet = empty, not an error (ENOENT stays tolerated)");
  // A queue path occupied by a regular file is corruption, not absence: readdirSync
  // fails ENOTDIR and that must bubble — swallowing it rendered a real queue as
  // empty, the fail-open class F2 flagged. chmod-free seam, so it runs as any user.
  writeFileSync(path.join(cfg, "graft-queue"), "not a dir\n", "utf8");
  assert.throws(() => listGraftQueue(cfg), /ENOTDIR/);
});

// ---------------------------------------------------------------- structural

test("structural: graft never imports the promote gate; no --force anywhere in graft code", () => {
  const graftFiles = ["src/core/graft.ts", "src/core/graft-support.ts", "src/core/graft-gates.ts", "src/core/graft-rebench.ts", "src/commands/graft.ts"];
  for (const rel of graftFiles) {
    const text = readFileSync(path.join(REPO_ROOT, rel), "utf8");
    // comments may DOCUMENT the absence of a bypass; the pin is on real code
    const code = text.split("\n").filter((line) => !/^\s*(\/\/|\*)/.test(line)).join("\n");
    assert.doesNotMatch(code, /from\s+"[^"]*promote\.js"/, `${rel} must not import promote`);
    assert.doesNotMatch(code, /--force/, `${rel} must not offer a bypass flag`);
  }
  const queue = readdirSync(path.join(REPO_ROOT, "src", "core"));
  assert.ok(queue.includes("graft.ts") && queue.includes("graft-support.ts"), "graft modules exist");
});

test("status without queue or graft rows still prints the honest zero (AC(d) compat)", async (t) => {
  const s = await suite(t);
  const dst = await makeInstance(s, "dst");
  const st = cli(dst, "status", "toy-smoke");
  assert.equal(st.status, 0);
  assert.match(st.stdout, /pending-bench graft queue: 0/);
  assert.match(st.stdout, /quarantine depth: 0/);
  assert.match(st.stdout, /graft decisions: 0/);
});
