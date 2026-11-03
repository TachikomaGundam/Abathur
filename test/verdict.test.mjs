import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { aggregate, verdictProblems } from "../kernel/judge/index.mjs";

const evidence = join(mkdtempSync(join(tmpdir(), "ab2-verdict-")), "answer.md");
writeFileSync(evidence, "answer\n");

const valid = {
  verdict: "PASS",
  canary_kill: false,
  answer_sha256: "a".repeat(64),
  judge_session: "ses_test",
  items: [{ id: "S1", status: "PASS", reason: "checked" }],
  evidence: [evidence],
};

test("a well-formed verdict passes", () => {
  assert.deepEqual(verdictProblems(valid), []);
  assert.equal(aggregate(valid), "PASS");
});

test("an unknown status is named", () => {
  const bad = { ...valid, items: [{ id: "S1", status: "MAYBE", reason: "checked" }] };
  assert.ok(verdictProblems(bad).some((p) => p.includes("illegal status MAYBE")));
});

test("empty reasons are rejected", () => {
  const bad = { ...valid, items: [{ id: "S1", status: "PASS", reason: "" }] };
  assert.ok(verdictProblems(bad).some((p) => p.includes("reason too short")));
});

test("relative or missing evidence is rejected", () => {
  assert.ok(verdictProblems({ ...valid, evidence: ["relative.md"] }).some((p) => p.includes("absolute")));
  assert.ok(verdictProblems({ ...valid, evidence: ["/nope/nope.md"] }).some((p) => p.includes("does not exist")));
});

test("a failing item makes the aggregate FAIL", () => {
  assert.equal(aggregate({ ...valid, items: [{ id: "S1", status: "FAIL", reason: "bad" }] }), "FAIL");
});
