import test from "node:test";
import assert from "node:assert/strict";
import { checkCommitIdentity, loadIdentities } from "../kernel/identity/index.mjs";

const identities = loadIdentities();

test("byte-exact registered identity is attributed", () => {
  assert.equal(checkCommitIdentity({ name: "abathur", email: "abathur@local" }, identities).status, "ATTRIBUTED");
});

test("case changes are not attributed", () => {
  assert.equal(checkCommitIdentity({ name: "Abathur", email: "abathur@local" }, identities).status, "ATTRIBUTED");
  assert.equal(checkCommitIdentity({ name: "abathur", email: "Abathur@local" }, identities).status, "UNATTRIBUTED");
});

test("unknown or missing identity is unattributed with a reason", () => {
  const unknown = checkCommitIdentity({ name: "abathur-seat", email: "abathur@local" }, identities);
  assert.equal(unknown.status, "UNATTRIBUTED");
  assert.match(unknown.reason, /no registered identity/);
  assert.equal(checkCommitIdentity({}, identities).status, "UNATTRIBUTED");
});

test("whitespace is not trimmed", () => {
  assert.equal(checkCommitIdentity({ name: "abathur ", email: "abathur@local" }, identities).status, "UNATTRIBUTED");
});
