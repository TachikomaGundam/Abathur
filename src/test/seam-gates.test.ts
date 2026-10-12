// Seam test (postmortem 863e6c2): the human-gate commands `promote` and
// `tombstone` must resolve an env-literal repoPath exactly like status/run
// (4997618 pattern). Pre-fix, promote.ts opened the ledger under the STORED
// UNRESOLVED `${VAR}` literal, read an empty ledger, and reported the
// misleading "no generation_complete ledger row" with the literal still in
// the hint — the same fail-open seam class as the status spawn-ENOENT.
// Pins, for both gates:
//  (1) env exported ⇒ gate reads the REAL ledger at the resolved path:
//      the refusal names the resolved repo, never the `${VAR}` literal;
//  (2) env unset ⇒ clean exit 2 NAMING the variable;
//  (3) stderr never contains the unresolved literal or a spawn-ENOENT.

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
const LIT_VAR = "ABATHUR_SEAM_GATES_REPO";

interface GateFixture {
  readonly root: string;
  readonly configDir: string;
  readonly repo: string;
  readonly label: string;
}

async function fixture(t: TestContext, label: string): Promise<GateFixture> {
  const root = mkdtempSync(path.join(os.tmpdir(), "seam-gates-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const configDir = path.join(root, "config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path.join(configDir, "config.jsonc"), '{ "opencodeBin": null }\n', "utf8");
  const repo = await prepareToyGenome(path.join(root, "genome"));
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
  return { root, configDir, repo, label };
}

function cli(
  f: GateFixture,
  args: readonly string[],
  env: Record<string, string | undefined>,
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, ABATHUR_CONFIG: path.join(f.configDir, "config.jsonc"), ...env },
    encoding: "utf8",
    timeout: 60_000,
  });
}

function assertNoLiteralOrEnoent(r: SpawnSyncReturns<string>): void {
  const blob = `${r.stdout}\n${r.stderr}`;
  assert.ok(!blob.includes(`\${${LIT_VAR}}`), `unresolved literal leaked into output:\n${blob}`);
  assert.ok(!blob.includes("ENOENT"), `misleading ENOENT leaked into output:\n${blob}`);
}

test("promote with env-literal repoPath: exported ⇒ blocked naming the RESOLVED repo path", async (t) => {
  const f = await fixture(t, "seam-gate-promote");
  const r = cli(f, ["promote", f.label, "g-nonexistent"], { [LIT_VAR]: f.repo });
  assert.equal(r.status, 1, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assertNoLiteralOrEnoent(r);
  assert.ok(
    r.stderr.includes(f.repo),
    `refusal must name the resolved repo path so the operator can debug:\n${r.stderr}`,
  );
});

test("tombstone with env-literal repoPath: exported ⇒ blocked, no literal leak", async (t) => {
  const f = await fixture(t, "seam-gate-tombstone");
  const r = cli(f, ["tombstone", f.label, "g-nonexistent", "--reason", "seam test"], { [LIT_VAR]: f.repo });
  assert.equal(r.status, 1, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assertNoLiteralOrEnoent(r);
});

test("retract with env-literal repoPath: exported ⇒ blocked naming the RESOLVED repo path", async (t) => {
  const f = await fixture(t, "seam-gate-retract");
  const r = cli(f, ["retract", f.label, "g-nonexistent", "--reason", "seam test"], { [LIT_VAR]: f.repo });
  assert.equal(r.status, 1, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assertNoLiteralOrEnoent(r);
});

test("promote with env-literal repoPath: unset ⇒ clean exit 2 naming the variable", async (t) => {
  const f = await fixture(t, "seam-gate-promote-unset");
  const env: Record<string, string | undefined> = {};
  env[LIT_VAR] = undefined;
  const r = cli(f, ["promote", f.label, "g-nonexistent"], env);
  assert.equal(r.status, 2, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.ok(r.stderr.includes(LIT_VAR), `exit-2 message must name the env var:\n${r.stderr}`);
  assert.ok(!r.stderr.includes("ENOENT"), `misleading ENOENT leaked into output:\n${r.stderr}`);
});
