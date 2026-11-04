# wave_engine — Abathur-line OTM-independent supervisor fanout

Replaces two bottlenecks: the team engine's `maxParallel=4` cap (this engine has
no width cap; default wave width = 64, the machine's real concurrency) and
sleep-holding seats that waited in-line (cells here are fire-and-report).

State lives in `/home/lab/tmp/abathur-waves/<wave_id>/` (override: `--base` or
env `ABATHUR_WAVES_DIR`). Cell state machine: `new -> launched -> claimed ->
done/failed`; `done` requires an existing `--receipt` and every file path
mentioned in the receipt text must fall under that cell's `allowed_roots` —
violations are printed and flagged `DONE-POLLUTED`, never silent. Cross-line
roots (see `line_roots.json`) are rejected at `plan`, fail-closed.

Every cell must declare `cwd`: the directory its commands run in. `cwd` must
exist and must sit inside `allowed_roots`. Relative paths in the receipt are
resolved against `cwd`, not against the supervisor's directory. `plan` and
`done` accept `--expect-root <dir>`: all `cwd`/`allowed_roots` must be under
that root, otherwise the command fails before writing or marking done.

## Supervisor usage (5 commands)

All commands run from the repo root. Do not rely on an inherited current
directory.

1. `cd /home/lab/workspace/harness/Abathur && python3 tools/wave_engine/wave.py plan <manifest.json>`
   — validates ids/deps/kinds/roots/cwd, writes launchpacks, prints topological waves.
2. `cd /home/lab/workspace/harness/Abathur && python3 tools/wave_engine/wave.py launch <wave_id> --cells all`
   — marks ready cells launched and prints numbered `task(...)` dispatch lines;
   fire ALL of them in ONE message — that is the concurrency.
3. Each cell seat starts with `cd <its cwd> &&` and runs:
   `python3 /home/lab/workspace/harness/Abathur/tools/wave_engine/wave.py claim <wave> <cell>`,
   then `... done <wave> <cell> --receipt <path>` (or `fail ... --note ...`).
4. `cd /home/lab/workspace/harness/Abathur && python3 tools/wave_engine/wave.py status <wave_id>` — per-cell dashboard.
5. `cd /home/lab/workspace/harness/Abathur && python3 tools/wave_engine/wave.py gauge` — all-wave saturation: sessions in
   flight vs target 64, cells/hour, rework rate, cold-start/work timings,
   read-only cloud in-flight from VideoGen `CLOUDQ.tsv` when present.

Retry: `cd /home/lab/workspace/harness/Abathur && python3 tools/wave_engine/wave.py requeue <wave> <cell>`
(failed -> new; done stays terminal).
Tests: `cd /home/lab/workspace/harness/Abathur && python3 -m pytest tools/wave_engine/tests -q`.

## Manifest shape

```json
{
  "wave_id": "example-20261104",
  "cells": [
    {
      "cell_id": "alpha",
      "kind": "gen",
      "brief_path": "/home/lab/workspace/harness/Abathur/handoffs/example.md",
      "allowed_roots": ["/home/lab/workspace/harness/Abathur"],
      "cwd": "/home/lab/workspace/harness/Abathur",
      "deps": []
    }
  ]
}
```

`allowed_roots`, `cwd`, `brief_path`, `cell_id`, and `kind` are mandatory.
Cross-line roots are rejected; a cell may not write into another line's repo.
