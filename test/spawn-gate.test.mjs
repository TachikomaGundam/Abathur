import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

import {
  CONSTANTS,
  GateError,
  findSpawnFiles,
  runGate,
  scanReexport,
  validatePolicy,
} from "../kernel/exec/spawn-gate.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const TOKEN = ["child", "_process"].join("");

function write(root, rel, body) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

function withTemp(fn) {
  const root = mkdtempSync(join(tmpdir(), "spawn-gate-"));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function entry(path, cls, extra = {}) {
  return { path, class: cls, reason: "test", ...extra };
}

test("the live tree passes with exactly 23 registered files", () => {
  const result = runGate(ROOT);
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.discovered.length, 23);
  assert.deepEqual(result.counts, {
    runner: 1,
    "trusted-controller": 5,
    "legacy-target": 8,
    "test-harness": 9,
  });
});

test("the walk finds literal spawn tokens in every loadable module form", () => {
  withTemp((root) => {
    write(root, ".probe/x.mjs", `import x from "node:${TOKEN}";`);
    write(root, "bare.js", `const x = require("${TOKEN}");`);
    write(root, "dynamic.mjs", `const x = await import("${TOKEN}");`);
    write(root, "evil.cjs", `const x = require("node:${TOKEN}");`);
    write(root, "spawner", `const x = require("${TOKEN}");`);
    const found = findSpawnFiles(root);
    for (const rel of [".probe/x.mjs", "bare.js", "dynamic.mjs", "evil.cjs", "spawner"]) {
      assert.ok(found.includes(rel), `missing ${rel}: ${found.join(", ")}`);
    }
  });
});

test("a re-export wrapper is detected without the literal token", () => {
  assert.equal(scanReexport('export { spawn } from "./helper.mjs";'), true);
  assert.equal(scanReexport('export const ok = 1;'), false);
});

test("a missing registry path fails closed", () => {
  withTemp((root) => {
    write(root, "runner.mjs", "export {};");
    const constants = {
      RUNNER_PATH: "runner.mjs",
      TRUSTED_PATHS: [],
      TEST_HARNESS_PATHS: [],
      LEGACY_BASELINE_PATHS: [],
      LEGACY_TARGET_BASELINE: 0,
      TEST_HARNESS_BASELINE: 0,
    };
    const policy = { entries: [entry("runner.mjs", "runner"), entry("missing.mjs", "legacy-target", { nextStage: "x" })] };
    assert.throws(() => validatePolicy(policy, root, constants), (error) => error.code === "SPAWN-STALE");
  });
});

test("a duplicate registry path fails closed", () => {
  withTemp((root) => {
    write(root, "runner.mjs", "export {};");
    const constants = {
      RUNNER_PATH: "runner.mjs",
      TRUSTED_PATHS: [],
      TEST_HARNESS_PATHS: [],
      LEGACY_BASELINE_PATHS: [],
      LEGACY_TARGET_BASELINE: 0,
      TEST_HARNESS_BASELINE: 0,
    };
    const policy = { entries: [entry("runner.mjs", "runner"), entry("runner.mjs", "runner")] };
    assert.throws(() => validatePolicy(policy, root, constants), (error) => error.code === "SPAWN-DUPLICATE");
  });
});

test("a symlinked registry path fails closed", () => {
  withTemp((root) => {
    write(root, "real.mjs", "export {};");
    symlinkSync("real.mjs", join(root, "link.mjs"));
    const constants = {
      RUNNER_PATH: "link.mjs",
      TRUSTED_PATHS: [],
      TEST_HARNESS_PATHS: [],
      LEGACY_BASELINE_PATHS: [],
      LEGACY_TARGET_BASELINE: 0,
      TEST_HARNESS_BASELINE: 0,
    };
    const policy = { entries: [entry("link.mjs", "runner")] };
    assert.throws(() => validatePolicy(policy, root, constants), (error) => error.code === "SPAWN-PATH-ESCAPE");
  });
});

test("a legacy-target above its code baseline fails closed", () => {
  withTemp((root) => {
    write(root, "runner.mjs", "export {};");
    write(root, "legacy.mjs", "export {};");
    const constants = {
      RUNNER_PATH: "runner.mjs",
      TRUSTED_PATHS: [],
      TEST_HARNESS_PATHS: [],
      LEGACY_BASELINE_PATHS: ["legacy.mjs"],
      LEGACY_TARGET_BASELINE: 0,
      TEST_HARNESS_BASELINE: 0,
    };
    const policy = { entries: [entry("runner.mjs", "runner"), entry("legacy.mjs", "legacy-target", { nextStage: "x" })] };
    assert.throws(() => validatePolicy(policy, root, constants), (error) => error.code === "SPAWN-POLICY-INVALID");
  });
});

test("malformed policy JSON fails closed", () => {
  withTemp((root) => {
    const policyPath = join(root, "policy.json");
    writeFileSync(policyPath, "{ not json");
    assert.throws(
      () => runGate(root, { policyPath }),
      (error) => error instanceof GateError && error.code === "SPAWN-POLICY-INVALID",
    );
  });
});

test("a planted unregistered file fails the full gate", () => {
  withTemp((root) => {
    const entries = [];
    const add = (path, cls, extra = {}) => {
      write(root, path, `const x = require("${TOKEN}");`);
      entries.push(entry(path, cls, extra));
    };
    add("runner.mjs", "runner");
    for (let index = 0; index < 5; index += 1) add(`trusted${index}.mjs`, "trusted-controller");
    for (let index = 0; index < 9; index += 1) add(`test/harness${index}.test.mjs`, "test-harness");
    for (let index = 0; index < 8; index += 1) {
      add(`legacy${index}.mjs`, "legacy-target", { nextStage: "later" });
    }
    const constants = {
      RUNNER_PATH: "runner.mjs",
      TRUSTED_PATHS: entries.filter((item) => item.class === "trusted-controller").map((item) => item.path),
      TEST_HARNESS_PATHS: entries.filter((item) => item.class === "test-harness").map((item) => item.path),
      LEGACY_BASELINE_PATHS: entries.filter((item) => item.class === "legacy-target").map((item) => item.path),
      LEGACY_TARGET_BASELINE: 8,
      TEST_HARNESS_BASELINE: 9,
    };
    write(root, ".probe/unlisted.mjs", `const x = require("${TOKEN}");`);
    const result = runGate(root, { policy: { entries }, constants });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((line) => line.startsWith("SPAWN-UNCLASSIFIED: .probe/unlisted.mjs")));
  });
});

test("the live registry constants are the documented baseline", () => {
  assert.equal(CONSTANTS.RUNNER_PATH, "kernel/exec/runner.mjs");
  assert.equal(CONSTANTS.LEGACY_TARGET_BASELINE, 8);
  assert.equal(CONSTANTS.TEST_HARNESS_BASELINE, 9);
  assert.equal(CONSTANTS.TRUSTED_PATHS.length, 5);
  assert.equal(CONSTANTS.TEST_HARNESS_PATHS.length, 9);
});
