# Changelog

All notable changes to Abathur are documented here.

## 0.1.0 — 2026-09-10

First release. An evolution harness for OpenCode agents:
mutation → fitness-eval → selection, with promotion held by a human gate.

### Core loop

- Genome specs (JSONC): bench units with train/val split, adapter commands,
  statistics config, evolution budget, kernel-immutable globs. Identity is the
  sha256 content fingerprint; labels are free. Registry, kernel manifests,
  friction queue, and graft queue live out-of-tree under the config dir
  (`~/.config/abathur`, or the dirname of `$ABATHUR_CONFIG`).
- `run`: incumbent → brief → mutator session (command template, argv-spawned,
  never a shell) → candidate diffs → seal → re-bench → stats verdicts, with
  worktree isolation and hard budget caps (truncation is `inconclusive`,
  never a fake pass). `--dry-run` proves `requires[]` probes with zero spawns.
- Selection stats (todo-7 gates): repeated-unit gains with confidence
  half-width, min-effect, val-regression guard; verdicts
  nominated/culled/indeterminate/inconclusive map to exit 0/1/1/2.
- Append-only per-genome ledger at `<repoPath>/.state/abathur/ledger.jsonl`;
  `status` (read-only), `promote` (the only path to a new incumbent; reseals
  the kernel from the promoted tree), `tombstone`. No `--confirm`, no `--force`
  anywhere: the CLI invocation is the human gate.

### Bench adapters

- `toy`: pure-node fixture genomes, zero model calls (ships as `toy-smoke` in
  `dist/genomes/`, plus `dist/core/evolve/stub-mutators.mjs` for scripted
  mutation loops).
- `opencode-fixture-scenarios`: sandboxed live-agent benches — mirrored
  sandbox HOME, per-unit reset/seed hooks, machine-local single-flight genome
  lock, script-first graders with optional judge model.

### Kernel seal and self-evolution

- `kernel.immutableGlobs` sealed at registration (`<configDir>/kernels/`);
  drifted trees refuse benches, sealed-path candidates are rejected at the path
  stage, `kernel audit <label>` verifies. The `abathur-self` seed
  (`genomes/abathur-self.jsonc`, machine-independent fingerprint via
  `${ABATHUR_SELF_REPO}`) benches candidates as a snapshot overlay: trusted
  test suite and golden-replay goalposts from the incumbent commit, candidate
  sources only from the overlay, harness-pinned toolchain. v1 self-evolution
  cannot change dependencies or build configuration — by design.
- `self-eval` reports fitness and never promotes. Friction digests from every
  run queue to `<configDir>/friction.jsonl` (val scrubbing is structural).

### Federation (offline)

- `bundle export`: deterministic, byte-identical re-exports; manifest schema v1
  with scoring provenance, budget counters, and train-only mask-scanned
  evidence (`<HOME>`/`<GENOME>`/`<MASKED-n>` placeholders; fail-closed leak
  gate). `bundle inspect` re-verifies every pinned member from contained bytes.
- `graft`: four byte-exact gates (genome fingerprint, benchDigest, scoring
  provenance three-way, `requires[]` probes) then a local re-bench at local
  reps/thresholds; peer scores are `peerClaim` metadata only. Decisions:
  nominated / culled / indeterminate / inconclusive / quarantined /
  pending-bench, all booked to the ledger; duplicate terminal grafts refuse.
- No transport, discovery, signatures, auto-merge, or auto-promotion in v1.

### First real genome

- `historian` template (`config/genomes/historian.example.jsonc`): Wiki.js
  scenario bench with A–J grader dimensions and a hard G gate. Machine values
  are `${VAR}` placeholders the operator resolves into a gitignored
  `*.local.jsonc`; only `repoPath` has built-in env resolution.

### Docs

- Bilingual README (mirrored zh/en), `docs/immutable-kernel.md`,
  `docs/federation.md`.
