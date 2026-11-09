import test from "node:test";
import assert from "node:assert/strict";
import { loadRegistry, validateRegistry } from "../kernel/planning/registry.mjs";
import { examIds } from "../exam/bank.mjs";

test("shipped registry is valid and covers every class", () => {
  const registry = loadRegistry();
  assert.deepEqual(validateRegistry(registry, examIds()), []);
  const classes = new Set(registry.clauses.map((clause) => clause.class));
  assert.deepEqual([...classes].sort(), ["A", "B", "C", "D", "E", "F", "G", "H", "P"]);
});

test("duplicate ids are rejected by name", () => {
  const registry = {
    clauses: [
      { id: "X-1", class: "A", statement: "a long enough statement", check: { cmd: "true", expect_rc: 0 }, no_exam_reason: "infra", evidence: "/tmp/x" },
      { id: "X-1", class: "A", statement: "a long enough statement", check: { cmd: "true", expect_rc: 0 }, no_exam_reason: "infra", evidence: "/tmp/x" },
    ],
  };
  const problems = validateRegistry(registry);
  assert.ok(problems.some((p) => p.includes("duplicate id X-1")));
});

test("unknown exam item is a named violation", () => {
  const registry = loadRegistry();
  const problems = validateRegistry(registry, new Set());
  assert.ok(problems.some((p) => p.includes("not present in exam bank")));
});

test("exam/no-exam exclusivity is enforced", () => {
  const registry = {
    clauses: [
      {
        id: "X-2",
        class: "B",
        statement: "a long enough statement",
        check: { cmd: "true", expect_rc: 0 },
        exam_item: "SR4-76",
        no_exam_reason: "both",
        evidence: "/tmp/x",
      },
    ],
  };
  assert.ok(validateRegistry(registry).some((p) => p.includes("exactly one")));
});
