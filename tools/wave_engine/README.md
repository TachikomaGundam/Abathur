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

## Supervisor usage (5 commands)

1. `python3 tools/wave_engine/wave.py plan <manifest.json>`
   — validates ids/deps/kinds/roots, writes launchpacks, prints topological waves.
2. `python3 tools/wave_engine/wave.py launch <wave_id> --cells all`
   — marks ready cells launched and prints numbered `task(...)` dispatch lines;
   fire ALL of them in ONE message — that is the concurrency.
3. Each cell seat: `wave.py claim <wave> <cell>` at start,
   then `wave.py done <wave> <cell> --receipt <path>` (or `fail ... --note ...`).
4. `python3 tools/wave_engine/wave.py status <wave_id>` — per-cell dashboard.
5. `python3 tools/wave_engine/wave.py gauge` — all-wave saturation: sessions in
   flight vs target 64, cells/hour, rework rate, cold-start/work timings,
   read-only cloud in-flight from VideoGen `CLOUDQ.tsv` when present.

Retry: `wave.py requeue <wave> <cell>` (failed -> new; done stays terminal).
Tests: `python3 -m pytest tools/wave_engine/tests -q`.
