#!/usr/bin/env node
// CLI front for the E1 cage-presence canary (W-2026-11-17-E R1).
// Usage: node scripts/cage-check.mjs   (from repo root)
// Contract aw-cagecheck/1 / schema cage-verdict/1.
// Exit: 0 ALIVE / 1 DEAD / 2 DISPUTED / 3 NOT-RUN — seat must run this at the
// start of any campaign that claims "inside E1 cage" and quote its output as
// the receipt; a NOT-RUN (3) means core evidence was unreadable and is NOT
// evidence of absence.
import { checkCagePresence, EXIT } from "../kernel/surface/cage-check.mjs";
const r = checkCagePresence();
console.log(JSON.stringify(r));
process.exit(EXIT[r.verdict]);
