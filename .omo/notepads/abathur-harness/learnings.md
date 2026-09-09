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
  anywhere (grep-proofed). Commit identity forced via -c abathur@harness.local (global gitconfig immune).
- `-m${message}` single argv element (dash-leading messages can't be option-injected); segment
  validators reject leading '-'/slash/'..' before ANY git spawn (exit 2 cannotAnswer).
- `git init` rejects `-c` AFTER subcommand; execFile-without-input closes child stdin, so a
  hang-fixture must `exec sleep`, not `exec cat`.
- Repo-wide builds are frequently red from PARALLEL todos' WIP (was: genome/glob/kernel). If npm test
  fails outside your files, re-run solo (tsconfig.solo pattern) and retry npm test before commit.
