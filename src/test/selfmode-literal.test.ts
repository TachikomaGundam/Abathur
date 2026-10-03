// Campaign-1 defect pins (historian evidence task-07, live symptom rc=2):
// a `${VAR}` env-literal repoPath is a PATH-INJECTION convenience, NOT an
// engine-self marker. run-loop.ts routed selfMode on isEnvRepoLiteral — ANY
// literal — so the historian genome (`${ABATHUR_HISTORIAN_REPO}`) was forced
// into the tsc-build/toy-replay snapshot-overlay bench and died fail-closed
// demanding `selfbench/expected.json`. selfMode must mean
// `envRepoName(repoPath) === "ABATHUR_SELF_REPO"`. Secondary pin: the dry-run
// plan must display the RESOLVED repo path, never the raw literal joined to
// cwd (run-plan.ts printed `/…/historian/${ABATHUR_HISTORIAN_REPO}`).
// Harness mirrors run-loop.test.ts: toy genome + stub mutator, no model calls.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { ExitSignal } from "../exit.js";
import { registerGenome, requireGenomesByLabel, type RegistryEntry } from "../core/genome.js";
import { Ledger } from "../core/ledger.js";
import type { WorktreeEnv } from "../core/genome-paths.js";
import { prepareToyGenome } from "../bench/toy.js";
import { runEvolution } from "../core/evolve/run-loop.js";

// Same three-candidate stub script as run-loop.test.ts (annotate-add seals,
// touch-kernel path-rejected, fix-add nominated).
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

interface LiteralFixture {
  readonly root: string;
  readonly configDir: string;
  readonly repo: string;
  readonly entry: RegistryEntry;
  readonly mutatorCommand: string;
  readonly env: WorktreeEnv;
  readonly sandboxRoot: string;
}

/**
 * Toy genome registered with repoPath stored as the UNRESOLVED literal
 * `${<envName>}` (the self-seed trick, pointed at the toy repo itself), env
 * var set for the duration of the test. Fresh configDir per test.
 */
async function literalFixture(t: TestContext, envName: string): Promise<LiteralFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "abathur-selfmode-"));
  t.after(() => {
    // trusted snapshots are chmod-protected read-only: restore writability first.
    spawnSync("chmod", ["-R", "u+rwX", root], { encoding: "utf8" });
    spawnSync("rm", ["-rf", root], { encoding: "utf8" });
  });
  const configDir = path.join(root, "config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path.join(configDir, "config.jsonc"), '{ "opencodeBin": null }\n', "utf8");

  const repo = await prepareToyGenome(path.join(root, "genome"));
  const specPath = path.join(repo, "genome.jsonc");
  const doc = JSON.parse(readFileSync(specPath, "utf8")) as { repoPath: string };
  doc.repoPath = `\${${envName}}`;
  writeFileSync(specPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");

  const saved = process.env[envName];
  process.env[envName] = repo;
  t.after(() => {
    if (saved === undefined) delete process.env[envName];
    else process.env[envName] = saved;
  });

  registerGenome(configDir, specPath);
  const entry = requireGenomesByLabel(configDir, "toy-smoke").entries[0];
  if (entry === undefined) throw new Error("fixture: toy-smoke registration vanished");

  const stub = path.join(root, "stub.mjs");
  writeFileSync(stub, STUB_SOURCE, "utf8");
  chmodSync(stub, 0o755);
  return {
    root,
    configDir,
    repo,
    entry,
    mutatorCommand: `node ${stub} --mode three --dir {worktree} --brief {brief}`,
    env: { XDG_CACHE_HOME: path.join(root, "xdg-cache"), HOME: path.join(root, "home") },
    sandboxRoot: path.join(root, "sandboxes"),
  };
}

function generationRowCount(f: LiteralFixture): number {
  return Ledger.open(f.repo)
    .readAll()
    .filter((r) => r.kind === "generation_complete").length;
}

// ------------------------------------------------- non-self literal: normal bench

test("campaign-1 defect: a non-self env-literal repoPath must NOT enter the self-bench overlay", async (t) => {
  const f = await literalFixture(t, "ABATHUR_HISTORIAN_REPO");
  const out = await runEvolution({
    entry: f.entry,
    configDir: f.configDir,
    mutatorCommand: f.mutatorCommand,
    env: f.env,
    sandboxRoot: f.sandboxRoot,
  });
  const plan = out.lines.join("\n");
  assert.equal(out.exitCode, 0, `expected exit 0, lines: ${plan}`);
  assert.ok(
    !/selfbench|self-snapshot|self-bench|overlay/i.test(plan),
    `non-self literal must never touch the self-bench machinery: ${plan}`,
  );
  assert.ok(generationRowCount(f) >= 2, "incumbent + candidate rows benched through the NORMAL toy path");
  assert.equal(existsSync(path.join(f.root, "selfbench")), false);
});

// ------------------------------------- self literal: overlay path preserved

test("regression pin: the ${ABATHUR_SELF_REPO} literal still routes into the self-bench path", async (t) => {
  // The toy repo carries no selfbench/expected.json, so entering the overlay
  // bench FAILS CLOSED with exactly that demand — the observable proof that
  // selfMode is still true for the engine-self literal (live symptom shape).
  const f = await literalFixture(t, "ABATHUR_SELF_REPO");
  await assert.rejects(
    runEvolution({
      entry: f.entry,
      configDir: f.configDir,
      mutatorCommand: f.mutatorCommand,
      env: f.env,
      sandboxRoot: f.sandboxRoot,
    }),
    (cause: unknown) => {
      assert.ok(cause instanceof ExitSignal, `expected ExitSignal, got ${String(cause)}`);
      assert.equal(cause.code, 2);
      assert.match(cause.message, /self-snapshot: trusted selfbench\/expected\.json missing/);
      return true;
    },
  );
});

// ----------------------------------------------------- dry-run plan display

test("--dry-run plan displays the RESOLVED repo path, never the literal against cwd", async (t) => {
  const f = await literalFixture(t, "ABATHUR_HISTORIAN_REPO");
  const out = await runEvolution({
    entry: f.entry,
    configDir: f.configDir,
    mutatorCommand: f.mutatorCommand,
    dryRun: true,
    env: f.env,
    sandboxRoot: f.sandboxRoot,
  });
  assert.equal(out.exitCode, 0, out.lines.join("\n"));
  const plan = out.lines.join("\n");
  assert.ok(plan.includes(`repo: ${f.repo}`), `plan must show the resolved path:\n${plan}`);
  assert.ok(!plan.includes("${"), `plan must never echo the raw literal (resolved against cwd garbage):\n${plan}`);
});
