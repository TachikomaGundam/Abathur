# CARRY-OVERRIDES

No entries.

Policy: at most 3 entries and at most 10% of the v2 file count. Each entry must
name a v1 path, a v2 path, a reason, and an independent `sibyl_audit` receipt
(APPROVE + INDEPENDENT + the entry text sha256). Entries are written as
backticked paths on one line so the copy gate can parse them.

Format when an entry exists:

- `v1/path/a.py` -> `v2/path/a.py` — reason — APPROVE INDEPENDENT sibyl-<ts>-<hex> text_sha256:<64hex>
