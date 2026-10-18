// Todo 6 acceptance pins for the opencode-fixture-scenarios adapter. The whole
// bench runs against FAKE opencodeBins (bash fixtures written to tmp by these
// tests): argv-spawned shebang scripts, never a shell string. Pins:
//  (A) 2-unit matrix runs end to end (provenance, metrics, transcript, HOME env);
//  (B) val scenario paths never appear in the mutator-readable manifest, and a
//      val run without includeVal is exit 2 (operator flag gates it);
//  (C) --version missing/garbage/minVersion mismatch ⇒ exit 2 BEFORE any unit;
//  (D) requires[] probes: missing cmd / probeExit mismatch ⇒ exit 2 naming it;
//  (E) hanging unit ⇒ process-group kill at timeoutS, zero orphans (pgrep-level);
//  (F) infra_failed is recorded distinctly, never looks like a score;
//  (G) garbage grader / garbage run stdout ⇒ inconclusive / zeroed metrics, no crash;
//  (H) crash → reset → seed digest == clean start (stale-state proof);
//  (I) single-flight lock: second concurrent adapter gets exit 2 "another bench active";
//  (J) sandbox HOME: ONLY .opencode/{plugin,skills,node_modules} + copied-then-mutated
//      config, never symlinks, real HOME untouched.

import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { ExitSignal } from "../exit.js";
import { treeDigestAt } from "../core/ids.js";
import type { BenchUnit } from "../core/spec.js";
import type { RunResult, ScoreOutcome } from "../bench/adapter.js";
import { FixtureScenariosAdapter, sandboxHomeDir } from "../bench/fixture.js";
import {
  adapterFixture,
  BIN_GOOD,
  fakeHome,
  fixtureGenome,
  fixtureSpec,
  freshDir,
  isExit2,
  manifestPath,
  POISON_UNIT,
  scored,
  TRAIN_UNITS,
  VAL_UNIT,
  writeScript,
} from "./fixtures-bench-fixture.js";

// ------------------------------------------------------------------ AC (A)

test("(A) 2-unit run: statuses, provenance versions, metrics, transcript, HOME env", async (t) => {
  const f = await adapterFixture(t, BIN_GOOD, {}, { includeVal: true });
  await f.adapter.reset(f.sandbox);
  await f.adapter.seed(f.sandbox);

  const rows: { run: RunResult; score: ScoreOutcome }[] = [];
  for (const unit of [TRAIN_UNITS[0]!, VAL_UNIT] as BenchUnit[]) {
    rows.push({
      run: await f.adapter.run(unit, f.sandbox, f.spec.bench.timeoutS),
      score: await f.adapter.score(unit),
    });
  }
  for (const { run } of rows) {
    assert.equal(run.status, "ok");
    assert.equal(run.exitCode, 0);
    assert.equal(run.benchProvenance.benchType, "opencode-fixture-scenarios");
    const versions = new Map(run.benchProvenance.versions.map((v) => [v.bin, v.version]));
    assert.equal(versions.get("node"), process.version);
  }
  const [a, b] = rows as [{ run: RunResult; score: ScoreOutcome }, { run: RunResult; score: ScoreOutcome }];
  assert.equal(scored(a.score).score, 1);
  assert.equal(scored(b.score).score, 0.25);
  assert.equal(scored(b.score).pass, false);
  assert.equal(a.run.metrics.tokensEst, 123); // parsed from the fake bin's run metadata
  assert.equal(a.run.metrics.turns, 4);

  const sbHome = sandboxHomeDir(f.sandbox);
  const transcript = readFileSync(a.run.transcriptPath ?? "", "utf8");
  assert.match(transcript, /model=test\/agent/);
  assert.match(transcript, /judge=test\/judge/);
  assert.ok(transcript.includes(`home=${sbHome}`), `transcript home must be the sandbox HOME: ${transcript}`);

  // the observed opencode version string is present in EVERY RunResult provenance
  for (const { run } of rows) {
    assert.ok(
      run.benchProvenance.versions.some((v) => v.version === "1.2.3" && v.bin.includes("oc-fake")),
      "observed fake-bin version missing from provenance",
    );
  }
  // seed copied the scenario files
  assert.ok(existsSync(path.join(f.sandbox, "seeded.flag")));
});

test("(A) configured opencode binary reaches the scenario runner", async (t) => {
  const f = await adapterFixture(t, BIN_GOOD, { captureOpencodeBin: true }, { includeVal: true });
  await f.adapter.reset(f.sandbox);
  await f.adapter.seed(f.sandbox);
  await f.adapter.run(TRAIN_UNITS[0]!, f.sandbox, f.spec.bench.timeoutS);
  assert.equal(readFileSync(path.join(f.sandbox, "opencode-bin.txt"), "utf8"), `${f.opencodeBin}\n`);
});

// ------------------------------------------------------------------ AC (B)

test("(B) val paths hidden from the mutator manifest; val run needs includeVal", async (t) => {
  const f = await adapterFixture(t);
  await f.adapter.reset(f.sandbox);
  await f.adapter.seed(f.sandbox);

  const raw = readFileSync(manifestPath(f.sandbox), "utf8");
  assert.ok(!raw.includes("ZZHIDDEN"), "canary scenario filename leaked into manifest");
  assert.ok(!raw.includes("val-canary"), "val path leaked into manifest");
  assert.ok(raw.includes("scenarios/scenarios-one.md"), "train path must stay visible");

  const entries = JSON.parse(raw)["scenarios"] as { alias: string; split: string; id?: string; path?: string }[];
  const valEntry = entries.find((e) => e.split === "val");
  assert.ok(valEntry !== undefined, "manifest must still count the val scenario");
  assert.equal(valEntry.id, undefined);
  assert.equal(valEntry.path, undefined);
  assert.match(valEntry.alias, /^scenario-\d{2}$/);

  // default adapter: running the val unit is a tool error naming the operator flag
  await assert.rejects(
    () => f.adapter.run(VAL_UNIT as BenchUnit, f.sandbox, f.spec.bench.timeoutS),
    (cause: unknown) => isExit2(cause) && /--include-val/.test((cause as ExitSignal).message),
  );

  // operator-flagged adapter may run it end to end
  const op = await adapterFixture(t, BIN_GOOD, {}, { includeVal: true });
  await op.adapter.reset(op.sandbox);
  await op.adapter.seed(op.sandbox);
  const run = await op.adapter.run(VAL_UNIT as BenchUnit, op.sandbox, op.spec.bench.timeoutS);
  assert.equal(run.status, "ok");
  assert.ok(readFileSync(manifestPath(op.sandbox), "utf8").includes("ZZHIDDEN")); // operator sees the truth
});


// ------------------------------------------------------------------ AC (H)

test("(H) crash→reset→seed restores the exact clean-start digest", async (t) => {
  const f = await adapterFixture(t);
  await f.adapter.reset(f.sandbox);
  await f.adapter.seed(f.sandbox);
  const clean = treeDigestAt(f.sandbox);

  const run = await f.adapter.run(POISON_UNIT as BenchUnit, f.sandbox, 5);
  assert.equal(run.status, "ok");
  assert.ok(existsSync(path.join(f.sandbox, "poison.txt")), "poison scenario must dirty the sandbox");
  assert.notEqual(treeDigestAt(f.sandbox), clean);

  await f.adapter.reset(f.sandbox);
  await f.adapter.seed(f.sandbox);
  assert.ok(!existsSync(path.join(f.sandbox, "poison.txt")));
  assert.equal(treeDigestAt(f.sandbox), clean);
});

// ------------------------------------------------------------------ AC (I)

test("(I) single-flight: second adapter exit 2 'another bench active', ok after release", async (t) => {
  const binDir = await freshDir(t, "fixbin");
  const binPath = await writeScript(binDir, "oc-fake", BIN_GOOD);
  const genDir = await fixtureGenome(t);
  const home = await fakeHome(t);
  const configDir = path.join(home, ".config", "abathur");
  const spec = fixtureSpec(genDir, binPath);
  const a = new FixtureScenariosAdapter(spec, { env: { HOME: home }, home, configDir, opencodeBin: binPath });
  const b = new FixtureScenariosAdapter(spec, { env: { HOME: home }, home, configDir, opencodeBin: binPath });
  const sandboxA = path.join(await freshDir(t, "fixsbx"), "sb-a");
  await a.reset(sandboxA); // holds the fingerprint-keyed lease
  const sandboxB = path.join(await freshDir(t, "fixsbx"), "sb-b");
  await assert.rejects(
    () => b.reset(sandboxB),
    (cause: unknown) => isExit2(cause) && /another bench active/.test((cause as ExitSignal).message),
  );
  a.release();
  await b.reset(sandboxB); // lease free again
  b.release();
});

// ------------------------------------------------------------------ AC (J)

test("(J) sandbox HOME copies only the .opencode subset + mutated config copy; real HOME untouched", async (t) => {
  const f = await adapterFixture(t);
  const openDigest = treeDigestAt(path.join(f.home, ".opencode"));
  const cfgDigest = treeDigestAt(path.join(f.home, ".config", "opencode"));
  await f.adapter.reset(f.sandbox);
  await f.adapter.seed(f.sandbox);

  const sbHome = sandboxHomeDir(f.sandbox);
  assert.ok(existsSync(path.join(sbHome, ".opencode", "plugin", "x.js")));
  assert.ok(existsSync(path.join(sbHome, ".opencode", "skills", "s.md")));
  assert.ok(existsSync(path.join(sbHome, ".opencode", "node_modules", "m", "package.json")));
  assert.ok(!existsSync(path.join(sbHome, ".opencode", "secrets.txt")), "secrets must not be mirrored");
  assert.ok(!existsSync(path.join(sbHome, ".bashrc")), "dotfiles outside the subset must not be mirrored");

  const cfg = path.join(sbHome, ".config", "opencode", "opencode.json");
  assert.ok(lstatSync(cfg).isFile(), "opencode config must be a copied regular file, never a symlink");
  const doc = JSON.parse(readFileSync(cfg, "utf8")) as Record<string, unknown>;
  assert.equal(doc["model"], "test/agent"); // mutated per scenario
  assert.equal(doc["theme"], "dark"); // copied content preserved
  assert.ok(existsSync(path.join(sbHome, ".config", "opencode", "prompts", "p.md")));
  assert.equal(treeDigestAt(path.join(f.home, ".opencode")), openDigest, "real .opencode must be untouched");
  assert.equal(treeDigestAt(path.join(f.home, ".config", "opencode")), cfgDigest, "real opencode config must be untouched");
  const realCfg = JSON.parse(readFileSync(path.join(f.home, ".config", "opencode", "opencode.json"), "utf8")) as Record<string, unknown>;
  assert.equal(realCfg["model"], undefined);
});
