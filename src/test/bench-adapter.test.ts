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
