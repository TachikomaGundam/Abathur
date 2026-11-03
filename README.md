# abathur

**English** | [中文](README.zh.md) — this English file is the authoritative text.

An evolution harness for OpenCode agents: observe failures, mutate, re-bench,
select — with promotion held by a human gate. Offline lineage bundles let one
instance learn from another's evidence; the harness itself performs no network
transport in v1 (model and fixture traffic is whatever your bench spawns).

## What it is

- **genome** — a JSONC contract for one thing that can evolve: which bench
  units measure it (train/val split), how (commands, adapter type, timeout,
  statistics gates), what its evolution budget is, and which files are
  kernel-immutable. Identity is the sha256 content fingerprint of the parsed
  spec, never its label or filename.
- **bench** — an adapter that turns one genome tree into per-unit scores.
  v1 ships two types: `toy` (pure-node fixtures, zero model calls) and
  `opencode-fixture-scenarios` (real agent sessions against a live fixture
  service, scored by script-first graders). Every candidate is re-benched
  against the incumbent; the statistics gates decide.
- **bundle** — an offline lineage export (`.bundle.tgz`): generation trees,
  patch, ledger summaries, redacted train-only evidence, and a v1 manifest
  that `bundle inspect` re-verifies from the contained bytes. See
  [docs/federation.md](docs/federation.md).
- **graft** — importing a peer's bundle: four byte-exact gates, then a local
  re-bench at local reps and thresholds. The bundle's scores are recorded as
  `peerClaim` metadata and never feed nomination math.
- **run loop** — incumbent → brief (failure observations) → mutator session →
  candidate diffs → seal → re-bench → verdicts. Nominated generations sit in
  the quarantine queue until a human runs `promote`; `tombstone` buries them; `retract` undoes a promote (LIFO, descendant-guarded); `re-adjudicate <label> <genId>` re-computes a verdict from ledger state without spawning engines (terminal-only).
  These commands are append-only ledger decisions; nothing is ever deleted.

## Install

```bash
npm i -g @tachikomagundam/abathur  # from the npm registry
npm pack                          # in a checkout; prepack runs the build
npm i -g ./tachikomagundam-abathur-*.tgz   # glob: npm pack emits the current version — never pin it here
abathur --help
```

Requires Node >= 22.22.1 and `git` on `PATH`. Runtime dependencies: `zod` only — `@opencode-ai/plugin` is an optional peer, needed solely when the opencode plugin adapter is loaded (the host opencode supplies it). After installing, `abathur init` creates the Abathur-owned deployment surfaces (data home + anchor dir) and prints each path; no install hook ever touches shared device facilities. The source checkout is <https://github.com/TachikomaGundam/Abathur> (`repository` in `package.json`); the npm tarball ships the built CLI, not `src/`.
Real benches additionally need the `opencode` CLI (path via `opencodeBin` in
config or `PATH` lookup) and whatever a genome's `requires[]` probes name.

Config resolution is fail-closed: `$ABATHUR_CONFIG` (must exist when set) >
`~/.config/abathur/config.jsonc` > `<package>/config/abathur.jsonc`, with a
gitignored sibling `*.local.jsonc` deep-merged on top; with none of the three
files present, built-in defaults apply. Unknown keys are exit 2.
All writable state lives under the config dir — genome registry
`<configDir>/genomes/<fp16>.jsonc`, kernel manifests `<configDir>/kernels/`,
friction queue `<configDir>/friction.jsonl`, pending-graft queue
`<configDir>/graft-queue/` — never inside the package; each genome's ledger
rides its own repo at `<repoPath>/.state/abathur/ledger.jsonl` (gitignored).

Two setups need more than the tarball:

- **abathur-self** (self-evolution): `export ABATHUR_SELF_REPO=<path>` pointing
  at a **git checkout** of this harness with its `node_modules` installed
  (`npm ci`). The seed spec `genomes/abathur-self.jsonc` is registered from
  that checkout — the self-bench builds candidate trees with the checkout's
  pinned toolchain, so this genome does not run from the npm package alone.
- **historian**: the operator workflow is its own section below.

## Quick start: the zero-model toy loop

No models, no network: the `toy-smoke` genome ships inside the package
(`dist/genomes/toy-smoke/`) and carries a seeded bug — `add()` subtracts.

```bash
abathur init                     # once: creates and prints the deployment dirs
mkdir -p ~/abathur-demo && cd ~/abathur-demo
export ABATHUR_PKG="$(npm root -g)/@tachikomagundam/abathur"

# 1. materialize an independent toy genome repo (git init + repoPath rewritten;
#    the genome registers with the label `toy-smoke`)
node "$ABATHUR_PKG/dist/genomes/toy-smoke/init.mjs" ./genome
abathur genome add ./genome/genome.jsonc

# 2. a mutator is an argv command template, not a flag you can skip: `run`
#    exits 2 without --mutator. The package ships a minimal one
#    (`examples/toy-stub.mjs`) plus the `dist/core/evolve/stub-mutators.mjs`
#    library it imports; that library exports `scriptedPatches()` returning
#    `{id,description,file,from,to}` patches. The example prints
#    {"candidates":[{"id","rationale","diffs":[unified-diff]}]} to stdout.
cp "$ABATHUR_PKG/examples/toy-stub.mjs" ./toy-stub.mjs

# 3. evolve: {worktree} and {brief} are rendered by the harness; the template
#    is spawned as argv, never through a shell.
abathur run --genome toy-smoke \
  --mutator "node $PWD/toy-stub.mjs --lib $ABATHUR_PKG/dist/core/evolve/stub-mutators.mjs --dir {worktree} --brief {brief}"
```

Typical output (toy budgets make this take seconds). `tokens` is an estimate of
rendered text, not model usage — the toy loop makes no model calls:

```
incumbent baseline: 4 units x 2 reps
candidate fix-add [tree cbc27a991cf9]: nominated (gain 0.5000, reps 2)
candidate break-mul [tree 52b89d61da91]: culled (gain -0.3333, reps 2)
  gate: gain -0.3333 < minEffect 0.5000
...
budget spent: candidates=4 tokens=4338 wallS=7.542 (caps candidates=4 tokens=100000 wallS=300)
```

Then read, decide, and hand the winner around:

```bash
abathur status toy-smoke                     # read-only ledger view; genIds are the first column
abathur promote toy-smoke g-...              # human gate — the ONLY path to a new incumbent
abathur bundle export toy-smoke --gen g-... --out ./bundles   # offline lineage
abathur bundle inspect ./bundles/*.bundle.tgz
abathur graft ./bundles/*.bundle.tgz --genome toy-smoke       # local re-bench of a peer bundle
abathur run --genome toy-smoke --dry-run     # plan + requires[] probes, zero spawns
```

## Inside opencode

Abathur ships an official opencode plugin adapter. The harness remains the
orchestrator, but once set up an opencode session can also drive the CLI
directly. Two install routes:

Both routes deliver the tool **and** the `/abathur` slash command; pick by
taste — A needs no edit of your opencode config and works fully offline, B
needs no file copying and removes with one deleted line.

**Route A — one command (file-copy installer).**

```bash
npm i -g @tachikomagundam/abathur
abathur opencode install    # copies plugin assets into ~/.config/opencode/
# restart opencode
```

**Route B — config only (auto-downloaded from npm).** Put the package name in
the `plugin` array of your opencode config (`opencode.json` or
`opencode.jsonc`) and restart:

```jsonc
{ "plugin": ["@tachikomagundam/abathur"] }
```

opencode then downloads the package from npm at startup into its own cache
(`~/.cache/opencode/packages/…`) and loads the package's `./server` export —
no file copying, no uninstall step (delete the line). Since 0.2.3 the plugin
also self-registers `/abathur` through its `config` hook: slash commands are
entries in the merged config's `command` map, and a plugin may add one there
— the upstream `opencode-acp` plugin registers `/acp` the same way (the
0.2.0–0.2.2 note here claiming plugins cannot register slash commands was
wrong; corrected). If Route A's copied `commands/abathur.md` exists it stays
authoritative — the injection never overwrites it, and the name-keyed command
map means `/abathur` can never appear twice. One honest limit stands for both
routes: the tool spawns the `abathur` **CLI**, which must exist on `PATH` (or
via `ABATHUR_BIN`) — keep the `npm i -g` install.

Either route gives the session:

- the agent tool **`abathur`** — spawns the `abathur` CLI argv-only (never a
  shell), restricted to eight commands (`genome`, `run`, `status`, `bundle`,
  `graft`, `self-eval`, `kernel`, `--help`), with a 120 s timeout and a 64 KB
  output cap. The binary resolves from `PATH` unless `ABATHUR_BIN` overrides
  it. Honest privilege note: the tool carries bash-equivalent privilege —
  `run` and `genome` legitimately spawn mutator/engine binaries by design —
  so the allowlist limits typos and UX, not capability. `promote`,
  `tombstone` and `retract` are deliberately NOT reachable through the tool:
  they are human gates and must be run in a terminal.
- the user command **`/abathur <args…>`** — a slash command that tells the
  agent to translate its arguments into a tool call and report the exit code.
  Route A provides it as the copied `commands/abathur.md` file; Route B gets
  it from the plugin's `config` hook at startup.

Route A ships its own manager commands: `abathur opencode status` shows each
target's path, installed/packaged sha256, and state (up-to-date / outdated /
foreign / absent).
`abathur opencode uninstall` removes only files carrying the abathur marker. A
foreign file at a target path makes `install` and `uninstall` refuse with exit 2
and name the path, while `status` reports the foreign state and exits 0 (it
observes; it does not act) — nothing is ever overwritten or deleted behind your back (there is
still no `--force` anywhere).

Caveat: fixture benches mirror the real `~/.config/opencode` (plugins and
commands included) into their sandboxed HOMEs, so an installed plugin also
loads inside bench sessions. Uninstall first if a bench needs a clean plugin
environment.

## Tier-1 discipline layer (≥0.4.0) — honest capability limits

The plugin's discipline layer (status injection, exam-file guard, env
injection, ledger tool, occupancy probe) is **防手滑 + 可见化 (accident-proofing
and visibility), not a security boundary**:

- The exam-file guard intercepts `edit`/`write`/`apply_patch` only; `bash`
  writes to guarded files are a named residual (warn-only heuristics). A
  determined agent can bypass it — the guard exists to stop slips and to make
  violations loud, not to withstand adversaries.
- The campaign lock is cooperative: it is written by `abathur run` (≥0.4.0)
  and removed at exit. A crashed run leaves a stale lock that the plugin
  judges by heartbeat/pid/start-time criteria; `SIGKILL` mid-heartbeat-window
  can look "pending" for up to 15 minutes by design.
- On engines <0.4.0 the plugin runs in `FALLBACK-PROBE` mode (process scan
  instead of the lock); the probe's own blind spots are documented in
  `loop/proposals/plugin-tier1-design-20261020.md`.
- The T3 env injection is disabled unless the operator pins `repoRoot` in the
  plugin's options and provides `~/.config/opencode/abathur-shell-env.json`
  (human key surface); the injectable key set is fixed by
  `config/env-contract.jsonc`.
- The ledger tool enforces hash-chained appends, but on a single-user machine
  the chain proves tampering only against *other* writers — the seat itself
  can rewrite its own ledger (named gap: external anchoring).

## The historian genome and the operator workflow

`historian` is the first real genome: OpenCode agents work wiki scenarios
against a live Wiki.js fixture; script-first graders score dimensions A–J with
a hard G gate. `config/genomes/historian.example.jsonc` is a **template** —
every machine-specific value is a `${VAR}` placeholder, because repo-tracked
files carry zero machine literals. Only `repoPath` has built-in env resolution
(`effectiveRepoPath`, `src/core/spec.ts`); `requires[]` probes and every
command string are spawned as argv, never through a shell, so `${VAR}` inside
them does **not** expand. The operator resolves the template:

1. Keep your own historian bench repo checkout (the genome's fixture: it must
   supply `scenarios/`, `rubric.md`, `seed_sandbox.sh`, `baseline/**`), a
   running wiki, and the wiki-ops CLI that fixture documents. This repository
   does not ship that fixture; the operator supplies it.
2. Copy the example to a private `*.local.jsonc` file (the gitignore pattern
   covers it anywhere in the tree) and substitute every placeholder with the
   real absolute paths / URLs; then `abathur genome add` **that** file.
   The printed fingerprint is deterministic per resolved path set (on the
   orchestrator's machine: `2b2456be6cddcb91` — yours will differ with your
   paths, and stay stable for them).
3. Live-run environment the operator must keep: `~/.wikijs-api-key` in the
   **parent** HOME (the `requires[]` probe child inherits the parent env and
   reads it directly), and `ABATHUR_WIKI_KEY_FILE` — the path to that key file;
   the sandbox-side scripts reinstall it into each mirrored sandbox home,
   because `resetCommand` wipes the sandbox HOME mirror before every unit (hook
   order: reset runs before the mirror, so anything hooks need must be
   re-installed per unit).
4. `export ABATHUR_JUDGE_MODEL=...` is mandatory even when empty: the
   grader-side `opencode` invocations error out on an unset variable, not on
   an empty one.
5. Prove setup without model spend: `abathur run --genome historian --dry-run`
   runs every `requires[]` probe and prints the plan; zero engines spawn.

Real runs launch `opencode` headless and cost tokens. Budgets
(`budget.maxCandidates/maxModelCalls/maxTokens/maxWallS`) are hard stops —
crossing one truncates to `inconclusive` (exit 2), never to a fake pass.

## D7 decoupling guarantees

- The genome registry and every writable artifact live **out-of-tree** under
  the config dir; the npm package directory is read-only at runtime.
- Source under `src/` contains **zero** machine or product literals
  (`src/test/**` fixtures are exempt by design). `src/test/d7-gate.test.ts`
  is the enforcement: it walks every `src/**/*.ts` file outside the fixture
  carve-out and fails on `os.homedir()` or the `historian` product name. The test
  derives the home path at runtime, so the guard itself carries no machine
  literal. The same test scans both public READMEs for the home path, so the
  manual cannot quote what the source may not carry; run `npm ci && npm test`
  in a source checkout to execute it. Config templates spell out placeholders
  instead.
- Machine paths enter only through config and env: a `${VAR}`-literal
  `repoPath` fingerprints over the **unresolved** bytes, so spec identity is
  machine-independent (abathur-self: `1913fcec…` everywhere) and resolves
  only at filesystem seams; unset env exits 2 naming the variable.
- Identity is always the content fingerprint, never a label: two byte-equal
  specs are the same genome on any machine; labels are free and may repeat, but
  a command that takes a label fails closed (exit 2) when more than one
  registered genome shares it — the message lists the fingerprints, and the
  fingerprint is the identity.
- Adapters are a closed `bench.type` registry; a genome without a known
  adapter type is exit 2, never a guess.

## Kernel seal and self-evolution

Every registered genome's `kernel.immutableGlobs` are hashed into a sealed
manifest under `<configDir>/kernels/`; benches and self-eval refuse to run on
a drifted tree, mutator candidates touching sealed paths are rejected at the
path stage, and only human `promote` reseals — from the promoted tree.
`abathur kernel audit <label>` verifies the seal against the working tree.
The full contract (what `abathur-self` may and may not touch, the
snapshot-overlay bench, why v1 self-evolution cannot change dependencies or
build configuration) is [docs/immutable-kernel.md](docs/immutable-kernel.md).

## Federation: bundles now, transport later

v1 ships the **format and the local tools**, not a network. A bundle is a
file you carry by any means you like; `bundle export` is deterministic —
re-exporting an unchanged ledger produces byte-identical tarballs, and the
byte-equality rule extends to every graft gate. Graft admits a peer lineage
only when genome fingerprint, benchDigest, scoring provenance, and
`requires[]` probes all recompute byte-equal **locally**; anything else
quarantines, queues as pending-bench, or refuses, with the decision booked to
the ledger. No noise-tolerance band, no `--force`, no bypass. Discovery,
transport, auto-merge, and auto-promotion are explicitly **out of scope**.
The schema field-for-field, the inspect gate order, and the graft decision
table are [docs/federation.md](docs/federation.md).

## Operator duties

- **Single-flight contract**: at most one live bench per genome fingerprint
  per shared fixture service. The genome lock `run`/`graft` take is a
  **machine-local** file lock (it serializes worktrees, sandboxes, and the
  ledger on one box). Historian benches share a wiki through `resetCommand`,
  which purges the entire `_sandbox/*` namespace — two machines benching the
  same historian genome against one wiki will clobber each other mid-run.
  Cross-machine serialization of historian benches is the operator's
  responsibility (schedule, lockbox, one-wiki-one-bench rule — your call).
- Promotion, burial and retraction are yours alone: `promote`/`tombstone`/`retract` carry no
  `--confirm` because the CLI invocation **is** the gate; there is no
  `--force` anywhere in the binary. Review `abathur status` quarantine depth
  and the pending-bench graft-queue rows (`abathur status <label>`) before
  promoting.
- Stale pending-bench queue entries (`<configDir>/graft-queue/`) mean a
  bundle waits on setup — register the genome or repair a probe, then re-run
  `graft`; terminal decisions retire the entry automatically.
- Keep `~/.wikijs-api-key` valid and `ABATHUR_JUDGE_MODEL` exported for
  historian work; budget caps are per-run hard stops, so raise them
  deliberately in the spec, never by re-running off-book.

## Exit codes

The contract, every command, no exceptions:

- `0` — ok / pass / nominated.
- `1` — blocked: a recorded **decision** (culled, indeterminate, quarantined,
  promote refusal, pending unregistered genome).
- `2` — cannot-answer: config error, malformed input, missing engine, probe
  pending, budget-truncated (inconclusive). Never a silent skip.

## License

MIT, see [LICENSE](LICENSE).
