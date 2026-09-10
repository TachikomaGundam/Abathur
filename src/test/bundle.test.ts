// Todo 12 AC pins (plan lines 165-172): lineage bundles — export + inspect with
// provenance + redacted train-only evidence.
//   AC happy: export a toy promoted lineage → inspect passes byte-for-byte,
//            re-export is deterministic;
//   AC tamper: flip one contained file byte → inspect exit 1 naming path + expected/actual sha;
//   AC mask-1: /opt/wiki-ops planted UNdeclared in rationale AND a transcript → export exits 1
//            naming member+line PRE-WRITE; no .tgz ever exists in --out afterwards;
//   AC mask-2: same literal DECLARED via spec bundle.maskLiterals → export/inspect pass,
//            bundle members carry the <MASKED-1> placeholder instead;
//   AC evidence: evidence/ carries train unit runIds only — a planted val transcript is
//            structurally excluded (export walks only train runIds);
//   AC lineage: manifest.genome.fingerprint != fingerprint(contained tree spec) (wrong-genome
//            import) → exit 1; unknown digest_algo → exit 2; garbage/truncated/evil-traversal
//            tar → exit 2, never a stack trace;
//   AC digest: manifest.benchDigest != digest recomputed from contained tree → exit 1;
//   dirty_worktree: uncommitted worktree edit → tree members + files[] follow the COMMIT,
//            never the worktree; --last N = N newest candidate rows, primary = max genId.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, chmodSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";

import { Ledger } from "../core/ledger.js";
import { benchDigest, fingerprint, genId } from "../core/ids.js";
import { newGeneration, openGenome, sealGeneration } from "../core/worktree.js";
import type { WorktreeEnv, WorktreeOptions } from "../core/genome-paths.js";
import { registerGenome, requireGenomesByLabel, fingerprint16 } from "../core/genome.js";
import type { RegistryEntry } from "../core/genome.js";
import { decodeGenerationRecord, type GenerationRowData } from "../core/evolve/run-bench.js";
import { runEvolution } from "../core/evolve/run-loop.js";
import { prepareToyGenome } from "../bench/toy.js";
import { loadGenomeSpecFile } from "../core/spec.js";
import { readTar, writeTar, TarError, type TarMember } from "../core/bundle-tar.js";
import { buildMaskPlan, scanMemberLeaks } from "../core/bundle-mask.js";

const CLI = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

const WIKI_LITERAL = "/opt/wiki-ops";

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
} else if (mode === "leaky") {
  out([
    { id: "fix-add", rationale: "fix add() per runbook " + ${JSON.stringify(WIKI_LITERAL)} + "/secrets", diffs: [lineDiff("units/add.mjs", FIX, "return a + b;")] },
  ]);
} else {
  process.stderr.write("stub: unknown mode\\n");
  process.exit(2);
}
`;

// ------------------------------------------------------------------ fixture

interface BundleFixture {
  readonly root: string;
  readonly configDir: string;
  readonly repo: string;
  readonly entry: RegistryEntry;
  readonly env: WorktreeEnv;
  readonly wopts: WorktreeOptions;
}

async function bundleFixture(t: TestContext, opts: { readonly maskLiterals?: readonly string[] } = {}): Promise<BundleFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "abathur-bundle-"));
  t.after(() => {
    spawnSync("rm", ["-rf", root], { encoding: "utf8" });
  });
  const configDir = path.join(root, "config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path.join(configDir, "config.jsonc"), '{ "opencodeBin": null }\n', "utf8");
  const repo = await prepareToyGenome(path.join(root, "genome"));
  if (opts.maskLiterals !== undefined) {
    const spec = loadGenomeSpecFile(path.join(repo, "genome.jsonc"));
    writeFileSync(
      path.join(repo, "genome.jsonc"),
      `${JSON.stringify({ ...spec, bundle: { maskLiterals: [...opts.maskLiterals] } }, null, 2)}\n`,
      "utf8",
    );
    // commit the edit: export self-describes from the gen COMMIT tree, so the
    // registry spec and the committed spec must agree by construction.
    gitC(repo, "-c", "user.name=abathur", "-c", "user.email=abathur@harness.local", "commit", "-am", "bundle: declare maskLiterals");
  }
  registerGenome(configDir, path.join(repo, "genome.jsonc"));
  const entry = requireGenomesByLabel(configDir, "toy-smoke").entries[0];
  if (entry === undefined) throw new Error("fixture: toy-smoke registration vanished");
  const stub = path.join(root, "stub.mjs");
  writeFileSync(stub, STUB_SOURCE, "utf8");
  chmodSync(stub, 0o755);
  const env: WorktreeEnv = { XDG_CACHE_HOME: path.join(root, "xdg-cache"), HOME: path.join(root, "home") };
  return { root, configDir, repo, entry, env, wopts: { env } };
}

function cliEnv(f: BundleFixture): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ABATHUR_CONFIG: path.join(f.configDir, "config.jsonc"),
    HOME: path.join(f.root, "home"),
    XDG_CACHE_HOME: path.join(f.root, "xdg-cache"),
  };
}

function cli(f: BundleFixture, ...args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [CLI, ...args], { env: cliEnv(f), encoding: "utf8", cwd: f.root });
}

function gitC(repo: string, ...args: string[]): string {
  const run = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout;
}

async function evolve(f: BundleFixture, mode = "three"): Promise<readonly Row[]> {
  const outcome = await runEvolution({
    entry: f.entry,
    configDir: f.configDir,
    mutatorCommand: `node ${path.join(f.root, "stub.mjs")} --mode ${mode} --dir {worktree} --brief {brief}`,
    env: f.env,
  });
  assert.equal(outcome.exitCode, 0, `fixture evolution must succeed: ${outcome.lines.join("\n")}`);
  return genRows(f);
}

interface Row {
  readonly genId: string;
  readonly data: GenerationRowData;
}

function genRows(f: BundleFixture): readonly Row[] {
  return Ledger.open(f.repo)
    .readAll()
    .filter((r) => r.kind === "generation_complete" && r.genId !== undefined)
    .map((r) => ({ genId: r.genId as string, data: decodeGenerationRecord(r) }));
}

function candidateRows(f: BundleFixture): readonly Row[] {
  return genRows(f).filter((r) => r.data.source === "candidate");
}

/** Plant a bench transcript exactly where the fixture adapter would have left it. */
function plantTranscript(f: BundleFixture, genIdStr: string, unitId: string, rep: number, lines: readonly string[]): string {
  const dir = path.join(f.configDir, "bench-sandboxes", "a-20260101T000000Z-fixture", genIdStr, `${unitId}-${String(rep)}`, ".bench", "transcripts");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${unitId}.jsonl`);
  writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  return file;
}

function bundleDir(f: BundleFixture): string {
  const dir = path.join(f.root, "bundles");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function listBundles(f: BundleFixture): string[] {
  return readdirSync(bundleDir(f)).filter((n) => n.endsWith(".bundle.tgz")).sort();
}

function readBundle(f: BundleFixture, name: string): Uint8Array {
  return readFileSync(path.join(bundleDir(f), name));
}

function membersOf(bytes: Uint8Array): Map<string, Uint8Array> {
  return new Map(readTar(bytes).map((m) => [m.path, m.content]));
}

function repack(f: BundleFixture, name: string, members: readonly TarMember[]): void {
  writeFileSync(path.join(bundleDir(f), name), gzip(writeTar(members)));
}

import { gunzipSync, gzipSync } from "node:zlib";

const gzip = (u: Uint8Array): Uint8Array => new Uint8Array(gzipSync(u));

function ungzip(f: BundleFixture, name: string): Uint8Array {
  return new Uint8Array(gunzipSync(readBundle(f, name)));
}

function manifestOf(f: BundleFixture, name: string): Record<string, unknown> {
  const m = membersOf(ungzip(f, name)).get("manifest.json");
  if (m === undefined) throw new Error("bundle has no manifest.json");
  return JSON.parse(new TextDecoder().decode(m)) as Record<string, unknown>;
}

const sha256Hex = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

/** Replace/insert one member; rePin=false leaves the manifest pins stale (byte-flip AC). */
function tamperMember(f: BundleFixture, name: string, memberPath: string, content: Uint8Array, rePin = true): void {
  const members = readTar(ungzip(f, name));
  const next = members
    .filter((m) => m.path !== memberPath)
    .concat([{ path: memberPath, content }]);
  if (memberPath !== "manifest.json" && rePin) {
    const manifest = members.find((m) => m.path === "manifest.json");
    if (manifest === undefined) throw new Error("bundle has no manifest.json");
    const doc = JSON.parse(new TextDecoder().decode(manifest.content)) as {
      files: { path: string; sha256: string; len: number }[];
    };
    const entry = doc.files.find((x) => x.path === memberPath);
    if (entry !== undefined) {
      entry.sha256 = sha256Hex(content);
      entry.len = content.length;
      const rewritten = new TextEncoder().encode(`${JSON.stringify(doc, null, 2)}\n`);
      repack(f, name, next.map((m) => (m.path === "manifest.json" ? { path: m.path, content: rewritten } : m)));
      return;
    }
  }
  repack(f, name, next);
}

/** Hand-built tar: writer refuses traversal, so craft the evil header directly. */
function tarWithRawHeader(badName: string): Uint8Array {
  const enc = new TextEncoder();
  const header = new Uint8Array(512);
  header.set(enc.encode(badName), 0);
  header.set(enc.encode("0000644\x00"), 100);
  header.set(enc.encode("0000000\x00"), 108);
  header.set(enc.encode("0000000\x00"), 116);
  header.set(enc.encode("00000000001\x00"), 124);
  header.set(enc.encode("00000000000\x00"), 136);
  header.set(new Uint8Array(8).fill(0x20), 148);
  header[156] = 0x30;
  header.set(enc.encode("ustar\x00"), 257);
  header.set(enc.encode("00"), 263);
  let sum = 0;
  for (const b of header) sum += b;
  header.set(enc.encode((sum & 0o777777).toString(8).padStart(6, "0") + "\0 "), 148);
  const blocks = [header, new Uint8Array(512).fill(0x78), new Uint8Array(512), new Uint8Array(512)];
  const out = new Uint8Array(512 * 4);
  let off = 0;
  for (const b of blocks) {
    out.set(b, off);
    off += 512;
  }
  return out;
}

// ------------------------------------------------------------- pure units

test("ids.benchDigest: reorder-stable, content-sensitive, config-sensitive", () => {
  const base = {
    units: [
      { unitId: "a", content: "AAA" },
      { unitId: "b", content: "BBB" },
    ],
    scripts: [{ path: "grader.mjs", content: "grade" }],
    graderCommand: "node grader.mjs {unit.path}",
    runCommand: "node {unit.path}",
    timeoutS: 10,
  };
  const d1 = benchDigest(base);
  const d2 = benchDigest({ ...base, units: [...base.units].reverse() });
  assert.equal(d1, d2, "unit order must not move the digest");
  assert.match(d1, /^[0-9a-f]{64}$/);
  assert.notEqual(
    d1,
    benchDigest({ ...base, scripts: [{ path: "grader.mjs", content: "grade v2" }] }),
    "grader content must move the digest",
  );
  assert.notEqual(
    d1,
    benchDigest({ ...base, scripts: [...base.scripts, { path: "seed.mjs", content: "s1" }] }),
    "seed script content must move the digest",
  );
  assert.notEqual(d1, benchDigest({ ...base, timeoutS: 11 }), "timeout must move the digest");
  assert.notEqual(
    d1,
    benchDigest({ ...base, agentModel: "m1", judgeModel: "j1", judgeCommand: "node judge.mjs" }),
    "models/judge must move the digest",
  );
});

test("bundle-tar: roundtrip, long names, traversal + garbage refused", () => {
  const members: TarMember[] = [
    { path: "manifest.json", content: new TextEncoder().encode("{}\n") },
    { path: "trees/g-x/units/add.mjs", content: new TextEncoder().encode("export function add(a: number, b: number) { return a + b; }\n") },
    { path: `deep/dir/${"x".repeat(120)}/file.txt`, content: new TextEncoder().encode("ok\n") },
  ];
  const bytes = writeTar(members);
  const back = readTar(bytes);
  assert.deepEqual(back.map((m) => m.path), members.map((m) => m.path));
  assert.deepEqual(Buffer.from(back[1]?.content ?? new Uint8Array()), Buffer.from(members[1]?.content ?? new Uint8Array()));

  assert.throws(() => writeTar([{ path: "../evil", content: new Uint8Array() }]), TarError);
  assert.throws(() => writeTar([{ path: "/etc/passwd", content: new Uint8Array() }]), TarError);
  assert.throws(() => readTar(new Uint8Array([1, 2, 3, 4, 5])), TarError);
  const good = writeTar(members);
  assert.throws(() => readTar(good.slice(0, good.length - 17)), TarError, "truncated tar must be refused");
  const corrupt = Uint8Array.from(good);
  corrupt[148] = corrupt[148] === 0x31 ? 0x32 : 0x31; // flip a header byte → bad checksum
  assert.throws(() => readTar(corrupt), TarError);
});

test("bundle-tar: non-ASCII member names round-trip byte-exact (PAX override, not USTAR mangling)", () => {
  const members: TarMember[] = [
    { path: "manifest.json", content: new TextEncoder().encode("{}\n") },
    { path: "ünï/данные.txt", content: new TextEncoder().encode("unicode member ✓\n") },
    { path: `ünï/${"данные".repeat(12)}.txt`, content: new TextEncoder().encode("short non-ascii\n") },
    { path: `${"ünï".repeat(30)}/leaf-ü.txt`, content: new TextEncoder().encode("split-prefixed non-ascii\n") },
  ];
  const back = readTar(writeTar(members));
  assert.deepEqual(back.map((m) => m.path), members.map((m) => m.path));
  for (const want of members) {
    const got = back.find((m) => m.path === want.path);
    assert.ok(got !== undefined, `member ${want.path} missing after roundtrip`);
    assert.deepEqual(Buffer.from(got.content), Buffer.from(want.content), `${want.path} content must be byte-exact`);
  }
});

test("bundle-mask: declared literals → placeholders; undeclared machine paths leak-flag with line", () => {
  const plan = buildMaskPlan({ home: "/srv/home-alice", repoPath: "/work/genome", extra: [WIKI_LITERAL] });
  const masked = plan.mask("at /srv/home-alice/x in /work/genome and see /opt/wiki-ops/runbook");
  assert.equal(masked, "at <HOME>/x in <GENOME> and see <MASKED-1>/runbook");
  // undeclared literal is a leak; declared one is clean
  const leak = scanMemberLeaks("line one\nsecond /srv/home-alice line", plan, "/home/other", "/work/other");
  assert.ok(leak !== null && leak !== undefined);
  assert.equal(leak.line, 2);
  assert.match(leak.snippet, /\/srv\/home-alice/);
  // after masking, the same text is clean
  assert.equal(scanMemberLeaks(plan.mask(`line one\nsecond ${WIKI_LITERAL} line`), plan, "/home/other", "/work/other"), null);
  // a DECLARED literal surviving masking is still a leak (fail-closed double gate)
  assert.ok(scanMemberLeaks(`second ${WIKI_LITERAL} line`, plan, "/home/other", "/work/other") !== null);
  assert.equal(scanMemberLeaks("plain text", plan, "/home/other", "/work/other"), null);
  // a generic machine path that is NOT a declared literal still leaks (fail-closed)
  assert.ok(scanMemberLeaks("x /etc/shadow", plan, "/home/other", "/work/other") !== null);
});

// --------------------------------------------------------- AC: happy path

test("AC(happy): export promoted lineage → inspect OK, manifest exact, deterministic re-export", async (t) => {
  const f = await bundleFixture(t);
  const rows = await evolve(f);
  const nominated = rows.find((r) => r.data.verdict === "nominated");
  assert.ok(nominated !== undefined && nominated.data.commitSha !== undefined);
  assert.equal(cli(f, "promote", "toy-smoke", nominated.genId).status, 0);

  const out = bundleDir(f);
  const run = cli(f, "bundle", "export", "toy-smoke", "--gen", nominated.genId, "--out", out);
  assert.equal(run.status, 0, `export: ${run.stderr}`);
  const expected = `abathur-${f.entry.fingerprint}-${nominated.genId}.bundle.tgz`;
  assert.deepEqual(listBundles(f), [expected]);
  assert.match(run.stdout, new RegExp(expected));

  const insp = cli(f, "bundle", "inspect", path.join(out, expected));
  assert.equal(insp.status, 0, `inspect: ${insp.stderr}${insp.stdout}`);
  assert.match(insp.stdout, /inspect.*OK/i);

  const m = manifestOf(f, expected);
  assert.deepEqual(Object.keys(m), [
    "schema_version", "digest_algo", "genome", "parent", "benchDigest", "benchProvenance",
    "budgetCounters", "stats", "sealedGlobs", "files", "rationale", "frictionDigests",
  ]);
  assert.equal(m.schema_version, 1);
  assert.equal(m.digest_algo, "sha256-canonical-v1");
  assert.deepEqual(Object.keys(m.benchProvenance as object), [
    "opencodeVersion", "agentModel", "adapterConfigDigest", "fixtureSeedId",
    "judgeModel", "mutatorModel", "nRepeats", "statsConfigDigest",
  ]);
  assert.equal((m.genome as { label: string }).label, "toy-smoke");
  assert.equal((m.genome as { fingerprint: string }).fingerprint, fingerprint(f.entry.spec));
  assert.equal(m.parent, nominated.data.headCommit);
  assert.equal(m.rationale, nominated.data.rationale);
  assert.deepEqual(m.budgetCounters, nominated.data.counters);
  assert.deepEqual((m.stats as { matrix: unknown }).matrix, nominated.data.units);
  assert.deepEqual(m.sealedGlobs, ["grader.mjs"]);
  assert.deepEqual(m.frictionDigests, []);

  const members = membersOf(ungzip(f, expected));
  // every non-manifest member is sha-pinned in files[] and hashes true
  const files = m.files as { path: string; sha256: string; len: number }[];
  const pinned = new Set(files.map((x) => x.path));
  for (const mpath of members.keys()) {
    if (mpath === "manifest.json") continue;
    assert.ok(pinned.has(mpath), `member ${mpath} must be pinned`);
  }
  for (const x of files) {
    const mem = members.get(x.path);
    assert.ok(mem !== undefined, `pinned member ${x.path} missing from bundle`);
    assert.equal(x.sha256, sha256Hex(mem));
    assert.equal(x.len, mem.length);
  }
  assert.ok(members.has("README.md"));
  assert.ok(members.has(`trees/${nominated.genId}/units/add.mjs`));
  assert.ok(members.has("patch.diff"));

  // deterministic re-export: byte-identical bundle
  const first = readBundle(f, expected);
  assert.equal(cli(f, "bundle", "export", "toy-smoke", "--gen", nominated.genId, "--out", out).status, 0);
  assert.deepEqual(Buffer.from(readBundle(f, expected)), Buffer.from(first), "re-export must be byte-identical");
});

test("AC(tamper): one flipped byte inside patch.diff → inspect exit 1 naming path + expected/actual sha", async (t) => {
  const f = await bundleFixture(t);
  const rows = await evolve(f);
  const nominated = rows.find((r) => r.data.verdict === "nominated");
  assert.ok(nominated !== undefined);
  assert.equal(cli(f, "bundle", "export", "toy-smoke", "--gen", nominated.genId, "--out", bundleDir(f)).status, 0);
  const name = listBundles(f)[0] as string;

  const original = readTar(ungzip(f, name)).find((m) => m.path === "patch.diff");
  assert.ok(original !== undefined);
  const flipped = Uint8Array.from(original.content);
  flipped[10] = flipped[10] === 0x61 ? 0x62 : 0x61; // flip a byte, keep the length identical
  tamperMember(f, name, "patch.diff", flipped, false);

  const insp = cli(f, "bundle", "inspect", path.join(bundleDir(f), name));
  assert.equal(insp.status, 1);
  const err = insp.stderr + insp.stdout;
  assert.match(err, /patch\.diff/);
  assert.match(err, new RegExp(`expected ${sha256Hex(original.content)}`));
  assert.match(err, new RegExp(`actual ${sha256Hex(flipped)}`));
});

// ------------------------------------------------------------ AC: masking

test("AC(pre-write refusal): undeclared /opt/wiki-ops in rationale AND transcript → exit 1, nothing written", async (t) => {
  const f = await bundleFixture(t);
  const rows = await evolve(f, "leaky");
  const gen = rows[rows.length - 1];
  assert.ok(gen !== undefined);
  plantTranscript(f, gen.genId, "add", 0, [
    '{"role":"user","text":"hi"}',
    `{"role":"assistant","text":"consult ${WIKI_LITERAL}/runbook"}`,
  ]);

  const run = cli(f, "bundle", "export", "toy-smoke", "--gen", gen.genId, "--out", bundleDir(f));
  assert.equal(run.status, 1, `leaking export must be refused: ${run.stdout}`);
  const err = run.stderr;
  assert.match(err, /manifest\.json:\d+/, "names the manifest member + line");
  assert.match(err, /evidence\/[^\s:]+:\d+/, "names the evidence member + line");
  assert.deepEqual(listBundles(f), [], "a leaking bundle must never be written");
});

test("AC(masked success): literal declared via spec bundle.maskLiterals → placeholders in every member", async (t) => {
  const f = await bundleFixture(t, { maskLiterals: [WIKI_LITERAL] });
  const rows = await evolve(f, "leaky");
  const gen = rows[rows.length - 1];
  assert.ok(gen !== undefined);
  const home = path.join(f.root, "home");
  plantTranscript(f, gen.genId, "add", 0, [`{"cwd":"${home}/x","note":"${WIKI_LITERAL}/runbook"}`]);

  assert.equal(cli(f, "bundle", "export", "toy-smoke", "--gen", gen.genId, "--out", bundleDir(f)).status, 0);
  const name = listBundles(f)[0] as string;
  assert.equal(cli(f, "bundle", "inspect", path.join(bundleDir(f), name)).status, 0, "declared literal is masked, not leaked");

  for (const mem of readTar(ungzip(f, name))) {
    const text = new TextDecoder().decode(mem.content);
    if (mem.path.startsWith("trees/")) continue;
    assert.ok(!text.includes(WIKI_LITERAL), `${mem.path} must not carry the declared literal`);
    assert.ok(!text.includes(home), `${mem.path} must not carry HOME`);
  }
  const ev = readTar(ungzip(f, name)).find((x) => x.path.startsWith("evidence/"));
  assert.ok(ev !== undefined);
  assert.match(new TextDecoder().decode(ev.content), /<MASKED-1>/);
  assert.match(new TextDecoder().decode(ev.content), /<HOME>/);
});

// ----------------------------------------------------------- AC: evidence

test("AC(evidence): only train runIds are walked — planted val transcript structurally excluded", async (t) => {
  const f = await bundleFixture(t);
  const rows = await evolve(f);
  const nominated = rows.find((r) => r.data.verdict === "nominated");
  assert.ok(nominated !== undefined);
  const addRun = nominated.data.units.find((u) => u.unitId === "add");
  const subRun = nominated.data.units.find((u) => u.unitId === "sub");
  assert.ok(addRun !== undefined && subRun !== undefined, "toy row carries train add and val sub");
  assert.ok(addRun.runIds.length > 0 && subRun.runIds.length > 0);

  plantTranscript(f, nominated.genId, "add", 0, ['{"role":"user","text":"train scenario line"}']);
  plantTranscript(f, nominated.genId, "sub", 0, ['{"role":"user","text":"VAL-SECRET scenario line"}']);

  assert.equal(cli(f, "bundle", "export", "toy-smoke", "--gen", nominated.genId, "--out", bundleDir(f)).status, 0);
  const name = listBundles(f)[0] as string;
  const members = readTar(ungzip(f, name));

  const evidence = members.filter((m) => m.path.startsWith("evidence/"));
  assert.ok(evidence.length >= 1, "train transcript made it into evidence/");
  const trainRunId = addRun.runIds[0] as string;
  const valRunId = subRun.runIds[0] as string;
  assert.ok(evidence.some((m) => m.path.endsWith(`${trainRunId}.jsonl`)));
  for (const m of evidence) {
    assert.ok(!m.path.includes("-sub-"), `evidence member ${m.path} references a val unit`);
    assert.ok(!new TextDecoder().decode(m.content).includes("VAL-SECRET"));
  }
  assert.ok(!members.some((m) => m.path.includes(valRunId)), "val runId never appears as a member path");
  assert.equal(cli(f, "bundle", "inspect", path.join(bundleDir(f), name)).status, 0);
});

test("AC(evidence cap): >2MiB train transcript → export refuses naming the member, no truncation", async (t) => {
  const f = await bundleFixture(t);
  const rows = await evolve(f);
  const nominated = rows.find((r) => r.data.verdict === "nominated");
  assert.ok(nominated !== undefined);
  plantTranscript(f, nominated.genId, "add", 0, ["x".repeat(2 * 1024 * 1024 + 10)]);
  const run = cli(f, "bundle", "export", "toy-smoke", "--gen", nominated.genId, "--out", bundleDir(f));
  assert.equal(run.status, 1);
  assert.match(run.stderr, /evidence\/[^\s]*add-0[^\s]*|2 ?MiB|cap/i);
  assert.deepEqual(listBundles(f), []);
});

// -------------------------------------------------------- AC: self-consistency

test("AC(wrong genome): swapped tree spec → fingerprint self-consistency fails exit 1", async (t) => {
  const f1 = await bundleFixture(t);
  const rows1 = await evolve(f1);
  const n1 = rows1.find((r) => r.data.verdict === "nominated");
  assert.ok(n1 !== undefined);
  assert.equal(cli(f1, "bundle", "export", "toy-smoke", "--gen", n1.genId, "--out", bundleDir(f1)).status, 0);
  const name1 = listBundles(f1)[0] as string;

  const f2 = await bundleFixture(t);
  const rows2 = await evolve(f2);
  const n2 = rows2[rows2.length - 1];
  assert.ok(n2 !== undefined);
  assert.equal(cli(f2, "bundle", "export", "toy-smoke", "--gen", n2.genId, "--out", bundleDir(f2)).status, 0);
  const f2Members = membersOf(ungzip(f2, listBundles(f2)[0] as string));
  const foreignSpec = f2Members.get(`trees/${String(n2?.genId)}/genome.jsonc`);
  assert.ok(foreignSpec !== undefined);
  assert.notEqual(fingerprint16(f1.entry.spec), fingerprint16(f2.entry.spec), "two toy instances differ by repoPath");

  tamperMember(f1, name1, `trees/${n1.genId}/genome.jsonc`, foreignSpec);
  const insp = cli(f1, "bundle", "inspect", path.join(bundleDir(f1), name1));
  assert.equal(insp.status, 1);
  assert.match(insp.stderr + insp.stdout, /fingerprint/i, "wrong-genome import is detected");
});

test("AC(digest recompute): manifest.benchDigest disagreeing with contained tree → exit 1", async (t) => {
  const f = await bundleFixture(t);
  const rows = await evolve(f);
  const nominated = rows.find((r) => r.data.verdict === "nominated");
  assert.ok(nominated !== undefined);
  assert.equal(cli(f, "bundle", "export", "toy-smoke", "--gen", nominated.genId, "--out", bundleDir(f)).status, 0);
  const name = listBundles(f)[0] as string;

  const members = readTar(ungzip(f, name));
  const manifest = members.find((m) => m.path === "manifest.json");
  assert.ok(manifest !== undefined);
  const doc = JSON.parse(new TextDecoder().decode(manifest.content)) as Record<string, unknown>;
  const real = doc.benchDigest as string;
  doc.benchDigest = real.replace(/[0-9a-f]$/, real.endsWith("0") ? "1" : "0");
  const rewritten = new TextEncoder().encode(`${JSON.stringify(doc, null, 2)}\n`);
  repack(f, name, members.map((m) => (m.path === "manifest.json" ? { path: m.path, content: rewritten } : m)));

  const insp = cli(f, "bundle", "inspect", path.join(bundleDir(f), name));
  assert.equal(insp.status, 1);
  assert.match(insp.stderr + insp.stdout, /benchDigest/i);
});

test("AC(unknown digest_algo): → exit 2 cannot-answer, not a failure claim", async (t) => {
  const f = await bundleFixture(t);
  const rows = await evolve(f);
  const nominated = rows.find((r) => r.data.verdict === "nominated");
  assert.ok(nominated !== undefined);
  assert.equal(cli(f, "bundle", "export", "toy-smoke", "--gen", nominated.genId, "--out", bundleDir(f)).status, 0);
  const name = listBundles(f)[0] as string;

  const members = readTar(ungzip(f, name));
  const manifest = members.find((m) => m.path === "manifest.json");
  assert.ok(manifest !== undefined);
  const doc = JSON.parse(new TextDecoder().decode(manifest.content)) as Record<string, unknown>;
  doc.digest_algo = "sha256-v0";
  const rewritten = new TextEncoder().encode(`${JSON.stringify(doc, null, 2)}\n`);
  repack(f, name, members.map((m) => (m.path === "manifest.json" ? { path: m.path, content: rewritten } : m)));

  const insp = cli(f, "bundle", "inspect", path.join(bundleDir(f), name));
  assert.equal(insp.status, 2);
  assert.match(insp.stderr, /digest_algo|sha256-v0/);
});

// ---------------------------------------------------------- adversarial I/O

test("malformed_input: garbage file, truncated tgz, evil traversal tar → exit 2, never a stack trace", async (t) => {
  const f = await bundleFixture(t);
  const dir = bundleDir(f);

  const junk = path.join(dir, "junk.bundle.tgz");
  writeFileSync(junk, Buffer.from("this is not a gzip stream at all"));
  const r1 = cli(f, "bundle", "inspect", junk);
  assert.equal(r1.status, 2);
  assert.ok(!r1.stderr.includes("    at "), "no stack trace");

  const rows = await evolve(f);
  const nominated = rows.find((r) => r.data.verdict === "nominated");
  assert.ok(nominated !== undefined);
  assert.equal(cli(f, "bundle", "export", "toy-smoke", "--gen", nominated.genId, "--out", dir).status, 0);
  const good = readBundle(f, listBundles(f)[0] as string);
  const trunc = path.join(dir, "trunc.bundle.tgz");
  writeFileSync(trunc, Buffer.from(good.slice(0, Math.floor(good.length / 2))));
  const r2 = cli(f, "bundle", "inspect", trunc);
  assert.equal(r2.status, 2);
  assert.ok(!r2.stderr.includes("    at "));

  const evil = path.join(dir, "evil.bundle.tgz");
  const evilBytes = tarWithRawHeader("../../../tmp/abathur-evil-probe");
  writeFileSync(evil, gzip(evilBytes));
  const r3 = cli(f, "bundle", "inspect", evil);
  assert.equal(r3.status, 2);
  assert.match(r3.stderr, /traversal|unsafe|member/i);
  assert.ok(!existsSync(path.join(os.tmpdir(), "abathur-evil-probe")), "evil member must never be materialised");

  const r4 = cli(f, "bundle", "inspect", path.join(dir, "does-not-exist.bundle.tgz"));
  assert.equal(r4.status, 2);
});

test("dirty_worktree: bundle follows the commit tree, never the uncommitted worktree", async (t) => {
  const f = await bundleFixture(t);
  const rows = await evolve(f);
  const nominated = rows.find((r) => r.data.verdict === "nominated");
  assert.ok(nominated !== undefined && nominated.data.commitSha !== undefined);
  writeFileSync(path.join(f.repo, "units", "mul.mjs"), "// DIRTY WORKTREE EDIT — must not reach the bundle\n", "utf8");

  assert.equal(cli(f, "bundle", "export", "toy-smoke", "--gen", nominated.genId, "--out", bundleDir(f)).status, 0);
  const name = listBundles(f)[0] as string;
  const members = membersOf(ungzip(f, name));
  const mul = members.get(`trees/${nominated.genId}/units/mul.mjs`);
  assert.ok(mul !== undefined);
  const committed = new TextEncoder().encode(gitC(f.repo, "show", `${String(nominated.data.commitSha)}:units/mul.mjs`));
  assert.deepEqual(Buffer.from(mul), Buffer.from(committed));
  assert.ok(!new TextDecoder().decode(mul).includes("DIRTY WORKTREE"));

  const m = manifestOf(f, name);
  const pin = (m.files as { path: string; sha256: string }[]).find((x) => x.path === `trees/${String(nominated.genId)}/units/mul.mjs`);
  assert.ok(pin !== undefined);
  assert.equal(pin.sha256, sha256Hex(committed));
  assert.equal(cli(f, "bundle", "inspect", path.join(bundleDir(f), name)).status, 0);
});

// ------------------------------------------------------------ --last / lineage

test("stale_state: --last N picks the N newest candidate gens; primary = newest; --gen re-selects", async (t) => {
  const f = await bundleFixture(t);
  await evolve(f); // two candidate gens (annotate culled + fix-add nominated)
  const cands = candidateRows(f);
  assert.equal(cands.length, 2);

  const r1 = cli(f, "bundle", "export", "toy-smoke", "--last", "2", "--out", bundleDir(f));
  assert.equal(r1.status, 0, r1.stderr);
  const name = listBundles(f)[0] as string;
  const ids = [...cands].sort((a, b) => (a.genId < b.genId ? -1 : 1)).map((r) => r.genId);
  assert.equal(name, `abathur-${f.entry.fingerprint}-${ids.join("_")}.bundle.tgz`);
  const m = manifestOf(f, name);
  const primary = cands.find((r) => r.genId === ids[1]);
  assert.ok(primary !== undefined);
  assert.equal(m.parent, primary.data.headCommit, "manifest describes the newest gen");
  assert.equal(m.rationale, primary.data.rationale);
  const members = readTar(ungzip(f, name));
  for (const id of ids) assert.ok(members.some((x) => x.path.startsWith(`trees/${id}/`)), `tree for ${id} shipped`);
  assert.ok(members.some((x) => x.path === "lineage.json"));
  assert.equal(cli(f, "bundle", "inspect", path.join(bundleDir(f), name)).status, 0);

  const r2 = cli(f, "bundle", "export", "toy-smoke", "--last", "5", "--out", bundleDir(f));
  assert.equal(r2.status, 0, `--last beyond history clamps: ${r2.stderr}`);
  assert.equal(listBundles(f).length, 1, "same selection ⇒ same file");

  // a third generation lands ⇒ --last 1 follows the ledger, never a stale choice
  const third = await handSeal(f, "bundle-third", { file: "units/mul.mjs", append: "\n// third\n" }, "culled");
  const r3 = cli(f, "bundle", "export", "toy-smoke", "--last", "1", "--out", bundleDir(f));
  assert.equal(r3.status, 0, r3.stderr);
  assert.ok(listBundles(f).some((n) => n.endsWith(`-${third.genId}.bundle.tgz`)), "newest gen picked");

  const bad = cli(f, "bundle", "export", "toy-smoke", "--gen", "g-20200101T000000Z-deadbeef", "--out", bundleDir(f));
  assert.equal(bad.status, 2, "no-data gen miss is cannot-answer, not a recorded decision");
  assert.match(bad.stderr + bad.stdout, /g-20200101T000000Z-deadbeef/, "unknown genId is NAMED");
});

test("AC(tamper-ledger): non-path-safe genId in a ledger row blocks export naming it, nothing written", async (t) => {
  const f = await bundleFixture(t);
  const rows = await evolve(f);
  const nominated = rows.find((r) => r.data.verdict === "nominated");
  assert.ok(nominated !== undefined && nominated.data.commitSha !== undefined);
  const evil = "../../evil";
  // hand-append a tampered candidate row through the real ledger API — the ledger
  // schema only requires a non-empty string, so the export path is the gate.
  // Real commit shas: the evil genId alone must decide the outcome.
  Ledger.open(f.repo).append({
    kind: "generation_complete",
    genId: evil,
    data: {
      source: "candidate",
      candidateId: "hand-evil",
      rationale: "tampered row",
      headCommit: nominated.data.headCommit,
      commitSha: nominated.data.commitSha,
      treeSha: nominated.data.treeSha ?? "2".repeat(40),
      complete: true,
      reps: 1,
      units: [],
      counters: { candidates: 1, modelCalls: 0, tokens: 0, wallS: 0 },
      manifest: [],
      verdict: "nominated",
      benchProvenance: { benchType: "toy", versions: [{ bin: "node", version: process.version }] },
    },
  });

  const run = cli(f, "bundle", "export", "toy-smoke", "--gen", evil, "--out", bundleDir(f));
  assert.equal(run.status, 1, `path-unsafe genId must block: ${run.stdout}${run.stderr}`);
  assert.match(run.stderr, /path-safe/, "refuses as the PATH_SAFE gate");
  assert.match(run.stderr + run.stdout, /\.\.\/\.\.\/evil/, "names the offending genId");
  assert.ok(!run.stderr.includes("    at "), `no stack trace: ${run.stderr}`);
  assert.deepEqual(listBundles(f), [], "nothing written");
});

async function handSeal(
  f: BundleFixture,
  tag: string,
  mutation: { readonly file: string; readonly append: string },
  verdict: GenerationRowData["verdict"],
): Promise<{ genId: string }> {
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
    benchProvenance: { benchType: "toy", versions: [{ bin: "node", version: process.version }] },
  };
  Ledger.open(f.repo).append({ kind: "generation_complete", genId: id, data });
  return { genId: id };
}

// -------------------------------------------------------------- CLI seam

test("CLI seam: usage errors are exit 2; router keeps bundle slot; help lists bundle", async (t) => {
  const f = await bundleFixture(t);
  assert.equal(cli(f, "bundle").status, 2);
  assert.ok(
    !cli(f, "bundle").stderr.includes("not implemented yet"),
    "bundle group must be wired, not pending",
  );
  assert.equal(cli(f, "bundle", "frobnicate").status, 2);
  assert.equal(cli(f, "bundle", "export", "toy-smoke", "--gen", "g-x").status, 2, "--out required");
  assert.equal(
    cli(f, "bundle", "export", "toy-smoke", "--gen", "g-x", "--last", "1", "--out", bundleDir(f)).status,
    2,
    "--gen XOR --last",
  );
  assert.equal(cli(f, "bundle", "export", "ghost-label", "--last", "1", "--out", bundleDir(f)).status, 2);
  assert.equal(cli(f, "bundle", "inspect").status, 2, "path required");

  const help = cli(f, "--help");
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^ {2}bundle {2}/m);
});
