# CARRY-OVERRIDES

No entries.

Policy: at most 3 entries and at most 10% of the v2 file count. Each entry must
name a v1 path, a v2 path, a reason, and an independent review-adapter receipt
(APPROVE + INDEPENDENT + a run id + the entry text sha256). The adapter is
injected by the operator; no product name is written into code or rules.

Format when an entry exists (one line per entry): a backticked v1 path, an arrow,
a backticked v2 path, the reason, an independent audit receipt with the words
APPROVE and INDEPENDENT plus the run id, and a text hash field. No example paths
are written here, because the gate parses every backticked path in this file as
an entry.
