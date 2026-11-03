import test from "node:test";
import assert from "node:assert/strict";
import { intake, register } from "../kernel/recurrence/index.mjs";

test("the first occurrence is a normal fix", () => {
  const ledger = new Map();
  assert.equal(register(ledger, { class: "copy-paste", site: "gate" }).code, "FIRST-OCCURRENCE");
});

test("the second occurrence demands a structural fix", () => {
  const ledger = new Map();
  register(ledger, { class: "copy-paste", site: "gate" });
  assert.equal(register(ledger, { class: "copy-paste", site: "cli" }).code, "STRUCTURAL-FIX-REQUIRED");
});

test("the third occurrence is a method violation", () => {
  const ledger = new Map();
  register(ledger, { class: "copy-paste" });
  register(ledger, { class: "copy-paste" });
  const result = register(ledger, { class: "copy-paste" });
  assert.equal(result.code, "METHOD-VIOLATION");
  assert.equal(result.attempts, 3);
});

test("a defect without a class is rejected", () => {
  assert.equal(register(new Map(), { site: "x" }).code, "NO-CLASS");
});

test("every intake needs one of the three dispositions", () => {
  assert.equal(intake({ class: "x" }, null).code, "NO-DISPOSITION");
  assert.equal(intake({ class: "x" }, { kind: "existing-class", class: "A" }).code, "INTAKE-EXISTING");
  assert.equal(intake({ class: "x" }, { kind: "new-class", name: "I" }).code, "INTAKE-NEW");
  assert.equal(intake({ class: "x" }, { kind: "reject", reason: "not a class" }).code, "INTAKE-REJECTED");
  assert.equal(intake({ class: "x" }, { kind: "reject", reason: "no" }).code, "NO-REJECT-REASON");
});
