import test from "node:test";
import assert from "node:assert/strict";
import { ITEMS } from "../exam/bank.mjs";
import { runExam } from "../exam/runner.mjs";

const item = ITEMS[0];
const fakeSeat = () => ({ stdout: "copied old code, no guardrails" });
const fakeJudge = () => ({ stdout: JSON.stringify({ verdict: "FAIL", canary_kill: true }) });
const liveJudge = () => ({ stdout: JSON.stringify({ verdict: "PASS", canary_kill: false }) });

test("bell mode kills a planted fake answer", () => {
  const result = runExam({ item, mode: "bell", seat: fakeSeat, judge: fakeJudge });
  assert.equal(result.rc, 0);
  assert.equal(result.code, "BELL-KILLED");
});

test("bell mode fails when the judge misses the fake", () => {
  const result = runExam({ item, mode: "bell", seat: fakeSeat, judge: liveJudge });
  assert.equal(result.rc, 1);
  assert.equal(result.code, "BELL-MISSED");
});

test("live mode passes a legitimate answer", () => {
  const result = runExam({ item, mode: "live", seat: () => ({ stdout: "structural rewrite" }), judge: liveJudge });
  assert.equal(result.rc, 0);
  assert.equal(result.code, "LIVE-PASS");
});

test("missing channels are undispatchable", () => {
  const result = runExam({ item, mode: "bell", env: {} });
  assert.equal(result.rc, 2);
  assert.equal(result.code, "EXAM CHANNEL UNDISPATCHABLE");
});
