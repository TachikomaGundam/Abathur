// Todo 10 AC pins (plan lines 149-156): human-gate promote / tombstone / status + genome rm.
//   AC(a) promote of a nominated clean gen fast-forwards abathur/incumbent, refreshes the
//         config-home kernel manifest, `kernel audit` exits 0 after, promote ledger row appended;
//   AC(b) promote whose diff touches a sealed path is blocked exit 1 EVEN with a forged
//         nominated generation_complete row (tamper fixture), with ref + manifest untouched;
//   AC(c) tombstone records culled lineage and deletes nothing (gen commit stays reachable);
//   AC(d) status renders incumbent + quarantine depth, never fabricates an incumbent;
//   plus: stale promote refused (not an ancestor), checked-out incumbent refused,
//   row-without-verdict refused, double promote refused, genome rm refuses ledger history.
// Promotion state is derived ONLY from the ledger; no mocks of git — real toy genome,
// real seals via todo-3 worktree APIs, commands driven through the real CLI.

import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";

import { acquireGenomeLock, acquireLock, Ledger } from "../core/ledger.js";
import type { LedgerRecord } from "../core/ledger.js";
import { fingerprint, genId } from "../core/ids.js";
import { newGeneration, openGenome, sealGeneration } from "../core/worktree.js";
import type { WorktreeEnv, WorktreeOptions } from "../core/genome-paths.js";
import { manifestPathFor, readManifestFile } from "../core/kernel.js";
import { registerGenome, requireGenomesByLabel, readRegistry } from "../core/genome.js";
import type { RegistryEntry } from "../core/genome.js";
import { INCUMBENT_BRANCH } from "../core/incumbent.js";
import { decodeGenerationRecord, type GenerationRowData } from "../core/evolve/run-bench.js";
import { runEvolution } from "../core/evolve/run-loop.js";
import { prepareToyGenome } from "../bench/toy.js";

const CLI = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

// ------------------------------------------------------------------ fixture

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
    { id: "touch-kernel", rationale: "subvert grading", diffs: [lineDiff("grader.mjs", "model-free", "model-free-ish")] },
    { id: "fix-add", rationale: "fix add(): subtraction to addition", diffs: [lineDiff("units/add.mjs", FIX, "return a + b;")] },
  ]);
} else {
  process.stderr.write("stub: unknown mode\\n");
  process.exit(2);
}
`;

interface GateFixture {
  readonly root: string;
  readonly configDir: string;
  readonly repo: string;
  readonly entry: RegistryEntry;
  readonly env: WorktreeEnv;
  readonly wopts: WorktreeOptions;
}

/** Isolated tmp home: registered toy genome + stub mutator; NO evolution run yet. */
async function gateFixture(t: TestContext): Promise<GateFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "abathur-promote-"));
  t.after(() => {
    spawnSync("rm", ["-rf", root], { encoding: "utf8" });
  });
  const configDir = path.join(root, "config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path.join(configDir, "config.jsonc"), '{ "opencodeBin": null }\n', "utf8");
  const repo = await prepareToyGenome(path.join(root, "genome"));
  registerGenome(configDir, path.join(repo, "genome.jsonc"));
  const entry = requireGenomesByLabel(configDir, "toy-smoke").entries[0];
  if (entry === undefined) throw new Error("fixture: toy-smoke registration vanished");
  const stub = path.join(root, "stub.mjs");
  writeFileSync(stub, STUB_SOURCE, "utf8");
  chmodSync(stub, 0o755);
  const env: WorktreeEnv = { XDG_CACHE_HOME: path.join(root, "xdg-cache"), HOME: path.join(root, "home") };
  return { root, configDir, repo, entry, env, wopts: { env } };
}

/** CLI env for spawned runs: config + HOME + cache all pinned into the tmp root. */
function cliEnv(f: GateFixture): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ABATHUR_CONFIG: path.join(f.configDir, "config.jsonc"),
    HOME: path.join(f.root, "home"),
    XDG_CACHE_HOME: path.join(f.root, "xdg-cache"),
  };
}

function cli(f: GateFixture, ...args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [CLI, ...args], { env: cliEnv(f), encoding: "utf8", cwd: f.root });
}

function git(f: GateFixture, ...args: string[]): string {
  const run = spawnSync("git", ["-C", f.repo, ...args], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout.trim();
}

// ------------------------------------------------------------------- rows

interface Row {
  readonly genId: string;
  readonly data: GenerationRowData;
}

function allRows(f: GateFixture): readonly LedgerRecord[] {
  return Ledger.open(f.repo).readAll();
}

function genRows(f: GateFixture): readonly Row[] {
  return allRows(f)
    .filter((r) => r.kind === "generation_complete" && r.genId !== undefined)
    .map((r) => ({ genId: r.genId as string, data: decodeGenerationRecord(r) }));
}

function rowsOfKind(f: GateFixture, kind: string): readonly LedgerRecord[] {
  return allRows(f).filter((r) => r.kind === kind);
}

/** Real 2-candidate evolution (run-loop, no mocks): fix-add nominated, annotate-add culled. */
async function evolve(f: GateFixture): Promise<readonly Row[]> {
  const outcome = await runEvolution({
    entry: f.entry,
    configDir: f.configDir,
    mutatorCommand: `node ${path.join(f.root, "stub.mjs")} --mode three --dir {worktree} --brief {brief}`,
    env: f.env,
    sandboxRoot: path.join(f.root, "sandboxes"),
  });
  assert.equal(outcome.exitCode, 0, "fixture evolution must succeed");
  return genRows(f);
}

// ------------------------------------------------------------- hand sealing

interface HandGen {
  readonly genId: string;
  readonly commitSha: string;
  readonly treeSha: string;
  readonly parent: string;
}

/**
 * Seal a generation BY HAND (todo-3 APIs) and forge its generation_complete row.
 * mutation.file may be a sealed path (grader.mjs) — the forged verdict is whatever
 * the caller says, which is exactly the tampered-ledger scenario promote must refuse.
 */
async function handSeal(
  f: GateFixture,
  tag: string,
  mutation: { readonly file: string; readonly append: string },
  verdict: GenerationRowData["verdict"],
  opts: { readonly gain?: number | null } = {},
): Promise<HandGen> {
  const opened = await openGenome(f.repo, [], f.wopts);
  const id = genId(fingerprint({ handseal: tag, root: f.root }));
  const genome = { repoPath: f.repo, genomeFp: f.entry.fingerprint };
  const gen = await newGeneration(genome, opened.headCommit, id, f.wopts);
  const target = path.join(gen.worktreePath, mutation.file);
  writeFileSync(target, `${readFileSync(target, "utf8")}${mutation.append}`, "utf8");
  const sealed = await sealGeneration(genome, id, `hand-seal ${id} (${tag})`, f.wopts);
  const data: GenerationRowData = {
    source: "candidate",
    candidateId: `hand-${tag}`,
    rationale: `hand-sealed ${tag}`,
    headCommit: opened.headCommit,
    commitSha: sealed.commitSha,
    treeSha: sealed.treeSha,
    complete: true,
    reps: 2,
    units: [],
    counters: { candidates: 1, modelCalls: 0, tokens: 0, wallS: 0 },
    manifest: [],
    ...(verdict === undefined ? {} : { verdict }),
    ...(opts.gain === undefined ? {} : { gain: opts.gain }),
    benchProvenance: { benchType: "toy", versions: [{ bin: "node", version: process.version }] },
  };
  Ledger.open(f.repo).append({ kind: "generation_complete", genId: id, data });
  return { genId: id, commitSha: sealed.commitSha, treeSha: sealed.treeSha, parent: opened.headCommit };
}

const CLEAN_MUTATION = { file: "units/mul.mjs", append: "\n// hand-sealed clean mutation\n" };
const SEALED_MUTATION = { file: "grader.mjs", append: "\n// tampered grader\n" };

function incumbentSha(f: GateFixture): string | null {
  const run = spawnSync("git", ["-C", f.repo, "rev-parse", "--verify", "-q", `refs/heads/${INCUMBENT_BRANCH}`], { encoding: "utf8" });
  return run.status === 0 ? run.stdout.trim() : null;
}

function manifestBytes(f: GateFixture): string {
  return readFileSync(manifestPathFor(f.configDir, f.entry.fingerprint), "utf8");
}

// -------------------------------------------------------------- AC (a) happy

test("AC(a): promote of nominated clean gen fast-forwards incumbent, refreshes manifest, kernel audit exits 0", async (t) => {
  const f = await gateFixture(t);
  const rows = await evolve(f);
  const nominated = rows.find((r) => r.data.verdict === "nominated");
  assert.ok(nominated !== undefined && nominated.data.commitSha !== undefined, "fixture produced a nominated row");
  const genSha = nominated.data.commitSha as string;

  assert.equal(incumbentSha(f), null, "no incumbent branch before first promote");
  const before = manifestBytes(f);

  const run = cli(f, "promote", "toy-smoke", nominated.genId);
  assert.equal(run.status, 0, `promote exit 0: ${run.stderr}`);
  assert.match(run.stdout, new RegExp(nominated.genId));
  assert.match(run.stdout, /manifest/i);

  assert.equal(incumbentSha(f), genSha, "incumbent branch fast-forwarded to the gen commit");
  // sealed files were untouched by this gen ⇒ same entries, byte-identical manifest
  assert.equal(manifestBytes(f), before, "clean promote leaves the manifest bytes unchanged");

  const audit = cli(f, "kernel", "audit", "toy-smoke");
  assert.equal(audit.status, 0, `kernel audit after promote: ${audit.stdout}${audit.stderr}`);

  const promoteRows = rowsOfKind(f, "promote");
  assert.equal(promoteRows.length, 1);
  const data = promoteRows[0]?.data as { actor: string; genId: string; from: string | null; to: string };
  assert.equal(data.actor, "cli");
  assert.equal(data.genId, nominated.genId);
  // first promote creates the ref: there was no prior incumbent, so `from` is null
  assert.equal(data.from, null);
  assert.equal(data.to, genSha);

  // a second promote of the same genId is refused (idempotence is not a feature here)
  const again = cli(f, "promote", "toy-smoke", nominated.genId);
  assert.equal(again.status, 1);
  assert.match(again.stderr + again.stdout, /already promoted/i);
});

test("AC(a2): hand-sealed clean nominated gen promotes and reseals manifest from the new tree", async (t) => {
  const f = await gateFixture(t);
  const gen = await handSeal(f, "clean-1", CLEAN_MUTATION, "nominated");
  const run = cli(f, "promote", "toy-smoke", gen.genId);
  assert.equal(run.status, 0, `promote clean hand-seal: ${run.stderr}${run.stdout}`);
  assert.equal(incumbentSha(f), gen.commitSha);
  const entries = readManifestFile(manifestPathFor(f.configDir, f.entry.fingerprint));
  assert.deepEqual([...new Set(entries.map((e) => e.path))].sort(), ["grader.mjs"]);
  const audit = cli(f, "kernel", "audit", "toy-smoke");
  assert.equal(audit.status, 0);
});

// ------------------------------------------------- AC (b) second enforcement

test("AC(b): tampered gen touching grader.mjs blocked exit 1 despite forged nominated row", async (t) => {
  const f = await gateFixture(t);
  const tampered = await handSeal(f, "sealed-touch", SEALED_MUTATION, "nominated");
  const before = manifestBytes(f);

  const run = cli(f, "promote", "toy-smoke", tampered.genId);
  assert.equal(run.status, 1, `sealed-path promote must block: ${run.stdout}`);
  assert.match(run.stderr + run.stdout, /grader\.mjs/, "blocks by naming the sealed path");
  assert.equal(incumbentSha(f), null, "nothing mutated: no incumbent ref");
  assert.equal(manifestBytes(f), before, "manifest untouched by a blocked promote");
  assert.equal(rowsOfKind(f, "promote").length, 0);

  // even after a legitimate promote exists, the tampered gen stays blocked
  const clean = await handSeal(f, "clean-first", CLEAN_MUTATION, "nominated");
  assert.equal(cli(f, "promote", "toy-smoke", clean.genId).status, 0);
  const run2 = cli(f, "promote", "toy-smoke", tampered.genId);
  assert.equal(run2.status, 1);
  assert.match(run2.stderr + run2.stdout, /grader\.mjs/);
});

test("fail-closed: non-nominated verdict, missing row, missing genId, unknown label", async (t) => {
  const f = await gateFixture(t);
  const rows = await evolve(f);
  const culled = rows.find((r) => r.data.verdict === "culled");
  assert.ok(culled !== undefined, "fixture produced a culled row");
  const c1 = cli(f, "promote", "toy-smoke", culled.genId);
  assert.equal(c1.status, 1);
  assert.match(c1.stderr + c1.stdout, /culled/, "names the actual verdict");

  const c2 = cli(f, "promote", "toy-smoke", "g-20200101T000000Z-deadbeef");
  assert.equal(c2.status, 1);
  assert.match(c2.stderr + c2.stdout, /g-20200101T000000Z-deadbeef/, "exit 1 NAMES the genId");

  const noVerdict = await handSeal(f, "no-verdict", CLEAN_MUTATION, undefined);
  const c3 = cli(f, "promote", "toy-smoke", noVerdict.genId);
  assert.equal(c3.status, 1, "row without verdict cannot be promoted");

  const c4 = cli(f, "promote", "nope-not-registered", "g-whatever");
  assert.equal(c4.status, 2, "unknown label is cannot-answer");

  const c5 = cli(f, "promote", "toy-smoke");
  assert.equal(c5.status, 2, "missing genId is cannot-answer");
});

// ------------------------------------------------------- stale / checked-out

test("stale_state: promoting an older nominated gen after a newer one is refused (not an ancestor)", async (t) => {
  const f = await gateFixture(t);
  const first = await handSeal(f, "gen-A", { file: "units/mul.mjs", append: "\n// A\n" }, "nominated");
  const second = await handSeal(f, "gen-B", { file: "units/add.mjs", append: "\n// B\n" }, "nominated");
  // both fork from the same base ⇒ after A is incumbent, B is not a descendant
  assert.equal(cli(f, "promote", "toy-smoke", first.genId).status, 0);
  const stale = cli(f, "promote", "toy-smoke", second.genId);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr + stale.stdout, /ancestor/i);
  assert.equal(incumbentSha(f), first.commitSha, "refusal leaves the ref where it was");
});

test("dirty_worktree: promote refuses while the incumbent branch is checked out", async (t) => {
  const f = await gateFixture(t);
  const gen = await handSeal(f, "checkout-block", CLEAN_MUTATION, "nominated");
  git(f, "branch", INCUMBENT_BRANCH, gen.parent);
  git(f, "checkout", "-q", INCUMBENT_BRANCH);
  const run = cli(f, "promote", "toy-smoke", gen.genId);
  assert.equal(run.status, 1);
  assert.match(run.stderr + run.stdout, /checked out/i);
  assert.equal(incumbentSha(f), gen.parent, "ref branch untouched while checked out");
});

// ------------------------------------------------------------------ tombstone

test("AC(c): tombstone records culled lineage, keeps commits and every byte of state", async (t) => {
  const f = await gateFixture(t);
  const rows = await evolve(f);
  const culled = rows.find((r) => r.data.verdict === "culled");
  const nominated = rows.find((r) => r.data.verdict === "nominated");
  assert.ok(culled !== undefined && nominated !== undefined && culled.data.commitSha !== undefined);
  const before = readFileSync(path.join(f.repo, ".state", "abathur", "ledger.jsonl"), "utf8");

  const run = cli(f, "tombstone", "toy-smoke", culled.genId, "--reason", "sibling of fix-add, no val gain");
  assert.equal(run.status, 0, `tombstone: ${run.stderr}`);

  const tomb = rowsOfKind(f, "tombstone");
  assert.equal(tomb.length, 1);
  const data = tomb[0]?.data as { genId: string; reason: string; actor: string };
  assert.deepEqual(data, { genId: culled.genId, reason: "sibling of fix-add, no val gain", actor: "cli" });

  // cull ≠ delete: the sealed commit stays reachable-by-object and history files only grow
  const cat = spawnSync("git", ["-C", f.repo, "cat-file", "-e", `${culled.data.commitSha}^{commit}`], { encoding: "utf8" });
  assert.equal(cat.status, 0, "gen commit object preserved after tombstone");
  const after = readFileSync(path.join(f.repo, ".state", "abathur", "ledger.jsonl"), "utf8");
  assert.ok(after.startsWith(before), "ledger stays append-only");

  // resolve the remaining nominated gen too (promote one, tombstone the other) ⇒
  // status shows zero pending decisions: both quarantine exits exist
  const promoted = await handSeal(f, "promote-then-status", { file: "units/mul.mjs", append: "\n// C\n" }, "nominated");
  assert.equal(cli(f, "promote", "toy-smoke", promoted.genId).status, 0);
  assert.equal(cli(f, "tombstone", "toy-smoke", nominated.genId, "--reason", "superseded by hand-seal C").status, 0);
  const st = cli(f, "status", "toy-smoke");
  assert.equal(st.status, 0);
  assert.match(st.stdout, new RegExp(`# ${promoted.genId}`), "promoted gen visible in generations table");
  assert.match(st.stdout, /quarantine depth: 0/, "promoted + tombstoned ⇒ nothing pending");
  assert.match(st.stdout, /incumbent: [0-9a-f]{7,}/);
});

test("tombstone fail-closed + prompt_injection hygiene", async (t) => {
  const f = await gateFixture(t);
  const gen = await handSeal(f, "evil-reason", CLEAN_MUTATION, "culled");

  const missing = cli(f, "tombstone", "toy-smoke", gen.genId);
  assert.equal(missing.status, 2, "--reason is required");

  const unknown = cli(f, "tombstone", "toy-smoke", "g-nope-not-here", "--reason", "x");
  assert.equal(unknown.status, 1);

  const evil = cli(f, "tombstone", "toy-smoke", gen.genId, "--reason", "evil\n\u001b[31mred\u001b[0m reason");
  assert.equal(evil.status, 0, `evil reason: ${evil.stderr}`);
  assert.ok(!evil.stdout.includes("\u001b"), "raw ANSI never reaches stdout");
  assert.ok(!evil.stdout.includes("\n\u001b"), "no injected escape line");
  const echoLine = evil.stdout.split("\n").filter((l) => l.length > 0);
  assert.equal(echoLine.length, 1, "echo is exactly one line");
  // the stored row is JSON-escaped on disk (canonicalJson), never a raw control byte line
  const raw = readFileSync(path.join(f.repo, ".state", "abathur", "ledger.jsonl"), "utf8");
  assert.ok(!raw.includes("\u001b"), "no raw ESC byte in ledger text");
  const stored = rowsOfKind(f, "tombstone")[0]?.data as { reason: string };
  assert.equal(stored.reason, "evil\n\u001b[31mred\u001b[0m reason", "ledger stores verbatim (escaped by JSON)");

  const twice = cli(f, "tombstone", "toy-smoke", gen.genId, "--reason", "again");
  assert.equal(twice.status, 1, "already tombstoned ⇒ refused");

  const promoted = await handSeal(f, "promoted-no-tomb", CLEAN_MUTATION, "nominated");
  assert.equal(cli(f, "promote", "toy-smoke", promoted.genId).status, 0);
  const tombPromoted = cli(f, "tombstone", "toy-smoke", promoted.genId, "--reason", "too late");
  assert.equal(tombPromoted.status, 1, "promoted gens cannot be tombstoned");
});

// -------------------------------------------------------------------- retract

test("AC(r1): retract undoes a fresh promote — ref deleted, manifest cleared, ledger append-only", async (t) => {
  const f = await gateFixture(t);
  const gen = await handSeal(f, "retract-happy", CLEAN_MUTATION, "nominated");
  assert.equal(cli(f, "promote", "toy-smoke", gen.genId).status, 0);
  assert.equal(incumbentSha(f), gen.commitSha);
  const manifestFile = manifestPathFor(f.configDir, f.entry.fingerprint);
  assert.ok(existsSync(manifestFile), "manifest exists after promote");
  const before = readFileSync(path.join(f.repo, ".state", "abathur", "ledger.jsonl"), "utf8");

  const run = cli(f, "retract", "toy-smoke", gen.genId, "--reason", "zero-gain change, human-ordered rollback");
  assert.equal(run.status, 0, `retract: ${run.stderr}`);
  assert.equal(incumbentSha(f), null, "incumbent ref deleted");
  assert.ok(!existsSync(manifestFile), "kernel manifest cleared");

  const retractRows = rowsOfKind(f, "retract");
  assert.equal(retractRows.length, 1);
  const data = retractRows[0]?.data as { genId: string; reason: string; actor: string; retractedTo: string };
  assert.equal(data.genId, gen.genId);
  assert.equal(data.retractedTo, gen.commitSha);
  assert.equal(data.reason, "zero-gain change, human-ordered rollback");
  assert.equal(rowsOfKind(f, "promote").length, 1, "promote row remains (history never rewritten)");
  const after = readFileSync(path.join(f.repo, ".state", "abathur", "ledger.jsonl"), "utf8");
  assert.ok(after.startsWith(before), "ledger stays append-only");

  const cat = spawnSync("git", ["-C", f.repo, "cat-file", "-e", `${gen.commitSha}^{commit}`], { encoding: "utf8" });
  assert.equal(cat.status, 0, "candidate commit preserved (retract ≠ delete)");

  const st = cli(f, "status", "toy-smoke");
  assert.equal(st.status, 0);
  assert.match(st.stdout, /incumbent: none/);
  assert.match(st.stdout, /ref is missing/, "status honestly warns about the retracted target");
});

test("retract fail-closed: missing reason, unknown gen, never-promoted, double retract", async (t) => {
  const f = await gateFixture(t);
  const gen = await handSeal(f, "retract-guards", CLEAN_MUTATION, "nominated");

  assert.equal(cli(f, "retract", "toy-smoke", gen.genId).status, 2, "--reason is required");
  assert.equal(cli(f, "retract", "toy-smoke", "g-nope", "--reason", "x").status, 1);
  const neverPromoted = cli(f, "retract", "toy-smoke", gen.genId, "--reason", "not promoted yet");
  assert.equal(neverPromoted.status, 1);
  assert.match(neverPromoted.stderr + neverPromoted.stdout, /no promote ledger row/);

  assert.equal(cli(f, "promote", "toy-smoke", gen.genId).status, 0);
  assert.equal(cli(f, "retract", "toy-smoke", gen.genId, "--reason", "undo").status, 0);
  const twice = cli(f, "retract", "toy-smoke", gen.genId, "--reason", "again");
  assert.equal(twice.status, 1);
  assert.match(twice.stderr + twice.stdout, /already retracted/);
});

test("retract LIFO + descendant guard: live descendant blocks, released descendant frees", async (t) => {
  const f = await gateFixture(t);
  const genA = await handSeal(f, "retract-A", { file: "units/mul.mjs", append: "\n// A\n" }, "nominated");
  assert.equal(cli(f, "promote", "toy-smoke", genA.genId).status, 0);
  // handSeal forks from the repo HEAD, so fast-forward main onto the new
  // incumbent first — the child must be a descendant of A or its own promote
  // would hit the not-an-ancestor stale_state guard.
  git(f, "merge", "--ff-only", "-q", genA.commitSha);

  const genChild = await handSeal(f, "retract-child", { file: "units/add.mjs", append: "\n// child\n" }, "nominated");
  const blockedByChild = cli(f, "retract", "toy-smoke", genA.genId, "--reason", "too late");
  assert.equal(blockedByChild.status, 1);
  assert.match(blockedByChild.stderr + blockedByChild.stdout, /orphan/);
  assert.equal(incumbentSha(f), genA.commitSha, "refusal leaves the ref where it was");

  assert.equal(cli(f, "promote", "toy-smoke", genChild.genId).status, 0);
  const lifo = cli(f, "retract", "toy-smoke", genA.genId, "--reason", "out of order");
  assert.equal(lifo.status, 1);
  assert.match(lifo.stderr + lifo.stdout, /LIFO/);

  assert.equal(cli(f, "retract", "toy-smoke", genChild.genId, "--reason", "child first").status, 0);
  assert.equal(incumbentSha(f), null);
  // child retracted ⇒ its lineage released ⇒ A retracts without a tombstone
  assert.equal(cli(f, "retract", "toy-smoke", genA.genId, "--reason", "now clear").status, 0);
  assert.equal(incumbentSha(f), null);
});

test("retract ref-absent: sole live promote records refState=absent; two live promotes refuse", async (t) => {
  const f = await gateFixture(t);
  const genA = await handSeal(f, "absent-A", CLEAN_MUTATION, "nominated");
  assert.equal(cli(f, "promote", "toy-smoke", genA.genId).status, 0);

  // documented manual-rollback shape: ref deleted out-of-band, sole live promote
  git(f, "update-ref", "-d", `refs/heads/${INCUMBENT_BRANCH}`);
  const ok = cli(f, "retract", "toy-smoke", genA.genId, "--reason", "manual rollback already done");
  assert.equal(ok.status, 0, `retract: ${ok.stderr}`);
  const row = rowsOfKind(f, "retract")[0]?.data as { refState?: string };
  assert.equal(row.refState, "absent", "row honestly marks the ref was already gone");
});

test("retract ref-absent with two live promotes refuses (no laundering of divergence)", async (t) => {
  const f = await gateFixture(t);
  const genA = await handSeal(f, "absent2-A", { file: "units/mul.mjs", append: "\n// A\n" }, "nominated");
  assert.equal(cli(f, "promote", "toy-smoke", genA.genId).status, 0);
  git(f, "merge", "--ff-only", "-q", genA.commitSha);
  const genB = await handSeal(f, "absent2-B", { file: "units/add.mjs", append: "\n// B\n" }, "nominated");
  assert.equal(cli(f, "promote", "toy-smoke", genB.genId).status, 0);

  git(f, "update-ref", "-d", `refs/heads/${INCUMBENT_BRANCH}`); // out-of-band divergence
  const run = cli(f, "retract", "toy-smoke", genB.genId, "--reason", "try to launder");
  assert.equal(run.status, 1);
  assert.match(run.stderr + run.stdout, /cannot verify what the retract undoes/);
  assert.equal(rowsOfKind(f, "retract").length, 0, "no row written on refusal");
});

test("retract refuses while a LINKED worktree has the incumbent branch checked out", async (t) => {
  const f = await gateFixture(t);
  const gen = await handSeal(f, "retract-wt", CLEAN_MUTATION, "nominated");
  assert.equal(cli(f, "promote", "toy-smoke", gen.genId).status, 0);
  const wt2 = path.join(f.root, "wt2");
  git(f, "worktree", "add", "-q", wt2, INCUMBENT_BRANCH);
  const run = cli(f, "retract", "toy-smoke", gen.genId, "--reason", "x");
  assert.equal(run.status, 1);
  assert.match(run.stderr + run.stdout, /checked out/);
  assert.equal(incumbentSha(f), gen.commitSha, "ref untouched while a linked worktree holds the branch");
});

test("retract echo hygiene: control bytes never reach stdout or the ledger file", async (t) => {
  const f = await gateFixture(t);
  const gen = await handSeal(f, "retract-evil", CLEAN_MUTATION, "nominated");
  assert.equal(cli(f, "promote", "toy-smoke", gen.genId).status, 0);
  const evil = cli(f, "retract", "toy-smoke", gen.genId, "--reason", "evil\n\u001b[31mred\u001b[0m reason");
  assert.equal(evil.status, 0, `evil reason: ${evil.stderr}`);
  assert.ok(!evil.stdout.includes("\u001b"), "raw ANSI never reaches stdout");
  const raw = readFileSync(path.join(f.repo, ".state", "abathur", "ledger.jsonl"), "utf8");
  assert.ok(!raw.includes("\u001b"), "no raw ESC byte in ledger text");
  const stored = rowsOfKind(f, "retract")[0]?.data as { reason: string };
  assert.equal(stored.reason, "evil\n\u001b[31mred\u001b[0m reason", "ledger stores verbatim (JSON-escaped on disk)");
});

test("gate locks: a live genome-lock holder blocks promote with a named pid (exit 2)", async (t) => {
  const f = await gateFixture(t);
  const gen = await handSeal(f, "lock-holder", CLEAN_MUTATION, "nominated");
  const lease = acquireGenomeLock({ ledger: Ledger.open(f.repo), configDir: f.configDir, genomeFp: f.entry.fingerprint });
  t.after(() => lease.release());
  const run = cli(f, "promote", "toy-smoke", gen.genId);
  assert.equal(run.status, 2, `promote while locked: ${run.stderr}`);
  assert.match(run.stderr + run.stdout, /held by live pid/);
  assert.equal(incumbentSha(f), null, "no ref movement while locked out");
});

test("gate locks: the repo-scoped gate lock contends across config homes", async (t) => {
  const f = await gateFixture(t);
  const gen = await handSeal(f, "repo-lock", CLEAN_MUTATION, "nominated");
  assert.equal(cli(f, "promote", "toy-smoke", gen.genId).status, 0);

  // a second config home registering the SAME repo (different genome lock, same gate lock)
  const configDir2 = path.join(f.root, "config2");
  mkdirSync(configDir2, { recursive: true });
  writeFileSync(path.join(configDir2, "config.jsonc"), '{ "opencodeBin": null }\n', "utf8");
  const doc = JSON.parse(readFileSync(path.join(f.repo, "genome.jsonc"), "utf8")) as Record<string, unknown>;
  doc["label"] = "toy-smoke";
  const spec2 = path.join(f.root, "private2.jsonc");
  writeFileSync(spec2, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  registerGenome(configDir2, spec2);

  const repoLease = acquireLock({ configDir: path.join(f.repo, ".state", "abathur"), key: "gate", label: "gate lock" });
  t.after(() => repoLease.release());
  const run = spawnSync(process.execPath, [CLI, "retract", "toy-smoke", gen.genId, "--reason", "x"], {
    env: { ...process.env, ABATHUR_CONFIG: path.join(configDir2, "config.jsonc"), HOME: path.join(f.root, "home") },
    encoding: "utf8",
    cwd: f.root,
  });
  assert.equal(run.status, 2, `retract via second config while gate-locked: ${run.stderr}`);
  assert.match(run.stderr + run.stdout, /gate lock 'gate' is held by live pid/);
  assert.equal(incumbentSha(f), gen.commitSha, "ref untouched while gate-locked");
  assert.equal(rowsOfKind(f, "retract").length, 0, "no row appended by the locked-out process");
});

test("retract refuses when the incumbent ref moved out-of-band after the promote", async (t) => {
  const f = await gateFixture(t);
  const gen = await handSeal(f, "diverge", CLEAN_MUTATION, "nominated");
  assert.equal(cli(f, "promote", "toy-smoke", gen.genId).status, 0);
  git(f, "update-ref", `refs/heads/${INCUMBENT_BRANCH}`, gen.parent); // rewind out-of-band
  const run = cli(f, "retract", "toy-smoke", gen.genId, "--reason", "x");
  assert.equal(run.status, 1);
  assert.match(run.stderr + run.stdout, /state diverged/);
  assert.equal(incumbentSha(f), gen.parent, "the moved ref is NOT deleted");
});

test("promote after retract refuses — a retracted gen stays dead (no re-promote lockup)", async (t) => {
  const f = await gateFixture(t);
  const gen = await handSeal(f, "re-promote", CLEAN_MUTATION, "nominated");
  assert.equal(cli(f, "promote", "toy-smoke", gen.genId).status, 0);
  assert.equal(cli(f, "retract", "toy-smoke", gen.genId, "--reason", "undo").status, 0);
  const again = cli(f, "promote", "toy-smoke", gen.genId);
  assert.equal(again.status, 1);
  assert.match(again.stderr + again.stdout, /already promoted/);
});

test("retract: a PRUNABLE worktree (deleted directory) does not block the rollback valve", async (t) => {
  const f = await gateFixture(t);
  const gen = await handSeal(f, "retract-prunable", CLEAN_MUTATION, "nominated");
  assert.equal(cli(f, "promote", "toy-smoke", gen.genId).status, 0);
  const wt2 = path.join(f.root, "wt-stale");
  git(f, "worktree", "add", "-q", wt2, INCUMBENT_BRANCH);
  rmSync(wt2, { recursive: true, force: true }); // directory gone, metadata stale ⇒ porcelain marks it prunable
  const list = spawnSync("git", ["-C", f.repo, "worktree", "list", "--porcelain"], { encoding: "utf8" });
  assert.match(list.stdout, /prunable/, "fixture sanity: git itself marks the stale worktree prunable");
  const run = cli(f, "retract", "toy-smoke", gen.genId, "--reason", "stale worktree must not block");
  assert.equal(run.status, 0, `retract: ${run.stderr}`);
  assert.equal(incumbentSha(f), null);
});

test("retract refuses while the incumbent branch is checked out", async (t) => {
  const f = await gateFixture(t);
  const gen = await handSeal(f, "retract-checkout", CLEAN_MUTATION, "nominated");
  assert.equal(cli(f, "promote", "toy-smoke", gen.genId).status, 0);
  git(f, "checkout", "-q", INCUMBENT_BRANCH);
  const run = cli(f, "retract", "toy-smoke", gen.genId, "--reason", "x");
  assert.equal(run.status, 1);
  assert.match(run.stderr + run.stdout, /checked out/i);
  assert.equal(incumbentSha(f), gen.commitSha, "ref untouched while checked out");
});

// -------------------------------------------------------------------- status

test("AC(d): status renders incumbent, generations, quarantine depth, budget; never fabricates", async (t) => {
  const f = await gateFixture(t);
  const virgin = cli(f, "status", "toy-smoke");
  assert.equal(virgin.status, 0);
  assert.match(virgin.stdout, /incumbent: none/, "no incumbent ⇒ literal 'none'");
  assert.match(virgin.stdout, /quarantine depth: 0/);
  assert.match(virgin.stdout, /pending-bench graft queue: 0/);

  const rows = await evolve(f);
  const mid = cli(f, "status", "toy-smoke");
  assert.equal(mid.status, 0);
  assert.match(mid.stdout, /incumbent: none/);
  assert.match(mid.stdout, /quarantine depth: 1/, "nominated-but-unpromoted fix-add is pending");
  for (const r of rows) assert.match(mid.stdout, new RegExp(`# ${r.genId}`), "every generation listed");
  assert.match(mid.stdout, /budget: candidates \d+\/\d+/);

  const nominated = rows.find((r) => r.data.verdict === "nominated");
  assert.ok(nominated !== undefined);
  assert.equal(cli(f, "promote", "toy-smoke", nominated.genId).status, 0);
  const after = cli(f, "status", "toy-smoke");
  assert.match(after.stdout, new RegExp(`incumbent: ${nominated.data.commitSha?.slice(0, 8)}`));
  assert.match(after.stdout, /last promote:/);
  assert.match(after.stdout, /quarantine depth: 0/);
  assert.ok(!/incumbent: none/.test(after.stdout), "never both none and a ref");
});

// ----------------------------------------------------------------- genome rm

test("genome rm: ledgerless genomes unregister (manifest stays), ledger history refuses", async (t) => {
  const f = await gateFixture(t);
  const unknown = cli(f, "genome", "rm", "ghost");
  assert.equal(unknown.status, 2);

  const noArgs = cli(f, "genome", "rm");
  assert.equal(noArgs.status, 2);

  const run = cli(f, "genome", "rm", "toy-smoke");
  assert.equal(run.status, 0, `ledgerless rm: ${run.stderr}${run.stdout}`);
  assert.ok(!existsSync(f.entry.registryFile), "registry entry removed");
  assert.ok(existsSync(manifestPathFor(f.configDir, f.entry.fingerprint)), "kernel manifest kept (archive-not-delete)");
  assert.ok(existsSync(path.join(f.repo, "genome.jsonc")), "repo untouched");
  assert.equal(readRegistry(f.configDir).entries.length, 0);

  // history appears once the genome has been run ⇒ rm must refuse
  const g = await gateFixture(t);
  await evolve(g);
  const refused = cli(g, "genome", "rm", "toy-smoke");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr + refused.stdout, /has ledger history — archive instead/);
  assert.ok(existsSync(g.entry.registryFile), "refusal removes nothing");

  // even an empty-but-existing ledger dir counts as history once rows exist;
  // a bare .state dir without the file is still ledgerless
  const h = await gateFixture(t);
  mkdirSync(path.join(h.repo, ".state", "abathur"), { recursive: true });
  const empty = cli(h, "genome", "rm", "toy-smoke");
  assert.equal(empty.status, 0, "no ledger rows ⇒ still removable");
});

// -------------------------------------------------------------- structural

test("structural: promote/retract cores are CLI-only; no auto-gate import path; no --force anywhere", () => {
  const importers: string[] = [];
  const scan = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name !== "node_modules") scan(p);
      } else if (ent.name.endsWith(".ts")) {
        if (/from\s+"(?:\.\.\/)*core\/promote\.js"/.test(readFileSync(p, "utf8"))) importers.push(p);
      }
    }
  };
  scan(path.join(REPO_ROOT, "src"));
  const relative = importers.map((p) => path.relative(REPO_ROOT, p).split(path.sep).join("/")).sort();
  assert.deepEqual(relative, ["src/commands/promote.ts"], "core/promote imported ONLY by commands/promote");
  const retractImporters: string[] = [];
  const scanRetract = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name !== "node_modules") scanRetract(p);
      } else if (ent.name.endsWith(".ts")) {
        const src = readFileSync(p, "utf8");
        if (/(?:from\s+|import\(\s*)["'](?:[^"']*\/)?core\/retract\.js["']|from\s+["']\.\/retract\.js["']/.test(src)) retractImporters.push(p);
      }
    }
  };
  scanRetract(path.join(REPO_ROOT, "src"));
  const relRetract = retractImporters.map((p) => path.relative(REPO_ROOT, p).split(path.sep).join("/")).sort();
  assert.deepEqual(relRetract, ["src/commands/retract.ts"], "core/retract imported ONLY by commands/retract");
  for (const rel of ["src/core/evolve/run-loop.ts", "src/core/evolve/reflect.ts", "src/core/evolve/candidate.ts"]) {
    assert.doesNotMatch(readFileSync(path.join(REPO_ROOT, rel), "utf8"), /from\s+"[^"]*promote\.js"/, `${rel} must not import promote`);
    assert.doesNotMatch(readFileSync(path.join(REPO_ROOT, rel), "utf8"), /from\s+"[^"]*retract\.js"/, `${rel} must not import retract`);
  }
  for (const gateFile of ["src/core/promote.ts", "src/core/retract.ts"]) {
    assert.doesNotMatch(readFileSync(path.join(REPO_ROOT, gateFile), "utf8"), /--force/, `no force flag in ${gateFile}`);
  }
  // the plugin tool allowlist must never grow a human gate (terminal-only class)
  const pluginSrc = readFileSync(path.join(REPO_ROOT, "plugin", "abathur.ts"), "utf8");
  const allowBlock = pluginSrc.match(/const ALLOWED_COMMANDS[\s\S]*?;/)?.[0] ?? "";
  assert.ok(allowBlock.length > 0, "ALLOWED_COMMANDS block must be found — a vacuous match tests nothing");
  for (const gate of ['"promote"', '"tombstone"', '"retract"']) {
    assert.ok(!allowBlock.includes(gate), `${gate} must NOT be plugin-reachable`);
  }
});
