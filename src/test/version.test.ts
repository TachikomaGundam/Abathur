// Version pins: engineVersion() must equal the package.json version (single
// source) and `abathur --version` must print exactly that on stdout — the
// plugin's version probe parses the line.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";

import { engineVersion } from "../version.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("engineVersion equals package.json version", () => {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { version: string };
  assert.equal(engineVersion(), pkg.version);
});

test("abathur --version prints the version on stdout, exit 0", () => {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { version: string };
  const cli = path.join(repoRoot, "dist", "cli.js");
  for (const flag of ["--version", "-v", "version"]) {
    const result = spawnSync(process.execPath, [cli, flag], { encoding: "utf8" });
    assert.equal(result.status, 0, `${flag} must exit 0`);
    assert.equal(result.stdout.trim(), pkg.version, `${flag} must print the bare version`);
  }
});
