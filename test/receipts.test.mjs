import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const SCRIPT = new URL("../scripts/verify-receipts.mjs", import.meta.url).pathname;

function planWith(body) {
  const dir = mkdtempSync(join(tmpdir(), "ab2-receipts-"));
  const plan = join(dir, "plan.md");
  writeFileSync(plan, body);
  return { dir, plan };
}

function verify(plan) {
  return spawnSync(process.execPath, [SCRIPT, plan], { encoding: "utf8" });
}

const evidence = join(mkdtempSync(join(tmpdir(), "ab2-evidence-")), "w1.log");
writeFileSync(evidence, "receipt\n");
const sha = createHash("sha256").update("receipt\n").digest("hex");

test("a closed todo with evidence passes", () => {
  const { plan } = planWith(`## Todos\n- [x] 1. Do the work\n  - **Evidence:** \`${evidence}\`\n`);
  const result = verify(plan);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /closed=1/);
});

test("a matching sidecar hash passes", () => {
  const { plan } = planWith(`## Todos\n- [x] 1. Do the work\n  - **Evidence:** \`${evidence}\`\n`);
  writeFileSync(`${evidence}.sha256`, `${sha}  ${evidence}\n`);
  assert.equal(verify(plan).status, 0);
});

test("a stale sidecar hash fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "ab2-evidence-"));
  const file = join(dir, "w1.log");
  writeFileSync(file, "changed\n");
  writeFileSync(`${file}.sha256`, `${sha}  ${file}\n`);
  const { plan } = planWith(`## Todos\n- [x] 1. Do the work\n  - **Evidence:** \`${file}\`\n`);
  const result = verify(plan);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /sha256 mismatch/);
});

test("a missing evidence file fails", () => {
  const { plan } = planWith(`## Todos\n- [x] 1. Do the work\n  - **Evidence:** \`/nope/ab2.log\`\n`);
  assert.equal(verify(plan).status, 1);
});

test("open todos are pending, not failures", () => {
  const { plan } = planWith(`## Todos\n- [ ] 1. Later\n  - **Evidence:** \`/nope/ab2.log\`\n`);
  const result = verify(plan);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /pending=1/);
});

test("a plan with zero todos is refused", () => {
  const { plan } = planWith("## Todos\n\nnothing here\n");
  const result = verify(plan);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /zero todos/);
});
