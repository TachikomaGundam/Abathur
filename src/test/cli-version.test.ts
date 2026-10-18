import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { PackageVersionError, runtimeVersion } from "../version.js";

const cliPath = fileURLToPath(new URL("../cli.js", import.meta.url));
const packagePath = fileURLToPath(new URL("../../package.json", import.meta.url));
const manifest: unknown = JSON.parse(readFileSync(packagePath, "utf8"));

function packageVersion(): string {
  if (typeof manifest !== "object" || manifest === null || !("version" in manifest)) {
    throw new Error("test package manifest has no version");
  }
  const { version } = manifest;
  if (typeof version !== "string") throw new Error("test package version is invalid");
  return version;
}

for (const argument of ["--version", "-V", "version"]) {
  test(`CLI version: ${argument} bypasses an invalid config path`, () => {
    const result = spawnSync(process.execPath, [cliPath, argument], {
      encoding: "utf8",
      env: { ...process.env, ABATHUR_CONFIG: "/definitely/missing/abathur.jsonc" },
    });

    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `abathur ${packageVersion()}\n`);
  });
}

for (const command of [
  "genome",
  "run",
  "status",
  "promote",
  "re-adjudicate",
  "tombstone",
  "retract",
  "bundle",
  "graft",
  "self-eval",
  "kernel",
  "opencode",
]) {
  test(`CLI help: ${command} --help bypasses config and exits successfully`, () => {
    const result = spawnSync(process.execPath, [cliPath, command, "--help"], {
      encoding: "utf8",
      env: { ...process.env, ABATHUR_CONFIG: "/definitely/missing/abathur.jsonc" },
    });

    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /^abathur — OpenCode genome evolution harness/m);
  });
}

test("runtime version: unreadable manifest has a named error", () => {
  assert.throws(
    () => runtimeVersion(() => { throw new Error("read denied"); }),
    PackageVersionError,
  );
});

test("runtime version: malformed manifest has a named error", () => {
  assert.throws(
    () => runtimeVersion(() => "{"),
    PackageVersionError,
  );
});

test("runtime version: compiled artifact version must match the manifest", () => {
  assert.throws(
    () => runtimeVersion(() => '{"version":"0.2.10"}', () => '{"version":"0.2.9"}'),
    PackageVersionError,
  );
});

test("package exports: internal release assessment is not a public module", () => {
  if (typeof manifest !== "object" || manifest === null || !("exports" in manifest)) {
    throw new Error("test package manifest has no exports");
  }
  const { exports } = manifest;
  assert.equal(typeof exports, "object");
  assert.notEqual(exports, null);
  if (typeof exports !== "object" || exports === null) {
    throw new Error("test package exports are invalid");
  }
  assert.equal("./release-state" in exports, false);
});
