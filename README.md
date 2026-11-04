# Abathur v2

Rebuilt from an empty directory. Nine methodological classes, nine kernel
modules, one rule registry.

- Classes: A identity, B isolation, C evidence, D judgment, E human gates,
  F recurrence, G hygiene, H lanes, P planning.
- Rules: `rules/registry.yaml` is the single authority. Generated text lives in
  `rules/generated/RULES.md` and must never be edited by hand.
- Tests: `npm test` (Node 22 native test runner, zero runtime dependencies).
- Human gates (`promote`, `tombstone`, `publish`) are never executed here; the
  CLI prints a prescription and exits non-zero.

## Layout

```
kernel/identity    A
kernel/surface     B
kernel/evidence    C
kernel/judge       D
kernel/gate        E
kernel/recurrence  F
kernel/hygiene     G
kernel/lane        H
kernel/planning    P
exam/              exam bank, draw, runner
cli/               command surface
scripts/           audit helpers (receipts, quality, baseline)
```

## Environment injection

External instruments are injected, never hardcoded:

| Variable | Used by | Unset behaviour |
|---|---|---|
| `ABATHUR_ANCHOR_CMD` | evidence anchor | `ANCHOR UNDISPATCHABLE` rc=2 |
| `ABATHUR_SESSION_VERIFIER` | judge defect ledger | `SESSION VERIFIER UNDISPATCHABLE` rc=2 |
| `ABATHUR_SEAT_CMD` / `ABATHUR_JUDGE_CMD` | exam runner | `EXAM CHANNEL UNDISPATCHABLE` rc=2 |
| `ABATHUR_COPY_GATE_CMD` | copy gate | `COPY GATE UNDISPATCHABLE` rc=2 |

## State directory

Abathur keeps run records, temporary work, denial receipts, and state-scoped evidence under:

```text
${XDG_STATE_HOME:-~/.local/state}/abathur
```

The directory is created on first use. No setup step is required. Deletions are confined to its `tmp/` subtree; nothing outside it (or the repository's own evidence tree) can be removed by the hygiene commands.

## Uninstall

```bash
npm uninstall -g @tachikomagundam/abathur
rm -rf "${XDG_STATE_HOME:-$HOME/.local/state}/abathur"
```

The second line removes run records and temporary files. Keep the directory if you want to retain denial receipts and state-scoped evidence.
