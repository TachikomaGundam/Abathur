import test from "node:test";
import assert from "node:assert/strict";
import { generateRules, renderRules } from "../kernel/planning/generate.mjs";
import { loadRegistry } from "../kernel/planning/registry.mjs";

test("rendering is deterministic", () => {
  const registry = loadRegistry();
  const first = renderRules(registry);
  const second = renderRules(registry);
  assert.equal(first, second);
  assert.ok(first.startsWith("# Generated rules — do not edit by hand"));
  assert.ok(first.includes(`registry-sha256: ${registry.sha256}`));
});

test("clauses are sorted by id and carry their check", () => {
  const text = renderRules(loadRegistry());
  const positions = ["A-IDENTITY-01", "B-SURFACE-01", "C-EVIDENCE-CHAIN-01"].map((id) => text.indexOf(id));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.ok(text.includes("node --test test/identity.test.mjs"));
});

test("generated text hash changes with content", () => {
  const registry = loadRegistry();
  const a = generateRules();
  const mutated = { ...registry, clauses: registry.clauses.slice(1) };
  const b = renderRules(mutated);
  assert.notEqual(a.text, b);
  assert.match(a.sha256, /^[0-9a-f]{64}$/);
});
