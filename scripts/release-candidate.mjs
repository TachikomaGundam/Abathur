#!/usr/bin/env node
// Build a release candidate from a named commit, never from the working tree.
// Usage: node scripts/release-candidate.mjs --commit <sha> [--out <dir>]
// Writes a receipt with commit, version, tarball sha256, and file count, then
// removes its private temp root. No network, no publish, no tag.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkInside, evidenceRoots, tempRoot } from "../kernel/surface/containment.mjs";

function fail(message, code = 2) {
  process.stderr.write(`RELEASE-CANDIDATE: ${message}\n`);
  process.exit(code);
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", ...options });
  if (result.error) fail(`${cmd}: ${result.error.message}`);
  if (result.status !== 0) fail(`${cmd} ${args.join(" ")}: ${(result.stderr || result.stdout || "").trim()}`, 1);
  return result.stdout;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write("usage: node scripts/release-candidate.mjs --commit <sha> [--out <dir>]\n");
  process.exit(0);
}
const commitIndex = args.indexOf("--commit");
if (commitIndex === -1 || !args[commitIndex + 1]) fail("--commit is required");
const requested = args[commitIndex + 1];
const outIndex = args.indexOf("--out");
const outDir = outIndex === -1
  ? join(evidenceRoots()[0], "release-candidates")
  : resolve(args[outIndex + 1] || "");
if (!checkInside(outDir, evidenceRoots()).ok) fail(`--out must be inside the evidence root: ${outDir}`);
mkdirSync(outDir, { recursive: true });

const repo = process.cwd();
const full = run("git", ["rev-parse", "--verify", `${requested}^{commit}`]).trim();
const status = run("git", ["status", "--porcelain"]).trim();

mkdirSync(tempRoot(), { recursive: true });
const work = mkdtempSync(join(tempRoot(), "release-candidate-"));
try {
  const tarPath = join(work, "src.tar");
  run("git", ["archive", "--format=tar", "-o", tarPath, full]);
  run("tar", ["-xf", tarPath, "-C", work]);
  rmSync(tarPath, { force: true });

  const pkg = JSON.parse(readFileSync(join(work, "package.json"), "utf8"));
  const packOut = run("npm", ["pack", "--pack-destination", work, "--silent"], { cwd: work }).trim().split("\n").pop();
  const built = join(work, packOut);
  const sha = sha256File(built);
  const count = Number(run("tar", ["-tzf", built]).trim().split("\n").filter(Boolean).length);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const receiptPath = join(outDir, `${full.slice(0, 12)}-${stamp}.md`);
  writeFileSync(
    receiptPath,
    [
      "# Release candidate",
      "",
      `- commit: ${full}`,
      `- version: ${pkg.version}`,
      `- tarball: ${packOut}`,
      `- sha256: ${sha}`,
      `- files: ${count}`,
      `- built_at: ${new Date().toISOString()}`,
      `- worktree_dirty_at_build: ${status ? "yes" : "no"}`,
      "- source: git archive of the named commit; the working tree is never packaged",
      "",
    ].join("\n"),
  );
  const stable = join(outDir, `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`);
  copyFileSync(built, `${stable}.tmp`);
  renameSync(`${stable}.tmp`, stable);

  process.stdout.write(`${JSON.stringify({ ok: true, commit: full, version: pkg.version, sha256: sha, files: count, tarball: stable, receipt: receiptPath })}\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
