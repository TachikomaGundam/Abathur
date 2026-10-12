// --include-val operator flag (plan todo 6 wording, F1 fix): the CLI switch must
// parse, thread down the bench seam to the fixture adapter (val units runnable,
// manifest no longer opaque), and fail CLOSED with exit 2 on toy genomes —
// never silently ignored. Adapter-level val hiding itself is pinned by
// bench-fixture.test.ts AC (B); these tests cover the CLI + factory seam.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { ExitSignal } from "../exit.js";
import { parseGenomeSpecDocument, type GenomeSpec } from "../core/spec.js";
import type { RegistryEntry } from "../core/genome.js";
import { openBenchAdapter } from "../core/evolve/run-bench.js";
import { runEvolution } from "../core/evolve/run-loop.js";
import { FixtureScenariosAdapter, type ScenarioEntry } from "../bench/fixture.js";
import { parseRunFlags } from "../commands/run.js";

// ------------------------------------------------------------- parse seam

test("parseRunFlags: --include-val is a boolean operator switch", () => {
  assert.equal(parseRunFlags(["--genome", "g", "--include-val"]).includeVal, true);
  assert.equal(parseRunFlags(["--genome", "g"]).includeVal, false);
  const combo = parseRunFlags(["--genome", "g", "--include-val", "--dry-run"]);
  assert.equal(combo.includeVal, true);
  assert.equal(combo.dryRun, true);
});

// -------------------------------------------------- adapter factory seam

const VAL_CANARY = "valcanary-7f41";

function fixtureSpec(genDir: string): GenomeSpec {
  return parseGenomeSpecDocument(
    {
      label: "iv-germ",
      repoPath: genDir,
      bench: {
        type: "opencode-fixture-scenarios",
        units: [
          { id: "one", path: "scenarios/scenarios-one.md", split: "train" },
          { id: "two", path: "scenarios/scenarios-two.md", split: "train" },
          { id: "hidden", path: `scenarios/${VAL_CANARY}.md`, split: "val" },
        ],
        runCommand: "opencode run {unit.path}",
        seedCommand: "seed.sh {sandbox}",
        resetCommand: "reset.sh {sandbox}",
        graderCommand: "node grader.mjs {unit.id}",
        judgeCommand: "node judge.mjs {unit.id}",
        judgeModel: "test/judge",
        agentModel: "test/agent",
        timeoutS: 5,
        stats: { halfWidth: 0.1, minEffect: 0.05, nReps: { initial: 1, max: 2 } },
      },
      budget: { maxCandidates: 2, maxModelCalls: 10, maxTokens: 1000, maxWallS: 60 },
      kernel: { immutableGlobs: [] },
      requires: [{ cmd: "node", args: ["--version"], probeExit: 0 }],
      opencodeBinVersion: { minVersion: "1.0.0" },
    },
    "<include-val-test>",
  );
}

function fixtureEntry(t: TestContext, genDir: string): GenomeSpec {
  t.after(() => rmSync(genDir, { recursive: true, force: true }));
  return fixtureSpec(genDir);
}

function manifestOf(t: TestContext, spec: GenomeSpec, includeVal?: boolean): readonly ScenarioEntry[] {
  const configDir = mkdtempSync(path.join(os.tmpdir(), "abathur-iv-cfg-"));
  t.after(() => rmSync(configDir, { recursive: true, force: true }));
  // ctor validates type + repoPath only; probes/locks are lazy, so no spawn here.
  const bundle = openBenchAdapter(spec, {
    configDir,
    ...(includeVal === undefined ? {} : { includeVal }),
  });
  t.after(() => bundle.release());
  assert.ok(bundle.adapter instanceof FixtureScenariosAdapter, "fixture bench must build the fixture adapter");
  return bundle.adapter.scenarioManifest();
}

test("openBenchAdapter: includeVal threads into the fixture adapter manifest", (t) => {
  const spec = fixtureEntry(t, mkdtempSync(path.join(os.tmpdir(), "abathur-iv-gen-")));
  const val = (entries: readonly ScenarioEntry[]): ScenarioEntry => {
    const found = entries.find((e) => e.split === "val");
    assert.ok(found !== undefined, "fixture spec must carry a val unit");
    return found;
  };

  const hidden = manifestOf(t, spec); // default: operator did NOT pass the flag
  const v1 = val(hidden);
  assert.equal(v1.id, undefined, "val id must stay hidden without the operator flag");
  assert.equal(v1.path, undefined, "val path must stay hidden without the operator flag");
  assert.match(v1.alias, /^scenario-\d{2}$/);
  assert.ok(!JSON.stringify(hidden).includes(VAL_CANARY), "val canary leaked into the default manifest");

  const shown = manifestOf(t, spec, true);
  const v2 = val(shown);
  assert.equal(v2.id, "hidden");
  assert.equal(v2.path, `scenarios/${VAL_CANARY}.md`);
});

// --------------------------------------------------------- toy fail-closed

function toyEntry(t: TestContext): RegistryEntry {
  const repoPath = mkdtempSync(path.join(os.tmpdir(), "abathur-iv-toy-"));
  t.after(() => rmSync(repoPath, { recursive: true, force: true }));
  const spec = parseGenomeSpecDocument(
    {
      label: "iv-toy",
      repoPath,
      bench: {
        type: "toy",
        units: [
          { id: "add", path: "units/add.mjs", split: "train" },
          { id: "sub", path: "units/sub.mjs", split: "val" },
        ],
        runCommand: "node {unit.path}",
        graderCommand: "node grader.mjs {unit.path}",
        timeoutS: 10,
        stats: { halfWidth: 0.25, minEffect: 0.5, nReps: { initial: 2, max: 4 } },
      },
      budget: { maxCandidates: 4, maxModelCalls: 16, maxTokens: 100000, maxWallS: 300 },
      kernel: { immutableGlobs: [] },
    },
    "<include-val-test>",
  );
  return { fingerprint: "0123456789abcdef", label: "iv-toy", spec, registryFile: "<test>/iv-toy.jsonc", storedText: "{}" };
}

test("runEvolution: toy genome + --include-val fails closed (exit 2), even with --dry-run", async (t) => {
  const configDir = mkdtempSync(path.join(os.tmpdir(), "abathur-iv-cfg-"));
  t.after(() => rmSync(configDir, { recursive: true, force: true }));
  await assert.rejects(
    runEvolution({ entry: toyEntry(t), configDir, includeVal: true, dryRun: true }),
    (cause: unknown) => {
      assert.ok(cause instanceof ExitSignal, `expected ExitSignal, got ${String(cause)}`);
      assert.equal(cause.code, 2);
      assert.match(cause.message, /--include-val is only supported by the opencode-fixture-scenarios bench/);
      return true;
    },
  );
});
