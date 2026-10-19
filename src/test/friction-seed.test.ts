// Seed-genome contract tests (split from friction.test.ts): the shipped
// genomes/abathur-self.jsonc must stay registrable — every seal glob covers a
// real file in the harness tree, and registration bytes are machine-independent.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import path from "node:path";
import test from "node:test";
import { fingerprint16, registerGenome } from "../core/genome.js";
import { filesMatching } from "../core/glob.js";
import { effectiveRepoPath, isEnvRepoLiteral, loadGenomeSpecFile } from "../core/spec.js";
import { ExitSignal } from "../exit.js";

const HARNESS_ROOT = path.resolve(new URL("../../", import.meta.url).pathname);

function touchSeal(root: string, rels: string[]): void {
  for (const rel of rels) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, "// unit\nexport function checks() { return [true]; }\n", "utf8");
  }
}

function liteSelfRepo(root: string): void {
  touchSeal(root, [
    "src/core/stats.ts",
    "src/core/ledger.ts",
    "src/core/ids.ts",
    "src/core/genome.ts",
    "src/core/promote.ts",
    "src/bench/toy.ts",
    "src/bench/fixture.ts",
    "genomes/abathur-self.jsonc",
    "scripts/copy-assets.mjs",
    "package.json",
    "tsconfig.json",
  ]);
}

test("seed genome: every seal glob covers at least one file in the REAL harness tree", () => {
  // Given: the abathur-self seed spec as shipped
  const spec = loadGenomeSpecFile(path.join(HARNESS_ROOT, "genomes/abathur-self.jsonc"));
  // When: each immutableGlob is resolved against the actual repository
  // Then: no glob is vacuous — a seal matching zero real files would make
  // `genome add abathur-self` fail closed on the shipped tree (genome.ts:77-82).
  for (const glob of spec.kernel.immutableGlobs) {
    assert.ok(
      filesMatching(HARNESS_ROOT, [glob]).length > 0,
      `seed seal glob '${glob}' matches no file under the real harness root`,
    );
  }
});

test("seed genome: fingerprint + registry stem machine-independent across ABATHUR_SELF_REPO values", (t) => {
  const spec = loadGenomeSpecFile(path.join(HARNESS_ROOT, "genomes/abathur-self.jsonc"));
  assert.equal(spec.label, "abathur-self");
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal ${...} placeholder text is the behavior under test
  assert.equal(spec.repoPath, "${ABATHUR_SELF_REPO}");
  assert.equal(isEnvRepoLiteral(spec.repoPath), true);
  assert.equal(effectiveRepoPath("relative/repo").length > 0, true);
  const fp = fingerprint16(spec);
  assert.match(fp, /^[0-9a-f]{16}$/);

  const homes: { dir: string; env: string }[] = [];
  for (const name of ["A", "B"]) {
    const root = mkdtempSync(path.join(os.tmpdir(), `abathur-selfreg-${name}-`));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const configDir = path.join(root, "config");
    mkdirSync(configDir, { recursive: true });
    const repoDir = path.join(root, "harness");
    liteSelfRepo(repoDir);
    homes.push({ dir: configDir, env: repoDir });
  }
  const [homeA, homeB] = homes as [{ dir: string; env: string }, { dir: string; env: string }];
  const saved = process.env.ABATHUR_SELF_REPO;
  try {
    process.env.ABATHUR_SELF_REPO = homeA.env;
    registerGenome(homeA.dir, path.join(HARNESS_ROOT, "genomes/abathur-self.jsonc"));
    process.env.ABATHUR_SELF_REPO = homeB.env;
    registerGenome(homeB.dir, path.join(HARNESS_ROOT, "genomes/abathur-self.jsonc"));
  } finally {
    if (saved === undefined) delete process.env.ABATHUR_SELF_REPO;
    else process.env.ABATHUR_SELF_REPO = saved;
  }
  const fileA = path.join(homeA.dir, "genomes", `${fp}.jsonc`);
  const fileB = path.join(homeB.dir, "genomes", `${fp}.jsonc`);
  assert.ok(existsSync(fileA) && existsSync(fileB), "same registry stem under both env values");
  const a = readFileSync(fileA, "utf8");
  assert.equal(a, readFileSync(fileB, "utf8"));
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal ${...} placeholder text is the behavior under test
  assert.ok(a.includes("${ABATHUR_SELF_REPO}"), "stored spec keeps the LITERAL, never the resolved path");

  // unset env => every consumer exits 2 naming the variable, never a literal dir:
  delete process.env.ABATHUR_SELF_REPO;
  const root3 = mkdtempSync(path.join(os.tmpdir(), "abathur-selfreg-C-"));
  t.after(() => rmSync(root3, { recursive: true, force: true }));
  try {
    registerGenome(root3, path.join(HARNESS_ROOT, "genomes/abathur-self.jsonc"));
    assert.fail("registration must refuse without ABATHUR_SELF_REPO");
  } catch (error) {
    assert.ok(error instanceof ExitSignal && error.code === 2);
    assert.match(error.message, /ABATHUR_SELF_REPO/);
  }
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal ${...} placeholder text is the behavior under test
  assert.equal(existsSync(path.join(root3, "${ABATHUR_SELF_REPO}")), false);
});
