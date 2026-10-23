// Docs-currency gate (born INCIDENT-20261006-README-ROT: Sibyl ballots found the
// README shipping a dead install literal, a false dependency claim, and half-listed
// human gates — narrative drift nothing was checking). This test IS the gate:
// every claim class that rotted once is now machine-verified against the same
// authoritative sources the code uses (package.json, the COMMANDS registry).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { COMMANDS } from "../cli.js";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const readme = readFileSync(path.join(REPO, "README.md"), "utf8");
const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};

test("install path never pins a tarball version (glob only)", () => {
  assert.doesNotMatch(
    readme,
    /tachikomagundam-abathur-\d+\.\d+\.\d+\.tgz/,
    "a pinned x.y.z tgz literal rots every release — use the *-tgz glob form",
  );
});

test("runtime dependencies named truthfully (every real dep appears)", () => {
  for (const dep of Object.keys(pkg.dependencies)) {
    assert.ok(readme.includes(dep), `README omits runtime dependency ${dep}`);
  }
  assert.ok(!/Only `zod` is a runtime dependency/.test(readme), "stale zod-only claim");
  assert.ok(!readme.includes("运行时依赖只有 `zod`"), "stale zod-only claim (zh)");
});

test("every registered CLI command appears in the README", () => {
  for (const spec of COMMANDS) {
    assert.ok(readme.includes(spec.name), `README never mentions command '${spec.name}'`);
  }
});

test("human-gate enumeration is complete on BOTH halves", () => {
  for (const gate of ["promote", "tombstone", "retract"]) {
    assert.ok(readme.includes(gate), `gate '${gate}' missing entirely`);
  }
  assert.ok(
    /`promote`,\s*`tombstone` and `retract` are deliberately NOT reachable/.test(readme),
    "EN gate sentence must list all three",
  );
  assert.ok(
    /`promote`、`tombstone` 与 `retract` 刻意\s*不可经由工具触达/.test(readme),
    "ZH gate sentence must list all three (line-wrap tolerant)",
  );
});

test("opencode-status foreign semantics stay as the code behaves", () => {
  // status classifies 'foreign' and exits 0; only install/uninstall refuse (exit 2).
  assert.ok(!readme.includes("both commands refuse with exit 2"), "stale EN foreign claim");
  assert.ok(!readme.includes("两条命令都会 exit 2"), "stale ZH foreign claim");
  assert.ok(readme.includes("reports the foreign state and exits 0"), "EN foreign/status pair missing");
});
