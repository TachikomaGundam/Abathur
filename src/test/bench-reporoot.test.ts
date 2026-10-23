// S4 engine seam — the {repoRoot} command variable. The mutation channel's
// delivery hinge: run/grader/seed/reset templates must resolve {repoRoot} to
// the bench's ACTIVE TREE — the genome repoPath for the incumbent, the sealed
// candidate worktree for a candidate (run-loop.ts swaps `spec.repoPath` before
// benching each candidate; the adapter must follow that same notion, including
// effectiveRepoPath's env-literal resolution at the FS boundary).
// Unknown placeholders stay fail-closed (exit 2). Offline: capture scripts
// record the rendered argv; the fake opencode only answers --version.

import assert from "node:assert/strict";
import { chmodSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { ExitSignal } from "../exit.js";
import { parseGenomeSpecDocument, type BenchUnit, type GenomeSpec } from "../core/spec.js";
import { FixtureScenariosAdapter } from "../bench/fixture.js";

// ------------------------------------------------------------------- helpers

async function freshDir(t: TestContext, prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), `abathur-${prefix}-`));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function writeScript(dir: string, name: string, body: string): Promise<string> {
  const filePath = path.join(dir, name);
  await writeFile(filePath, body, "utf8");
  chmodSync(filePath, 0o755);
  return filePath;
}

/** Records `argv[mode, out, ...rest]`: rest joined per line into `out`; prints the metric/score line. */
const CAPTURE = `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const [mode, out, ...rest] = process.argv.slice(2);
writeFileSync(out, rest.join("\\n") + "\\n", "utf8");
if (mode === "score") {
  process.stdout.write(JSON.stringify({ unit: "one", score: 1, pass: true, metrics: { tokensEst: 3, turns: 1 } }) + "\\n");
} else {
  process.stdout.write(JSON.stringify({ tokensEst: 3, turns: 1 }) + "\\n");
}
`;

const FAKE_OC = `#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo "1.2.3"; exit 0; fi
exit 0
`;

const UNIT: BenchUnit = { id: "one", path: "scenarios/one.md", split: "train" };
const VAL_UNIT: BenchUnit = { id: "v1", path: "scenarios/v1.md", split: "val" };

interface SeamFixture {
  readonly spec: GenomeSpec;
  readonly genDir: string;
  readonly sandbox: string;
  readonly home: string;
  readonly cap: string;
  readonly binPath: string;
  readonly out: (name: string) => string;
  readonly adapter: (spec: GenomeSpec) => FixtureScenariosAdapter;
}

async function seamFixture(t: TestContext, genDir: string): Promise<SeamFixture> {
  const root = await freshDir(t, "seam-ad");
  const capPath = await writeScript(root, "cap.mjs", CAPTURE);
  const binDir = await freshDir(t, "seam-bin");
  const binPath = await writeScript(binDir, "oc-fake", FAKE_OC);
  const home = await freshDir(t, "seam-home");
  const configDir = await freshDir(t, "seam-cfg");
  const outDir = path.join(root, "caps");
  mkdirSync(outDir, { recursive: true });
  const out = (name: string): string => path.join(outDir, `${name}.txt`);
  const spec = parseGenomeSpecDocument(
    {
      label: "seam-germ",
      repoPath: genDir,
      bench: {
        type: "opencode-fixture-scenarios",
        units: [UNIT, VAL_UNIT],
        runCommand: `node ${capPath} run ${out("run")} {repoRoot} {unit.path}`,
        seedCommand: `node ${capPath} seed ${out("seed")} {repoRoot}`,
        resetCommand: `node ${capPath} reset ${out("reset")} {repoRoot}`,
        graderCommand: `node ${capPath} score ${out("grader")} {repoRoot}`,
        agentModel: "test/agent",
        timeoutS: 30,
        stats: { halfWidth: 0.15, minEffect: 0.1, nReps: { initial: 1, max: 2 } },
      },
      budget: { maxCandidates: 2, maxModelCalls: 4, maxTokens: 10000, maxWallS: 600 },
      kernel: { immutableGlobs: [] },
      requires: [{ cmd: "node", args: ["--version"], probeExit: 0 }],
      opencodeBinVersion: { minVersion: "1.0.0" },
    },
    "<test>",
  );
  const sandbox = path.join(root, "sandbox");
  return {
    spec,
    genDir,
    sandbox,
    home,
    cap: capPath,
    binPath,
    out,
    adapter: (s) => new FixtureScenariosAdapter(s, { env: { HOME: home }, home, configDir, opencodeBin: binPath }),
  };
}

/** Minimal genome dir (the fixture adapter only requires repoPath to be a directory). */
async function genomeTree(t: TestContext, name = "germ"): Promise<string> {
  const genRoot = await freshDir(t, `seam-${name}`);
  const genDir = path.join(genRoot, "germ");
  mkdirSync(path.join(genDir, "scenarios"), { recursive: true });
  writeFileSync(path.join(genDir, "scenarios", "one.md"), "# one\n\n## Brief\ndo it\n", "utf8");
  writeFileSync(path.join(genDir, "scenarios", "v1.md"), "# v1\n\n## Brief\ndo it val\n", "utf8");
  return genDir;
}

function readCap(file: string): string {
  return readFileSync(file, "utf8").trim();
}

function isExit2Matching(needle: RegExp): (cause: unknown) => boolean {
  return (cause: unknown) => cause instanceof ExitSignal && cause.code === 2 && needle.test(cause.message);
}

// --------------------------------------------------------------------- pins

test("{repoRoot} renders to the incumbent genome repoPath in run + grader + hooks", async (t) => {
  const genDir = await genomeTree(t);
  const f = await seamFixture(t, genDir);
  const adapter = f.adapter(f.spec);
  try {
    await adapter.reset(f.sandbox);
    await adapter.seed(f.sandbox);
    const run = await adapter.run(UNIT, f.sandbox, 30);
    assert.equal(run.status, "ok");
    const score = await adapter.score(UNIT);
    assert.equal(score.kind, "scored");
    assert.equal(readCap(f.out("run")), `${genDir}\nscenarios/one.md`);
    assert.equal(readCap(f.out("grader")), genDir);
    assert.equal(readCap(f.out("seed")), genDir);
    assert.equal(readCap(f.out("reset")), genDir);
  } finally {
    adapter.release();
  }
});

test("{repoRoot} follows the candidate worktree when spec.repoPath is swapped (run-loop.ts pattern)", async (t) => {
  const genDir = await genomeTree(t);
  const f = await seamFixture(t, genDir);
  // simulate run-loop.ts:279 — benchTarget receives { ...spec, repoPath: worktreePath }
  const worktree = path.join(path.dirname(genDir), "wt");
  cpSync(genDir, worktree, { recursive: true });
  mkdirSync(path.join(worktree, "abathur-notes"), { recursive: true });
  writeFileSync(path.join(worktree, "abathur-notes", "card.md"), "planted run card\n", "utf8");
  const candidate = f.adapter({ ...f.spec, repoPath: worktree });
  try {
    const sandbox = path.join(f.sandbox, "cand");
    await candidate.reset(sandbox);
    await candidate.seed(sandbox);
    const run = await candidate.run(UNIT, sandbox, 30);
    assert.equal(run.status, "ok");
    const score = await candidate.score(UNIT);
    assert.equal(score.kind, "scored");
    assert.equal(readCap(f.out("run")), `${worktree}\nscenarios/one.md`);
    assert.equal(readCap(f.out("grader")), worktree);
  } finally {
    candidate.release();
  }
});

test("fixture ctor resolves an env-literal repoPath via effectiveRepoPath (run-loop.ts:142 pattern)", async (t) => {
  const genDir = await genomeTree(t, "lit");
  const f = await seamFixture(t, genDir);
  const litSpec: GenomeSpec = { ...f.spec, repoPath: "${ABATHUR_SEAM_LIT_REPO}" };
  const base = {
    env: { HOME: f.home },
    home: f.home,
    configDir: path.join(f.home, ".config", "abathur"),
    opencodeBin: f.binPath,
  };
  delete process.env["ABATHUR_SEAM_LIT_REPO"];
  try {
    // unset env ⇒ clean exit 2 NAMING the variable (never a garbage-path spawn error)
    assert.throws(
      () => new FixtureScenariosAdapter(litSpec, base),
      isExit2Matching(/requires env var ABATHUR_SEAM_LIT_REPO/),
    );
    // set env ⇒ resolves at the FS boundary; {repoRoot} renders to the resolved tree
    process.env["ABATHUR_SEAM_LIT_REPO"] = genDir;
    const adapter = new FixtureScenariosAdapter(litSpec, base);
    try {
      const sandbox = path.join(f.sandbox, "lit");
      await adapter.reset(sandbox);
      await adapter.seed(sandbox);
      const run = await adapter.run(UNIT, sandbox, 30);
      assert.equal(run.status, "ok");
      assert.equal(readCap(f.out("run")), `${genDir}\nscenarios/one.md`);
    } finally {
      adapter.release();
    }
  } finally {
    delete process.env["ABATHUR_SEAM_LIT_REPO"];
  }
});

test("fail-closed UNCHANGED: unknown placeholder through the adapter is still exit 2", async (t) => {
  const genDir = await genomeTree(t, "unk");
  const f = await seamFixture(t, genDir);
  const bad: GenomeSpec = {
    ...f.spec,
    bench: { ...f.spec.bench, runCommand: `node ${f.cap} run ${f.out("bad")} {nope}` },
  };
  const adapter = f.adapter(bad);
  try {
    await adapter.reset(f.sandbox);
    await adapter.seed(f.sandbox);
    await assert.rejects(() => adapter.run(UNIT, f.sandbox, 30), isExit2Matching(/unknown placeholder/));
  } finally {
    adapter.release();
  }
});
