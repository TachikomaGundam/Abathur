import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const product = ["si", "byl"].join("");
const productZh = String.fromCharCode(0x897f, 0x6bd4, 0x62c9);

test("v2 tree has no hard-coded review product name", () => {
  const result = spawnSync(process.execPath, ["scripts/scan-coupling.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /COUPLING OK/);
});

test("scanner catches a planted product name", () => {
  const dir = mkdtempSync(join(tmpdir(), "coupling-"));
  try {
    writeFileSync(join(dir, "bad.mjs"), `// ${product}\n// ${productZh}\nexport const x = 1;\n`);
    const result = spawnSync(process.execPath, ["scripts/scan-coupling.mjs", "--root", dir], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /COUPLING FAIL/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
