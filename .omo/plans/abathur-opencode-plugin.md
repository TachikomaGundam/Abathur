# abathur-opencode-plugin

Goal: `npm i -g @tachikomagundam/abathur && abathur opencode install` → inside opencode the agent can call the `abathur` tool and the user can type `/abathur <cmd>`. Ship as 0.2.0 via the proven CI+OIDC+provenance pipeline.

Design (settled by research, sources: opencode v1.18.30 tag source at /tmp/opencode-src + abathur seam map):
- Shipped assets: top-level `plugin/abathur.ts` (V1 format: default export `{ id, server }`, registers `tool: { abathur: tool({...}) }` wrapping the CLI via argv-only spawn of the global `abathur` bin, allowlist of top-level commands, output caps, no shell) + `plugin/abathur-command.md` (slash command template). Package via `files: [..., "plugin"]` (graders/ precedent; tsc never touches it).
- `abathur opencode install|status|uninstall` new CommandSpec (cli.ts: two lines). install = byte-copy of packaged assets into `~/.config/opencode/plugins/abathur.ts` and `~/.config/opencode/commands/abathur.md`; idempotent via sha256; foreign non-abathur file at target → refuse (marker-header identifies ours; no --force discipline); prints restart note + bench-mirror landmine warning (fixture-support.ts:114-135 copies real ~/.config/opencode into bench sandboxes → plugin activates inside historian benches). HOME/paths env-derived only (D7 gate src/test/d7-gate.test.ts bans machine literals).
- Tests: src/test/opencode.test.ts per genome.test.ts:34,108-114 convention (spawn dist/cli.js, sandboxed HOME).
- Docs: README en+zh "Inside opencode" section + CHANGELOG + version 0.2.0.

## TODOs

- [x] 1. Implement feature (one deep worker): `plugin/abathur.ts` + `plugin/abathur-command.md` + `src/commands/opencode.ts` (install|status|uninstall) + cli.ts registration + package.json files bump + `src/test/opencode.test.ts` + README en/zh section + CHANGELOG + version 0.2.0; `npm run build && npm test` fully green; single commit on main.
- [x] 2. Release: sync sanitized tree to `public` branch (isolated worktree, TachikomaGundam committer identity), clean build+test on public, push `public:main`, wait CI, tag `v0.2.0`, push tag → publish.yml OIDC run success; registry verified (version doc 200 + abbreviated attestations non-empty + tarball HEAD 200).
- [x] 3. Hands-on acceptance on this machine: global upgrade to 0.2.0 (exact version), `abathur opencode install`, restart opencode, prove plugin loads (log evidence) + `abathur` tool listed + one real agent tool-call returns abathur output; then `abathur opencode status`.
- [ ] 4. Wiki en+zh card flip (adapter exists; "not a plugin" line → "core spawns opencode; now ships official plugin adapter"; install/uninstall commands + bench-mirror landmine documented) + ledger entries + historian map refresh.

## Final Verification Wave

- [ ] F1. Oracle adversarial review of the feature diff (security: argv-only / allowlist / path-derivation / idempotency / refusal UX; correctness; docs honesty).
- [ ] F2. Orchestrator personally re-runs: full test suite, `npm pack --dry-run` shows plugin/ ships and no .omo, complete task-3 cycle.
