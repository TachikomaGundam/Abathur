import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { reclaim, retention, watermark } from "../kernel/hygiene/index.mjs";

function makeFile(dir, name, content) {
  const path = join(dir, name);
  writeFileSync(path, content);
  return { path, sha256: createHash("sha256").update(content).digest("hex") };
}

test("a verified manifest reclaims its files", () => {
  const dir = mkdtempSync(join(tmpdir(), "ab2-hygiene-"));
  const file = makeFile(dir, "run.log", "data");
  const result = reclaim(dir, { files: [file] });
  assert.equal(result.rc, 0);
  assert.equal(result.code, "RECLAIMED");
  assert.equal(existsSync(file.path), false);
});

test("an evidence file is refused even with a matching hash", () => {
  const dir = mkdtempSync(join(tmpdir(), "ab2-hygiene-"));
  const proof = join(dir, ".omo", "evidence", "proof.log");
  mkdirSync(join(dir, ".omo", "evidence"), { recursive: true });
  writeFileSync(proof, "keep");
  const sha = createHash("sha256").update("keep").digest("hex");
  const result = reclaim(dir, { files: [{ path: proof, sha256: sha }] });
  assert.equal(result.rc, 2);
  assert.equal(result.code, "DENYLISTED");
  assert.equal(existsSync(proof), true);
});

test("a hash mismatch refuses the whole manifest", () => {
  const dir = mkdtempSync(join(tmpdir(), "ab2-hygiene-"));
  const file = makeFile(dir, "a.log", "a");
  const result = reclaim(dir, { files: [{ path: file.path, sha256: "0".repeat(64) }] });
  assert.equal(result.rc, 2);
  assert.equal(result.code, "HASH-MISMATCH");
  assert.equal(existsSync(file.path), true);
});

test("an empty manifest is refused", () => {
  assert.equal(reclaim("/tmp", { files: [] }).code, "MANIFEST-MISSING");
});

test("retention keeps the newest names", () => {
  const dir = mkdtempSync(join(tmpdir(), "ab2-retention-"));
  for (const name of ["a", "b", "c"]) writeFileSync(join(dir, name), name);
  const result = retention(dir, 1);
  assert.equal(result.rc, 0);
  assert.deepEqual(result.removed, ["a", "b"]);
});

test("watermark is report-only", () => {
  const dir = mkdtempSync(join(tmpdir(), "ab2-watermark-"));
  const file = makeFile(dir, "big.log", "12345");
  assert.equal(watermark(file.path, 2).code, "OVER-WATERMARK");
  assert.equal(watermark(file.path, 99).code, "OK");
});
