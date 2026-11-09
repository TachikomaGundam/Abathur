# wave_engine — Abathur-line OTM-independent supervisor fanout

Replaces two bottlenecks: the team engine's `maxParallel=4` cap (this engine has
no width cap; default wave width = 64, the machine's real concurrency) and
sleep-holding seats that waited in-line (cells here are fire-and-report).

State lives in `$HOME/.local/state/abathur/waves/<wave_id>/` (override: `--base` or
env `ABATHUR_WAVES_DIR`). Cell state machine: `new -> launched -> claimed ->
done/failed`; `done` requires an existing `--receipt`. Receipt paths outside
`allowed_roots` or inside a declared protected surface are printed and flagged
`DONE-POLLUTED`, never silent. Cross-line roots and protected surfaces (from
`line_roots.local.json`) are rejected at `plan`, fail-closed.

Every cell must declare `cwd`: the directory its commands run in. `cwd` must
exist and must sit inside `allowed_roots`. Relative paths in the receipt are
resolved against `cwd`, not against the supervisor's directory. `plan` and
`done` accept `--expect-root <dir>`: all `cwd`/`allowed_roots` must be under
that root, otherwise the command fails before writing or marking done.

`line_roots.local.json` is the single source for **your** line roots and
protected surfaces. It is gitignored and machine-specific. Copy
`line_roots.example.json` to `line_roots.local.json` and edit it; the example
contains placeholder paths only, no host paths and no real surface names.
Set `ABATHUR_LINE_ROOTS` to use another path. Each line is an object
`{roots, forbidden_surfaces}`; a missing `forbidden_surfaces` key fails closed.
`plan` records the file's sha256 in each launchpack; `done` refuses with
`LINE-ROOTS-DRIFT` if the file changed after plan. A broad `allowed_root` that
merely contains a protected surface is warned and remains receipt-checked plus
human-reviewed; it is not mount enforcement. The policy lives in your local
config, never in the engine code.

A cell may declare `read_roots`: directories it may read but must not write.
They must exist and must not overlap `allowed_roots`. The dispatch line marks
`READ-ONLY REVIEW REQUIRED`. This is a declaration, not a filesystem sandbox;
same-uid bash can still write there. Real denial belongs to the mount layer.

A cell may declare `role`. Roles are frozen at session start; no hot reload.
`plan --role-dir <dir> --session-start <ISO-8601>` resolves `<dir>/<role>.md`.
A role file newer than session start fails with `RESTART-REQUIRED`; a missing
role fails with `UNKNOWN-ROLE`. If any cell declares a role, both flags are
mandatory. The host role loader remains owned by opencode.

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
      "read_roots": ["/home/lab/workspace/harness/VideoGen"],
      "cwd": "/home/lab/workspace/harness/Abathur",
      "deps": []
    }
  ]
}
```

`allowed_roots`, `cwd`, `brief_path`, `cell_id`, and `kind` are mandatory.
`read_roots` and `role` are optional. Cross-line roots are rejected; a cell may
not write into another line's repo. Protected surfaces are declared once in
your local `line_roots.local.json`, never copied into individual tickets.

## Orchestrate (cross-line read models, READ-ONLY vs VideoGen)

`orchestrate.py` derives wave read-models from the VideoGen line's roster
`evolution/production/staging/assembly/FIREABLE-v1.md`. Stdlib only; it never
writes to VideoGen. Line roots come from your `line_roots.local.json` key
`otm_videogen` (single source). Manifests are written to the same state dir as
waves (`--base` / env `ABATHUR_WAVES_DIR`), as `<wave-id>.manifest.json`.

1. `cd /home/lab/workspace/harness/Abathur && python3 tools/wave_engine/orchestrate.py plan-fires --video-gen-root /home/lab/workspace/harness/VideoGen --wave-id <id>`
   — parses the FIREABLE + FIREABLE-CANDIDATE tables into cells
   `{cell_id, kind:"gen", allowed_roots:[<otm_videogen root>], anchors:[...], wave:0}`;
   JSON to stdout + writes `<base>/<id>.manifest.json`. Unparseable roster or a
   row without a named anchor => `{"error": ...}` on stdout, exit 2 (never guesses).
2. `cd /home/lab/workspace/harness/Abathur && python3 tools/wave_engine/orchestrate.py gates --video-gen-root /home/lab/workspace/harness/VideoGen`
   — owner-gate census of the blocked table by reason class + machine line
   `TOTAL_BLOCKED=<n> <CLASS>=<n> ... HEADER_BLOCKED=<n> CROSSCHECK=OK|MISMATCH`
   (header claim vs parsed count; a mismatch is flagged, neither number trusted).
3. `cd /home/lab/workspace/harness/Abathur && python3 tools/wave_engine/orchestrate.py verif-queue --video-gen-root /home/lab/workspace/harness/VideoGen`
   — VERIF-PENDING cells with per-file FOUND/MISSING (artifact located by name
   under the video line root) + `VERIF_CELLS=<n> FILES_TOTAL=<n> FOUND=<n> MISSING=<n>`.
4. `cd /home/lab/workspace/harness/Abathur && python3 tools/wave_engine/orchestrate.py selftest`
   — cross-line safety: every parsed fire cell pins `allowed_roots` to the
   `otm_videogen` root; `wave.py`'s plan validator must REJECT a deliberate
   cross-line cell (root = aihr) and still accept an in-line cell. Prints
   `SELFTEST PASS/FAIL` with counts.
