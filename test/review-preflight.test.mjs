import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { reviewPreflight } from "../kernel/governance/review-preflight.mjs";

const dir = mkdtempSync(join(tmpdir(), "review-pre-"));
const rec = join(dir, "receipt.txt");
const body = "probe output: guard heartbeats stop 2026-11-16T11:33:48Z\n";
writeFileSync(rec, body);
const recSha = createHash("sha256").update(body).digest("hex");

const base = () => ({
  kind: "preflight",
  version: 1,
  goal: "should the clause be pinned",
  purpose: "audit",
  orderedBy: "m00591",
  artifactAuthor: "other:pcbx@h.pcbx.dev",
  convenerSession: "ses_02423d730ffeqFX3rU3H0afl5h",
  probeAttempts: [{ question: "when did guard heartbeats stop", receiptPath: rec, receiptSha256: recSha }],
  probeWaiver: null,
  engineProof: null,
});
const io = { read: (p) => (p === rec ? body : null) };

test("PASS: owner-ordered, independent chain, receipts verify", () => {
  const r = reviewPreflight(base(), io);
  assert.equal(r.verdict, "PASS");
  assert.equal(r.flags.mechanical, true);
});

test("REFUSE: convener is the artifact author (seat chain)", () => {
  const t = base();
  t.artifactAuthor = "seat:run-x";
  t.convenerSession = "seat:run-x";
  const r = reviewPreflight(t, io);
  assert.equal(r.verdict, "REFUSE");
  assert.match(r.reasons[0], /convener-is-author/);
});

test("REFUSE: receipt sha mismatch or unreadable path", () => {
  const t = base();
  t.probeAttempts = [{ question: "q", receiptPath: rec, receiptSha256: "f".repeat(64) }];
  assert.match(reviewPreflight(t, io).reasons[0], /sha-mismatch/);
  const t2 = base();
  t2.probeAttempts = [{ question: "q", receiptPath: join(dir, "nope.txt"), receiptSha256: recSha }];
  assert.match(reviewPreflight(t2, io).reasons[0], /receipt-unreadable/);
});

test("REFUSE: unknown purpose (research is banned) and malformed fields", () => {
  const t = base(); t.purpose = "research";
  assert.match(reviewPreflight(t, io).reasons[0], /unknown-purpose/);
  const t2 = base(); t2.orderedBy = "trust me";
  assert.match(reviewPreflight(t2, io).reasons[0], /orderedBy-not-msgref/);
  const t3 = base(); t3.convenerSession = null; t3.engineProof = null;
  assert.match(reviewPreflight(t3, io).reasons[0], /convener-unknown/);
  assert.match(reviewPreflight("not json", io).reasons[0], /ticket-not-json/);
});

test("REFUSE: no probe evidence without waiver; draft/adjudicate need waiver", () => {
  const t = base(); t.probeAttempts = [];
  assert.match(reviewPreflight(t, io).reasons[0], /probe-evidence-missing/);
  const t2 = base(); t2.purpose = "draft"; t2.probeAttempts = [];
  assert.match(reviewPreflight(t2, io).reasons[0], /purpose-probe-waiver-required/);
  const t3 = base(); t3.purpose = "draft"; t3.probeAttempts = []; t3.probeWaiver = "clause drafting";
  assert.equal(reviewPreflight(t3, io).verdict, "PASS");
  const t4 = base(); t4.purpose = "draft"; // probes present, no waiver needed
  assert.equal(reviewPreflight(t4, io).verdict, "PASS");
});

test("NOT-INDEPENDENT: seat-authored + unverifiable convener chain (2026-11-19 class)", () => {
  const t = base();
  t.artifactAuthor = "seat:run-1794809298568-0f94d91ff2191a97";
  t.convenerSession = null;
  t.engineProof = "convened by operator-injected review adapter, convener engine id not captured";
  const r = reviewPreflight(t, io);
  assert.equal(r.verdict, "NOT-INDEPENDENT");
  assert.match(r.reasons[0], /convener-chain-unverifiable/);
});

test("NOT-INDEPENDENT: independent chain but no owner-order reference", () => {
  const t = base();
  t.orderedBy = null;
  const r = reviewPreflight(t, io);
  assert.equal(r.verdict, "NOT-INDEPENDENT");
  assert.match(r.reasons.join("|"), /no owner-order reference/);
});

test("relative receipt path rejected (receipts are contract anchors)", () => {
  const t = base();
  t.probeAttempts = [{ question: "q", receiptPath: "relative/path.txt", receiptSha256: recSha }];
  assert.match(reviewPreflight(t, io).reasons[0], /receiptPath-not-absolute/);
});

rmSync(dir, { recursive: true, force: true });
