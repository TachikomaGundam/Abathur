import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendEntry, verifyChain } from "../kernel/evidence/index.mjs";

const BASE = mkdtempSync(join(tmpdir(), "ab2-evidence-"));
process.env.ABATHUR_STATE_DIR = BASE;
mkdirSync(join(BASE, "evidence"), { recursive: true });
let counter = 0;

function ledger() {
  counter += 1;
  return join(BASE, "evidence", `ledger-${counter}.jsonl`);
}

test("a ledger outside the evidence roots is refused", () => {
  assert.throws(() => appendEntry("/tmp/outside-evidence.jsonl", { n: 1 }), /EVIDENCE-OUTSIDE-ROOT/);
});

test("an untouched chain verifies", () => {
  const path = ledger();
  appendEntry(path, { wave: "W2" }, { writer: "abathur", ts: "2026-11-03T00:00:00Z", now: undefined });
  appendEntry(path, { wave: "W2b" }, { writer: "abathur", ts: "2026-11-03T00:00:01Z" });
  assert.deepEqual(verifyChain(path), []);
});

test("an edited body breaks the chain", () => {
  const path = ledger();
  appendEntry(path, { value: 1 }, { writer: "w", ts: "t1" });
  appendEntry(path, { value: 2 }, { writer: "w", ts: "t2" });
  const lines = readFileSync(path, "utf8").trim().split("\n");
  const entry = JSON.parse(lines[0]);
  entry.body.value = 999;
  lines[0] = JSON.stringify(entry);
  writeFileSync(path, `${lines.join("\n")}\n`);
  assert.ok(verifyChain(path).some((p) => p.includes("hash mismatch")));
});

test("a deleted middle entry breaks the sequence", () => {
  const path = ledger();
  appendEntry(path, { n: 1 }, { writer: "w", ts: "t1" });
  appendEntry(path, { n: 2 }, { writer: "w", ts: "t2" });
  appendEntry(path, { n: 3 }, { writer: "w", ts: "t3" });
  const lines = readFileSync(path, "utf8").trim().split("\n");
  writeFileSync(path, `${[lines[0], lines[2]].join("\n")}\n`);
  const problems = verifyChain(path);
  assert.ok(problems.some((p) => p.includes("seq")) || problems.some((p) => p.includes("prev")));
});

test("a missing ledger fails closed", () => {
  assert.deepEqual(verifyChain("/tmp/definitely-not-here-ab2.jsonl"), ["ledger does not exist"]);
});
