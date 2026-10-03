# The Immutable Kernel — what self-evolution may and may not touch

This is the human-facing contract of the shipped seed `genomes/abathur-self.jsonc`
and of `src/core/evolve/self-overlay.ts` / `self-snapshot.ts`. The seed's header
comments restate the same contract in spec-adjacent form; where they are terse,
this document is the expansion. Registration is fail-closed by design: every
seal glob must cover at least one real file (the `graders/**` contract directory
satisfies that since todo 14), and the seed stays byte-stable — its `repoPath` is
the unresolved literal `${ABATHUR_SELF_REPO}`, so the spec fingerprint
(`1913fcec…`) is identical on every machine and the checkout only resolves at
filesystem seams. Point that variable at a git checkout with `npm ci` done; unset
exits 2, naming the variable.

## The sealed set

`kernel.immutableGlobs` on the abathur-self genome seals:

| Pattern | Why it is sealed |
|---|---|
| `src/core/stats.ts` | the selection gate itself — nomination math, Bonferroni, budget verdicts |
| `src/core/ledger.ts` | append-only evidence: friction queue + generation rows |
| `src/core/ids.ts` | canonical JSON + fingerprints — the identity of every genome/row/tree |
| `src/core/genome.ts` | registry semantics: registration, superset rule, fail-closed coverage |
| `src/core/promote.ts` | the human-only gate: second sealed-path pass, CAS ref move, manifest regen |
| `src/bench/toy.*`, `src/bench/fixture.*` | the bench adapters — how every score is produced |
| `graders/**` | grader contract schemas — what "correct" means per bench |
| `genomes/**` | every genome spec, including this seed and the toy-smoke fixtures |
| `scripts/copy-assets.mjs`, `package.json`, `tsconfig.json` | the toolchain itself |

Self cannot unseal: a candidate diff touching any sealed file is rejected at the
path stage (`validateCandidate`), the kernel audit refuses runs against a drifted
working tree (exit 1, before any state exists), and only the human `promote`
command ever reseals the manifest — from the promoted tree, never the worktree.
The sealed hashes live in a per-genome manifest under `<configDir>/kernels/`
(written at registration, re-checked at every bench and `self-eval` entry);
`abathur kernel audit <label>` compares that manifest against the working tree.

**Consequence (accepted):** v1 self-evolution cannot change dependencies or
build configuration. `package.json` and `tsconfig.json` ride outside the
overlaid `src/**` and would otherwise slip into a promoted generation
score-neutrally and silently reseal on installer re-add (plan round-2 #2).
Toolchain changes are a human PR, not an evolution candidate.

## Why tests run from a snapshot, not from the candidate

Fitness-hack class (plan 11c, oracle Critical #1): if the candidate's own tree
supplies the test suite, a candidate can delete or weaken the tests it is graded
by and score better while getting worse. The self-bench therefore composes:

1. **Trusted tree** = `snapshotCommit(incumbent)` — sealed kernel files, the
   test suite (`src/test/**`), the golden-replay fixtures + expected digests,
   and toolchain config, all read-only from the incumbent commit.
2. **Overlay** = candidate `src/**` files matching no seal and not under
   `src/test/**` (candidate test edits are dropped by the allowlist; deletions
   are unrepresentable in a copy-only overlay, matching udiff v1's
   modify/create-only contract).
3. **Build** with the harness-pinned toolchain: the repo's own `tsc` against the
   harness install's `node_modules` — never candidate-supplied build scripts,
   never `npm ci`. Caps: build 180 s, suite 900 s, replay 120 s; a build timeout
   is inconclusive, a suite/replay timeout scores nothing.
4. **Score** = `node --test dist/test/**/*.test.js` over the overlaid build plus
   the golden toy-replay digest (`selfbench/replay.mjs`, expected from the
   TRUSTED copy). Pure incumbent-vs-incumbent is degenerate and forbidden; the
   incumbent build is the baseline, candidates are the overlaid builds.

The seed's two bench units make the goalposts concrete: `suite` (train) is
`node --test dist/test/**/*.test.js` built from the overlaid candidate sources;
`golden-replay` (val) replays `selfbench/replay.mjs` and compares the digest
against `selfbench/expected.json` — taken from the TRUSTED copy, so a candidate
cannot move the val goalpost it is measured against. Both units score binary per
rep, which is why the seed pins `stats.halfWidth 0.05, minEffect 0, nReps 2..4`:
a nomination means "candidate src passes the incumbent-pinned suite AND the
golden digest holds, non-degenerately, across reps". A pure incumbent-vs-incumbent
comparison is degenerate and forbidden; an overlay with no effective change is
downgraded to `indeterminate` by the overlay-empty guard, never nominated.

The candidate worktree's own tests are never executed, and the scorer is invoked
with snapshot paths only — structurally, nothing in `self-eval`/`self-snapshot`
imports `promote.ts`; `self-eval` reports fitness, the operator promotes.

## Friction digest

Every `run` appends structured `friction_digest` records to the global queue
`<configDir>/friction.jsonl` (stalls, repeated rejections by stage, inconclusive
causes, CLI errors). Records are schema-validated, strings are echo-sanitized
and bounded, and digests covering val-unit runs carry counts/timings/status
codes only — scenario text and assertion diffs can never enter the queue.
