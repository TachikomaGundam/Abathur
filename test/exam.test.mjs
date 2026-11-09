import test from "node:test";
import assert from "node:assert/strict";
import { ITEMS, examIds, findItem } from "../exam/bank.mjs";
import { draw, regressionDuty } from "../exam/draw.mjs";

test("the bank covers the five planned items and one canary", () => {
  assert.deepEqual([...examIds()].sort(), ["SR4-76", "SR4-77", "SR4-78", "SR4-79", "SR4-80"]);
  assert.equal(ITEMS.filter((item) => item.canary).length, 1);
  assert.equal(findItem("SR4-76").canary, true);
  assert.equal(findItem("SR4-76").rubric.length, 4);
});

test("draw is deterministic for a seed", () => {
  const first = draw({ seed: "2026-11-03", count: 3 });
  const second = draw({ seed: "2026-11-03", count: 3 });
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, draw({ seed: "other", count: 3 }));
});

test("canary mode always includes the canary", () => {
  for (const seed of ["a", "b", "c", "d"]) {
    assert.ok(draw({ seed, count: 2, canary: true }).includes("SR4-76"));
  }
});

test("regression duty keeps classes without two consecutive passes", () => {
  assert.deepEqual(regressionDuty([{ class: "P", verdict: "PASS" }, { class: "P", verdict: "PASS" }]), []);
  assert.deepEqual(regressionDuty([{ class: "A", verdict: "PASS" }, { class: "A", verdict: "FAIL" }]), ["A"]);
});
