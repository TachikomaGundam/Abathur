// Shared adapter-layer contract (todo 6 reuses these exports): fail-closed
// command rendering. Pure functions, no fixture needed.

import assert from "node:assert/strict";
import { test } from "node:test";

import { ExitSignal } from "../exit.js";
import type { BenchUnit } from "../core/spec.js";
import { renderCommand, sandboxVars, unitVars } from "../bench/adapter.js";

function expectExit2(action: () => unknown, ...needles: string[]): void {
  try {
    action();
  } catch (cause) {
    assert.ok(cause instanceof ExitSignal, `expected ExitSignal, got ${String(cause)}`);
    assert.equal(cause.code, 2);
    for (const needle of needles) assert.match(cause.message, new RegExp(needle));
    return;
  }
  assert.fail("expected ExitSignal(2), nothing thrown");
}

test("renderCommand: quote-aware argv, placeholders, fail-closed junk (exit 2)", () => {
  const unit: BenchUnit = { id: "u1", path: "dir with sp/u.mjs", split: "train" };
  assert.deepEqual(renderCommand("node {unit.path} --id {unit.id}", unitVars(unit, "/sbx")), [
    "node",
    "dir with sp/u.mjs",
    "--id",
    "u1",
  ]);
  assert.deepEqual(renderCommand("sh -c 'echo hi'", sandboxVars("/sbx")), ["sh", "-c", "echo hi"]);
  assert.deepEqual(renderCommand('run "{sandbox}"', sandboxVars("/tmp/s b")), ["run", "/tmp/s b"]);
  expectExit2(() => renderCommand("node {nope}", unitVars(unit, "/s")), "unknown placeholder");
  expectExit2(() => renderCommand("   ", unitVars(unit, "/s")), "empty");
  expectExit2(() => renderCommand('node "oops', unitVars(unit, "/s")), "unbalanced quote");
});

// S4 engine seam: {repoRoot} = the bench's ACTIVE TREE, threaded through the
// shared CommandVars constructors so both adapters resolve it identically.
// Without a threaded repoRoot the placeholder must stay FAIL-CLOSED (exit 2),
// exactly like any unknown placeholder — never a half-substituted command.

test("{repoRoot}: unitVars/sandboxVars carry the active tree into run/grader/hook templates", () => {
  const unit: BenchUnit = { id: "u1", path: "scenarios/a.md", split: "train" };
  assert.deepEqual(
    renderCommand("bash run-scenario.sh {unit.id} {repoRoot}/{unit.path}", unitVars(unit, "/sbx", "/active/tree")),
    ["bash", "run-scenario.sh", "u1", "/active/tree/scenarios/a.md"],
  );
  assert.deepEqual(
    renderCommand("bash seed-wrapped.sh {repoRoot}/seed_sandbox.sh", sandboxVars("/sbx", "/active/tree")),
    ["bash", "seed-wrapped.sh", "/active/tree/seed_sandbox.sh"],
  );
  // pre-existing keys untouched by the seam
  assert.deepEqual(unitVars(unit, "/sbx", "/r"), {
    "unit.path": "scenarios/a.md",
    "unit.id": "u1",
    sandbox: "/sbx",
    workdir: "/sbx",
    repoRoot: "/r",
  });
  assert.deepEqual(sandboxVars("/sbx", "/r"), { sandbox: "/sbx", workdir: "/sbx", repoRoot: "/r" });
});

test("{repoRoot} unthreaded ⇒ fail-closed exit 2 (unknown placeholder behavior UNCHANGED)", () => {
  const unit: BenchUnit = { id: "u1", path: "p", split: "train" };
  expectExit2(() => renderCommand("node x {repoRoot}", unitVars(unit, "/s")), "unknown placeholder");
  expectExit2(() => renderCommand("node x {repoRoot}", sandboxVars("/s")), "unknown placeholder");
  expectExit2(
    () => renderCommand("node x {repoRoot}", { worktree: "/w", brief: "/b" }),
    "unknown placeholder",
  );
});
