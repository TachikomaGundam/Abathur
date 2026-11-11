import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

test("dispatch policy stays source-checkout-only until a new charter", () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
  assert.equal(
    pkg.files.some((entry) => entry === "tools" || entry.startsWith("tools/")),
    false,
    "package.json.files must not ship tools/",
  );
  assert.equal(
    existsSync(resolve(ROOT, "kernel", "dispatch")),
    false,
    "kernel/dispatch must not exist without a new dispatch charter",
  );
  assert.equal(existsSync(resolve(ROOT, "tools", "wave_engine", "wave.py")), true);
  assert.equal(
    existsSync(resolve(ROOT, "tools", "wave_engine", "line_roots.example.json")),
    true,
  );
  const example = readFileSync(
    resolve(ROOT, "tools", "wave_engine", "line_roots.example.json"),
    "utf8",
  );
  assert.equal(example.includes("/home/"), false);
  assert.equal(example.includes("INTENT-LEDGER"), false);
  assert.equal(example.includes("MODEL-REGISTRY"), false);
});

test("release paths use the single package-boundary scanner", () => {
  const publish = readFileSync(
    resolve(ROOT, ".github", "workflows", "publish.yml"),
    "utf8",
  );
  const integrity = readFileSync(
    resolve(ROOT, ".github", "workflows", "integrity.yml"),
    "utf8",
  );
  for (const workflow of [publish, integrity]) {
    assert.match(workflow, /node scripts\/scan-package\.mjs/);
    assert.doesNotMatch(workflow, /TARBALL-GUARD|PACKAGE-BOUNDARY: forbidden/);
  }
});

test("dispatch doctrine names the policy and execution split", () => {
  const doctrine = readFileSync(
    resolve(ROOT, "docs", "parallel-dispatch-doctrine.md"),
    "utf8",
  );
  assert.match(doctrine, /方法论边界/);
  assert.match(doctrine, /source-checkout-only/);
  assert.match(doctrine, /kernel\/dispatch/);
});
