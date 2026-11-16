import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { findRegistryHits, fullTokens, prefixesOf, loadRegistry, scan } from "../scripts/scan-retired-handles.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const registry = loadRegistry(ROOT);
const prefixes = prefixesOf(registry);

test("registry is well formed and records the 20261110 purge", () => {
  assert.equal(registry.version, 1);
  assert.ok(registry.purges.some((p) => p.purge_id === "rewrite-20261110"));
  assert.ok(registry.handles.length >= 20);
  for (const handle of registry.handles) {
    assert.match(handle.prefix, /^[0-9a-f]{7,40}$/);
    assert.ok(Array.isArray(handle.seen_in) && handle.seen_in.length > 0);
  }
  for (const residual of registry.accepted_residuals) {
    assert.equal(residual.kind, "commit-message");
    assert.match(residual.commit, /^[0-9a-f]{40}$/);
    assert.ok(residual.why.trim().length > 20);
  }
});

test("a registered full ID and its short prefix both match", () => {
  // Fixtures are derived from the registry at runtime: a literal retired ID in
  // this file would itself be a handle and the scan would fail closed on it.
  const full = registry.handles.find((handle) => handle.prefix.length === 40).prefix;
  assert.equal(findRegistryHits(`see ${full} for details`, prefixes).length, 1);
  assert.equal(findRegistryHits(`see ${full.slice(0, 7)} for details`, prefixes).length, 1);
  assert.equal(findRegistryHits("unrelated a1b2c3d4e5f", prefixes).length, 0);
});

test("a 64-hex sha256 content hash is not treated as a commit handle", () => {
  const digest = "5341dbda8f7731c466e2f65db475cc1eb34ba126db2a9ed7d269cc5d7aac100b";
  assert.equal(fullTokens(`tarball_sha256: ${digest}`).length, 0);
});

test("scan of this repository is clean and only accepts the two registered residuals", () => {
  const result = scan(ROOT);
  assert.deepEqual(result.violations, []);
  assert.equal(result.accepted, 2);
});

test("scan fails closed on a planted retired handle in a tracked file", () => {
  const dir = mkdtempSync(join(tmpdir(), "retired-handles-"));
  const run = (args) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  run(["init", "-q"]);
  run(["config", "user.email", "t@example.invalid"]);
  run(["config", "user.name", "t"]);
  mkdirSync(join(dir, "config"));
  copyFileSync(join(ROOT, "config", "retired-handles.json"), join(dir, "config", "retired-handles.json"));
  const short = registry.handles.find((handle) => handle.prefix.length === 40).prefix.slice(0, 7);
  writeFileSync(join(dir, "doc.md"), `release built from ${short}\n`);
  run(["add", "."]);
  const planted = scan(dir);
  assert.equal(planted.violations.length, 1);
  assert.equal(planted.violations[0].kind, "retired-handle");
  assert.equal(planted.violations[0].where, "doc.md");
});

test("scan fails closed on an unregistered full handle that does not resolve", () => {
  const dir = mkdtempSync(join(tmpdir(), "retired-unresolved-"));
  const run = (args) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  run(["init", "-q"]);
  run(["config", "user.email", "t@example.invalid"]);
  run(["config", "user.name", "t"]);
  mkdirSync(join(dir, "config"));
  copyFileSync(join(ROOT, "config", "retired-handles.json"), join(dir, "config", "retired-handles.json"));
  const orphan = randomBytes(20).toString("hex");
  writeFileSync(join(dir, "doc.md"), `orphan ${orphan}\n`);
  run(["add", "."]);
  const planted = scan(dir);
  assert.equal(planted.violations.length, 1);
  assert.equal(planted.violations[0].kind, "unresolved-full-handle");
});
