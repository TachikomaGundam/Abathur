import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const CLI = resolve(ROOT, "cli/abathur-v2.mjs");

function run(args, extra) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
    env: extra ? { ...process.env, ...extra } : process.env,
  });
}

test("rules validate passes on the shipped registry", () => {
  const result = run(["rules", "validate"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /RULES OK/);
});

test("promote prints a prescription and refuses to execute", () => {
  const result = run(["promote", "--id", "G99"]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /HUMAN-GATE/);
  assert.match(result.stdout, /terminal/);
});

test("an unknown exam item is blocked by name", () => {
  const result = run(["exam", "run", "SR4-00", "--mode", "bell"]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /EXAM UNKNOWN ITEM SR4-00/);
});

test("a bare subcommand prints usage with rc=2", () => {
  const result = run(["exam"]);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /usage: abathur-v2/);
});

test("a nested gate run refuses instead of recursing", () => {
  const result = run(["gate", "run"], { ABATHUR_GATE_NESTED: "1" });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /GATE NESTED/);
});
