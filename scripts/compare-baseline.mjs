#!/usr/bin/env node
/**
 * Compare production, v2 remote, and the main tree against the frozen baseline.
 * Baseline path comes from ABATHUR_BASELINE or the default harness path.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const BASELINE = process.env.ABATHUR_BASELINE ?? "/home/lab/workspace/harness/Abathur/.omo/evidence/refactor-baseline-20261103.txt";
const PRODUCTION = "/home/lab/.npm-global/lib/node_modules/@tachikomagundam";
const MAIN = "/home/lab/workspace/harness/Abathur";
const V2 = "/home/lab/workspace/harness/Abathur-v2";

if (!existsSync(BASELINE)) {
  process.stdout.write(`BASELINE MISSING ${BASELINE}\n`);
  process.exitCode = 2;
  process.exit();
}

const baseline = readFileSync(BASELINE, "utf8");
const auto = /## AUTO[\s\S]*?HEAD:\s*([0-9a-f]{40})[\s\S]*?STATUS:\n([\s\S]*?)(?:\n## |\n*$)/.exec(baseline);
const snapshot = /## PRE-REFACTOR SNAPSHOT[\s\S]*?PRODUCTION LISTING:\n([\s\S]*?)\nMAIN REMOTES:/.exec(baseline);
if (!auto || !snapshot) {
  process.stdout.write("BASELINE PARSE FAILED\n");
  process.exitCode = 2;
  process.exit();
}

const problems = [];

const listed = snapshot[1]
  .split("\n")
  .filter((line) => /^[d-]/.test(line))
  .map((line) => line.trim().split(/\s+/).pop())
  .filter((name) => name && name !== "." && name !== "..")
  .sort();
const actual = existsSync(PRODUCTION) ? readdirSync(PRODUCTION).sort() : [];
if (JSON.stringify(listed) !== JSON.stringify(actual)) {
  problems.push(`production listing changed: baseline=[${listed}] actual=[${actual}]`);
}

const remote = spawnSync("git", ["-C", V2, "remote", "-v"], { encoding: "utf8" });
if (remote.status !== 0 || remote.stdout.trim() !== "") {
  problems.push(`v2 remote is not empty: ${remote.stdout.trim() || remote.stderr.trim()}`);
}

const head = spawnSync("git", ["-C", MAIN, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
if (head !== auto[1]) problems.push(`main HEAD changed: ${head} != ${auto[1]}`);

const status = spawnSync("git", ["-C", MAIN, "status", "--porcelain"], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } })
  .stdout.split("\n").filter(Boolean).sort().join("\n").trim();
const expected = auto[2].split("\n").map((line) => line).filter(Boolean).sort().join("\n").trim();
if (status !== expected) problems.push("main status differs from baseline");

for (const problem of problems) process.stdout.write(`BASELINE DIFF: ${problem}\n`);
process.stdout.write(`BASELINE ${problems.length === 0 ? "OK" : "DIFF"} problems=${problems.length} rc=${problems.length === 0 ? 0 : 1}\n`);
process.exitCode = problems.length === 0 ? 0 : 1;
