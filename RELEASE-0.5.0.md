# Release 0.5.0 — prepared candidate

Prepared: 2026-11-03 (host channel, system clock).
Package: `@tachikomagundam/abathur@0.5.0`.
Status: **prepared, not published**. Publishing and global install are human-key steps.

## Candidate identity

- Tarball: `/tmp/tachikomagundam-abathur-0.5.0.tgz`
- sha256: `5341dbda8f7731c466e2f65db475cc1eb34ba126db2a9ed7d269cc5d7aac100b`
- Files: 37 (code, rules, exam fixtures/judge, config, docs, README)
- `bin`: `abathur -> cli/abathur-v2.mjs` (shebang present)
- Excludes: tests, `.omo`, mapping-analysis internals, git metadata.
- Published baseline at preparation: `0.4.1` (`npm view` rc=0).

## Prechecks (all rc=0, host channel)

| Check | Command | Result |
|---|---|---|
| tests | `npm test` | 79 pass / 0 fail |
| code scan | `node scripts/scan-quality.mjs` | `QUALITY OK files=46 problems=0` |
| coupling | `node scripts/scan-coupling.mjs` | `COUPLING OK files=56` |
| rules | `node cli/abathur-v2.mjs rules validate` | 18 clauses, sha256 `90a7ed6f…` |
| plan | `python3 ../Abathur/loop/plan_check.py …` | `PLAN-CHECK OK n=17` |
| receipts | `node scripts/verify-receipts.mjs …` | `closed=21 pending=0 failed=0` |
| copy gate | `python3 ../Abathur/scripts/copy-similarity.py Abathur Abathur-v2` | `COPY-GATE OK`, top 0.530 |
| baseline | `ABATHUR_BASELINE=<r2> node scripts/compare-baseline.mjs` | `BASELINE OK problems=0` |
| auth | `npm whoami` | `tachikomagundam` |
| package | `npm publish --dry-run --access public` | `+ @tachikomagundam/abathur@0.5.0`, rc=0 |

## Isolated install proof

Installed the tarball into a disposable prefix and ran it from `/tmp`:

```text
npm install -g --prefix /tmp/abathur-install-test /tmp/tachikomagundam-abathur-0.5.0.tgz
added 1 package
/tmp/abathur-install-test/bin/abathur --help          → rc=0
/tmp/abathur-install-test/bin/abathur rules validate  → RULES OK clauses=18 rc=0
/tmp/abathur-install-test/bin/abathur identity check --name abathur --email abathur@local
                                                     → ATTRIBUTED rc=0
```

The prefix was deleted afterwards. This proves module resolution does not depend on
the v2 worktree or on the current directory.

## Human steps (each needs your key; run in a terminal)

```bash
# 1. publish
cd /home/lab/workspace/harness/Abathur-v2
/usr/bin/npm publish --access public

# 2. confirm the registry sees it
/usr/bin/npm view @tachikomagundam/abathur version
# expected: 0.5.0

# 3. global install (production surface)
/usr/bin/npm install -g @tachikomagundam/abathur@0.5.0

# 4. verify the installed binary
/home/lab/.npm-global/bin/abathur --help
/home/lab/.npm-global/bin/abathur rules validate
/home/lab/.npm-global/bin/abathur identity check --name abathur --email abathur@local
```

Rollback if anything is wrong:

```bash
/usr/bin/npm install -g @tachikomagundam/abathur@0.4.1
```

## Why these exact commands

- `npm` resolves to `/usr/bin/npm` (9.2.0); `node` to `/usr/bin/node` (v22.22.1).
- Global prefix is `/home/lab/.npm-global` (`npm config get prefix` rc=0), so the binary
  lands at `/home/lab/.npm-global/bin/abathur`. That path does not exist yet
  (`ls` rc=2), which is expected: production install is pending.
- Do **not** use `npm link`; it would bind production to a mutable worktree.

## Named packaging facts (do not hide)

- `rules/registry.yaml` evidence pointers are absolute `/home/lab/...` paths. They are
  this machine's proof links; on another machine they will not resolve. This is a
  machine-local package for now, not a portable distribution.
- `config/identities.json` is included; without it `identity check` would fail after
  install. The isolated install test above exercises this path.
- No test suite is shipped; `npm test` is a source-tree check, not a package check.
