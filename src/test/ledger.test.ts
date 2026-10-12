// Todo 2 pins: append-only ledger file semantics (plan AC b, c + resume).
// Lock/friction pins live in ledger-lock.test.ts. TDD RED first.

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { canonicalJson } from "../core/ids.js";
import { LEDGER_KIND_GENERATION_COMPLETE, Ledger, LedgerError, ledgerPath } from "../core/ledger.js";
import { FIXED_CLOCK, freshPair, rawLines } from "./testutil.js";

function seedLedgerFile(genome: string, text: string): void {
  mkdirSync(path.dirname(ledgerPath(genome)), { recursive: true });
  writeFileSync(ledgerPath(genome), text, "utf8");
}

// --------------------------------------------------------- append + read-back

test("1000 appends read back byte-exact via a single O_APPEND write each (AC b)", async (t) => {
  const { genome } = await freshPair(t);
  const ledger = Ledger.open(genome, FIXED_CLOCK);
  const expected: string[] = [];
  for (let seq = 0; seq < 1000; seq += 1) {
    const rec = ledger.append({ kind: "run_result", data: { seq, note: "x".repeat(seq % 7) } });
    expected.push(`${canonicalJson(rec)}\n`);
  }
  assert.equal(readFileSync(ledgerPath(genome), "utf8"), expected.join(""));
  const all = ledger.readAll();
  assert.equal(all.length, 1000);
  assert.deepEqual(
    all.map((r) => r.data.seq),
    Array.from({ length: 1000 }, (_, i) => i),
  );
});

test("append stamps ts from the injected clock and fails closed on invalid records", async (t) => {
  const { genome } = await freshPair(t);
  const ledger = Ledger.open(genome, FIXED_CLOCK);
  const rec = ledger.append({ kind: "k", genId: "g-1", data: { z: [1, { b: 2, a: 3 }] } });
  assert.deepEqual(rec, {
    v: 1,
    ts: "2026-09-09T12:00:00.000Z",
    kind: "k",
    genId: "g-1",
    data: { z: [1, { b: 2, a: 3 }] },
  });
  assert.throws(() => ledger.append({ kind: "" }), Error);
  assert.throws(() => ledger.append({ kind: "k", genId: "" }), Error);
  assert.equal(rawLines(ledgerPath(genome)).length, 1, "failed appends must write nothing");
});

// ------------------------------------------------------------- corrupt tail

test("pre-truncated tail is quarantined to ledger.corrupt-*, prior records preserved verbatim (AC c)", async (t) => {
  const { genome } = await freshPair(t);
  const good = Array.from({ length: 10 }, (_, i) =>
    canonicalJson({
      v: 1,
      ts: `2026-09-09T12:00:0${i}.000Z`,
      kind: LEDGER_KIND_GENERATION_COMPLETE,
      genId: `g-${i}`,
      data: {},
    }),
  ).join("\n");
  const partial = '{"v":1,"ts":"2026-09-09T12:00:10.000Z","kind":"gen';
  const original = `${good}\n${partial}`;
  seedLedgerFile(genome, original);

  const ledger = Ledger.open(genome, FIXED_CLOCK);
  const dir = path.dirname(ledgerPath(genome));
  const corruptName = readdirSync(dir).find((f) => f.startsWith("ledger.corrupt-"));
  assert.ok(corruptName, "quarantine file ledger.corrupt-* must exist");
  // The archive keeps the FULL original bytes — nothing is lost, only relocated.
  assert.equal(readFileSync(path.join(dir, corruptName), "utf8"), original);
  // The ledger keeps the 10 complete lines byte-identical, newline-terminated.
  assert.equal(readFileSync(ledgerPath(genome), "utf8"), `${good}\n`);
  assert.deepEqual(
    ledger.readAll().map((r) => r.genId),
    Array.from({ length: 10 }, (_, i) => `g-${i}`),
  );

  const next = ledger.append({ kind: "after_repair" });
  assert.equal(next.kind, "after_repair");
  assert.equal(ledger.readAll().length, 11);
});

test("entire-file partial write (no newline anywhere) quarantines to an empty valid ledger", async (t) => {
  const { genome } = await freshPair(t);
  seedLedgerFile(genome, '{"v":1,"ts":');
  const ledger = Ledger.open(genome, FIXED_CLOCK);
  assert.deepEqual(ledger.readAll(), []);
  assert.equal(readFileSync(ledgerPath(genome), "utf8"), "");
});

test("malformed line in the MIDDLE is an integrity failure, never silently skipped or repaired", async (t) => {
  const { genome } = await freshPair(t);
  const l1 = canonicalJson({ v: 1, ts: "t", kind: "a", data: {} });
  const l3 = canonicalJson({ v: 1, ts: "t", kind: "c", data: {} });
  seedLedgerFile(genome, `${l1}\n{"v":1,"ts":oops}\n${l3}\n`);
  for (const attempt of [
    () => Ledger.open(genome, FIXED_CLOCK),
    () => Ledger.open(genome).readAll(),
  ]) {
    assert.throws(
      attempt,
      (e: unknown) => e instanceof LedgerError && /line 2/.test(e.message),
      "mid-file corruption must name the offending line",
    );
  }
  assert.ok(
    !readdirSync(path.dirname(ledgerPath(genome))).some((f) => f.startsWith("ledger.corrupt-")),
    "integrity failure must not quarantine anything",
  );
});

// --------------------------------------------------------------- resume API

test("lastCompleteGeneration: null when empty or no matching kind, latest generation_complete otherwise", async (t) => {
  const { genome } = await freshPair(t);
  const ledger = Ledger.open(genome, FIXED_CLOCK);
  assert.equal(ledger.lastCompleteGeneration(), null);
  ledger.append({ kind: "run_result", genId: "g-a", data: {} });
  assert.equal(ledger.lastCompleteGeneration(), null);
  ledger.append({ kind: LEDGER_KIND_GENERATION_COMPLETE, genId: "g-a" });
  ledger.append({ kind: "run_result", genId: "g-b" });
  ledger.append({ kind: LEDGER_KIND_GENERATION_COMPLETE, genId: "g-b" });
  assert.equal(ledger.lastCompleteGeneration(), "g-b");
  // A fresh instance sees the same state — resume reads the file, not memory.
  assert.equal(Ledger.open(genome, FIXED_CLOCK).lastCompleteGeneration(), "g-b");
});
