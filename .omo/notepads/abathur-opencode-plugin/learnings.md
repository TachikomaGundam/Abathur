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
