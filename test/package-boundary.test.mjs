import { test } from "node:test";
import assert from "node:assert/strict";
import {
  forbiddenPackagePath,
  inspectPackageFiles,
} from "../scripts/scan-package.mjs";

test("work artifacts and source-only files are forbidden in the package", () => {
  const forbidden = [
    "tools/wave_engine/wave.py",
    "src/tools/runner.js",
    "handoffs/HANDOFF.md",
    "handoffs",
    "dockets/task.json",
    "work/notes.md",
    "workfiles/a.txt",
    "notes/release.md",
    "sessions/s1.json",
    "tmp/cache.bin",
    ".omo/evidence/ledger.md",
    "__pycache__/x.pyc",
    "lib/module.pyc",
  ];
  for (const path of forbidden) {
    assert.equal(forbiddenPackagePath(path), true, path);
  }
});

test("ordinary product files are allowed", () => {
  const clean = [
    "README.md",
    "cli/abathur-v2.mjs",
    "kernel/surface/index.mjs",
    "scripts/scan-package.mjs",
    "rules/registry.yaml",
    "docs/release/v0.5.9.md",
    "workflow.md",
    "toolshed/readme.md",
    "temporary.md",
  ];
  for (const path of clean) {
    assert.equal(forbiddenPackagePath(path), false, path);
  }
});

test("inspection returns only forbidden entries", () => {
  const files = [
    { path: "README.md" },
    { path: ".omo/evidence/ledger.md" },
    { path: "handoffs/HANDOFF.md" },
    { path: "cli/abathur-v2.mjs" },
  ];
  assert.deepEqual(
    inspectPackageFiles(files).map((entry) => entry.path),
    [".omo/evidence/ledger.md", "handoffs/HANDOFF.md"],
  );
});
