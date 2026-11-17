#!/usr/bin/env node
// CLI front for the E1 cage-presence canary (W-2026-11-17-E R1).
// Usage: node scripts/cage-check.mjs   (from repo root)
// Exit: 0 LIVE / 1 DEAD / 2 DISPUTED — seat must run this at the start of any
// campaign that claims "inside E1 cage" and quote its output as the receipt.
import { checkCagePresence, EXIT } from "../kernel/surface/cage-check.mjs";
const r = checkCagePresence();
console.log(JSON.stringify(r));
process.exit(EXIT[r.verdict]);
