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

## Todo 6 — opencode-fixture-scenarios adapter (src/bench/fixture.ts + fixture-support.ts + fixture-probe.ts)

Exported API surface for todo 9 (the run-loop):

- `class FixtureScenariosAdapter implements BenchAdapter` — ctor `(spec: GenomeSpec, opts: FixtureAdapterOptions = {})`. `new FixtureScenariosAdapter(spec)` stays symmetric with ToyBenchAdapter; todo 9's only required addition is **`adapter.release()` in a finally-block** — the single-flight genome lock (fingerprint(spec)-keyed via acquireGenomeLock, waitMs default 0) is acquired at `start()` (first reset/seed/run/score) and HELD across the whole bench, exactly as plan requires "held across reset→seed→run". A second live holder gets `ExitSignal(2)` whose message starts `fixture: another bench active for genome` (hint carries the raw locks.ts holder detail). Probe failure releases the lease and un-memoizes start, so retries are safe.
- `FixtureAdapterOptions { env?: ConfigEnv; configDir?: string; opencodeBin?: string; home?: string; includeVal?: boolean; lockWaitMs?: number }` — configDir defaults to `resolveConfigEnv(env)` (pass an explicit dir in tests: the genome lock dir lands under it); opencodeBin resolution chain opts → `loadConfig(env).config.opencodeBin` → literal `"opencode"`; home = the REAL home mirrored into the sandbox; includeVal is the operator-only val gate (todo 10 CLI flag; API-level only, no CLI wired here).
- `adapter.scenarioManifest(): readonly ScenarioEntry[]` + `scenarioManifestPath(sandboxDir)` = `<sandboxDir>/.bench/manifest.json` (written by seed). Val entries are `{alias:"scenario-NN", split:"val"}` with NO id/path unless includeVal — aliases are positional and stable, so scores join back to val units without leaking paths to mutator-facing output.
- Lifecycle paths: sandbox HOME = `<sandboxDir>/.sandbox-home` (mirrorSandboxHome copies ONLY `.opencode/{plugin,skills,node_modules}` + `.config/opencode` via `cpSync {recursive, dereference:true}` — real copies, never symlinks; opencode config is then MUTATED by writing `<home>/.config/opencode/opencode.json` = base(JSONC-tolerant) merged with `{model: agentModel}`). Transcript per unit: `<sandboxDir>/.bench/transcripts/<unitId>.jsonl`, surfaced as `RunResult.transcriptPath` (set only when status ok AND the file exists after the child exits).
- Child env contract (run + both hooks): `HOME=<sandboxDir>/.sandbox-home`, `ABATHUR_AGENT_MODEL`, `ABATHUR_JUDGE_MODEL` (when set), `ABATHUR_TRANSCRIPT=<per-unit path>` — runCommand fixtures write the transcript there; parseRunMeta reads the run stdout's LAST JSON line for `{tokensEst?, turns?}` only (garbage ⇒ metrics {0,0}, never a crash).
- Startup probes (fixture-probe.ts `probeEngines`): `<bin> --version` within 30s, semver-ish `v?X.Y.Z(-pre)` extracted (raw string goes verbatim into EVERY RunResult.benchProvenance.versions, preceded by a node entry, requires entries appended); unparsable/failed version or `compareSemver(observed, spec.opencodeBinVersion.minVersion) < 0` or a requires[] spawn_failed/exit≠probeExit ⇒ `cannotAnswer` exit 2 BEFORE any unit runs. minVersion lives at **spec.opencodeBinVersion.minVersion** — NOT bench.minVersion as the task text said; spec.ts is authoritative.
- adapter.ts shared-plumbing additions (moved out of toy.ts, both import from adapter.js now): `parseGraderLine`, `childStatus`, `inconclusive`, `firstLine`, `ZERO_METRICS`, and **ChildOptions.env?: Readonly<Record<string,string>>** — merged as `{...process.env, ...env, LC_ALL:"C"}` so fixtures can pin HOME without shell tricks. RunResult gained optional `transcriptPath`.

Gotchas hit:

- infra_failed is a FIRST-CLASS status: run spawn_failed ⇒ `status:"infra_failed"`, exitCode null, note `spawn failed: …`, and score() returns inconclusive on such units — never 0. Misleading-success probe: matrix consumers must filter by status before averaging (todo 9).
- Val gating errors on BOTH run() and score() (gateVal), so a mutator cannot smuggle a val path in by pre-fetching a BenchUnit from the spec itself.
- J-gotcha: do NOT digest-compare the whole fake HOME — abathur locks/ledger live under configDir which tests nest inside the fake home; only `.opencode` and `.config/opencode` digests must be stable across a bench run.
- Concurrent-worker hazard: `npm run build` compiles EVERYTHING including other workers' red files (their tsc still EMITS dist for them on type errors — a stale `dist/test/reflect.test.js` from their failed build will pollute your `npm test` run with failures that are not yours). During parallel development build with a scoped tsconfig extending the repo one (exclude the red files; remember `typeRoots` + `types:["node"]` must survive the extends or node builtins go unresolved) and run `node --test dist/test/<yours>.test.js`.
- 250-LOC ceiling: fixture.ts landed at 242 pure LOC after extracting fixture-support.ts + fixture-probe.ts (mirrors the todo-7 split pattern; fixture.ts re-exports the support surface so consumers import from one place).

## Todo 8 — reflection brief + constrained-diff mutator driver (2026-09-09)
API surface (todo 9 imports ALL of this from `src/core/evolve/reflect.js` — re-exports are the contract):
- `buildBrief(spec: GenomeSpec, units: readonly BriefUnitEvidence[], counters: BudgetCounters): string`
  — pure (brief.ts). `BriefUnitEvidence {unit: BenchUnit, scores: readonly number[], failures: readonly string[]}`.
  Only split==="train" units with (any score<1 | failures non-empty | empty scores=inconclusive) get a section
  (`## <path> (unit id: <id>)`, `- scores over N reps: …`, `- failure: <oneLine 500>`). Val units → ONLY
  `val-1, val-2…` aliases + count; ids/paths/scores/content never emitted even if present in input evidence.
- `runMutatorSession(opts: MutatorSessionOptions): Promise<MutatorSessionResult>` —
  opts `{spec, brief, mutatorCommand, opencodeBin?: string|null, env?, timeoutS?=spec.bench.timeoutS,
  maxCandidates?=spec.budget.maxCandidates, ledger?=Ledger.open(spec.repoPath), now?}`;
  result `{launchGenId, applied: AppliedCandidate[], rejected: RejectedCandidate[]}` with
  `AppliedCandidate {candidateId, rationale, genId, worktreePath, parentCommit, commitSha, treeSha, touchedFiles}`
  and `RejectedCandidate {candidateId, stage: "schema"|"syntax"|"path"|"apply"|"parse", reason}`.
- `validateCandidate(raw: unknown, policy: PathPolicy, fallbackId = "candidate"): CandidateValidation` (candidate.ts);
  `PathPolicy {immutableGlobs, artifactGlobs}`. Stages ordered schema→syntax→path; ANY violating path rejects the
  WHOLE candidate. `ARTIFACT_GLOBS: readonly string[]` central const (dist/**, **/dist/**, node_modules/**,
  **/node_modules/**, .state/**, **/.state/**, *.local.jsonc, **/*.local.jsonc) + repo .gitignore folded in by the
  driver via `artifactGlobsFromGitignore(text): string[]` (dir 'x/'→['x/**','**/x/**']; bare→[x,'**/x']; `!` skipped).
- `parseUnifiedDiff(text): {ok:true,changes:FileChange[]}|{ok:false,error}` + `applyChanges(changes, readBase):
  {ok:true, files: Map<string,string>, touched}|{ok:false,reason}` (udiff.ts) — pure, disk never touched; v1 ops:
  modify+create only; renames/deletes/binary/CRLF/`\ No newline`/control-bytes rejected; hunks are POSITIONAL
  (drift → 'hunk context mismatch … refusing without force' — that IS the dirty_worktree refusal).
- child stdout contract: `mutatorOutputSchema` = `{candidates: unknown[] (min1)}` top level; per-candidate
  `candidateSchema` strictObject `{id?: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, rationale: 1..4000 chars, diffs: string[] min1}`.
  Top-level damage (non-JSON/array/bad shape) → ledger row stage parse|schema candidateId 'mutator-stdout' THEN
  blocked exit 1. Per-candidate damage → rejected[] + ledger, session continues.
- ledger: new stable kind `"candidate_rejected"`, data `{candidateId, stage, reason}` (+genId when a worktree existed).
  Driver never appends generation_complete (todo 9 owns that).

Gotchas:
- Fail-closed bin check runs BEFORE openGenome/mkdtemp/newGeneration: `resolveBin` (opencode→opencodeBin else PATH
  scan; path-style argv[0] statSync X_OK) → cannotAnswer exit 2. `node /missing/script.mjs` is NOT covered (node
  resolves fine) — only the binary itself is pre-checked; a missing script dies later as stdout-parse exit 1. By design.
- renderCommand placeholders provided to the template: `{worktree}` (throwaway launch dir) and `{brief}`
  (abs path to brief.md in an os.tmpdir mkdtemp removed in finally). Probe argv with empty vars BEFORE materializing.
- sealGeneration `git add -A`s everything in the candidate worktree — keep ALL side files (brief, capture, ledger)
  OUTSIDE the worktree or they get sealed into the candidate commit. Ledger lives in the REAL repo .state (driver
  writes there only); candidate worktrees never contain .state.
- zero-effect candidates would make sealGeneration block ('nothing to seal'): driver diffs write-vs-existing and
  rejects stage "apply" "candidate changes nothing" instead of throwing mid-session.
- rationale is attacker data: never executed; stripped to printable ASCII, flattened to one line ≤80 chars, shipped
  as ONE argv element `-m<msg>` (todo-3 dash guard) and JSON-escaped in ledger.
- exit-path hygiene: launch worktree + every non-sealed candidate worktree rmSync'd in finally; stale `git worktree`
  registry entries are pruned by cleanupStale (todo 3) — driver deliberately does NOT cleanupStale itself because
  sealed worktrees/commits belong to the caller (todo 9 benches from worktreePath/commitSha, then cleans).
- genIds embed now().getTime() — reruns with the same stub seed give identical candidateIds+treeShas (determinism
  proof) but distinct genIds/dirs (no collision).
- Test stub mutator is a runtime-written /tmp-style script (STUB_SOURCE in reflect.test.ts), NOT a shipped fixture:
  dist/test never receives .mjs copies (copy-assets has no test-fixture row) — inline-and-write sidesteps that.
  It reads its --dir worktree to build byte-exact hunks and mirrors scriptedPatches anchors (pinned by test).
- 250-LOC ceiling: reflect.ts (277 at first) split into brief.ts (55) + reflect.ts (225); split is re-export-only,
  consumer import path unchanged.

## Todo 9 — resumable run-loop orchestrator (CLI `abathur run`)
API surface (consumers: cli.ts COMMANDS + todo-10 promotion):
- runEvolution(opts: RunLoopOptions{entry,configDir,mutatorCommand?,reps?,maxCandidates?,dryRun?,opencodeBin?,env?,sandboxRoot?,now?})
  → Promise<RunLoopOutcome{exitCode,lines:string[]}> in src/core/evolve/run-loop.ts (290 lines, 243 pure, split: run-plan.ts dry-run text,
  run-rows.ts ledger row schema + resume/peek, run-bench.ts adapter factory + replicate bench, child-track.ts reap/tracker,
  src/commands/run.ts CLI parse).
- generation_complete data = generationRowDataSchema (run-rows.ts): source incumbent|candidate, headCommit, commitSha?/treeSha?
  (candidate-required), complete, reps, units[{unitId,split,scores,runIds,failures}], counters{candidates,modelCalls,tokens,wallS},
  manifest[{glob,path,sha256}], verdict?/exitCode?/gain?/gateFailures?, dirtyWorktree?, benchProvenance. Mutator driver never
  appends these — todo 9 owns the write.
- exit semantics (runExitCode): any nominated this-run ⇒ 0; else any inconclusive ⇒ 2 (cannot-answer, budget-tripped included);
  else candidates considered ⇒ 1; none ⇒ 0. Gate order is load-bearing: auditKernel BEFORE Ledger.open/lock/reap/spawn, so a
  drifted kernel leaves .state/ untouched (asserted by absence, not mtime-only).
- Child tracking: additive ChildOptions.onChild?:(h:ChildHandle{pid,exited:Promise<void>})=>void in runChild — invoked
  synchronously after spawn (pid==pgid, detached), ChildOutcome shape untouched so all todo-5/6/8 tests stay green unchanged.
  ChildTracker appends canonical-JSON lines (compact, no spaces — grepping the log needs '"kind":"candidate-bench"' style),
  removes on child exit via atomic tmp+rename rewrite; run-loop drains pending removals before finishing. reapOrphans: kill-0
  first, kill(-pgid) SIGKILL only for records in <repo>/.state/abathur/active-children.jsonl, self pid always skipped,
  unparseable/invalid-pid lines counted malformed and dropped, file truncated AFTER kills (crash mid-reap re-kills idempotently).
Gotchas (each cost a red test or an evidence rerun):
- Driver slices raws to maxCandidates BEFORE validation AND before todo-9 dedups by treeSha ⇒ a full-budget resume can never
  re-deliver an already-recorded candidate; the exit status must CARRY stored verdicts for the current head
  ('carried into this run's exit status' line) or a completed run flips 0→1 on every rerun. resume.candidatesByTree rows are
  head-filtered: other heads' verdicts are history, not this outcome.
- Candidate budget slot must be excluded from evaluate's running counters (evalCounters = counters - own row spend) or the
  Nth candidate of a full run self-trips the cap ⇒ permanently inconclusive. Same reason benchTarget's per-rep budget check
  counts countersBefore.candidates only.
- Unscored units (run timeout/infra_failed, inconclusive grader, budget cut) must be FILTERED from UnitReplicates
  (scores.length>0) before stats.evaluate — empty replicate lists poison aggregateScore with NaN, and gain null then renders
  'n/a (truncated)' but the val gates silently pass a garbage candidate.
- Dry-run must not call Ledger.open (its ctor mkdirs .state/abathur ⇒ breaks zero-mutation) — peekPlanState reads the ledger
  file read-only instead; plan runs before lock/reap/openGenome/spawns; sandbox dirs also stay uncreated.
- benchTarget pre-creates a row for EVERY spec unit incl. val (includeVal:true on the fixture adapter) — the val gate has no
  data otherwise; toy val unit sub() therefore contributes scores like train (18 samples for 2 reps × 2 candidates + incumbent
  on toy-smoke, explode contributes 0 — it always times out).
- modelCalls is booked 0 everywhere: adapters don't yet meter opencode calls (real accounting is a later todo); budget math
  exercises on tokens/wallS.
- Fixture lock keys on genome fingerprint: the candidate override {...spec, repoPath: worktreePath} changes fingerprint16, so
  consecutive candidate benches take DIFFERENT lock keys — fine for the sequential loop, wrong for future parallel workers.
- Evidence-workspace gotchas: editing genome.jsonc AFTER 'genome add' re-registers a new fingerprint ⇒ two label entries ⇒
  run exit2 ambiguous (edit first, register once); editing a bench-target file (units/explode.mjs) without committing ⇒
  openGenome dirty-target refusal (correct behavior — commit evidence tweaks).
- src/commands/run.ts parseRunFlags rejects value-looking flag args ('--reps --x' ⇒ exit2), --max-candidates clamps DOWN only
  (min(flag, spec)); CLI tests must set process.env.ABATHUR_CONFIG (runRun resolves config dir from real env, not fixture arg).
- adapter.ts sits at 261 pure LOC: 241 pre-existing + the 20-line additive hook; splitting todo-5/6 keystone plumbing was
  forbidden by the 173-tests-unchanged constraint — accepted exception, do not grow it.

## Todo 10 — human-gate commands: promote / tombstone / status + genome rm (2026-09-09)
- New API surface:
  - src/core/promote.ts `promoteGeneration(req: PromoteRequest{entry,configDir,genId,env?}): Promise<PromoteOutcome{genId,fromSha,toSha,lines}>`
    and `LEDGER_KIND_PROMOTE="promote"`. Imported ONLY by src/commands/promote.ts (pinned by a structural test that greps every
    src/*.ts for `from "..*/core/promote.js"` — exactly one hit). run-loop/reflect/candidate never touch it.
  - Commands `promote <label> <genId>`, `tombstone <label> <genId> --reason <text>`, `status <label> [--last N]` wired into
    COMMANDS (pending() placeholders retired); `genome rm <label>` case added; src/commands/run.ts got an additive `who` param
    on resolveUniqueEntry (now exported, default "run" ⇒ existing messages byte-identical).
- Order-of-operations IS the security property: ledger nomination check → SECOND sealed-path enforcement
  (`git diff --name-only -z parent..commit` crossed vs compileGlob(kernel.immutableGlobs) AND vs the config-home manifest path
  set) → fastForwardIncumbent (CAS; refuses checked-out incumbent; non-descendant ⇒ "is not an ancestor of" exit 1) → ONLY THEN
  manifest regen from snapshotCommit(new gen tree) (never from the worktree) → append promote row {actor:"cli",genId,from,to}.
  A forged nominated generation_complete row can never move the ref or the manifest (AC(b) pins ref + manifest bytes unchanged).
- Gotcha: FastForwardResult.fromSha is null on FIRST promote (branch creation, not a move) — promote ledger row `from` is null
  there, NOT the gen's parent commit. Test asserted parent first and went red for the right reason; `status` prints "new branch".
- Gotcha: status must NOT call Ledger.open — it mkdirs <repo>/.state/abathur as a side-effect, which would poison `genome rm`'s
  ledgerless check. status reads ledgerPath() raw (existsSync + per-line ledgerRecordSchema.safeParse; any bad row ⇒ exit 2,
  mirroring peekPlanState). genome rm likewise checks history via the raw file (exists + trim().length>0 ⇒ refuse 'has ledger
  history — archive instead'; rm removes ONLY the registry .jsonc — kernel manifest, repo, worktrees, commits all stay).
- Ledger row counters from run-loop are PER-GENERATION spend (run-loop.ts:173,262 write out.spent per row) ⇒ status budget line
  = plain sum of generation_complete counters vs spec.budget caps. No global counters exist.
- status quarantine depth definition (documented in src/commands/status.ts): candidate generation_complete rows whose LATEST row
  per genId is verdict==='nominated' AND whose genId has neither a promote nor a tombstone row — i.e. blocked-but-never-decided.
  A tampered gen refused at promote correctly stays quarantined (honest depth:1 in task-10-happy.txt).
- promote derives state ONLY from the ledger (todo-9 rule): genId args are matched against rows, never passed to git/fs;
  unknown genId ⇒ exit 1 naming it; row without verdict ⇒ exit 1; incumbent-baseline row ⇒ exit 1; double promote ⇒ exit 1.
  tombstone is append-only ({genId,reason,actor:"cli"}, reason stored verbatim, capped 4000 chars) and echoes a sanitized
  one-liner ([^ -~]→space, ≤120, todo-8 sealMessage discipline — ANSI/control chars never reach stdout).
- No --confirm/--yes on promote/tombstone: the plan's signatures carry none and the explicit human CLI invocation IS the gate
  (border --yes gates irreversible pushes; historian README:75 --confirm gates destructive deletes — these append ledger rows +
  move a ref nobody has checked out, reversible by design: promote a descendant later). Zero --force anywhere (grep-pinned).
- kernel audit (todo 4) unchanged and standalone; AC(a) pins `kernel audit` exit 0 after promote because the regen re-hashes
  grader.mjs from the promoted tree. Manifest regen re-scan is TREE-derived: sealed-but-untracked working files present at
  registration would drop out — acceptable per plan ("regenerate the kernel manifest from the new incumbent tree").
- Test/evidence: src/test/promote.test.ts 11 tests (real toy genome + real seals + forged rows, CLI spawned with ABATHUR_CONFIG/
  HOME/XDG_CACHE_HOME pinned to tmp home). RED task-10-failure.txt (11/11 red pre-implementation), task-10-happy.txt full
  transcript incl. tamper refusal + tombstone cat-file -e proof. Suite 186 → 197/197 green ×2 runs (no flakes).

## Todo 12 — lineage bundles: export + inspect with provenance + redacted evidence (2026-09-09)
- New API surface (import from src/core/bundle.js barrel): `exportBundle(req{entry,configDir,select:{genIds}|{last},outDir,home})`,
  `inspectBundle(req{bundlePath,home})`, `bundleManifestSchema` (plan field set EXACT, key order = serialized byte order, tests pin it),
  `DIGEST_ALGO="sha256-canonical-v1"`, `benchDigest(input)` + `ADAPTER_IFACE_VERSION="abathur-bench-adapter-v1"` (ADDITIVE in ids.ts;
  iface const = todo 5/6 adapter contract, bump on breaking adapter-shape change so digests stop comparing), spec.ts ADDITIVE
  `bundle:{maskLiterals:string[]}` optional section; bundle-tar.ts `writeTar/readTar/TarError` (pure-node, NO tar child — single-shot
  commands, in-memory ≤64MiB, precise member-level errors are the adversarial ACs: truncated/evil/checksum); bundle-mask.ts
  `buildMaskPlan/scanMemberLeaks`.
- Bundle layout: manifest.json (NOT self-pinned) + README.md + lineage.json + patch.diff + trees/<genId>/** + evidence/<genId>/<runId>.jsonl.
  files[] = every member except manifest.json, {path,sha256,len} sorted. Name `abathur-<fp16>-<genIds joined '_'>.bundle.tgz`.
  GEN CONTENT READ FROM GIT ONLY: `git -C repo archive --format=tar <commit>` via own execFile(encoding:"buffer") — util/git is
  STRING-stdout only, binary needs the local variant (same argv-only/30s-SIGKILL/LC_ALL=C guards). Dirty worktree impossible by
  construction (AC proven: tree member == `git show commit:path` while worktree bytes differ).
- PRIMARY GEN = lexicographically max genId among selected (ids embed compactUtc). Export AND inspect share primaryGenId() — a per-gen
  manifest scalar set (parent/stats/rationale/benchDigest/benchProvenance.nRepeats) describes ONLY the primary; older selected gens
  ship as trees/<gid>/** + lineage.json summaries. --last N = N newest CANDIDATE rows (ledger append order, latest row per genId),
  clamped; incumbent rows never exported. --gen/--last XOR; unknown genId ⇒ exit 1 NAMED.
- Self-describing: manifest.genome.fingerprint = fingerprint(spec parsed from trees/<primary>/genome.jsonc) at EXPORT (registry value
  unused) ⇒ inspect recomputes from contained bytes ⇒ wrong-genome graft detected exit 1 even with honest files[] re-pins. benchDigest
  likewise recomputed from contained tree at inspect; sha gate can be bypassed by a repacker — the digest/fingerprint gates catch it (both AC-tested).
- Masking contract: literals = HOME + genome repoPath ALWAYS (spec.bundle.maskLiterals EXTENDS → <MASKED-1>,<MASKED-2>… by declared
  order; placeholders <HOME>/<GENOME>). trees/<gid>/** members are EXEMPT from mask+scan by design: byte-truth of git objects, and
  genome.jsonc necessarily carries the machine-local repoPath (integrity > leak there; fingerprint check pins it). Every masked member
  is scanned over FINAL SERIALIZED BYTES, pre-write: surviving declared literals OR any generic /<root>/ absolute path (roots list in
  bundle-mask MACHINE_PATH_ROOTS; /dev excluded so "/dev/null" diff headers are legal). First hit per member reported as
  member:<1-based-line> + ≤120-char sanitized snippet; ANY hit ⇒ blocked(1), NOTHING written (tmp-file + rename is the backstop).
  Inspect rebuilds the same scan from CONTAINED specs (repoPath+maskLiterals) + this machine's HOME.
- Evidence: walks ONLY train rows' runIds from the ledger (split!=="train" never touched — val transcripts structurally unreferencable);
  transcript store layout mirrored from todo-6/9: <configDir>/bench-sandboxes/<invId=a-…>/<genId|incumbent>/<unitId>-<rep>/.bench/transcripts/<unitId>.jsonl,
  latest invId (lex-max = chronological) wins; missing transcript (toy benches) = no member. >2MiB ⇒ refuse exit 1 naming member (never truncate).
  Inspect additionally rejects evidence members matching r-…-<valId>-<rep>.jsonl against the contained spec's val ids.
- GOTCHA (cost a red test): editing genome.jsonc BEFORE registerGenome does NOT make tree==registry spec — init.mjs already committed it;
  export self-describes from the COMMIT tree, so fixture must `git commit -am` the spec edit (maskLiterals then land in tree spec).
- GOTCHA: readTar treats the two 512B zero end-blocks as terminator — truncation INSIDE the padding looks valid unless the reader
  requires ≥2 full zero blocks + block-multiple remainder at the break (my first impl silently accepted good.slice(0,-17)).
- GOTCHA: rationale/frictionDigests reach the manifest inside a JSON.stringify — JSON does NOT escape '/', so HOME/path literals
  survive into the serialized bytes verbatim ⇒ pre-mask fields AND final bytes (belt), scan over bytes catches both.
- Inspect exit map: missing file / not-gzip / not-tar / traversal member / manifest missing|garbage|schema-fail / unknown digest_algo ⇒ 2;
  sha|len mismatch, missing/extra member, fingerprint|label mismatch, benchDigest mismatch, mask leak, val evidence, patch.diff absent ⇒ 1.
  Malformed inputs never stack-trace (cli funnel) — AC-tested with junk bytes, half tgz, hand-built traversal-header tar (test crafts raw
  512B header because writeTar itself refuses traversal — good dogfood signal).
- Deterministic tar (mtime 0, uid/gid 0, mode 0644, sorted members, JSON.stringify indent-2 + '\n' manifest) ⇒ re-export of unchanged
  ledger is BYTE-IDENTICAL (AC-asserted). PAX 'x' path-override supported in reader for >100-char names; USTAR prefix split is the writer default.
- benchProvenance v1 mapping: opencodeVersion from ledger row versions[bin==="opencode"] (toy ⇒ null), mutatorModel null until todo 11;
  adapterConfigDigest = fingerprint of bench command surface + iface const; fixtureSeedId = fingerprint(seedCommand) when set;
  statsConfigDigest = fingerprint(spec.bench.stats). Plan wording "everything that can move a score": unit CONTENTS, script CONTENTS
  (grader/seed/reset files read from the gen tree), command templates, models, timeout, iface version — all in benchDigest.
- Tests: src/test/bundle.test.ts 16 tests (3 pure-unit: benchDigest/tar/mask; 13 integration with real toy evolve+promote+CLI spawn,
  planted transcripts, hand-built evil tar, handSeal third gen). Suite 197 → 213 ×2 green, no flakes. Evidence task-12-{failure,happy}.txt
  (driver: node /tmp/opencode/task12-evidence.mjs happy|failure — leak refusal names 4 members pre-write + `[]` written after refusal).

## Todo 13 — graft: cross-instance crystallization merge with local re-bench (2026-09-09)
- New API surface: src/core/graft.ts `graftBundle(req{entry:RegistryEntry|null,configDir,bundlePath,genomeLabel,home,opencodeBin?,env?,now?})→{exitCode,lines}`
  (orchestrator, 229 pure LOC); src/core/graft-gates.ts (bundle IO + 4 gates + dup refusal; exports GraftRequest/GraftOutcome/VerifiedBundle/readBundleBytes/
  parseBundleBytes/bestEffortClaim/localBenchDigest/provenanceGateFailures/probeGraftPrerequisites/assertNotGrafted); src/core/graft-rebench.ts (graftAndBench:
  worktree+apply+seal+local bench+rows); src/core/graft-support.ts (queue convention + graft_import row codec + echo sanitizer — fs/text ONLY so status can
  render without Ledger.open); src/commands/graft.ts CLI; status.ts additive.
- LEDGER_KIND_GRAFT_IMPORT='graft_import' lives in graft-support.ts (own module const; ledger.ts untouched). Row data: {decision,genomeLabel,bundleSha256,
  bundlePath,sourceGenomeFingerprint,sourceBenchDigest,reason,imported:true,graftGenId,commitSha,treeSha,peerClaim} — generation_complete rows stay
  schema-stable (provenance rides the graft_import row only).
- Queue convention: <configDir>/graft-queue/<bundle-sha256>.json {bundleSha256,bundlePath,genomeLabel,reason,queuedAt,sourceGenomeFingerprint}; filename-key
  cross-checked inside (foreign key = tampering, cannotAnswer); any terminal decision removes it; listGraftQueue fail-closed like status's ledger reads.
  status.ts: 'pending-bench graft queue: N' + entry lines + 'graft decisions: N' section; UNREGISTERED label with queue entries gets a queue-view exit 0;
  without them the identical resolveUniqueEntry exit-2 message stays (AC(d) '/pending-bench graft queue: 0/' pin survives — virgin home prints the 0 line).
- Exit map: nominated 0; culled/indeterminate/quarantined/already-grafted/pending-unregistered 1; inconclusive/probe-pending/malformed-container/unknown-flag 2.
  Inspect integrity-fail (code 1) ⇒ quarantine booked when a local ledger exists, then the same message echoed; code 2 (garbage) rethrows WITHOUT booking —
  and WITHOUT queue (queue is for bundles awaiting setup, not garbage). Unregistered+integrity-fail ⇒ throw 1 clean, zero state.
- GATE SEMANTICS that cost analysis time: benchDigest gate = benchDigestFor(LOCAL spec, bundle's CONTAINED primary tree) vs manifest.benchDigest — NOT a
  digest of the incumbent HEAD tree. Candidate patches change unit content ⇒ incumbent-vs-bundle would quarantine every honest graft. The gate pins the
  BENCH SURFACE the peer measured, anchored on the local spec (inspect already pins contained==claimed; graft re-derives locally so export/inspect can
  never drift from verification — parseBundleBytes uses the same bundleManifestSchema + bundle-common).
- AC(a) cross-instance trick (toy fingerprints embed repoPath): same ABSOLUTE genome path in a DIFFERENT config home — export from instance A at P,
  rm -rf P, prepareToyGenome(P) again (init.mjs is idempotent-per-dir so the wipe is mandatory), register into home B: identical spec bytes ⇒ identical
  fingerprint, different git history. Evidence + test prove nominated/culled per LOCAL score with peer claims lying the other way (manifest.json edits are
  self-consistent because manifest.json is NOT sha-pinned — files[] tampering would die at inspect first).
- Provenance gate: 5 recomputables (agentModel/judgeModel/statsConfigDigest/adapterConfigDigest/fixtureSeedId) byte-equal THREE ways — local-derived vs
  peer-contained-spec-derived vs manifest-claim (lying claim ⇒ quarantine); opencodeVersion via parseSemver+compareSemver equality, both-null honest for toy;
  local side reads the newest incumbent generation row's versions (no rows ⇒ [] ⇒ null side). deriveBenchProvenance demands a real GenerationRowData —
  built schema-valid minimal row (provenanceRow()), never a cast.
- requires[] probes: fixture type ⇒ probeEngines(bin=resolveOpencodeBin, repoRoot) verbatim (opencode --version + minVersion + requires). TOY must NOT call
  probeEngines (its opencode --version probe is unconditional — a toy genome without opencode would pending forever); local mirror reproduces
  fixture-probe's probeRequires exactly (runChild argv-spawn, 30s, spawn_failed/exit≠probeExit ⇒ cannotAnswer before any worktree/bench).
  Pending-rows do NOT trip the dup rule; terminal ones do ('already grafted', exit 1) — stale_state pinned.
- Re-bench = single-shot run-loop clone: reapOrphans under genome lock, openGenome(repo,[],env) (empty targetPaths ⇒ dirt never blocks; incumbent benched
  from snapshotCommit(HEAD), NOT the worktree — dirty_worktree AC proves bundle bytes win), ChildTracker+drain, benchTarget incumbent→candidate,
  evalCounters minus own slot, evaluate nPairs:1, clampReps(undefined, local nReps.initial). sandboxBase=<configDir>/bench-sandboxes/<invId> with
  invId=graft-<compactUtc>-<sha8> so todo-12 evidence export walks graft transcripts. applyBundleTree = byte-truth: rm tracked-not-in-tree (git ls-tree -r -z
  HEAD) + write every member (safeJoin belts readTar's refusal); porcelain-clean tree ⇒ no seal attempt (sealGeneration blocks on empty) ⇒ graft commit =
  incumbent HEAD sha, bench still runs (no-op graft culled by minEffect — honest verdict beats a fabricated refusal).
- Adversarial round: prompt_injection — echo()/flat() everywhere (ANSI/newline hostile rationale+matrix strings never reach stdout/stderr/status; ledger text
  JSON-escaped, pinned by raw-ESC-byte scan); malformed — junk/stripped-manifest/evil-traversal-tar/--force/missing-flag all exit 2 single-line, zero rows,
  zero queue dir; hung_commands — covered by proxy (adapter runChild 30s-timeout group-kill machinery unchanged, graft spawns bench through it only);
  cancellation_resume — NOT-APPLICABLE by design: graft is single-shot, durable state = queue file + graft_import row; 'resume' = re-run (pinned header
  comment in graft.ts; the dup/pending rules make re-runs safe).
- Tests: src/test/graft.test.ts 12 tests (real dual-instance toy evolve+export+CLI graft; tamper surgeries incl. honest-files[]-stale-digest repack and
  hand-built traversal tar header). Suite 213 → 225/225 ×2 green, no flakes. Evidence .omo/evidence/abathur/task-13-{failure,happy}.txt (driver:
  node /tmp/opencode/task13-evidence.mjs — full export→graft→status→promote chain + quarantine + pending-queue transcripts).

---

## Todo 11 — self-evolution: abathur-self genome + friction digest (2026-09-09)
- New API surface:
  - src/core/evolve/friction.ts: FRICTION_KIND="friction_digest" record rides the EXISTING lock-guarded
    <configDir>/friction.jsonl (appendFriction/readFriction, todo 2 — reused, no reinvention). One record per
    run: cause "run-summary" (evolve emits ONE summary via the new optional RunLoopOptions.friction sink — absent
    sink ⇒ byte-identical old behavior, all 225 baseline tests untouched) | "cli-error" (runRun wraps runEvolution,
    appends a zero-counts summary with the sanitized ExitSignal message) | "self-eval". frictionDigestSchema data:
    {genomeFp(16hex), cause, exit 0|1|2, complete, counts{7}, rejections{total,byStage(5 stages)}, stall{budgetTruncated,
    orphanGroups}, train[]{unitId,n,mean,failures≤4}, val{count,aliases val-N,samples}, reasons≤10}. scrub() is the
    only string path ([^ -~]→space + ≤200 + "..."); ledger envelope stays {v:1,ts,kind,genId?,runId?,data}.
  - VAL SCRUBBING IS STRUCTURAL: buildRunFriction never receives a val unit's real id/path/score-text — callers pass
    {unitId,split,scores,failures} rows and the builder maps val→count+positional val-N aliases+samples, dropping all
    text. A val scenario string cannot reach the queue even if a mutator lies (AC-2 canary test: id/path/failures
    renamed val-CANARY-9f3a BEFORE register+commit ⇒ never in file).
  - src/core/evolve/self-overlay.ts (244): treePaths/planOverlay(candidateFiles,spec)→{overlay,dropped[{path,reason
    sealed|trusted-tests}]} — candidate src/** minus kernel.immutableGlob matches minus src/test/** (trusted-test rule,
    AC-4); cloneSnapshot (cpSync w/ .git + node_modules filter + thaw + node_modules symlink to HARNESS_ROOT);
    runBuild = the repo's own 2-step recipe tsc -p tsconfig.json + node scripts/copy-assets.mjs, both under one
    buildTimeoutS cap, HARNESS-PINNED compiler via symlink (never npm, never candidate scripts); runSuite (node --test
    with env NODE_TEST_CONTEXT:undefined STRIPPED — see gotcha), runReplay, parseTapSummary (# tests|pass|fail last
    wins), readExpectedDigest(<snapshot>/selfbench/expected.json).
  - src/core/evolve/self-snapshot.ts (217): selfBench(req) = snapshotCommit(incumbent)+snapshotCommit(candidate) →
    clone base → overlay candidate src → build → per rep: node --test suite (score pass/tests, runId s-<sha12>-i) +
    golden replay (digest==trusted expected ⇒ 1/0) → BenchTargetOutcome-shaped units/spent/complete/failures +
    overlaid/dropped/buildStatus/suiteRuns/replayDigest/replayExpected; selfGuardVerdict maps overlay-empty nomination
    ->indeterminate and build-timeout ->inconclusive. DEFAULT caps: build 180s, suite 900s, replay 120s.
  - src/core/evolve/run-friction.ts: startRunFriction(sink) collector (noteUnits/noteBench/noteSession/
    noteCandidate/emit) — run-loop stays orchestrator-only; run-loop.ts 243→281 pure LOC.
  - src/commands/self-eval.ts + cli.ts slot: `self-eval [--genome abathur-self] [--gen G]... [--reps N]`. Reports to
    stdout (incl. dropped-reason lines + full digests); NEVER Ledger.open (raw ledgerPath read, exit 2 on any bad
    line); NEVER writes ledger rows; auditKernel BEFORE anything (reuse); appends ONE self-eval friction record.
    NO-PROMOTE-AUTHORITY is structural + tested: friction.test.ts scans all five new files for promote.js /
    promoteGeneration / fastForwardIncumbent / new Function / eval( / child_process.exec( / import( — zero hits.
  - spec.ts: isEnvRepoLiteral + effectiveRepoPath(repoPath, env) — `${VAR}` literal repoPath is machine-INDEPENDENT:
    fingerprint16/registry stem/kernels/locks/invId/genId/friction all use the RAW literal; ONLY filesystem-touching
    seams resolve (openGenome/snapshotCommit/newGeneration/sealGeneration, auditKernel manifest repo, run-loop+
    self-eval+kernel command, Ledger+ChildTracker+reap live at genomeRepo). Missing/empty env ⇒ exit 2 naming the var
    BEFORE any mkdir/spawn; a never-expanded literal also lands as the genome label in errors, never a stray dir.
  - genomes/abathur-self.jsonc seed: bench.type toy mechanics REINTERPRETED for self-bench — runCommand/graderCommand
    are declarative no-ops (selfBench never builds a ToyBenchAdapter), unitId carries the metric name (suite=train
    pass-rate, golden-replay=val digest match); stats {halfWidth .05, minEffect 0 (candidate src ride sealed CI ⇒
    cull-on-any-regression), nReps 2..4}; immutableGlobs = the plan's list VERBATIM (no additions — see gotcha). docs/immutable-kernel.md is the todo-15 seed; selfbench/{replay.mjs,expected.json} = TRUSTED fixture
    (digest 24c50864e61205a06fca6fb1f4db5be10d113e78a204e012cd4f3fff745ddd1d, captured real-repo ×2 identical).
- Gotchas (each cost a red test or a re-run):
  - planOverlay MUST diff candidate-vs-base: copying EVERY non-immutable candidate src file re-deploys UNCHANGED
    sealed-adjacent files (src/bench/toy.ts is sealed so the copy keeps the incumbent's toy.js — dist/test/*.test.js
    importing ../bench/toy.js then hit tsc TS2307 against the symlinked real node_modules/@types). Diff overlay keeps
    dist self-consistent. AC-4's candidate (deletes a test + edits units/add.mjs) also exercises the "some dropped,
    some overlaid" path the old copy-all silently broke.
  - node --test NESTED inside node --test: the child inherits NODE_TEST_CONTEXT and the inner runner prints NO '# pass'
    summary (silent score loss). Adapter runChild env now accepts an explicit undefined to DELETE a key (spawn omits
    undefined); runSuite passes NODE_TEST_CONTEXT:undefined. Standalone hung-suite probes look fine until you run them
    under the outer runner — always test hangs through node --test too.
  - Node 22 detects unsettled top-level await and exits (test "hang" must use setInterval to keep the loop alive);
    runBuild must be TWO steps (tsc + copy-assets) or the overlay's dist/core/evolve/stub-mutators.mjs is missing and
    trusted tests import-fail (tsc does NOT copy .mjs sources).
  - runEvolution's friction sink takes a RunFrictionInput (not a raw record) so run-loop never imports zod; runLoop
    counts timeouts from unit failure strings — the same ": run timeout"/": run infra_failed" markers buildRunFriction
    matches. self-eval reports replay observed + expected IN FULL (plan requires the two be equal — truncating both
    made a red assert indistinguishable; full hex on stdout is safe, replay digest is not val content).
  - the allowlist data flow is candidate-proof BY PROVENANCE, not by sealing extras: planOverlay (self-overlay.ts:67)
    and validateCandidate (reflect.ts:176) both consume spec.kernel.immutableGlobs from the REGISTRY entry spec
    (operator-registered, genomes/** sealed), never from the candidate tree's own genome.jsonc copy — a candidate that
    rewrote or emptied its tree copy changes nothing. And the apply-stage check runs in the LIVE binary (import-time
    graph only; selfBench never runtime-loads candidate code — it spawns build/test/replay against bytes), so v1
    self-eval needs no glob beyond the plan's list.
  - makeSelfHarness (src/test/fixtures-self.ts) = trimmed tmp copy of the harness (real src/** + package/tsconfig/
    scripts/genomes/**/selfbench/replay.mjs + 4 trusted tests + symlink node_modules + git init): every run_REPO in
    tests is a tmp COPY, never the real repo; a candidate can drop the 200-test real suite but cannot drop the 4
    trusted tests (drop==no-op) so suite score 1.0 requires genuine green.
  - Test helper traps: captureReplayDigest runs tsc+replay.mjs (no copy-assets → replay.mjs imports
    ../src/core/evolve/stub-mutators.mjs source directly); fixture self-mutators.test.ts imports
    ../core/evolve/stub-mutators.mjs (dist path, copy-assets builds it); writeFileSync {mode:755} decimal = mode 0o755
    but node ESM reads via symlink target perms in tmp dirs — use {mode:0o755} (a --wxrw---t storm.mjs cost a re-run);
    ledgerCount filters '"generation_complete"' or candidate_rejected rows inflate it.
- ACs pinned by tests: AC-1 storm ≥1 friction_digest (friction.test.ts:5 + run-loop exit 1); AC-2 canary never in
  queue (friction.test.ts:6 + self-snapshot.test.ts run-summary has no candidate rationale); AC-3 sealed-core double
  proof = stats-tamper rejected at path stage (overlay drops sealed) AND tampered snapshot fails auditKernel at
  self-eval/run start exit 1 (self-snapshot.test.ts:4,5 +:96); AC-4 trusted-test delete ⇒ zero score effect
  (scores == incumbent); AC-5 replay digest identical across two invocations (+ full-suite x2).
- Machine-independence proof (friction.test.ts:7): same seed registered under two ABATHUR_SELF_REPO dirs ⇒ identical
  <fp>.jsonc stem + byte-equal registry text; unset env ⇒ exit 2 naming ABATHUR_SELF_REPO, never a literal `
  ${ABATHUR_SELF_REPO}` directory.
- adversarial round: prompt_injection (AC-2 structural + scrub everywhere + CLI error funnel stack-free, ABATHUR_DEBUG
  only); malformed_input (junk genome.jsonc seed fails loadGenomeSpecFile exit 2; mid-file corrupt queue line ⇒
  readFrictionDigests {error} fail-closed, truncated tail repaired byte-verbatim; corrupt expected.json ⇒ exit 2);
  stale_state (self-eval twice ⇒ byte-identical reports + same digests, tested; no candidate-tree reuse); dirty_worktree
  (self-bench reads snapshotCommit(HEAD) only — a dirty real repo never enters scoring; run-loop dirty refusal is
  todo 3's openGenome); misleading_success_output (report shows WHY: dropped-reason lines, guard note, gate failures,
  build note; friction rejections.total == 3 == the rejected lines); hung_commands (3 hard caps + killGroup + guard
  downgrade; a tsc-hang ⇒ SELF_BUILD_TIMEOUT ⇒ inconclusive); flaky_tests (suite x2 green, 245 pass / 0 fail);
  cancellation_resume — NOT-APPLICABLE by design: self-eval is single-shot (like graft), durable state = the friction
  queue + existing ledger rows; a killed selfBench leaves only a frozen xdg-cache snapshot (thaw-safe) and re-run is
  the resume.
- Tests: src/test/friction.test.ts 9 + src/test/self-snapshot.test.ts 10 (real tmp-harness snapshots + CLI spawns);
  baseline 225 → 245/245 ×2 green, no flakes (todo-14 historian files excluded via scoped tsconfig.solo.json during
  overlap; final full-suite number pending their quiet tree). Evidence .omo/evidence/abathur/task-11-{failure,happy}.txt
  (driver: node /tmp/opencode/task11-evidence.mjs — toy storm → friction queue + canary absence; seed registration;
  proof1 stats-tamper rejected(path)+annotate-out nominated through overlay; proof2 kernel-drift refusal run+audit exit
  1 → restore → exit 0; proof3 handSealed test-deleter ⇒ dropped(trusted-tests) overlay-0 verdict indeterminate;
  self-eval ×2 byte-identical; ledger untouched).

## Todo 14 — historian genome instance + script-first grader + the LIVE campaign (2026-09-10)
- Config+grader todo as planned: NO protocol changes. Additive-only src: probeRequiresOnly in
  src/bench/fixture-probe.ts (names FULL argv on failure) + run-loop.ts dry-run branch + run-plan.ts
  'requires probes: N/N OK' line — so `run --dry-run` proves requires[] without spawning engines
  (todo-11 overlap: they touched the same files elsewhere; my hunks committed cleanly in 4c12e06).
- Core resolves NO ${ENV} in genomes (loadGenomeSpecFile is plain parse+strict) → example keeps
  ${ABATHUR_HISTORIAN_REPO}/${ABATHUR_REPO}/${ABATHUR_WIKI_BASE}/${ABATHUR_WIKI_OPS}; QA materializes
  via /tmp/opencode/task14-materialize.mjs (also emits canonical copy → ABATHUR_GENOME_CANONICAL that
  mutate.sh seals as genome.jsonc inside each candidate tree — the bundle's contained spec).
- Grader lives fully in graders/historian/{grader.mjs,grader-core.mjs,grader-support.mjs(+d.mts)} —
  script-first A-H dims, G hard gate, 05=(G+H+J)/3 renorm; judgeCommand stays UNWIRED (adapter never
  executes it), subjective A-D use documented mechanical proxies. dist/test → ../../graders import
  pattern works in dev AND shipped layout (d.mts only, no TS6059).
- Fixture ordering that bit: reset hook runs BEFORE mirrorSandboxHome WIPES .sandbox-home — anything
  hooks need (wiki key at $HOME/.wikijs-api-key) must be (re)installed by the hook itself every time;
  seed-wrapped.sh/run-scenario.sh both call ensure-key first. HOOK_TIMEOUT_S=60 fixed — measured
  reset ~5-20s (id-list deletes + cache-refresh), seed 15.4s: fits.
- resetCommand = list-driven (GraphQL pages.list → delete every _sandbox/* row by id --confirm →
  cache-refresh): self-healing vs unknown agent paths, closes Metis #3. Proof: 27 wiki-pre.json digests
  across 3 generations ALL byte-equal (e82cb18d2881ce82, 263 rows; gen3 normalized digest 23b9965ef257e0
  ×9). Historian repo porcelain byte-identical before/after the whole campaign ('.state/' lives in
  .git/info/exclude — local metadata, worktree untouched).
- Bundle masking is fail-closed and LIVE transcripts prove why: real agent sessions echo /opt/wiki-ops,
  /tmp, /mnt/nextcloud-data, /etc/os-release into tool outputs → export REFUSED gen1/gen2 bundles
  (correct refusal, saved as 11-*-env/enospc + reasoning in example comment). Fix = generic Unix roots
  as bundle.maskLiterals (no /home/ literal allowed in repo config — my own grep-gate test caught my
  comment mentioning it; wording fix 4c12e06). gen3 candidate (extended contained spec) exports+inspects
  clean: 131 members, 0 val members, 0 surviving machine roots. Contained spec is immutable per gen →
  old gens stay unexportable by design; that's the gate working, document before blaming machinery.
- tmpfs INODE cap is a real bench constraint: /tmp = 1,048,576 inodes; per-unit mirrored sandbox
  (.opencode/node_modules) accumulates ~27 sandboxes ≈ cap → ENOSPC mid-bench (exit 2, honest, no
  candidate row burned — resume counters only advance on generation_complete rows; gen re-benched after
  moving configDir to disk-backed /home/lab/tmp/abathur-task14/home3).
- Run-loop behaviors re-verified under fire: SIGKILL'd holder → next run appends lock_takeover and
  proceeds; spent-candidate clamp message 'candidate cap N already spent' (exit 1 resume-noop) when
  --max-candidates < ledger counters; campaign budget maxCandidates=3 documented in example (2 reset-
  equivalence gens + 1 bundle-AC gen). Live mutator = opencode headless (real diffs: new note file +
  genome.jsonc seal); RUN_EXIT=1 with per-unit 'gate: n=1 … indeterminate' = the EXPECTED n=1 outcome.
- Live totals: 3 real generations (gen1 2h58m incl 3 honest failure attempts for env/sed/GraphQL-400
  bugs — preserved as evidence; gen2 1h50m; gen3 1h12m). Candidate g-20260910T041039Z-6abd059b
  commit 235ddcea: 5 wins 4 ties vs incumbent, gain +0.1786, indeterminate, NOT promoted (plan).
  agentModel bailian-token-plan/qwen3.8-flash all sessions.

## §Todo15 — bilingual docs, federation reference, packaging portability proof (2026-09-10)

Gotchas found while making the shipped package the thing the README tells people to run:

1. **npm -g installs the bin as a SYMLINK** (`prefix/bin/abathur -> lib/node_modules/abathur/dist/cli.js`).
   The `invokedDirectly` guard in `src/cli.ts` compared the RAW `process.argv[1]` against
   `import.meta.url`, so every global install silently no-op'd — `abathur` printed nothing, exit 0.
   Unit tests never caught it (they spawn `dist/cli.js` by real path). Fix: `realpathSync(resolve(argv[1]))`
   in a try/catch. Lesson: any "am I the entrypoint?" guard must canonicalize BOTH sides; the tmp-HOME
   install proof is the only test that exercises this seam.
2. **Bench snapshots are intentionally read-only**; tearing down a scratch harness state dir needs
   `chmod -R u+w <xdg-cache>/abathur/worktrees` before `rm -rf`, or the teardown pollutes evidence
   transcripts with Permission-denied noise (results stay valid — snapshot reuse is content-keyed).
3. **`genomes/` and `selfbench/` are deliberately NOT in package.json `files`** (`files=["dist","config","graders","docs"]`):
   the toy quick-start materializes from `dist/genomes/toy-smoke` (copied by `scripts/copy-assets.mjs`,
   resolves from both repo `dist/test/**` and shipped `dist/**` — the same ../../-relative trick as graders),
   and `abathur-self` cannot run from a tarball anyway (self-bench needs the git checkout: `.git`, node_modules,
   graders/** seal coverage). So the README registers abathur-self from `$ABATHUR_SELF_REPO` (checkout), never
   from the package. Proof: `npm pack --dry-run` = 112 files, contains dist/cli.js + stub-mutators.mjs +
   dist/genomes/toy-smoke/** + graders/historian/** + docs/**.
4. **Graft demo ordering**: demo graft BEFORE promote on the toy budget (maxCandidates=4); after the
   budget is exhausted the local re-bench honestly reports `inconclusive: budget exhausted` (exit 2,
   peer claim never trusted — good failure mode, bad happy-path screenshot).
5. **Deterministic export re-proved at packaging level**: same genome twice → identical tarball sha256
   (772fedfc1eb3…), which is exactly the sha graft uses as `graftGenId` seed. Byte-equality is load-bearing
   across commands, not just tests.
6. **README parity is mechanical, not aspirational**: checker = heading count + level-shape equality
   between `## English` and `## 中文` blocks (11/11, h3 10/10); planted a zh-only heading, checker flipped
   red (11/12) — evidence in task-15-failure.txt. zh translations of `--flags` and file paths must stay
   byte-identical to EN (translated only in surrounding prose) or the docs stop being copy-pasteable.
7. Promote prints a cosmetic relative path (`manifest: rewrote ../home/.config/...`) when HOME is
   relocated — pre-existing display quirk, zero behavior effect, left alone (docs-only task).

## §F1-fix — CI gate for the D7 literal ban + `--include-val` operator seam (2026-09-10)

1. **Grep gates must run as tests, not README rituals.** `src/test/d7-gate.test.ts`
   walks `src/**/*.ts` (own recursive `readdirSync(withFileTypes)`, symlinks skipped —
   a symlink could smuggle an offending file out of the tree), skips the plan's
   `src/test/**` carve-out, and fails naming EVERY `file:line [label] content`.
   Two pins make it trustworthy: resolve the tree via
   `fileURLToPath(new URL("../../src", import.meta.url))` (the promote/bundle pattern —
   immune to cwd because `node --test` runs from `dist/test/`), and a `scanned > 20`
   anti-vacuity assert so a broken path resolution can never pass silently.
   Proven by planting `src/zz-plant-probe.ts` (RED names it), deleting it, re-GREEN —
   never built into dist, never staged.
2. **Where `--include-val` threads**: `run.ts` parse (`RunFlags.includeVal`, spread
   `...(flags.includeVal ? { includeVal: true } : {})`) → `RunLoopOptions.includeVal`
   → guard in `runEvolution` right after caps (BEFORE kernel audit/dry-run, so a toy
   genome exits 2 without touching state — and `--dry-run` cannot smuggle it past the
   guard) → BOTH `benchTarget` call sites → `OpenAdapterOptions.includeVal` →
   `run-bench.ts` fixture factory. The factory's hardcoded `includeVal: true` was the
   real leak: plan line 118 says val runs ONLY under the operator flag, so the
   evolution loop's mutator-facing manifest now hides val paths by default (AC(B)
   adapter-level hiding was already pinned; the loop just wasn't honoring it).
3. **Guard on `bench.type !== "opencode-fixture-scenarios"`, not `=== "toy"`** — the
   fail-closed polarity means any future bench type rejects the flag by default
   instead of silently ignoring it. Message quotes the actual type.
4. **Type-level RED is valid RED in a tsc-gated repo**: the new tests failed
   `TS2339 Property 'includeVal' does not exist` before implementation — the compiler
   refuses the feature's absence as loudly as a runtime assert. Capture it in the
   evidence transcript anyway.

## 2026-09-10 — F1-fix2: loop BENCHING authority ≠ operator EXPOSURE (regression 3c6bbf9 → fix)
1. **One boolean, two consumers = a conflation waiting to crash.** The val gate
   serves two different consumers of the same bench: the SELECTION GATE needs val
   REPLICATES (nomination is val-regression-gated, plan 125-132), the MUTATOR-facing
   surface needs val PATHS hidden (plan 117-124). 3c6bbf9 wired `--include-val`
   straight into the bench seam and the default `run` died ExitSignal(2) at the
   first val unit — mid-bench, before any generation row. When wiring an operator
   flag onto a seam that an internal loop also crosses, ask FIRST: does the loop's
   correctness depend on this seam, independent of the operator's preference?
2. **The fix shape: split the axes.** `loopValAuthority` (internal, constant-true
   at the loop's benchTarget driver; allows run/score) vs `includeVal` (operator
   flag; controls manifest id/path EXPOSURE only). Neither implies the other:
   authority-without-exposure = val benched but opaque (the default run);
   exposure implies authority (flag-on consumers see paths AND can run).
3. **Why not the tempting `includeVal ?? true`:** because exposure rides the SAME
   option at the adapter, a loop-side default-true would leak val paths into every
   sandbox manifest unconditionally (todo-6 violation its own tests pin) and turn
   the CLI flag into a no-op. If two meanings share one variable, one consumer is
   always going to be lied to — separate the variables, not the defaults.
4. **Loop-level tests are a distinct rung from adapter/CLI tests.** The 285-green
   suite had adapter-level val pins and CLI parse/exit-2 pins, but nothing benched
   a val-bearing genome THROUGH runEvolution — the exact seam the regression broke
   (dry-run tests never reach the bench). Any time a flag reaches from CLI to
   adapter, at least one test must cross the full loop with the flag OFF.
5. **RED capture against the bad HEAD is cheap and decisive**: 3 lines of TAP + the
   gateVal→benchTarget→runEvolution stack prove the crash path and pin the fix
   (fixture-loop.test.ts tests 1+3); the flag-ON test passing pre-fix correctly
   localizes the bug to the default path. D7's vendor-literal gate also caught the
   fix's own comment — run the FULL suite after comment edits, not just targeted ones.

## F2 review close-out: pure-LOC ceiling scope + cleanupStale stance (2026-09-10)

The 250 pure-LOC ceiling governs **production modules** (src/** minus src/test/**);
integration tests are exempt and legitimately exceed it (graft.test.ts, bundle.test.ts)
because one narrative scenario per test file cannot be split without losing the
end-to-end pin — this is the reviewed scope, not a gap. The two production modules
above the ceiling, src/core/evolve/run-loop.ts (283) and src/bench/fixture.ts (253),
carry accepted do-not-grow exception headers (F1-fix2 mandated minimal seams: loop-local
construction and the in-fixture LOOP_VAL_AUTHORITY seam) and split at the next real
feature. Relatedly, cleanupStale (src/core/worktree.ts:238) is a known-unused **with
tests**, not dead code: v1 deliberately never prunes worktrees/bench dirs under a
possibly-running bench (F2 A1 keeps that assertion honest via the per-genome cache dir
instead), and a prune command is post-v1 work.
