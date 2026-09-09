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
