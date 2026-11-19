#!/usr/bin/env node
// Read-only ledger chain verifier (owner activation-gate item 3).
// Usage: node scripts/verify-ledger.mjs [path]   default: newest .omo/ledger-entry*.txt
// Exit: 0 chain valid, 1 broken, 2 cannot-answer (no ledger found — fail-closed).
import fs from "node:fs";
import path from "node:path";
import { entryHash } from "../kernel/evidence/index.mjs";

const dir = path.resolve(import.meta.dirname, "..", ".omo");
let target = process.argv[2];
if (!target) {
  const cands = fs
    .readdirSync(dir)
    .filter((f) => /^ledger-entry\d+\.txt$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  if (cands.length === 0) {
    process.stdout.write(JSON.stringify({ verdict: "CANNOT-ANSWER", why: "no ledger-entry files" }) + "\n");
    process.exit(2);
  }
  target = path.join(dir, cands[cands.length - 1]);
}
const lines = fs.readFileSync(target, "utf8").trimEnd().split("\n");
let prev = null;
let bad = 0;
for (let i = 0; i < lines.length; i++) {
  let e;
  try {
    e = JSON.parse(lines[i]);
  } catch {
    process.stdout.write(`LINE ${i + 1}: UNPARSEABLE\n`);
    bad++;
    continue;
  }
  const h = entryHash(e.prev, e.body, e.writer, e.ts);
  if (h !== e.hash) {
    process.stdout.write(`SEQ ${e.seq}: HASH MISMATCH (recomputed ${h})\n`);
    bad++;
  }
  if (i > 0 && e.prev !== prev) {
    process.stdout.write(`SEQ ${e.seq}: PREV LINK BAD\n`);
    bad++;
  }
  prev = e.hash;
}
process.stdout.write(
  JSON.stringify({ file: target, entries: lines.length, bad, verdict: bad ? "BROKEN" : "OK", lastHash: prev }) + "\n"
);
process.exit(bad ? 1 : 0);
