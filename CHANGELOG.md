# Changelog

All notable changes to Abathur are documented here.

## 0.2.2 — 2026-09-11

### npm name-route plugin install (route B)

- `package.json` gained an `exports` map (`"."` → `dist/cli.js`,
  `"./server"` → `plugin/abathur.ts`, `"./package.json"`) so listing
  `"@tachikomagundam/abathur"` in opencode's `plugin` config field lets the
  loader resolve the plugin entry from the npm cache install — the shape is
  pinned by tests against opencode v1.18.30's `resolvePackageEntrypoint`
  (first `exports["./server"]`, plain-string form).
- `@opencode-ai/plugin` (1.17.x line) declared as a runtime dependency so
  arborist provisions the import beside the package inside opencode's cache
  tree — the mechanism the installed OMO plugin uses.
- `plugin/abathur.ts` header documents both delivery routes; marker stays in
  version parity with `package.json` (pinned by tests).
- README (en+zh) "Inside opencode" now presents the two routes: A) one
  command file-copy install (tool + `/abathur`; slash commands cannot be
  registered by plugins upstream), B) config-only name entry with automatic
  npm download at startup (tool only; CLI still required on `PATH`).
- The route A file-copy installer and its refusal semantics are unchanged.

## 0.2.1 — 2026-09-11

### Plugin adapter remediation (outcome of the F1 adversarial review)

- Human gates are now terminal-only: the opencode tool allowlist drops
  `promote` and `tombstone`. Reachable set is eight commands — `genome`,
  `run`, `status`, `bundle`, `graft`, `self-eval`, `kernel`, `--help` — and
  the slash-command template states that the tool itself refuses the gates
  and points the user to a terminal.
- Honest privilege documentation: the tool description now says plainly that
  the tool carries bash-equivalent privilege (`run`/`genome` legitimately
  spawn mutator/engine binaries by design) — the allowlist limits typos and
  UX, not capability. Mirrored in both README languages.
- `run` timeout note: when a killed `abathur run` times out, the result note
  explains that detached children (mutator/bench sessions) may still be
  running and that the next `abathur run` reaps them.
- Installer hardening: both packaged assets are read before any destination
  is validated (a missing second asset no longer leaves a partial install);
  the write loop re-checks marker ownership, so a foreign file planted
  between validation and write is refused instead of overwritten (TOCTOU);
  install and uninstall share an lstat destination guard — directories and
  symlinks are refused with exit 2 and named, never followed, entered, or
  destroyed.

## 0.2.0 — 2026-09-11

### Official opencode plugin adapter

- New `abathur opencode install|status|uninstall`: copies the packaged V1
  plugin (`plugin/abathur.ts`) and slash-command template
  (`plugin/abathur-command.md`) into `~/.config/opencode/{plugins,commands}/`.
  After an opencode restart the session gets the agent tool `abathur` (the
  CLI spawned argv-only — never a shell — behind a nine-command top-level
  allowlist plus `--help`, 120 s timeout, 64 KB output cap, binary from
  `ABATHUR_BIN` or `PATH`) and the user command `/abathur <args…>`.
- Identity discipline mirrors the harness: targets are recognized by a
  first-line marker; a foreign file at a target path is refused with exit 2
  and named, never overwritten or deleted. No `--force` was added. Re-install
  is idempotent (byte-equality check → "up to date"). `status` reports
  per-target installed/packaged sha256 and state
  (up-to-date / outdated / foreign / absent).
- Shipped as top-level `plugin/` via package.json `files` (tsc never compiles
  it; `@opencode-ai/plugin` resolves inside opencode's own config-directory
  install). The plugin's marker version (`// abathur-opencode-plugin v…`) is
  hardcoded and pinned by test to the package version — bump both together.
- Caveat: fixture benches mirror the real `~/.config/opencode` (plugins
  included) into sandbox HOMEs, so the installed plugin also loads inside
  bench sessions; uninstall first for a clean plugin environment.

## 0.1.1 — 2026-09-11

### Docs

- Quick-start follow-up to the scoped rename: `ABATHUR_PKG` now points at
  `$(npm root -g)/@tachikomagundam/abathur` and the tarball install line at
  `tachikomagundam-abathur-<version>.tgz` (mirrored zh/en).

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
