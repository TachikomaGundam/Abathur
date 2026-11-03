import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReview, REVIEW_ENV } from "../kernel/planning/review.mjs";

function adapter(dir, body) {
  const path = join(dir, "adapter.mjs");
  writeFileSync(path, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

test("an unconfigured review adapter is undispatchable", () => {
  const result = runReview({ artifact: "a", goal: "g", env: {} });
  assert.equal(result.rc, 2);
  assert.match(result.code, /UNDISPATCHABLE/);
});

test("an injected adapter returns a bound receipt", () => {
  const dir = mkdtempSync(join(tmpdir(), "review-"));
  try {
    const cmd = adapter(
      dir,
      'process.stdout.write(JSON.stringify({verdict:"APPROVE",independence:"INDEPENDENT",run:"run-1",artifact_sha256:"a".repeat(64)}));',
    );
    const result = runReview({ artifact: "a", goal: "g", env: { [REVIEW_ENV]: cmd } });
    assert.equal(result.rc, 0);
    assert.equal(result.verdict, "APPROVE");
    assert.equal(result.independence, "INDEPENDENT");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("malformed adapter output is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "review-"));
  try {
    const cmd = adapter(dir, 'process.stdout.write("not json");');
    const result = runReview({ artifact: "a", goal: "g", env: { [REVIEW_ENV]: cmd } });
    assert.equal(result.rc, 2);
    assert.match(result.code, /MALFORMED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
