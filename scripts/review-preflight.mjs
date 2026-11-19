#!/usr/bin/env node
// CLI front for the review-council preflight gate. Read a ticket JSON from stdin:
//   cd "$(git rev-parse --show-toplevel)" && node scripts/review-preflight.mjs < ticket.json
//   node scripts/review-preflight.mjs --live-1119   # classify the 2026-11-19 launch already under way
// Exit: 0 PASS / 1 REFUSE / 2 NOT-INDEPENDENT (verdict is DATA only).
import { readFileSync } from "node:fs";
import { reviewPreflight, EXIT } from "../kernel/governance/review-preflight.mjs";

const io = {
  read: (p) => {
    try { return readFileSync(p); } catch { return null; }
  },
};

function live1119() {
  return {
    kind: "preflight",
    version: 1,
    goal: "ruling package Q1/Q2/Q3 (pin face, dead-plugin dispatch, workspace duty)",
    purpose: "draft",
    orderedBy: "m00591",
    artifactAuthor: "seat:run-1794809298568-0f94d91ff2191a97",
    convenerSession: null,
    engineProof: "convened by operator-injected review adapter; convener engine id not captured",
    probeAttempts: [],
    probeWaiver: "draft purpose: clause text needs no probe receipts; cited facts carry paths/sha",
  };
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write("usage: node scripts/review-preflight.mjs [--live-1119] < ticket.json\n");
  process.exit(0);
}
let text;
if (args.includes("--live-1119")) text = JSON.stringify(live1119());
else text = readFileSync(0, "utf8");

const result = reviewPreflight(text, io);
process.stdout.write(JSON.stringify(result) + "\n");
process.exit(EXIT[result.verdict] ?? 1);
