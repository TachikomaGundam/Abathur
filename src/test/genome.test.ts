// Todo 4 acceptance pins: GenomeSpec schema, out-of-tree genome registry, and the
// sealed-path kernel manifest (TDD RED first — plan protocol). Given/When/Then
// throughout; every fixture lives in a per-run mkdtemp tmpdir removed via t.after.
// Registry/manifest paths stay under <configDir> (ABATHUR_CONFIG parent), never
// inside a genome repo tree — that isolation is itself pinned here.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { ExitSignal } from "../exit.js";
import { canonicalJson, fingerprint } from "../core/ids.js"; // todo 2 owns canonical JSON
import {
  fingerprint16,
  readRegistry,
  registerGenome,
  requireGenomesByLabel,
  type RegistryEntry,
} from "../core/genome.js";
import {
  auditKernel,
  buildManifest,
  compareManifest,
  serializeManifest,
  type ManifestEntry,
} from "../core/kernel.js";
import { loadGenomeSpecFile } from "../core/spec.js";
import { compileGlob, filesMatching, listFiles } from "../core/glob.js";

const cliPath = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

// ------------------------------------------------------------------- fixtures

async function freshDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), `abathur-${prefix}-`));
}

function keep(t: TestContext, dir: string): string {
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** Plain working-tree fixture repo (kernel seals match WORKING-TREE files). */
async function makeRepo(t: TestContext): Promise<string> {
  const root = keep(t, await freshDir("repo"));
  await writeFile(path.join(root, "kernel.mjs"), "export const frozen = 1;\n", "utf8");
  await writeFile(path.join(root, "README.md"), "# fixture genome\n", "utf8");
  await mkdir(path.join(root, "secrets"), { recursive: true });
  await writeFile(path.join(root, "secrets", "key.pem"), "PRIVATE\n", "utf8");
  await mkdir(path.join(root, "evolve"), { recursive: true });
  await writeFile(path.join(root, "evolve", "hot.ts"), "export const hot = 2;\n", "utf8");
  return root;
}

/** Writable config home: ABATHUR_CONFIG inside, so resolveConfigDir() is isolated. */
async function makeEnv(t: TestContext): Promise<{ configDir: string; env: NodeJS.ProcessEnv }> {
  const home = keep(t, await freshDir("home"));
  const configDir = path.join(home, ".config", "abathur");
  await mkdir(configDir, { recursive: true });
  const configPath = path.join(configDir, "config.jsonc");
  await writeFile(configPath, "// isolated test config\n{}\n", "utf8");
  return { configDir, env: { ...process.env, ABATHUR_CONFIG: configPath, HOME: home } };
}

function baseSpec(repoRoot: string): Record<string, unknown> {
  return {
    label: "fixture-genome",
    repoPath: repoRoot,
    bench: {
      type: "toy",
      units: [
        { id: "t1", path: "bench/t1.json", split: "train" },
        { id: "v1", path: "bench/v1.json", split: "val" },
      ],
      seedCommand: "echo seed",
      runCommand: "abathur-bench run {unit.path}",
      graderCommand: "abathur-bench grade {unit.path}",
      timeoutS: 120,
      stats: { halfWidth: 0.05, minEffect: 0.1, nReps: { initial: 3, max: 9 } },
    },
    budget: { maxCandidates: 8, maxModelCalls: 64, maxTokens: 2000000, maxWallS: 3600 },
    kernel: { immutableGlobs: ["kernel.mjs", "secrets/**"] },
  };
}

async function writeSpec(
  t: TestContext,
  name: string,
  spec: Record<string, unknown>,
): Promise<string> {
  const dir = keep(t, await freshDir("specs"));
  const file = path.join(dir, name);
  await writeFile(file, JSON.stringify(spec, null, 2), "utf8");
  return file;
}

async function writeSpecText(t: TestContext, name: string, text: string): Promise<string> {
  const dir = keep(t, await freshDir("specs"));
  const file = path.join(dir, name);
  await writeFile(file, text, "utf8");
  return file;
}

function abathur(
  env: NodeJS.ProcessEnv,
  ...args: string[]
): { status: number; stdout: string; stderr: string } {
  const run = spawnSync(process.execPath, [cliPath, ...args], { env, encoding: "utf8" });
  return { status: run.status ?? -1, stdout: run.stdout, stderr: run.stderr };
}

async function expectExit(
  action: () => unknown,
  code: 1 | 2,
  ...needles: string[]
): Promise<ExitSignal> {
  let signal: ExitSignal | undefined;
  try {
    await action();
  } catch (error) {
    if (error instanceof ExitSignal) signal = error;
    else throw error;
  }
  assert.ok(signal instanceof ExitSignal, `expected ExitSignal(code ${code}), got none`);
  assert.equal(signal.code, code, `wrong exit code — message: ${signal.message}`);
  for (const needle of needles) {
    assert.ok(
      signal.message.includes(needle),
      `message must contain '${needle}' — got: ${signal.message}`,
    );
  }
  return signal;
}

function entryByFingerprint(entries: readonly RegistryEntry[], fp: string): RegistryEntry {
  const found = entries.find((e) => e.fingerprint === fp);
  assert.ok(found !== undefined, `registry has no entry ${fp}`);
  return found;
}

// ------------------------------------------------------------- canonical json

test("canonicalJson: recursively sorts keys, compact separators", () => {
  assert.equal(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] }), '{"a":[{"c":3,"d":2}],"b":1}');
  assert.equal(canonicalJson([2, [3, { z: 1, a: 2 }]]), "[2,[3,{\"a\":2,\"z\":1}]]");
});

test("fingerprint: invariant to key insertion order", () => {
  const one = JSON.parse('{"label":"x","bench":{"type":"toy","timeoutS":1}}');
  const two = JSON.parse('{"bench":{"timeoutS":1,"type":"toy"},"label":"x"}');
  assert.equal(fingerprint(one), fingerprint(two));
});

test("fingerprint: equals sha256 hex of canonicalJson", async () => {
  const { createHash } = await import("node:crypto");
  const value = { b: 1, a: 2 };
  const expected = createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
  assert.equal(fingerprint(value), expected);
});

// -------------------------------------------------------------- glob compiler

test("compileGlob: star stays inside one segment", () => {
  assert.ok(compileGlob("*.ts").test("a.ts"));
  assert.ok(!compileGlob("*.ts").test("dir/a.ts"));
  assert.ok(compileGlob("src/*.ts").test("src/a.ts"));
});

test("compileGlob: ** spans zero or more segments", () => {
  assert.ok(compileGlob("secrets/**").test("secrets/a.pem"));
  assert.ok(compileGlob("secrets/**").test("secrets/sub/a.pem"));
  assert.ok(!compileGlob("secrets/**").test("other/a.pem"));
  assert.ok(compileGlob("**/*.ts").test("a.ts"));
  assert.ok(compileGlob("**/*.ts").test("x/y/a.ts"));
  assert.ok(compileGlob("src/**/index.ts").test("src/index.ts"));
  assert.ok(compileGlob("src/**/index.ts").test("src/a/b/index.ts"));
});

test("compileGlob: ?, classes, negated classes, literal dots", () => {
  assert.ok(compileGlob("a?.ts").test("ab.ts"));
  assert.ok(!compileGlob("a?.ts").test("abc.ts"));
  assert.ok(compileGlob("x[ab]y").test("xay"));
  assert.ok(!compileGlob("x[ab]y").test("xcy"));
  assert.ok(compileGlob("x[!ab]y").test("xcy"));
  assert.ok(!compileGlob("a.ts").test("axts")); // '.' is literal, not regex any-char
});

test("listFiles/filesMatching: sorted working-tree paths, .git skipped", async (t) => {
  const repo = await makeRepo(t);
  const files = listFiles(repo);
  assert.deepEqual(files, ["README.md", "evolve/hot.ts", "kernel.mjs", "secrets/key.pem"]);
  assert.deepEqual(filesMatching(repo, ["secrets/**", "kernel.mjs"]), [
    "kernel.mjs",
    "secrets/key.pem",
  ]);
});

// ----------------------------------------------------------------- validation

test("loadGenomeSpecFile: accepts a fully valid toy spec", async (t) => {
  const repo = await makeRepo(t);
  const file = await writeSpec(t, "ok.jsonc", baseSpec(repo));
  const spec = loadGenomeSpecFile(file);
  assert.equal(spec.label, "fixture-genome");
  assert.equal(spec.bench.stats.halfWidth, 0.05);
});

test("validation: unknown bench.type fails exit 2 naming bench.type", async (t) => {
  const repo = await makeRepo(t);
  const spec = baseSpec(repo);
  (spec.bench as Record<string, unknown>).type = "not-a-bench";
  const file = await writeSpec(t, "badtype.jsonc", spec);
  await expectExit(() => loadGenomeSpecFile(file), 2, "bench.type");
});

test("validation: zero val units rejected exit 2", async (t) => {
  const repo = await makeRepo(t);
  const spec = baseSpec(repo);
  (spec.bench as Record<string, unknown>).units = [
    { id: "t1", path: "bench/t1.json", split: "train" },
  ];
  const file = await writeSpec(t, "noval.jsonc", spec);
  await expectExit(() => loadGenomeSpecFile(file), 2, "val");
});

test("validation: missing stats.halfWidth fails exit 2 NAMING THE KEY (hr required-entry discipline)", async (t) => {
  const repo = await makeRepo(t);
  const spec = baseSpec(repo);
  delete (spec.bench as Record<string, unknown> & { stats: Record<string, unknown> }).stats.halfWidth;
  const file = await writeSpec(t, "nohalf.jsonc", spec);
  await expectExit(() => loadGenomeSpecFile(file), 2, "bench.stats.halfWidth");
});

test("validation: missing stats (whole object) fails exit 2 naming bench.stats", async (t) => {
  const repo = await makeRepo(t);
  const spec = baseSpec(repo);
  delete (spec.bench as Record<string, unknown>).stats;
  const file = await writeSpec(t, "nostats.jsonc", spec);
  await expectExit(() => loadGenomeSpecFile(file), 2, "bench.stats");
});

test("validation: opencode-fixture-scenarios without agentModel fails exit 2 naming bench.agentModel", async (t) => {
  const repo = await makeRepo(t);
  const spec = baseSpec(repo);
  (spec.bench as Record<string, unknown>).type = "opencode-fixture-scenarios";
  const file = await writeSpec(t, "noagent.jsonc", spec);
  await expectExit(() => loadGenomeSpecFile(file), 2, "bench.agentModel");
});

test("validation: judgeCommand without judgeModel fails exit 2 naming bench.judgeModel", async (t) => {
  const repo = await makeRepo(t);
  const spec = baseSpec(repo);
  (spec.bench as Record<string, unknown>).judgeCommand = "judge {unit.path}";
  const file = await writeSpec(t, "nojudge.jsonc", spec);
  await expectExit(() => loadGenomeSpecFile(file), 2, "bench.judgeModel");
});

test("validation: unknown spec key fails exit 2 (strict schema, hr required-entry style)", async (t) => {
  const repo = await makeRepo(t);
  const spec = baseSpec(repo);
  spec.mystery = true;
  const file = await writeSpec(t, "extrakey.jsonc", spec);
  await expectExit(() => loadGenomeSpecFile(file), 2, '"mystery"');
});

test("validation: wrong type for bench.timeoutS fails exit 2 naming the key", async (t) => {
  const repo = await makeRepo(t);
  const spec = baseSpec(repo);
  (spec.bench as Record<string, unknown>).timeoutS = "soon";
  const file = await writeSpec(t, "badtimeout.jsonc", spec);
  await expectExit(() => loadGenomeSpecFile(file), 2, "bench.timeoutS");
});

test("validation: garbage JSONC fails exit 2 as malformed, never a stack", async (t) => {
  const file = await writeSpecText(t, "garbage.jsonc", "{ this is not json // ??? ");
  await expectExit(() => loadGenomeSpecFile(file), 2, "malformed");
});

// ------------------------------------------------------------ register: happy

test("registerGenome: writes out-of-tree registry + kernel manifest", async (t) => {
  const repo = await makeRepo(t);
  const { configDir } = await makeEnv(t);
  const file = await writeSpec(t, "ok.jsonc", baseSpec(repo));

  const result = registerGenome(configDir, file);
  assert.equal(result.kind, "registered");
  assert.equal(result.label, "fixture-genome");

  const registryFile = path.join(configDir, "genomes", `${result.fingerprint}.jsonc`);
  const manifestFile = path.join(configDir, "kernels", `${result.fingerprint}.json`);
  const stored = JSON.parse(await readFile(registryFile, "utf8"));
  assert.equal(stored.label, "fixture-genome");
  assert.equal(result.fingerprint, fingerprint16(stored));

  const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as {
    entries: ManifestEntry[];
  };
  const sealed = manifest.entries.map((e) => e.path);
  assert.deepEqual(sealed, ["kernel.mjs", "secrets/key.pem"]); // evolve/hot.ts NOT sealed
  for (const entry of manifest.entries) assert.match(entry.sha256, /^[0-9a-f]{64}$/);

  // Registry lives under configDir — structurally outside every genome repo tree.
  assert.ok(!path.resolve(registryFile).startsWith(path.resolve(repo)));
});

test("registerGenome: idempotent re-add is a clean no-op", async (t) => {
  const repo = await makeRepo(t);
  const { configDir } = await makeEnv(t);
  const file = await writeSpec(t, "ok.jsonc", baseSpec(repo));
  registerGenome(configDir, file);
  const again = registerGenome(configDir, file);
  assert.equal(again.kind, "already-sealed");
  const entries = await readRegistry(configDir);
  assert.equal(entries.entries.length, 1);
});

test("registerGenome: same label, different fingerprint ⇒ distinct genomes", async (t) => {
  const repo = await makeRepo(t);
  const { configDir } = await makeEnv(t);
  registerGenome(configDir, await writeSpec(t, "a.jsonc", baseSpec(repo)));
  const variant = baseSpec(repo);
  (variant.bench as Record<string, unknown>).timeoutS = 999;
  const second = registerGenome(configDir, await writeSpec(t, "b.jsonc", variant));
  assert.equal(second.kind, "registered");
  const entries = await readRegistry(configDir);
  assert.equal(entries.entries.length, 2);
  assert.notEqual(entries.entries[0]?.fingerprint, entries.entries[1]?.fingerprint);
  for (const e of entries.entries) assert.equal(e.label, "fixture-genome");
});

test("registerGenome: glob matching zero existing files fails exit 2 fail-closed", async (t) => {
  const repo = await makeRepo(t);
  const { configDir } = await makeEnv(t);
  const spec = baseSpec(repo);
  (spec.kernel as Record<string, unknown>).immutableGlobs = ["kernel.mjs", "ghosts/**"];
  const file = await writeSpec(t, "ghost.jsonc", spec);
  await expectExit(() => registerGenome(configDir, file), 2, "ghosts/**");
  const entries = await readRegistry(configDir);
  assert.equal(entries.entries.length, 0); // nothing written
});

// ------------------------------------------------------------- kernel: audit

test("auditKernel: clean genome is ok; tampered file is named as modified", async (t) => {
  const repo = await makeRepo(t);
  const { configDir } = await makeEnv(t);
  const result = registerGenome(configDir, await writeSpec(t, "ok.jsonc", baseSpec(repo)));
  const scan = await readRegistry(configDir);
  const entry = entryByFingerprint(scan.entries, result.fingerprint);

  assert.deepEqual(await auditKernel(entry, configDir), { ok: true, drifted: [] });

  await writeFile(path.join(repo, "kernel.mjs"), "export const frozen = 2;\n", "utf8");
  const audit = await auditKernel(entry, configDir);
  assert.equal(audit.ok, false);
  assert.deepEqual(audit.drifted, [{ path: "kernel.mjs", kind: "modified", glob: "kernel.mjs" }]);
});

test("auditKernel: deleted sealed file ⇒ missing; new glob-matched file ⇒ added", async (t) => {
  const repo = await makeRepo(t);
  const { configDir } = await makeEnv(t);
  const result = registerGenome(configDir, await writeSpec(t, "ok.jsonc", baseSpec(repo)));
  const entry = entryByFingerprint((await readRegistry(configDir)).entries, result.fingerprint);

  await rm(path.join(repo, "secrets", "key.pem"));
  await writeFile(path.join(repo, "secrets", "extra.pem"), "NEW\n", "utf8");
  const audit = await auditKernel(entry, configDir);
  assert.equal(audit.ok, false);
  assert.deepEqual(audit.drifted, [
    { path: "secrets/extra.pem", kind: "added", glob: "secrets/**" },
    { path: "secrets/key.pem", kind: "missing", glob: "secrets/**" },
  ]);
});

test("re-add after tamper with SAME fingerprint ⇒ exit 1 naming drifted files, no reseal", async (t) => {
  const repo = await makeRepo(t);
  const { configDir } = await makeEnv(t);
  const file = await writeSpec(t, "ok.jsonc", baseSpec(repo));
  registerGenome(configDir, file);
  const manifestFile = path.join(configDir, "kernels", `${fingerprint16(loadGenomeSpecFile(file))}.json`);
  const beforeManifest = await readFile(manifestFile, "utf8");

  await writeFile(path.join(repo, "kernel.mjs"), "SABOTAGE\n", "utf8");
  await expectExit(() => registerGenome(configDir, file), 1, "kernel.mjs");
  // The manifest must be untouched — re-add never reseals.
  assert.equal(await readFile(manifestFile, "utf8"), beforeManifest);
});

test("re-add with missing manifest (deleted behind our back) ⇒ refused, NEVER resealed", async (t) => {
  const repo = await makeRepo(t);
  const { configDir } = await makeEnv(t);
  const file = await writeSpec(t, "ok.jsonc", baseSpec(repo));
  const result = registerGenome(configDir, file);
  await rm(path.join(configDir, "kernels", `${result.fingerprint}.json`));
  await expectExit(() => registerGenome(configDir, file), 1, "refus");
  assert.deepEqual(await readdir(path.join(configDir, "kernels")), []); // nothing resealed
});

// ------------------------------------------------- kernel: glob superset rule

test("new fingerprint, same repoPath, weakened globs ⇒ exit 1 naming the weakened glob", async (t) => {
  const repo = await makeRepo(t);
  const { configDir } = await makeEnv(t);
  registerGenome(configDir, await writeSpec(t, "a.jsonc", baseSpec(repo)));
  const weaker = baseSpec(repo);
  (weaker.kernel as Record<string, unknown>).immutableGlobs = ["kernel.mjs"];
  const weakerFile = await writeSpec(t, "weaker.jsonc", weaker);
  await expectExit(() => registerGenome(configDir, weakerFile), 1, "secrets/**");
  const entries = await readRegistry(configDir);
  assert.equal(entries.entries.length, 1); // weakened spec not written
});

test("new fingerprint, same repoPath, superset globs ⇒ registered", async (t) => {
  const repo = await makeRepo(t);
  const { configDir } = await makeEnv(t);
  registerGenome(configDir, await writeSpec(t, "a.jsonc", baseSpec(repo)));
  const wider = baseSpec(repo);
  wider.label = "fixture-genome-wide";
  (wider.kernel as Record<string, unknown>).immutableGlobs = [
    "kernel.mjs",
    "secrets/**",
    "README.md",
  ];
  const result = registerGenome(configDir, await writeSpec(t, "wider.jsonc", wider));
  assert.equal(result.kind, "registered");
});

test("new fingerprint, different repoPath ⇒ superset rule does not apply", async (t) => {
  const repoA = await makeRepo(t);
  const repoB = await makeRepo(t);
  const { configDir } = await makeEnv(t);
  registerGenome(configDir, await writeSpec(t, "a.jsonc", baseSpec(repoA)));
  const narrow = baseSpec(repoB);
  narrow.label = "other-genome";
  (narrow.kernel as Record<string, unknown>).immutableGlobs = ["kernel.mjs"];
  const result = registerGenome(configDir, await writeSpec(t, "narrow.jsonc", narrow));
  assert.equal(result.kind, "registered");
});

// --------------------------------------------------------------- registry I/O

test("buildManifest/compareManifest/serializeManifest are deterministic", async (t) => {
  const repo = await makeRepo(t);
  const first = buildManifest(repo, ["kernel.mjs", "secrets/**"]);
  const second = buildManifest(repo, ["secrets/**", "kernel.mjs"]); // glob order ≠ entry order
  assert.deepEqual(serializeManifest(first), serializeManifest(second));
  assert.deepEqual(compareManifest(first, second), []);
});

test("readRegistry: corrupt registry file degrades to a warning, never a crash", async (t) => {
  const repo = await makeRepo(t);
  const { configDir } = await makeEnv(t);
  registerGenome(configDir, await writeSpec(t, "ok.jsonc", baseSpec(repo)));
  const genomeFiles = (await readdir(path.join(configDir, "genomes"))).filter((f) =>
    f.endsWith(".jsonc"),
  );
  assert.equal(genomeFiles.length, 1);
  await writeFile(path.join(configDir, "genomes", "deadbeefdeadbeef.jsonc"), "{{{ nope", "utf8");

  const scan = await readRegistry(configDir);
  assert.equal(scan.entries.length, 1);
  assert.equal(scan.warnings.length, 1);
  assert.ok(scan.warnings[0]?.includes("deadbeefdeadbeef"));
});

test("requireGenomesByLabel: unknown label ⇒ exit 2 naming the label", async (t) => {
  const { configDir } = await makeEnv(t);
  await expectExit(() => requireGenomesByLabel(configDir, "ghost"), 2, "ghost");
});

// ------------------------------------------------------------------- CLI wiring

test("CLI: add → list → show → seals round-trip; kernel audit passes then blocks", async (t) => {
  const repo = await makeRepo(t);
  const { env } = await makeEnv(t);
  const file = await writeSpec(t, "ok.jsonc", baseSpec(repo));

  const add = abathur(env, "genome", "add", file);
  assert.equal(add.status, 0, add.stderr);
  assert.match(add.stdout, /fixture-genome/);
  const fp = /\(([0-9a-f]{16})\)/.exec(add.stdout)?.[1];
  assert.ok(fp !== undefined, `add output must print the fingerprint: ${add.stdout}`);

  const list = abathur(env, "genome", "list");
  assert.equal(list.status, 0, list.stderr);
  assert.ok(list.stdout.includes("fixture-genome"));
  assert.ok(list.stdout.includes(fp));

  const show = abathur(env, "genome", "show", "fixture-genome");
  assert.equal(show.status, 0, show.stderr);
  const shown = JSON.parse(show.stdout.split("\n").filter((l) => !l.startsWith("#")).join("\n"));
  assert.equal(shown.bench.stats.halfWidth, 0.05);

  const seals = abathur(env, "genome", "seals", "fixture-genome");
  assert.equal(seals.status, 0, seals.stderr);
  assert.ok(seals.stdout.includes("kernel.mjs"));
  assert.ok(seals.stdout.includes("secrets/**"));

  const auditOk = abathur(env, "kernel", "audit", "fixture-genome");
  assert.equal(auditOk.status, 0, auditOk.stderr);

  await writeFile(path.join(repo, "kernel.mjs"), "TAMPERED\n", "utf8");
  const auditBad = abathur(env, "kernel", "audit", "fixture-genome");
  assert.equal(auditBad.status, 1);
  assert.ok(`${auditBad.stdout}${auditBad.stderr}`.includes("kernel.mjs"));

  const readd = abathur(env, "genome", "add", file);
  assert.equal(readd.status, 1);
  assert.ok(`${readd.stdout}${readd.stderr}`.includes("kernel.mjs"));

  const unknown = abathur(env, "kernel", "audit", "never-registered");
  assert.equal(unknown.status, 2);
});

test("CLI: absent glob / zero val / missing threshold / garbage spec all exit 2 without stacks", async (t) => {
  const repo = await makeRepo(t);
  const { env, configDir } = await makeEnv(t);

  const ghost = baseSpec(repo);
  (ghost.kernel as Record<string, unknown>).immutableGlobs = ["ghosts/**"];
  const badGlob = abathur(env, "genome", "add", await writeSpec(t, "g.jsonc", ghost));
  assert.equal(badGlob.status, 2, badGlob.stdout + badGlob.stderr);

  const noVal = baseSpec(repo);
  (noVal.bench as Record<string, unknown>).units = [
    { id: "t1", path: "b/t1.json", split: "train" },
  ];
  const badVal = abathur(env, "genome", "add", await writeSpec(t, "v.jsonc", noVal));
  assert.equal(badVal.status, 2, badVal.stdout + badVal.stderr);

  const noThresh = baseSpec(repo);
  delete (noThresh.bench as Record<string, unknown> & { stats: Record<string, unknown> }).stats
    .halfWidth;
  const badThresh = abathur(env, "genome", "add", await writeSpec(t, "h.jsonc", noThresh));
  assert.equal(badThresh.status, 2, badThresh.stdout + badThresh.stderr);
  assert.ok(`${badThresh.stdout}${badThresh.stderr}`.includes("bench.stats.halfWidth"));

  const garbage = abathur(
    env,
    "genome",
    "add",
    await writeSpecText(t, "garbage.jsonc", "NOT JSON AT ALL {{{"),
  );
  assert.equal(garbage.status, 2);
  const combined = `${garbage.stdout}${garbage.stderr}`;
  assert.ok(!combined.includes("\n    at "), `stack leaked into output: ${combined}`);

  const entries = await readRegistry(configDir);
  assert.equal(entries.entries.length, 0); // every rejection wrote nothing
});

test("CLI: genome rm stays pending until todo 10", async (t) => {
  const { env } = await makeEnv(t);
  const rm = abathur(env, "genome", "rm", "whatever");
  assert.equal(rm.status, 2);
});
