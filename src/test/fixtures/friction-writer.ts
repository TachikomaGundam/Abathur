// Child-process entrypoint for the concurrent friction-append test (AC f).
// Stands in for two genomes running `abathur` at once — the one place under
// src/test where touching `process` is legitimate.

import { appendFriction } from "../../core/ledger.js";

const [configDir, source, countRaw] = process.argv.slice(2);
const count = Number(countRaw);
if (configDir === undefined || source === undefined || !Number.isInteger(count) || count < 0) {
  process.stderr.write("usage: friction-writer <configDir> <source> <count>\n");
  process.exit(2);
}

// 200 back-to-back acquisitions in one process; production appends one event
// per call on the default 15s budget, so the loop raises its own deadline.
for (let seq = 0; seq < count; seq += 1) {
  appendFriction(configDir, { kind: "friction", data: { source, seq } }, { waitMs: 60_000 });
}
process.exit(0);
