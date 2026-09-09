# Learnings — abathur-harness

Conventions, patterns, and successful approaches discovered during work on this plan.

_Auto-scaffolded by /start-work. Append new entries below - never overwrite._

---

## Todo 1 (2026-09-09, worker 1) — scaffold conventions for todos 2-15
- Toolchain: node v22.22.1, npm 11.19.1, git 2.53.0. Runtime deps: zod 4.5.4 ONLY (devDeps typescript 5.9.3, @types/node 22.20.1). Anchor commit c98b110 (`anchor: opencode project root for /home/lab/workspace/harness/Abathur`), repo root = /home/lab/workspace/harness/Abathur.
- tsconfig: module/moduleResolution NodeNext, strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + noUnusedLocals/Parameters + verbatimModuleSyntax + isolatedModules. rootDir src → dist. Tests live in src/test/**.ts and compile to dist/test/**.
- GOTCHA: plan-literal `node --test dist/test/` (and bare dir arg) is BROKEN on node 22.22.1 — runner execs the directory as a module (repro: any dir arg). package.json test script uses node-native glob instead: `node --test "dist/test/**/*.test.js"` (quoted; keep it for nested test dirs in later todos).
- Exit-code helpers (src/exit.ts — reuse, never re-derive): `EXIT_OK|EXIT_BLOCKED|EXIT_CANNOT_ANSWER` (0|1|2), `ExitSignal` (class, carries code+optional hint), `blocked(msg, hint?)`, `cannotAnswer(msg, hint?)` both `never`, `renderExitSignal(sig)` → "abathur: msg\n  hint: …". CLI boundary prints single clean line to stderr, never stack traces (ABATHUR_DEBUG=1 opt-in only).
- CLI seam (src/cli.ts): `COMMANDS: readonly CommandSpec[]` where CommandSpec={name,summary,run(ctx)}. Handler signature `run({loaded, args}: CommandContext) => ExitCode | Promise<ExitCode>`; return EXIT_OK or throw ExitSignal; NEVER touch process in handlers (unit-testable). Todo groups replace their `pending(name, summary)` entry; put real logic in src/commands/<group>.ts, keep cli.ts a thin router. Config load happens in dispatch() before handler — ConfigError → cannotAnswer automatically.
- Config (src/config.ts): `loadConfig(env: ConfigEnv = process.env): LoadedConfig{config, path, overlayPath}` — resolution $ABATHUR_CONFIG (set ⇒ fail-closed unreadable incl. empty string) > ~/.config/abathur/config.jsonc > <package>/config/abathur.jsonc > built-in defaults (path=null, no crash). Overlay: sibling `*.local.jsonc` (base minus .jsonc suffix + ".local.jsonc") deep-merged BEFORE z.strictObject validation (unknown keys in overlay also exit-2-named).
- `resolveConfigDir(env?)`: parent of $ABATHUR_CONFIG when set, else canonical ~/.config/abathur — may not exist; callers mkdir -p on write. DECISION: repo <package>/config/ is read-only shipped default, NEVER a data dir (todo 4 genome registry goes to resolveConfigDir()).
- ConfigError (exported class): kind "unreadable"|"malformed"|"unknown-key"|"invalid-value"; message always names file path, unknown-key also names keys; constructor (kind, message, filePath, keys?).
- JSONC parser in src/jsonc.ts: `stripJsonc` (re-exported from config.ts), `parseJsonc(source): unknown` throws SyntaxError (caller rewraps). Handles //, /* */, trailing commas; string-safe.
- Schema today: opencodeBin: string|null (default null=PATH lookup), stateDir: string|null (default null=$ABATHUR_HOME else ~/.local/share/abathur). New keys: extend configSchema + document in config/abathur.jsonc; machine-local ABSOLUTE paths belong only in gitignored *.local.jsonc — todo 15 grep-gate forbids /home/lab literals in src/**.
- scripts/copy-assets.mjs: ASSETS table [srcRel, distRel]; add rows for new non-TS runtime assets; missing source = graceful skip (stub-mutators.mjs lands todo 5, genomes/toy-smoke todo 8). package.json "files" allowlist ["dist","config","graders","docs"] — anything shipped to npm must be under those.
- Evidence: .omo/evidence/abathur/task-1-happy.txt (RED→GREEN→AC-1..3→npm ci), task-1-failure.txt (unknownField/unreadable/malformed all exit 2, stack_trace_lines=0).

## Todo 4 — genome registry, spec schema, sealed-path kernel (2026-09-09)
- GenomeSpec field names VERBATIM (todos 5-9 consume): label, repoPath,
  bench{type:"toy"|"opencode-fixture-scenarios", units[{id,path,split:"train"|"val"}],
  seedCommand?, resetCommand?, runCommand, graderCommand, judgeCommand?, judgeModel?,
  agentModel?, timeoutS, stats{halfWidth,minEffect,nReps{initial,max}}},
  budget{maxCandidates,maxModelCalls,maxTokens,maxWallS}, kernel{immutableGlobs[]},
  requires?[{cmd,args?,probeExit}], opencodeBinVersion?{minVersion}. All strictObject:
  unknown keys ⇒ exit 2 naming the key path (`invalid value at "bench.stats.halfWidth"`,
  hr thresholds.yaml discipline). Conditional requires (superRefine): ≥1 val unit;
  opencode-fixture-scenarios ⇒ agentModel; judgeCommand ⇒ judgeModel.
- Paths: registry <configDir>/genomes/<fp16>.jsonc (content = canonicalJson(spec)+"\n"),
  kernel manifest <configDir>/kernels/<fp16>.json ({"entries":[{glob,path,sha256}...]}
  sorted by path). fp16 = fingerprint(spec).slice(0,16) — SAME stem both sides.
  resolveConfigDir() from src/config.ts; registry is structurally out-of-tree.
- auditKernel(entry: RegistryEntry, configDir: string): {ok: boolean,
  drifted: {path, kind: "modified"|"missing"|"added", glob}[]} — read-only; todo 9/10
  REUSE it (exported from src/core/kernel.ts). Manifest missing/corrupt ⇒ cannotAnswer
  exit 2 there (a seal we cannot read is not a clean seal).
- registerGenome re-add rules (plan line 106-108): same fingerprint ⇒ byte-compare
  manifest; drift ⇒ exit 1 naming drifted files and NEVER writes (no reseal outside
  promote); new fingerprint + same resolved repoPath ⇒ incoming immutableGlobs must
  cover every file currently matched by existing globs OVER THE CURRENT WORKING TREE
  (approximate resolved-pattern comparison; weakening ⇒ exit 1 naming the glob + an
  example uncovered file). Promote reseal = todo 10.
- canonicalJson/fingerprint imported from src/core/ids.ts (todo 2 landed first —
  private fallback NOT needed; consolidation TODO moot).
- Glob matcher src/core/glob.ts: own impl, no minimatch. ** = whole-segment zero-or-more,
  * /? never cross "/", [abc]/[!abc] classes; seals match WORKING-TREE files (git
  fixture: committed kernel.mjs + untracked evolve/hot.ts both matched).
- Tests: src/test/genome.test.ts 34 tests green ×2 runs. CLI tests spawn dist/cli.js
  with ABATHUR_CONFIG+HOME in tmp homes.

## Todo 2 landed — exact API surface (todo 4: import these names, do not guess)
- src/core/ids.ts: `canonicalJson(value: unknown): string` (recursive sorted keys, no ws; TypeError on NaN/±Infinity/BigInt/function/symbol/top-level undefined/Date/class instances; undefined array slots → null, undefined object props dropped), `fingerprint(value): string` (sha256 hex of canonicalJson), `type TreeFile = { readonly path: string; readonly content: Uint8Array | string }`, `fileTreeDigest(files: readonly TreeFile[]): string` (sha256 over canonicalJson of [{path, sha256(content)}] sorted by path; duplicate path throws; modes/mtimes structurally excluded), `walkTree(root): TreeFile[]` (regular files only, symlinks skipped, fwd-slash rel paths), `treeDigestAt(root): string`, `genId(contentFingerprint: string, at?: Date): string` = `g-<compactUtc>-<first8>` (compact e.g. 20260909T142530Z — path-safe, no colons; clock injectable for deterministic tests), `runId(genId, unitId, repIdx): string` = `r-<genId>-<unitId>-<repIdx>`.
- src/core/ledger.ts: `ledgerRecordSchema` (z.strictObject envelope {v:1, ts, kind, genId?, runId?, data}), types `LedgerRecord`/`LedgerRecordInput`, `class LedgerError` (kind:"integrity" — mid-file tamper; CLI should map to exit 2), `ledgerPath(genomeRepo)` = <repo>/.state/abathur/ledger.jsonl, `Ledger.open(genomeRepo, opts?{now})` (eager validation + tail repair), `ledger.append(input)` (ONE write() of canonicalJson+"\n", O_APPEND), `ledger.readAll()`, `ledger.lastCompleteGeneration(): string|null`; kinds `LEDGER_KIND_LOCK_TAKEOVER`/`LEDGER_KIND_GENERATION_COMPLETE`. Corrupt tail renames to `ledger.corrupt-<compactUtc>-<pid>.jsonl` — complete-line prefix rewritten byte-verbatim (only allowed content op; never rewrite existing lines).
- Friction queue (todo 11): file <configDir>/friction.jsonl (`frictionQueuePath`), `appendFriction(configDir, input, opts?{waitMs=15000,now})` lock-guarded, `readFriction(configDir)`.
- src/core/locks.ts (ledger.ts re-exports acquireLock/lockDirFor/LockLease/LockOptions): `acquireLock({configDir, key, waitMs?, now?, label?}): LockLease` — <configDir>/.locks/<key>.lock mkdir-atomic, owner.json{pid,createdAt,label}; live holder + budget exhausted ⇒ throw ExitSignal code 2 "…held by live pid N…"; dead/malformed owner ⇒ takeover via rename to unique quarantine then re-mkdir; release() only removes if owner pid is self. `acquireGenomeLock({ledger, configDir, genomeFp, waitMs?})` appends the lock_takeover ledger record when lease.tookOverFrom !== null.
- Lock design rationale (proven by tests (d)/(e)/(f) + 12x stress): takeover uses rename-then-recreate so two takers can't both win mkdir; a mkdir winner re-verifies its claim (owner pid AND dir inode) because a holder descheduled past STALE_GRACE_MS=250 can otherwise be stolen mid-claim (silent double-hold) — lost claims retry; 250ms grace prevents stealing fresh locks whose owner-write hasn't landed; takeover attempts capped at 8 ⇒ exit 2 churn. Residual known race: PID reuse within a liveness check window (documented, standard for PID liveness locks).
- Friction fixture writer loops 200 acquisitions ⇒ passes waitMs 60000; production default 15000 is per-single-event.

## Todo 3 — worktree generation store (2026-09-09, done)
API surface (import ONLY from src/core/worktree.ts; it re-assembles the pieces):
- openGenome(repoPath, targetPaths=[], opts) -> {repoPath,headCommit,branch,dirtyWorktree:DirtyEntry[]}
  refusal=blocked exit1 ONLY on dirty paths under targetPaths (tracked mod OR untracked-in-target);
  unrelated dirt = notices (todo 9 writes ledger dirty_worktree). bare/empty/non-git/absent all blocked.
- newGeneration(genome:GenomeRef{repoPath,genomeFp}, parentCommit(rev-or-sha), genId, opts) -> {worktreePath,parentCommit}
- snapshotCommit(genome, commitSha, opts) -> {snapshotPath,commitSha,treeSha} (todo 11 self-bench input)
- sealGeneration(genome, genId, message, opts) -> {commitSha,treeSha} — refuses attached/dirty-free wt
- cleanupStale(genome, olderThanDays, opts) -> {removed,kept} full paths under cache
- fastForwardIncumbent(genome, commitSha, opts) -> {branch,fromSha(null|sha),toSha} — todo 10 promotion; INCUMBENT_BRANCH='abathur/incumbent'
- cacheRoot(env): $XDG_CACHE_HOME/abathur/worktrees else ~/.cache/abathur/worktrees (relative XDG ignored);
  layout <fp>/<genId> + <fp>/snapshots/<sha>; WorktreeOptions={env?,cwd?,timeoutMs?,bin?}.
Files: src/util/git.ts (execFile argv-only, timeout SIGKILL 30s def, git()/tryGit()/GitError kind
failed|timeout|spawn; LC_ALL=C pinned), src/util/freeze.ts (freeze/thaw mode walkers),
src/core/genome-paths.ts (scheme+validators+WorktreeEnv/GenomeRef/Options/SnapshotHandle types),
src/core/snapshot.ts, src/core/incumbent.ts, src/core/worktree.ts (238 pure LOC, near ceiling — split
snapshot/incumbent out for that reason). Tests: src/test/{git,snapshot,worktree}.test.ts +
fixtures-wt.ts (renamed 'fixtures' was taken? no — kept distinct from parallel agents' src/test/fixtures/).
Gotchas:
- `git -C snap fetch <local-abs-path> <DANGLING-NON-TIP-SHA>` WORKS on git 2.53 local transport —
  sealed commits unreachable from branches snapshot fine (todo 11 chain flow proven).
- Frozen snapshots: freeze AFTER checkout; rm must thawTree first (Linux has no lchmod; symlinks
  skipped — parent dir 0o555 guards them). git -C <frozen snap> rev-parse still reads fine.
- cleanupStale prunes worktree registry AFTER dir removal, else 'worktree add' refuses re-use of a
  genId whose dir was just deleted ('already registered'). Double-cleanup idempotent (tested).
- update-ref <ref> <new> <old> = ff-CAS: rewind/race exit non-zero -> blocked; zero --force tokens
  anywhere (grep-proofed). Commit identity forced via -c abathur@host.example (global gitconfig immune).
- `-m${message}` single argv element (dash-leading messages can't be option-injected); segment
  validators reject leading '-'/slash/'..' before ANY git spawn (exit 2 cannotAnswer).
- `git init` rejects `-c` AFTER subcommand; execFile-without-input closes child stdin, so a
  hang-fixture must `exec sleep`, not `exec cat`.
- Repo-wide builds are frequently red from PARALLEL todos' WIP (was: genome/glob/kernel). If npm test
  fails outside your files, re-run solo (tsconfig.solo pattern) and retry npm test before commit.

## Todo 7

### src/core/stats.ts — API surface (signatures VERBATIM; todos 9/10/12 consume these)

```ts
import { EXIT_BLOCKED, EXIT_CANNOT_ANSWER, EXIT_OK, type ExitCode } from "../exit.js";
import type { BenchStats } from "./spec.js";

export interface BudgetCounters { readonly candidates: number; readonly modelCalls: number; readonly tokens: number; readonly wallS: number; }               // mirrors GenomeSpec.budget names
export interface BudgetCaps { readonly maxCandidates: number; readonly maxModelCalls: number; readonly maxTokens: number; readonly maxWallS: number; }
export interface UnitReplicates { readonly unitId: string; readonly split: "train" | "val"; readonly scores: readonly number[]; }
export interface UnitStat { readonly n: number; readonly mean: number; readonly sampleVariance: number; readonly sem: number; readonly ciHalfWidth: number; readonly indeterminate: boolean; }
export interface CandidateResult { readonly runId: string; readonly units: readonly UnitReplicates[]; readonly counters: BudgetCounters; }
export interface IncumbentResult { readonly units: readonly UnitReplicates[]; }
export interface UnitComparison { readonly unitId: string; readonly candidateMean: number; readonly incumbentMean: number; readonly ciHalfWidth: number; readonly delta: number; readonly ciPasses: boolean; readonly passes: boolean; }
export type Verdict = "nominated" | "culled" | "indeterminate" | "inconclusive";
export interface GateVerdict { readonly verdict: Verdict; readonly exitCode: ExitCode; readonly runId: string; readonly counters: BudgetCounters; readonly caps: BudgetCaps; readonly gain: number | null; readonly minEffect: number; readonly effectiveAlpha: number; readonly nPairs: number; readonly unitComparisons: readonly UnitComparison[]; readonly failures: readonly string[]; }
export interface EvaluateInput { readonly candidate: CandidateResult; readonly incumbent: IncumbentResult; readonly stats: BenchStats; readonly budgetCaps: BudgetCaps; readonly nPairs: number; }
export interface ParetoPoint { readonly id: string; readonly trainScore: number; readonly tokens: number; readonly wallS: number; readonly complete: boolean; }

export const FAMILY_ALPHA = 0.05;                                    // Bonferroni constant, never configurable
export const VERDICT_EXIT: Readonly<Record<Verdict, ExitCode>>;      // nominated:0, culled:1, indeterminate:1, inconclusive:2
export function needsExit(verdict: Verdict): ExitCode;
export function bonferroniAlpha(nPairs: number): number;             // FAMILY_ALPHA / nPairs; RangeError unless int >= 1
export function studentTQuantile(alpha: number, df: number): number; // two-sided; alpha in (0,1), df >= 1; abs err < 1e-3 vs t-table
export function summarizeUnit(scores: readonly number[], alpha?: number): UnitStat;          // default alpha FAMILY_ALPHA; n<2 => indeterminate + NaN
export function aggregateScore(units: readonly UnitReplicates[]): number;                    // mean over train unit means; val fallback when no train units
export function clampReps(requested: number | undefined, nReps: BenchStats["nReps"]): number; // --reps fixed count, clamped [initial, max]; absent => initial
export function budgetExhausted(counters: BudgetCounters, caps: BudgetCaps): boolean;         // any cap at/above
export function evaluate(input: EvaluateInput): GateVerdict;
export function seededRandom(seed: number): () => number;             // mulberry32, exact-tie rank order in paretoFrontier
export function paretoFrontier(points: readonly ParetoPoint[], seed?: number): readonly string[]; // default seed 1
```

### Semantics / gotchas (binding for consumers)
- HARD RULE nReps>=2: n<2 on ANY candidate unit — or a val unit MISSING from candidate (n=0) — => verdict "indeterminate", NEVER nominated. `--reps N` is a FIXED rep count clamped into [nReps.initial, nReps.max] — no sequential escalation in v1.
- Nomination gates (all must hold, per pair at bonferroni-corrected alpha): (1) per-val-unit CI half-width <= stats.halfWidth; (2) aggregate gain (train-unit-mean delta; val fallback when bench has no train units) >= stats.minEffect (=== fails); (3) no val regression: per-unit delta >= -ciHalfWidth (ties allowed).
- Budget exhaustion (any counter >= cap, passed in as plain values — NO I/O) => "inconclusive", exitCode 2 (EXIT_CANNOT_ANSWER), gain=null, unitComparisons=[], counters+hit caps surfaced in failures ("budget exhausted: <name>=<used>/<cap>" per cap). NEVER implicit pass, excluded from series. Todo 9: CLI maps inconclusive to exit 2 via needsExit(verdict).
- Bonferroni: family alpha 0.05 / nPairs across simultaneous finalist pairs; effectiveAlpha surfaced in GateVerdict. No other p-hacking knobs exist.
- Pareto over (trainScore, tokens, wallS): complete:false (budget-truncated) points NEVER enter; ordering = score desc, tokens asc, wallS asc; exact ties ranked via seeded Fisher-Yates (seed default 1; same seed => same order).
- Gate is RNG-free; seededRandom is only used for Pareto tie order.
- VERDICT_EXIT / needsExit mapping: nominated->0, culled->1, indeterminate->1, inconclusive->2 — tri-state mirrors hr/recommend.py + a 4th verdict per plan.

### Implementation gotchas
- Inverse-t: own implementation (bisection on regularized incomplete beta via Lanczos continued fraction). GOTCHA: Lanczos g=7 pairs with the 9 coefficients — using LANCZOS.length-1 (=8) silently gives logGamma(1)=-0.94 and broken quantiles (bit us mid-task). Accuracy: |t - table| < 1e-3 incl. df=1 12.706, df=2 4.303, df=9 2.262, df=30 2.042 (in unit tests, tol 1e-3). NOTE: plan line ~132 writes "t_{0.975,df=2}=2.920" — that is the ONE-SIDED value; two-sided 95% at df=2 is 4.303 (tested).
- Fixture helpers for exact variance: n=5, devs [-2c,-1c,0,1c,2c], c=sqrt(var*4/10) -> sample variance EXACTLY var (ddof=4); sem=sqrt(var/5).
- exactOptionals: incumbent val mean machine-built via tieIncumbentValMean = candMean + t(alpha, n-1)*sem so delta === -CI exactly (ties allowed on the regression floor).
- AFTER the fact (pure-LOC gate): the math kernel moved to src/core/stats-math.ts and the Pareto block to src/core/stats-pareto.ts (stats.ts 342 -> 211 pure LOC; stats-pareto re-exports seededRandom/paretoFrontier/ParetoPoint). The surface above stays VERBATIM via re-exports in stats.ts:
  `import { studentTQuantile } from "./stats-math.js"; import { seededRandom, paretoFrontier } from "./stats-pareto.js"; export { studentTQuantile, seededRandom, paretoFrontier }; export type { ParetoPoint } from "./stats-pareto.js";`
  GOTCHA: when scripting file surgery on stats.ts, `/** Family-wise alpha` sits BEFORE the /** mulberry32 block — slicing with the wrong end anchor duplicated half the file (recovered via `git checkout -- src/core/stats.ts` from the committed revision).

## Todo 5 — Toy bench adapter (deterministic, model-free evolution substrate)

Exact exported API surface (todo 6/8/9 workers: import these, never re-implement):

src/bench/adapter.ts — the shared contract (verbatim):

```ts
export interface RunMetrics {
  readonly tokensEst: number;
  readonly turns: number;
}

export type RunStatus = "ok" | "timeout" | "infra_failed";

export interface ProvenanceVersion {
  readonly bin: string;
  readonly version: string;
}

/** Version provenance stamped into every RunResult (plan §todo6 wording). */
export interface BenchProvenance {
  readonly benchType: BenchSpec["type"];
  readonly versions: readonly ProvenanceVersion[];
}

export interface RunResult {
  readonly unitId: string;
  readonly status: RunStatus;
  readonly metrics: RunMetrics;
  readonly benchProvenance: BenchProvenance;
  /** Child exit code; null for timeout / infra_failed. */
  readonly exitCode: number | null;
  /** Recorded reason for timeout / infra_failed; absent for clean ok runs. */
  readonly note?: string | undefined;
}

export interface ScoreResult {
  readonly unitId: string;
  /** Normalized unit score, 0..1. */
  readonly score: number;
  readonly pass: boolean;
  readonly metrics: RunMetrics;
}

/** Per-unit score outcome; a broken grader is INCONCLUSIVE for that unit, never a crash. */
export type ScoreOutcome =
  | { readonly kind: "scored"; readonly result: ScoreResult }
  | { readonly kind: "inconclusive"; readonly unitId: string; readonly reason: string };

export interface BenchAdapter {
  /** Put the sandbox back to a pristine starting state (toy: wipe + recreate). */
  reset(sandboxDir: string): Promise<void>;
  /** Materialize deterministic starting state (toy: copy genome repo units). */
  seed(sandboxDir: string): Promise<void>;
  /** Execute one unit in the sandbox, hard-capped at timeoutS seconds. */
  run(unit: BenchUnit, sandboxDir: string, timeoutS: number): Promise<RunResult>;
  /** Grade one unit via bench.graderCommand (toy: node grader.mjs {unit.path}). */
  score(unit: BenchUnit): Promise<ScoreOutcome>;
}
```

Also from adapter.ts (todo 6 should reuse, not rewrite):
- `CommandVars = Readonly<Record<string, string>>`, `unitVars(unit, sandboxDir)`, `sandboxVars(sandboxDir)`, `renderCommand(template, vars): string[]` — quote-aware template engine. Placeholders: `{unit.path}` `{unit.id}` `{sandbox}` `{workdir}`. Unknown placeholder / empty template / unbalanced quote ⇒ `cannotAnswer` ExitSignal(2), fail-closed.
- `ChildKind = "exited" | "timeout" | "spawn_failed"`, `ChildOutcome {kind, exitCode, stdout, stderr, reason}`, `ChildOptions {argv, cwd, timeoutS, env?}`, `killGroup(pid)`, `runChild(opts): Promise<ChildOutcome>` — spawn with `detached: true`, timeout kills the WHOLE process group via `kill(-pid, SIGKILL)`; runChild NEVER rejects (kind carries the failure). maxBytes 1MiB stream cap, env gets LC_ALL=C.

src/bench/toy.ts:
- `class ToyBenchAdapter implements BenchAdapter` — `new ToyBenchAdapter(spec: GenomeSpec)`; repoRoot = resolve(spec.repoPath) (non-dir ⇒ exit 2).
- `toyTemplateDir(): string` — finds genomes/toy-smoke beside module in repo or dist layout, else exit 2.
- `prepareToyGenome(destDir: string, templateDir: string = toyTemplateDir()): Promise<string>` — runs the fixture's own init.mjs via `node` child (60s cap); returns path.resolve(destDir). Use this in ALL later loop tests to get a self-git-initialized toy genome; then `loadGenomeSpecFile(join(dest, "genome.jsonc"))`.

Semantics gotchas (locked by src/test/bench-toy.test.ts):
- `run` status is `ok` even when the unit exits ≠0 — the nonzero exit is recorded in exitCode/note, never escalated to infra_failed. timeout/infra_failed metrics are `{tokensEst: 0, turns: 0}`; toy ok-metrics = `{tokensEst: ceil(unitSourceBytes/4), turns: 1}`. tokensEst is a toy-only heuristic — todo 6 replaces it for real benches; do not build gates on its absolute value.
- benchProvenance is ALWAYS `[{bin: "node", version: process.version}]` on the toy path (model-free, D7: no opencode, no network, no absolute machine paths in results — sandbox paths appear only in child cwd, never in RunResult fields).
- `score(unit)` reads the adapter's LAST activeSandbox touched by reset/seed/run; a cold `score` before any of those ⇒ ExitSignal(2). One adapter instance per sandbox (do not interleave sandboxes on one instance).
- Grader contract: ONE JSON line on last stdout line `{unit, score 0..1, pass, metrics{tokensEst,turns}}`; bad JSON / nonzero grader exit / timeout ⇒ `{kind:"inconclusive", unitId, reason}` for THAT unit — the loop must treat it as per-unit failure, never crash (AC d).
- bench.seedCommand/resetCommand hooks run in sandbox after the copy/wipe; hook failure ⇒ cannotAnswer(2) (seed/reset are infra, unlike score).

src/core/evolve/stub-mutators.mjs (+ sibling stub-mutators.d.mts — the .d.mts is what makes `import ... from "../core/evolve/stub-mutators.mjs"` typecheck under NodeNext+verbatimModuleSyntax; TS-only trick, mjs stays the runtime impl):
- `scriptedPatches(): ScriptedPatch[]` (4 patches: fix-add/break-mul/break-sub/annotate-add; anchors are byte-exact against genomes/toy-smoke units — if you edit a unit file, fix its anchors or applyPatch silently returns false), `selectPatches(seed, count)` (mulberry32 + Fisher-Yates, deterministic, count clamped, TypeError guards), `applyPatch(repoDir, {file, from, to}): boolean` (refuses missing file / absent anchor / ambiguous anchor; single replace otherwise; re-apply ⇒ false).

genomes/toy-smoke fixture (copy-assets already ships it to dist/genomes/toy-smoke; package.json untouched):
- genome.jsonc: type "toy", units add/mul/explode(train)+sub(val), runCommand "node {unit.path}", graderCommand "node grader.mjs {unit.path}", timeoutS 10, stats {halfWidth 0.25, minEffect 0.5, nReps 2..4} (todo-9 gates pass deterministically), kernel.immutableGlobs ["grader.mjs"].
- units: add.mjs carries the seeded bug line `return a - b; // seeded bug: must be \`return a + b;\`` (fix-add lifts add score 0→1); explode.mjs process.exit(1) at import (kills grader mid-flight); mutate.mjs and hang.mjs are isMain-guarded (safe to grader-import): hang runs `exec sleep 31.7` (10s adapter timeout leaves margin; exec makes group-kill reap it — evidence shows 0 orphans), mutate writes ./poison.txt to demonstrate reset.
- init.mjs: copy self-dir→dest (skips .git/.state), rewrites repoPath to ABS dest, `git init -b main` + commit with -c identity, idempotent (re-init keeps existing .git, same HEAD).

Process lessons:
- tsc emits JS even with SYNTAX errors (line-eating recovery) — a stale/mangled dist/test/*.js misled a test-file split; trust `tsc` exit, not emitted artifacts, when repairing.
- AC (b) determinism proof: two matrices from independent fresh sandboxes deepEqual (incl. score metrics); AC (c) isolation: treeDigestAt(sandbox) after seed == pre-run-1 digest after a state-mutating run 1 + reset+seed (poison.txt gone). Evidence: .omo/evidence/abathur/task-5-happy.txt / task-5-failure.txt (driver: node /tmp/opencode/task5-evidence.mjs happy|failure against dist/).

### orchestrator needs-fix round 1 (todo 5)
- Trap: node `spawn` with a `cwd` that does not exist fails as `spawn <bin> ENOENT` — it blames the BINARY, not the cwd (`/usr/bin/node ENOENT` while node is installed). Hit via `prepareToyGenome(<deep/missing/parent/g>)`.
- Fix: `prepareToyGenome` now does `mkdirSync(path.dirname(dest), {recursive:true})` before spawning init.mjs (src/bench/toy.ts). Regression test: bench-toy.test.ts "prepareToyGenome creates missing parent dirs…" (also re-asserts same-dest idempotence). RED error string for grep: `toy fixture init failed (spawn failed: spawn /usr/bin/node ENOENT): no output`.
- Rule for todo 6+: any runChild/spawn taking a caller-chosen dir as cwd must create it first — the ENOENT message will send you debugging the wrong binary.
