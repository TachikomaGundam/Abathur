# Learnings — abathur-opencode-plugin

## 2026-09-11 — task 1 implementation (plugin adapter, 0.2.0)

### opencode V1 plugin format (verified against v1.18.30 source at /tmp/opencode-src)

- `readV1Plugin` (packages/opencode/src/plugin/shared.ts:272-304): default export must be an
  **object** with a `server` that is a **function** (`typeof server !== "function"` → throw).
  `server(input, options)` resolves to `Hooks`. Legacy fallback: named function exports also load,
  but V1 `{id, server}` is the supported shape.
- **File/path plugins MUST export `id`** — `resolvePluginId` (shared.ts:306-323) throws
  `Path plugin ${spec} must export id` for source==="file" without it. Directory-scanned
  `~/.config/opencode/plugins/*.ts` counts as file source.
- `Hooks.tool?: { [key: string]: ToolDefinition }` (packages/plugin/src/index.ts:226-228).
  Registry consumes it verbatim: `for (const [id, def] of Object.entries(p.tool ?? {}))
  custom.push(fromPlugin(id, def))` (packages/opencode/src/tool/registry.ts:201-202) — the record
  KEY is the tool name shown to the model.
- `tool()` helper (packages/plugin/src/tool.ts): `{description, args: <zod RAW shape object>,
  execute(args, ctx): Promise<ToolResult>}`; `ToolResult = string | {output, title?, metadata?,
  attachments?}`. `tool.schema` is the zod namespace — **use `tool.schema.*` instead of
  `import { z } from "zod"`** so the shipped file needs no zod resolution of its own.
- Plugin directory scan: `Glob.scan("{plugin,plugins}/*.{ts,js}")` one level only
  (packages/opencode/src/config/plugin.ts:21); commands: `{command,commands}/**/*.md` recursive
  (packages/opencode/src/config/command.ts:15). No plugin hook exists for slash commands — hence
  the byte-copy install design for both files.
- Live config-dir types ship from `@opencode-ai/plugin` **1.17.4** while the binary is 1.18.30 —
  package and CLI versions are decoupled; the .d.ts shape matched source exactly.
- Typecheck recipe for an uncompiled shipped plugin (no local dep added): scratch dir with
  symlinks `node_modules/@opencode-ai/plugin` + `node_modules/zod` →
  ~/.config/opencode/node_modules/..., `@types/node` → repo's, then repo tsc with
  strict+exactOptionalPropertyTypes+noUncheckedIndexedAccess. Passed clean.

### Commands md frontmatter gotcha

- Command metadata decodes `ConfigCommandV1.Info` = `{template(required, = md body), description?,
  agent?, model?, variant?, subtask?}` (packages/core/src/v1/config/command.ts). Frontmatter is
  parsed by gray-matter, which only recognizes `---` blocks at **byte 0**. Our first-line marker
  `<!-- abathur-opencode-command -->` therefore precludes YAML frontmatter — the whole file
  becomes the template body (valid: only `template` is required; description just stays empty in
  the palette). `$ARGUMENTS` is substituted in the body (session/prompt.ts:1390-1391).

### Node child_process error-shape gotcha

- On a non-zero exit, **`err.code` is the numeric exit code** (not the ErrnoException string), so
  `NodeJS.ErrnoException`'s `code?: string` typing is actively wrong for this branch; used a local
  structural `SpawnError` interface instead. maxBuffer exceeded: node kills the child and the
  callback still receives the partial stdout/stderr strings → report truncation as a note, never
  a throw. Spawn funnel: ENOENT→127 / MAXBUFFER→-1 / timeout-kill→124 / numeric code→CLI verdict.

### Machine / toolchain quirks

- This box's Node v22.22.1 is compiled **without TypeScript support**: both
  `import "./x.ts"` (ERR_UNKNOWN_FILE_EXTENSION) and `--experimental-strip-types`
  (ERR_NO_TYPESCRIPT) fail. Runtime proof of the shipped plugin instead: tsc-transpile to .mjs in
  a scratch dir with a stub `@opencode-ai/plugin` (`tool` identity fn + Proxy-chainable
  `tool.schema`), then real ESM import — asserted V1 shape, allowlist refusal (string, not throw),
  argv spawn via ABATHUR_BIN=/bin/echo, ENOENT→exit 127 note. All green (PLUGIN_LOAD_SMOKE_OK).
- `loadConfig` is fail-closed on comment-only config.jsonc (`// smoke` → empty doc → exit 2). Use
  `{}` for smoke-test configs.
- Notepad guard blocks Write even when the file does not exist — create new notepad pages via
  shell append (>>), which preserves the append-only contract.

### Design decisions pinned by tests

- install/uninstall are **two-pass** (validate every target for foreign-ness before writing to
  any), so a refusal never leaves a half-installed pair; test asserts the untouched sibling.
- Marker identity = first-line prefix (`// abathur-opencode-plugin v` /
  `<!-- abathur-opencode-command -->`). Overwrite allowed iff marker present; byte-equality →
  "up to date". No --force anywhere.
- status always exits 0 (read-only view); states: up-to-date / outdated / foreign / absent, with
  installed= and packaged= full sha256 per line.
- D7 literal ban extended voluntarily to `plugin/` — enforced by an explicit test
  (`shipped plugin assets carry zero machine literals`), plus a marker-version↔package.json parity
  pin (0.2.0 hardcoded in both files per plan; bump together).

## 2026-09-11 — task 5 CODE: 0.2.1 F1 remediation

- lstat guard gotcha: cannotAnswer THROWS from inside a try — never call it in the
  try block whose catch swallows errors, or the ExitSignal dies as "absent".
  Pattern: `let shape: ReturnType<typeof lstatSync> | undefined; try { shape = lstat(...) } catch { return }` then check after.
- lstat on a symlink-to-file reports isFile()===false, so `!isFile()` already covers links;
  the `|| isSymbolicLink()` half of the mandated condition is defensive-explicit (kept verbatim).
- Exact-array pin parse: `/const ALLOWED_COMMANDS[^=]*=\s*\[([^\]]*)\]/` captures the array BODY
  only — the two-line doc comment above the literal (mentions promote/tombstone) sits before
  `const` and is never scanned; inner /"([^"]+)"/g extracts quoted entries. Membership loops
  could never catch re-added extras or reordering — this does.
- Scratch plugin-typecheck recipe (learnings 0.2.0) still works but NOW NEEDS --skipLibCheck:
  @opencode-ai/plugin's index.d.ts references HeadersInit (DOM lib) which @types/node 22 no
  longer provides. Own-file errors stay zero.
- Install asset-hoist: readPackagedAsset before requireNoForeign means a missing SECOND asset
  fails with nothing written; the old per-loop read could half-install (asset1 written, asset2
  missing → exit 2 with a partial pair).
- Comment-hook (anti-slop) fires on the product marker line 1 itself — it is the load-bearing
  identity marker, exempt in practice; justify rationale comments inline once.

## 2026-09-11 — task 6 CODE+PROOF: 0.2.2 npm name-route (source-evidence findings)

### Entry selection (v1.18.30 plugin/shared.ts, cited)
- `resolvePackageEntrypoint` (shared.ts:103-115): with an `exports` record, picks
  `exports["./server"]` via `extractExportValue` (plain string, or `{import|default}` subfield);
  if exports lacks `./server` it FALLS BACK TO `main` for kind=server — so a package with
  main=dist/cli.js and no exports would have imported the CLI as a "plugin". Our exports map
  both enables route B and forecloses that footgun.
- Path containment check `resolvePackageFile` (shared.ts:88-96): entry must stay inside pkg dir.
- `loader.ts` pipeline: resolvePluginTarget → createPluginEntry → engines gate ONLY for
  source==="npm" (loader.ts:125-129) → plain `await import(entry)` (Bun transpiles .ts —
  INDEX_FILES includes index.ts, shared.ts:53, so raw TS entries are first-class).
- engines.opencode: DECIDED to omit — `checkPluginCompatibility` (shared.ts:186-199) returns
  early when the field is absent → gate skipped = max compatibility. OMO ships with no engines too.

### Dependency provisioning in the arborist cache (verified, two real mechanisms)
- Npm.add (core/npm.ts): installs into `<cache>/packages/<sanitized-spec>/` via Arborist
  {binLinks, ignoreScripts, save:true, saveType:"prod"}; package deps land as SIBLINGS under
  that node_modules → plugin import of @opencode-ai/plugin resolves by node walk-up.
- Evidence: OMO declares `"@opencode-ai/plugin": "1.15.13"` in dependencies (exact pin, cache
  copy = 1.15.13); historian declares NONE but peerDependencies `>=1.0.0` (arborist auto-installs
  peers → cache got 1.18.29). Task spec chose dependencies `^1.17.4` (OMO mechanism, caret);
  our registry probe's cache ended up with 1.18.30. Also verified config.ts:453-460 installs
  @opencode-ai/plugin@<binary-ver> only into CONFIG dirs (ConfigPaths.directories), NOT npm
  cache dirs — so the declared dependency is genuinely load-bearing for route B.

### Proof recipe (reusable)
- Registration proof WITHOUT auth/LLM: temp HOME + XDG_{CONFIG,CACHE,DATA}_HOME; write
  `<xdg>/opencode/opencode.jsonc` {"plugin":[<spec>]}; `setsid opencode serve --port N` & curl
  `GET /experimental/tool/ids?directory=<empty tmp cwd>` (server/routes/instance/httpapi —
  lists "built-in + dynamically registered"; abathur appears iff plugin loads; control
  {"plugin":[]} removes it). NOTE: `opencode serve --pure` did NOT suppress config plugins in
  our run — don't use it as the control; use plugin:[].
- Execute proof for the cached .ts: tsc --rootDir/--outDir into the cache plugin/ dir (temp homes
  only), import emitted .js from node (bare @opencode-ai/plugin resolves to the arborist copy),
  ctx stub needs {directory, worktree, metadata(){}} — execute returns a plain STRING (ToolResult).
- Node 22.22 here still cannot import .ts; dist/cli.js from tsc lacks the exec bit — chmod for
  ABATHUR_BIN=<file> tests (npm bin shims are executable in real installs, so product unaffected).

### Ops lessons
- NEVER `pkill -f "<pattern>"` where the pattern occurs in your own command line — the shell
  kills itself (happened once) and a broad pattern once killed a foreign project's serve
  (pcb-control 19921). Track spawned PIDs explicitly; kill only those.
- CI ledger-lock flake signature: ENOTEMPTY rmdir `.locks/friction.lock` kills a friction-writer
  child → AC-f expects [0,0]. Pre-existing race between stale-quarantine rename and release
  rmSync in src/core/locks.ts; unrelated to plugin route. 0.2.2 CI: rerun --failed passed.

## 2026-09-11 — task 7 CODE+RELEASE: 0.2.3 config-hook slash command (CORRECTS 0.2.0-0.2.2 misclaim)

### CORRECTION of the 0.2.0 learning "No plugin hook exists for slash commands"
- Half-right: Hooks (packages/plugin/src/index.ts) has NO command hook. But
  `config?: (input: Config) => Promise<void>` (index.ts:225) receives the
  FULLY-MERGED live cfg — file commands ({command,commands}/**/*.md, merged at
  config.ts:473 `result.command = mergeDeep(...)`, remeda mergeDeep = 2nd arg wins)
  are ALREADY inside cfg.command when plugin/index.ts:245-253 ("Notify plugins of
  current config") fires hook.config(cfg) after config.get() resolves
  (InstanceState-memoized SAME object, config.ts:620-621). Mutating cfg.command
  in the hook therefore REGISTERS A SLASH COMMAND. Proven in prod: opencode-acp
  dist/index.js:12492-12495 `opencodeConfig.command ??= {}; command["acp"] = {...}`.

### Precedence / dedup (source-cited, v1.18.30)
- No duplicate entries are possible: Command.init (command/index.ts:63-101) writes
  into ONE Record<string,Info> `commands[name] = {...}`; file-md and cfg.command-key
  funnel through the same record. Skills explicitly guard `if (commands[item.name])
  continue` — name-keyed overwrite is by design.
- Ordering: jsonc "command" keys → file .md (mergeDeep wins) → plugin config hooks last.
  ACP's `=` beats the file; OUR `??=` yields to the file: Route A keeps byte-identical
  0.2.2 behaviour (file md authoritative, empty description, marker line inside template —
  gray-matter quirk) and the injection ONLY fills Route B. Live-verified all three
  (temp HOME + opencode serve + GET /command): ctrl plugin:[] → 0 entries; route-B
  file:tarball → exactly 1, our description, no marker line; route-A sim (plugins/ +
  commands/ copied) → exactly 1, file bytes. GET /command route:
  server/routes/instance/httpapi/groups/instance.ts:51 + handlers/instance.ts:76-77
  (command.list()), ?directory= query routing same as /experimental/tool/ids.
- Template byte-mirror shipped as in-slice string const (no fs read at hook time:
  Route A's md lives in a DIFFERENT dir than the plugin file; Route B must not depend
  on on-disk md either) — test extracts the literal with /const COMMAND_TEMPLATE =
  `((?:[^`\\]|\\.)*)`;/ unescapes \` and deep-equals md minus first line. md = 901
  bytes, body = 867, trailing "there.\n" preserved.

### CI flake vs RACE — (E) orphaned sleep survived the group kill (NOT the AC-f ENOTEMPTY)
- bench-toy(e) runs the SHIPPED toy genome's units/hang.mjs (execSync "sleep 31.7") and
  bench-fixture(E) had a local fake BIN_HANG `exec sleep 31.7`; both assert absence via
  machine-wide `ps -eo args`. node --test parallelizes FILES → concurrent overlap makes
  each file's global scan see the OTHER's live sleep. Repro: run both files' hang tests
  concurrently → 5/5 mutual failure. Our 309th test shifted scheduling and made CI hit it
  deterministically (2/2 runs, same signature; local full-suite timing had masked it).
- FIX (test-only, product untouched): bench-fixture fake → `exec sleep 29.31` (substring-
  disjoint from 31.7 and from git.test's "sleep 30"); after fix 5/5 concurrent rounds clean.
- LESSON: machine-global ps-scans in tests must use UNIQUE per-file markers; "rerun once"
  flake policy only for KNOWN signatures — identical failure twice = investigate, don't gamble.

### Ops
- Probe hygiene: `opencode serve` children under setsid OUTLIVE group-signal by leader PID
  when they re-fork (recorded leader gone, port held by pid+2) — after teardown ALWAYS
  `ss -tlnp` the probe port and kill the exact listener PID(s), then re-verify ports clean.
- Node ESM scratch recipe for importing the shipped plugin directly: the real
  @opencode-ai/plugin dist is ESM-only ("exports" has import condition, no require) —
  tsc-emit a "type":"module" package.json beside BOTH the .ts input and the .js output
  dir (else nodenext emits CJS require() → ERR_PACKAGE_PATH_NOT_EXPORTED).
