// D7 grep gate (plan success criterion 7, line 217): shipped sources under src/
// must never carry machine-bound absolute paths or vendor-specific literals.
// The README's manual `grep -rnE ... src/` review is not enforcement — this test
// IS the CI-style gate: it walks every TypeScript source file under src/, minus
// the src/test/** carve-out the plan grants (fixtures legitimately name such
// strings), and asserts each file contains neither "/home/lab" nor a
// case-sensitive "historian". A violation fails naming EVERY offending file and
// line. Repo sources resolve relative to this module (promote.test.ts pattern),
// so the gate is robust to the cwd `node --test` runs from.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/** src/ of the repo this compiled test belongs to: dist/test/*.js → ../../src. */
const SRC_DIR = fileURLToPath(new URL("../../src", import.meta.url));
/** The plan's carve-out: test sources may contain the very literals they ban. */
const TEST_DIR = path.join(SRC_DIR, "test");

const FORBIDDEN: readonly { readonly label: string; readonly needle: string }[] = [
  { label: "absolute workspace path", needle: "/home/lab" },
  { label: "vendor literal", needle: "historian" },
];

/** Recursive .ts walk; symlinks are never followed (they could escape src/). */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) found.push(full);
  }
  return found;
}

test("D7 gate: src/** outside src/test/** is free of machine-bound literals", () => {
  const violations: string[] = [];
  let scanned = 0;
  for (const file of sourceFiles(SRC_DIR)) {
    if (file.startsWith(`${TEST_DIR}${path.sep}`)) continue;
    scanned += 1;
    const lines = readFileSync(file, "utf8").split("\n");
    for (const [index, line] of lines.entries()) {
      for (const { label, needle } of FORBIDDEN) {
        if (line.includes(needle)) {
          violations.push(`${path.relative(SRC_DIR, file)}:${String(index + 1)} [${label}] ${line.trim()}`);
        }
      }
    }
  }
  // a vacuous pass (bad path resolution) must be as loud as a violation
  assert.ok(scanned > 20, `gate only scanned ${String(scanned)} sources under ${SRC_DIR} — path resolution broken`);
  assert.equal(
    violations.length,
    0,
    `D7 grep gate violated (${String(violations.length)} hit(s)):\n${violations.join("\n")}`,
  );
});
