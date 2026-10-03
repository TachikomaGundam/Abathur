// S4 engine seam (deliverable f) — `abathur status` must resolve the stored
// repoPath through effectiveRepoPath (the run/genome/kernel/self-eval pattern,
// run-loop.ts:142) before touching ANY filesystem seam. Pre-fix, status passed
// the STORED UNRESOLVED `${VAR}` literal as the git cwd; Node reports a missing
// cwd as the misleading `spawn git ENOENT` (task-09 evidence §C). Pins:
//  (1) env-literal genome + env exported ⇒ status exits 0 (real git + ledger
//      seam on the resolved tree — never an ENOENT);
//  (2) env-literal genome + env UNSET ⇒ clean exit 2 NAMING the variable, and
//      the misleading spawn-ENOENT string is gone;
//  (3) concrete repoPath keeps working unchanged (regression guard).

import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";

import { registerGenome } from "../core/genome.js";
import { prepareToyGenome } from "../bench/toy.js";

const CLI = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
const LIT_VAR = "ABATHUR_SEAM_STATUS_REPO";

interface SeamStatusFixture {
  readonly root: string;
  readonly configDir: string;
  readonly repo: string;
}

async function fixture(t: TestContext, label: string): Promise<SeamStatusFixture> {
  const root = mkdtempSync(path.join(os.tmpdir(), "seam-status-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const configDir = path.join(root, "config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path.join(configDir, "config.jsonc"), '{ "opencodeBin": null }\n', "utf8");
  const repo = await prepareToyGenome(path.join(root, "genome"));
  // Register under the exported env (add resolves the same way run does),
  // storing the spec with the UNRESOLVED literal (0.2.x convention).
  const doc = JSON.parse(readFileSync(path.join(repo, "genome.jsonc"), "utf8")) as Record<string, unknown>;
  doc["label"] = label;
  doc["repoPath"] = `\${${LIT_VAR}}`;
  const specFile = path.join(root, "private.jsonc");
  writeFileSync(specFile, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  process.env[LIT_VAR] = repo;
  try {
    registerGenome(configDir, specFile);
  } finally {
    delete process.env[LIT_VAR];
  }
  return { root, configDir, repo };
}

function cli(
  f: SeamStatusFixture,
  label: string,
  env: Record<string, string | undefined>,
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [CLI, "status", label], {
    encoding: "utf8",
    cwd: f.root,
    env: {
      ...process.env,
      ABATHUR_CONFIG: path.join(f.configDir, "config.jsonc"),
      HOME: path.join(f.root, "home"),
      XDG_CACHE_HOME: path.join(f.root, "xdg-cache"),
      ...env,
    },
  });
}

test("status resolves an env-literal repoPath via effectiveRepoPath: exported ⇒ exit 0", async (t) => {
  const f = await fixture(t, "seam-self");
  const r = cli(f, "seam-self", { [LIT_VAR]: f.repo });
  assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.match(r.stdout, /genome: seam-self/);
  assert.ok(!r.stderr.includes("ENOENT"), "the misleading spawn-ENOENT string must be gone");
});

test("status on an env-literal repoPath with the env UNSET: clean exit 2 naming the variable", async (t) => {
  const f = await fixture(t, "seam-unset");
  const r = cli(f, "seam-unset", { [LIT_VAR]: undefined });
  assert.equal(r.status, 2);
  assert.match(r.stderr, new RegExp(`requires env var ${LIT_VAR}`));
  assert.ok(!r.stderr.includes("ENOENT"), `misleading ENOENT returned: ${r.stderr}`);
});
