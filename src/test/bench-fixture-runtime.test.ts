import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { ExitSignal } from "../exit.js";
import type { BenchUnit } from "../core/spec.js";
import { compareSemver, parseSemver } from "../bench/fixture.js";
import {
  adapterFixture,
  BIN_GARBAGE_RUN,
  BIN_GOOD,
  BIN_HANG,
  fakeHome,
  fixtureGenome,
  fixtureSpec,
  freshDir,
  isExit2,
  TRAIN_UNITS,
  writeScript,
} from "./fixtures-bench-fixture.js";
import { FixtureScenariosAdapter } from "../bench/fixture.js";

test("(E) hanging unit: group kill at timeoutS, zero orphans", async (t) => {
  const f = await adapterFixture(t, BIN_HANG, { timeoutS: 1 }, {}, "oc-fake-runtime");
  await f.adapter.reset(f.sandbox);
  await f.adapter.seed(f.sandbox);
  const started = Date.now();
  const run = await f.adapter.run(TRAIN_UNITS[0] as BenchUnit, f.sandbox, 1);
  assert.ok(Date.now() - started < 8000);
  assert.equal(run.status, "timeout");
  assert.equal(run.exitCode, null);
  assert.match(run.note ?? "", /killed after 1s: process group SIGKILL/);
  const ps = spawnSync("ps", ["-eo", "args"], { encoding: "utf8" });
  assert.ok(!ps.stdout.includes("sleep 29.31"), "orphaned sleep survived the group kill");
});

test("(F) infra_failed is recorded with a distinct status/note, never a silent 0", async (t) => {
  const f = await adapterFixture(t, BIN_GOOD, { runCommand: "abathur-no-such-bin run {unit.path}" }, {}, "oc-fake-runtime");
  await f.adapter.reset(f.sandbox);
  await f.adapter.seed(f.sandbox);
  const run = await f.adapter.run(TRAIN_UNITS[0] as BenchUnit, f.sandbox, 5);
  assert.equal(run.status, "infra_failed");
  assert.equal(run.exitCode, null);
  assert.match(run.note ?? "", /spawn failed/);
});

test("(G1) garbage run stdout ⇒ ok with zeroed metrics, no parse crash", async (t) => {
  const f = await adapterFixture(t, BIN_GARBAGE_RUN, {}, {}, "oc-fake-runtime");
  await f.adapter.reset(f.sandbox);
  await f.adapter.seed(f.sandbox);
  const run = await f.adapter.run(TRAIN_UNITS[0] as BenchUnit, f.sandbox, 5);
  assert.equal(run.status, "ok");
  assert.deepEqual(run.metrics, { tokensEst: 0, turns: 0 });
});

test("(G2) failing / garbage grader ⇒ inconclusive-for-unit, never a crash", async (t) => {
  const f = await adapterFixture(t, BIN_GOOD, {}, {}, "oc-fake-runtime");
  await f.adapter.reset(f.sandbox);
  await f.adapter.seed(f.sandbox);
  const unknown = await f.adapter.score({ id: "ghost", path: "scenarios/none.md", split: "train" });
  assert.equal(unknown.kind, "inconclusive");
  if (unknown.kind === "inconclusive") assert.match(unknown.reason, /unknown unit ghost/);
  await writeFile(path.join(f.sandbox, "grader.mjs"), 'process.stdout.write("not json at all\\n");\n', "utf8");
  const bad = await f.adapter.score(TRAIN_UNITS[0] as BenchUnit);
  assert.equal(bad.kind, "inconclusive");
  if (bad.kind === "inconclusive") assert.match(bad.reason, /not a score JSON line/);
});

test("fixture hook: an omitted integration asset is an actionable exit 2", async (t) => {
  const binDir = await freshDir(t, "fixbin");
  const binPath = await writeScript(binDir, "oc-fake-runtime", BIN_GOOD);
  const genDir = await fixtureGenome(t);
  const home = await fakeHome(t);
  const spec = fixtureSpec(genDir, binPath, { seedCommand: `${genDir}/missing-integration-hook.sh {sandbox}` });
  const adapter = new FixtureScenariosAdapter(spec, { env: { HOME: home }, home, configDir: path.join(home, ".config", "abathur"), opencodeBin: binPath });
  const sandbox = path.join(await freshDir(t, "fixsbx"), "sb");
  await adapter.reset(sandbox);
  await assert.rejects(
    () => adapter.seed(sandbox),
    (cause: unknown) => isExit2(cause) && /fixture seedCommand failed/.test((cause as ExitSignal).message) && /missing-integration-hook\.sh/.test((cause as ExitSignal).message),
  );
  adapter.release();
});

test("semver helpers: 1.10 > 1.9, prerelease < release, garbage ⇒ null", () => {
  const cmp = (a: string, b: string): number => {
    const va = parseSemver(a);
    const vb = parseSemver(b);
    if (va === null || vb === null) throw new Error(`unparsable: ${a} / ${b}`);
    return compareSemver(va, vb);
  };
  assert.ok(cmp("1.10.0", "1.9.0") > 0);
  assert.equal(cmp("1.2.3", "1.2.3"), 0);
  assert.ok(cmp("1.2.3-beta", "1.2.3") < 0);
  assert.ok(cmp("v2.0.0", "1.99.99") > 0);
  assert.equal(parseSemver("banana"), null);
});
