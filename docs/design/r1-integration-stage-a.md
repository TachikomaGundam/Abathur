# R1 integration, stage A — spawn inventory gate (v3)

Status: **approved (v3 + must-fix) and implemented.** No runtime behavior
changed. The gate is `kernel/exec/spawn-gate.mjs`; the registry is
`kernel/exec/spawn-policy.json`; the test is `test/spawn-gate.test.mjs`.

## Context

R1 (per-invocation bwrap runner) is approved and has a working prototype in
`kernel/exec/`. It is not wired to production callers. The next risk is the
inventory: Abathur has many direct `child_process` sites, some of which execute
target code.

A blind “route everything through R1” change would break shell-string
contracts, detached long runs, repo access, and network-dependent adapters. The
first step is a mechanical, fail-closed inventory.

## Current inventory (probed 2026-11-05)

The repository has **22** JS/MJS files containing the literal
`child_process`, including the hidden `.opencode/plugins/sandbox-bash.js`.
The only excluded trees are `.git`, `node_modules`, `<state>`, and `.codegraph`.
All other paths, including dot-directories, are walked.

| Class | Count | Files |
|---|---:|---|
| `runner` | 1 | `kernel/exec/runner.mjs` |
| `trusted-controller` | 4 | `kernel/exec/bwrap.mjs`, `scripts/scan-quality.mjs`, `scripts/compare-baseline.mjs`, `.opencode/plugins/sandbox-bash.js` |
| `legacy-target` | 8 | `cli/abathur-v2.mjs`, `exam/runner.mjs`, `exam/spawn.mjs`, `kernel/evidence/anchor.mjs`, `kernel/judge/defects.mjs`, `kernel/planning/review.mjs`, `scripts/release-candidate.mjs`, `scripts/copy-gate.mjs` |
| `test-harness` | 9 | `test/cli.test.mjs`, `test/containment.test.mjs`, `test/copygate.test.mjs`, `test/coupling.test.mjs`, `test/plan-check.test.mjs`, `test/receipts.test.mjs`, `test/release-candidate.test.mjs`, `test/surface-cwd.test.mjs`, `test/surface-record.test.mjs` |
| **total** | **22** | |

`legacy-target` is explicit debt, not a safety claim. The baseline is **8**;
the gate fails if it grows. It may shrink as sites move to the runner.

## Options

### A. Gate-only spawn inventory (recommended)

Add:

- `kernel/exec/spawn-policy.json`: only `entries`; every entry has `path`,
  `class`, `reason`; every `legacy-target` entry also has `nextStage`. The JSON
  carries no baselines and no class pins.
- `kernel/exec/spawn-gate.mjs`:
  - code-level constants are the authority: `LEGACY_TARGET_BASELINE=8`,
    `TEST_HARNESS_BASELINE=9`, `RUNNER_PATH=kernel/exec/runner.mjs`, the five
    `TRUSTED_CONTROLLER_PATHS`, and `TEST_HARNESS_GLOB=test/*.test.mjs`;
  - the registry is validated against those constants before any scan; a
    registry that raises a baseline or reclassifies a pinned path fails
    (`SPAWN-POLICY-INVALID`);
  - walks `.js`, `.mjs`, `.cjs`, and extensionless first-party files, including
    dot-directories; extensionless files are read as text only if they are
    small UTF-8 files (limit 1 MiB), so a Node CJS `require('./x')` target is
    not invisible;
  - excludes only the closed list `.git`, `node_modules`, `<state>`,
    `.codegraph`;
  - detects the literal token `child_process` (the scanner constructs the
    needle from parts, so its own source is not a registry entry);
  - flags an unregistered file (`SPAWN-UNCLASSIFIED`);
  - flags any non-registry export of `spawn`, `spawnSync`, `exec`, `execSync`,
    `execFile`, `execFileSync`, or `fork` (`SPAWN-REEXPORT`);
  - fails if any registry path is missing, duplicated, escapes the repo after
    `realpath`, or resolves through a symlink (`SPAWN-STALE`,
    `SPAWN-DUPLICATE`, `SPAWN-PATH-ESCAPE`);
  - fails on malformed JSON (`SPAWN-POLICY-INVALID`);
  - pins `runner`, `test-harness`, and `trusted-controller` to the code
    constants above;
  - fails if `legacy-target` count > `LEGACY_TARGET_BASELINE` or
    `test-harness` count > `TEST_HARNESS_BASELINE`; the comparison is always
    against the code constants, never against numbers in the JSON;
  - prints class counts and the debt list.
- `test/spawn-gate.test.mjs`:
  - current tree passes with exactly 23 registered paths;
  - a planted file in an unregistered dot-directory fails;
  - a planted bare `child_process` specifier fails;
  - a planted `node:child_process` fails;
  - a planted `import("child_process")` fails;
  - a planted `require("child_process")` fails;
  - a planted `.cjs` file fails;
  - a planted re-export wrapper fails;
  - a missing registry path fails;
  - a duplicate registry path fails;
  - a symlinked registry path fails;
  - malformed policy JSON fails;
  - a `legacy-target` growth fails;
  - a `test-harness` growth fails;
  - a structural class violation fails.

No `runTarget` calls are added in stage A. The gate only makes the blast radius
visible and prevents new literal spawn sites.

### B. Gate plus wire `exam/runner` now

Replace the shell-string seat/judge path with an argv contract and `runTarget`.
This changes `ABATHUR_SEAT_CMD` / `ABATHUR_JUDGE_CMD` from shell strings to
argv arrays (or requires a parser), and exam adapters may need network/model
access. Not recommended before A.

### C. Gate plus wire `release-candidate`

Run `git archive` / `npm pack` through R1. These need repository access,
`.git`, and possibly network; R1's staged input deliberately refuses `.git`.
Not recommended before A.

### D. Pause integration

Keep the R1 library and tests only. Safe, but leaves the production boundary
unchanged.

## Recommendation

**A now.** It is small, reversible, and gives the next stages a real inventory
instead of a guessed one. After A is green, choose B or C with the registry
output in hand.

## Class rules

- `runner`: exactly `kernel/exec/runner.mjs`.
- `trusted-controller`: exactly the five listed files. They invoke bwrap
  probing, git metadata, `node --check`, or the cage launcher; they do not
  accept arbitrary target commands.
- `test-harness`: exactly `test/*.test.mjs`. They spawn the CLI to test it; they
  are not production target execution.
- `legacy-target`: any file that executes operator/target commands and has not
  been moved to the runner. Requires `nextStage`; counted against the baseline.
- Absence from the registry is the `unknown` state and fails closed.

## Walk and matching

- Extensions: `.js`, `.mjs`, `.cjs`. `.ts` is out of scope because this Node
  runtime does not load it.
- Exclusions are a closed path list: `.git`, `node_modules`, `<state>`,
  `.codegraph`.
- Hidden directories are walked. A file under `.probe/` is found unless it is
  one of the four exclusions.
- Matching is literal text: the bytes `child_process`. It catches static
  imports, bare specifiers, `require`, dynamic `import()` with a literal, and
  re-export strings. It cannot see computed or obfuscated specifiers; that is a
  named residual, not a claim.
- The gate itself does not contain the literal; it builds the needle from
  `"child_" + "process"`. Test fixtures are written to a temp directory, so the
  test file also contains no literal and no registry entry is needed for the new
  files.

## Acceptance for A

- `node --test test/spawn-gate.test.mjs` passes.
- A planted bypass file fails with `SPAWN-UNCLASSIFIED`, `SPAWN-REEXPORT`,
  `SPAWN-STALE`, `SPAWN-DUPLICATE`, `SPAWN-PATH-ESCAPE`, or
  `SPAWN-POLICY-INVALID`.
- `npm test`, `node scripts/scan-quality.mjs`, `node scripts/scan-coupling.mjs`,
  `node cli/abathur-v2.mjs gate run`, and `node scripts/plan-check.mjs` stay
  green.
- The registry has exactly the 23 current entries; the walk asserts it
  discovers the same 23.
- `legacy-target` count is 8 and cannot grow; `test-harness` count is 9 and
  cannot grow; both checks compare against the code constants, not JSON fields.
- No production file changes behavior; no new dependency; no `~/.config` write.

## Non-claims

- The gate does not sandbox anything.
- A mapped file can still call `child_process` internally; the registry is a
  file-level inventory, not line-level proof.
- Computed or obfuscated module specifiers (`import(name)`,
  `"child"+"_process"`, unicode escapes, base64-loaded modules) bypass literal
  scanning. This is the same class as the alias residual.
- A wrapper can import a registered helper without a literal `child_process`;
  the re-export check catches the named symbols but not every alias.
- `legacy-target` is not “safe”; it is named debt with a next stage.
- Python `tools/wave_engine` dispatch is out of scope for this Node gate; it
  has its own tests and state machine.
- Excluded trees (`node_modules`, `<state>`, `.codegraph`, `.git`) receive zero
  scan coverage. “Blast radius visible” means first-party, non-excluded paths
  only.
- The gate is a team-accident tripwire, not an adversarial control.

## Questions for the reviewer

1. Is the 23-entry file-level inventory sufficient for stage A, or must the
   gate be line-level from the start?
2. Is the class vocabulary (`runner`, `trusted-controller`, `test-harness`,
   `legacy-target`) sufficient, or should any current file move class?
3. Is the `legacyTargetBaseline=8` plus `testHarnessBaseline=9` ratchet enough
   to stop debt laundering, or is a path-level baseline required?
4. Is the named computed-specifier residual acceptable for stage A?
