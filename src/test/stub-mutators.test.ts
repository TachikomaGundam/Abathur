// Pure-mutator unit seam (todo 5 substrate): deterministic seeded selection +
// anchor discipline. The end-to-end "fix lifts score" test stays in bench-toy.

import assert from "node:assert/strict";
import { test } from "node:test";

import { scriptedPatches, selectPatches } from "../core/evolve/stub-mutators.mjs";

test("stub-mutators: seeded selection is deterministic and clamped", () => {
  const table = scriptedPatches();
  assert.ok(table.length >= 2);
  assert.deepEqual(selectPatches(42, 2), selectPatches(42, 2));
  assert.equal(selectPatches(42, 2).length, 2);
  assert.equal(selectPatches(7, 99).length, table.length); // count clamps to table size
  assert.deepEqual(selectPatches(3, 0), []);
  // argument guards in the plain-JS mutator are TypeErrors (no CLI exit boundary here)
  assert.throws(() => selectPatches(-1, 1), TypeError);
  assert.throws(() => selectPatches(1.5, 1), TypeError);
  assert.throws(() => selectPatches(1, -2), TypeError);
});
