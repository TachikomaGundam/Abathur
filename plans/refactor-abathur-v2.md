# Refactor Abathur v2 — reconstructed plan

Reconstructed 2026-11-12 by the Abathur seat after the original plan file (kept at
`<state>/plans/refactor-abathur-v2.md`) was lost in the October tree catastrophe.
Canonical location moved into the repo: the seat cage cannot see the state dir, so a
gate path there was unexecutable by any seat (false assurance). The plan-check
guarantee is unchanged; only the path moved. Every todo below maps to a clause entry
that exists today in rules/registry.yaml, and every Acceptance is a command that runs
on this machine now. This file is the reconstruction of the shipped v2 refactor, not
a forward-looking proposal.

## TL;DR (For humans)

Split the old monolith into a small kernel of single-purpose modules, one CLI, an
exam bank with a deterministic drawer, a hash-chained evidence ledger, and a set of
mechanical gates that must be green before any "done" claim. v2 now runs the repo.

## Scope

Single-repo v2 refactor: kernel modules (planning, identity, evidence, judge,
surface, lane, hygiene, recurrence, gate), the exam pipeline, the rules registry as
rule authority, and the gate command that binds them.

### Must NOT have

- No rule text maintained in two places; the registry is the single source.
- No self-approval path: human gate commands only print prescriptions.
- No v1 paths (loop/, src/, dist/) referenced by any v2 module or test.
- No seat executable that installs itself into production surfaces.

## Verification strategy

Each clause carries an executable check with an expected exit code. The full gate is
`node cli/abathur-v2.mjs gate run` plus `npm test`; both must be green before any
completion claim, with timestamps taken from the system clock.

## Execution strategy

Waves ran in dependency order: rule authority first, then kernel modules that the
rules check, then judge and exam layers, then surface enforcement, then hygiene and
recurrence, and finally the CLI gate that binds all checks.

## Todos

- [x] 1. Establish the rules registry as single rule authority
  - Class: P
  - Clause: P-REGISTRY-01
  - Wave: 1
  - Depends: none
  - What to do / Must NOT do: one registry entry per rule with check and exam item or named exemption; must not hand-edit generated text.
  - References: rules/registry.yaml, kernel/planning/registry.mjs
  - Acceptance: node --test test/registry.test.mjs exits rc=0
  - Evidence: test/registry.test.mjs
  - QA: registry validate runs in the gate with clauses=23
  - Commit: v2 history (original hashes lost in tree catastrophe)
- [x] 2. Generate rule text deterministically from the registry
  - Class: P
  - Clause: P-GENERATE-01
  - Wave: 1
  - Depends: 1
  - What to do / Must NOT do: generated RULES.md carries the registry digest; must not be hand-edited.
  - References: kernel/planning/generate.mjs, rules/generated/RULES.md
  - Acceptance: node --test test/generate.test.mjs exits rc=0
  - Evidence: rules/generated/RULES.md
  - QA: digest mismatch fails the test suite
  - Commit: v2 history (original hashes lost in tree catastrophe)
- [x] 3. Split kernel into single-purpose modules behind index interfaces
  - Class: B
  - Clause: B-MODULE-BOUNDARY-01
  - Wave: 1
  - Depends: 1
  - What to do / Must NOT do: modules communicate only through index.mjs; no deep imports, no shared mutable globals.
  - References: kernel/planning, kernel/identity, kernel/evidence, kernel/judge, kernel/surface
  - Acceptance: node --test test/module-boundary.test.mjs exits rc=0
  - Evidence: test/module-boundary.test.mjs
  - QA: boundary scan in npm test
  - Commit: v2 history (original hashes lost in tree catastrophe)
- [x] 4. Commit identity attribution by registered roster match
  - Class: A
  - Clause: A-IDENTITY-01
  - Wave: 2
  - Depends: 3
  - What to do / Must NOT do: attribute only byte-exact name and email matches; everything else UNATTRIBUTED.
  - References: kernel/identity/index.mjs, cli/abathur-v2.mjs identity command
  - Acceptance: node --test test/identity.test.mjs exits rc=0
  - Evidence: test/identity.test.mjs
  - QA: identity check wired into CLI exit codes
  - Commit: v2 history (original hashes lost in tree catastrophe)
- [x] 5. Hash-chained evidence ledger with genesis and chain verify
  - Class: C
  - Clause: C-EVIDENCE-CHAIN-01
  - Wave: 2
  - Depends: 3
  - What to do / Must NOT do: append-only entries with prev-hash chaining; edits break the chain visibly; must not rewrite history.
  - References: kernel/evidence/index.mjs, cli/abathur-v2.mjs evidence verify
  - Acceptance: node --test test/evidence.test.mjs exits rc=0
  - Evidence: test/evidence.test.mjs
  - QA: chain verify exercised by ledger reconstruction on 2026-11-12
  - Commit: v2 history plus appendEntry parent-directory fix 2026-11-12
- [x] 6. Anchor bridge to the external anchor-chain infrastructure
  - Class: C
  - Clause: C-ANCHOR-BRIDGE-01
  - Wave: 2
  - Depends: 5
  - What to do / Must NOT do: mirror ledger head into the workspace anchor chain; must not fake an anchor when infrastructure is absent.
  - References: kernel/evidence/anchor.mjs
  - Acceptance: node --test test/anchor.test.mjs exits rc=0
  - Evidence: test/anchor.test.mjs
  - QA: anchor command in CLI
  - Commit: v2 history (original hashes lost in tree catastrophe)
- [x] 7. Verdict schema for judge outputs
  - Class: D
  - Clause: D-VERDICT-SCHEMA-01
  - Wave: 3
  - Depends: 3
  - What to do / Must NOT do: every verdict carries schema, basis, and confidence; free-form pass claims are rejected.
  - References: kernel/judge, exam/judges
  - Acceptance: node --test test/verdict.test.mjs exits rc=0
  - Evidence: test/verdict.test.mjs
  - QA: schema violations fail the suite
  - Commit: v2 history (original hashes lost in tree catastrophe)
- [x] 8. Defect ledger format for injury tickets
  - Class: D
  - Clause: D-DEFECT-LEDGER-01
  - Wave: 3
  - Depends: 7
  - What to do / Must NOT do: named defects with repro command and closure evidence; must not close without the repro re-run.
  - References: kernel/judge
  - Acceptance: node --test test/defects.test.mjs exits rc=0
  - Evidence: test/defects.test.mjs
  - QA: ledger format enforced in tests
  - Commit: v2 history (original hashes lost in tree catastrophe)
- [x] 9. Exam bank and deterministic drawer
  - Class: P
  - Clause: P-EXAM-REGISTRY-01
  - Wave: 3
  - Depends: 1
  - What to do / Must NOT do: seed-draw reproducibility and canary slots; the bank is machine-readable and versioned.
  - References: exam/bank.mjs, exam/draw.mjs
  - Acceptance: node --test test/exam.test.mjs exits rc=0
  - Evidence: exam/bank.mjs
  - QA: draw reproducibility asserted in tests
  - Commit: v2 history (original hashes lost in tree catastrophe)
- [x] 10. Bell and live exam runner
  - Class: P
  - Clause: P-BELL-RUNNER-01
  - Wave: 3
  - Depends: 9
  - What to do / Must NOT do: bell runs stay in the seat cage; live runs bind a run record; results carry receipts.
  - References: exam/runner.mjs, exam/spawn.mjs
  - Acceptance: node --test test/runner.test.mjs exits rc=0
  - Evidence: test/runner.test.mjs
  - QA: runner wired to exam CLI command
  - Commit: v2 history (original hashes lost in tree catastrophe)
- [x] 11. Surface containment, run records, and denial journal
  - Class: B
  - Clause: B-SURFACE-01
  - Wave: 4
  - Depends: 3
  - What to do / Must NOT do: checkInside against declared roots, launcher-signed run records, denials journaled; must not trust self-issued records.
  - References: kernel/surface/index.mjs, kernel/surface/record.mjs
  - Acceptance: node --test test/surface.test.mjs test/containment.test.mjs test/surface-record.test.mjs test/surface-cwd.test.mjs test/exam-spawn.test.mjs test/hygiene.test.mjs exits rc=0
  - Evidence: kernel/surface/index.mjs
  - QA: surface show and surface check wired into CLI
  - Commit: v2 history plus surface-cwd tests added 2026-11
- [x] 12. Bash cage boots on the v2 tree without v1 mounts
  - Class: B
  - Clause: B-BASH-CAGE-01
  - Wave: 4
  - Depends: 11
  - What to do / Must NOT do: add self-protection mounts only when targets exist; cage must boot on a tree without loop/.
  - References: kernel/exec policy files
  - Acceptance: node --test test/sandbox.test.mjs exits rc=0
  - Evidence: test/sandbox.test.mjs
  - QA: cage boots every seat session
  - Commit: v2 history (original hashes lost in tree catastrophe)
- [x] 13. Lane attribution for cross-line writes
  - Class: H
  - Clause: H-LANE-01
  - Wave: 4
  - Depends: 11
  - What to do / Must NOT do: classify writes by lane binding; foreign writes flagged; must not treat lane checks as a security wall.
  - References: kernel/lane/index.mjs, tools/wave_engine/line_roots.local.json
  - Acceptance: node --test test/lane.test.mjs exits rc=0
  - Evidence: test/lane.test.mjs
  - QA: lane check wired into CLI
  - Commit: v2 history (original hashes lost in tree catastrophe)
- [x] 14. Hygiene reclaim, retention, and watermark
  - Class: G
  - Clause: G-HYGIENE-01
  - Wave: 5
  - Depends: 11
  - What to do / Must NOT do: bounded growth for run artifacts and logs; retention policy machine-enforced.
  - References: kernel/hygiene/index.mjs
  - Acceptance: node --test test/hygiene.test.mjs exits rc=0
  - Evidence: test/hygiene.test.mjs
  - QA: hygiene commands wired into CLI
  - Commit: v2 history (original hashes lost in tree catastrophe)
- [x] 15. Reconcile stale run records
  - Class: G
  - Clause: G-RUN-RECONCILE-01
  - Wave: 5
  - Depends: 11
  - What to do / Must NOT do: sweep dead-pid records at CLI start; freshness evidence for bind-path records inside pid namespaces.
  - References: kernel/surface/record.mjs
  - Acceptance: node --test test/surface-record.test.mjs exits rc=0
  - Evidence: test/surface-record.test.mjs
  - QA: reconcileRuns called by every CLI invocation
  - Commit: v2 history plus pidns freshness fix 2026-11-12
- [x] 16. Recurrence sweep of obligations
  - Class: F
  - Clause: F-RECURRENCE-01
  - Wave: 5
  - Depends: 14
  - What to do / Must NOT do: scheduled obligations re-surface until closed; silence is a violation signal.
  - References: kernel/recurrence
  - Acceptance: node --test test/recurrence.test.mjs exits rc=0
  - Evidence: test/recurrence.test.mjs
  - QA: sweep report included in gate output
  - Commit: v2 history (original hashes lost in tree catastrophe)
- [x] 17. Human gate commands print prescriptions only
  - Class: E
  - Clause: E-HUMAN-GATE-01
  - Wave: 6
  - Depends: 2, 4, 6, 8, 10, 12, 13, 15, 16
  - What to do / Must NOT do: promote, tombstone, publish emit prescriptions for the human key holder; the seat never executes them.
  - References: cli/abathur-v2.mjs, kernel/gate/index.mjs
  - Acceptance: node --test test/cli.test.mjs exits rc=0
  - Evidence: test/cli.test.mjs
  - QA: gate run binds all clause checks
  - Commit: v2 history (original hashes lost in tree catastrophe)
- [x] 18. Anti-copy discipline for constitutional text
  - Class: P
  - Clause: P-ANTI-COPY-01
  - Wave: 6
  - Depends: 17
  - What to do / Must NOT do: rule bodies referenced once; copies detected by similarity scan.
  - References: test/copygate.test.mjs
  - Acceptance: node --test test/copygate.test.mjs exits rc=0
  - Evidence: test/copygate.test.mjs
  - QA: copygate in npm test
  - Commit: v2 history (original hashes lost in tree catastrophe)
- [x] 19. Receipt index for upward reports
  - Class: C
  - Clause: C-RECEIPT-INDEX-01
  - Wave: 6
  - Depends: 5, 17
  - What to do / Must NOT do: every upward report ends with an absolute-path receipt index; receipts must resolve from the page.
  - References: test/receipts.test.mjs
  - Acceptance: node --test test/receipts.test.mjs exits rc=0
  - Evidence: test/receipts.test.mjs
  - QA: receipt index format asserted in tests
  - Commit: v2 history (original hashes lost in tree catastrophe)
- [x] 20. Review port and coupling scan
  - Class: P
  - Clause: P-REVIEW-PORT-01
  - Wave: 6
  - Depends: 3, 17
  - What to do / Must NOT do: spawn-capable files registered in the trusted list with class and reason; unclassified spawns fail the gate.
  - References: kernel/exec/spawn-policy.json, kernel/exec/spawn-gate.mjs, scripts/scan-coupling.mjs
  - Acceptance: node scripts/scan-coupling.mjs && node --test test/coupling.test.mjs test/review.test.mjs exits rc=0
  - Evidence: kernel/exec/spawn-policy.json
  - QA: spawn-gate also runs standalone in the delivery gate list
  - Commit: v2 history plus cellrunner registrations 2026-11-12
- [x] 21. Plan checker for future refactor plans
  - Class: P
  - Clause: P-PLAN-CHECK-01
  - Wave: 6
  - Depends: 1
  - What to do / Must NOT do: structural validator for headings, todo fields, class coverage, wave graph; judges shape, not correctness.
  - References: scripts/plan-check.mjs
  - Acceptance: node --test test/plan-check.test.mjs exits rc=0
  - Evidence: scripts/plan-check.mjs
  - QA: this file itself passes the checker
  - Commit: v2 history (original hashes lost in tree catastrophe)
- [x] 22. Dispatch packaging boundary
  - Class: P
  - Clause: P-DISPATCH-BOUNDARY-01
  - Wave: 6
  - Depends: 17
  - What to do / Must NOT do: wave dispatch engine stays scope-bounded and manifest-validated; no seat executable installs into production surfaces.
  - References: tools/wave_engine
  - Acceptance: node --test test/dispatch-boundary.test.mjs exits rc=0
  - Evidence: tools/wave_engine/README.md
  - QA: manifest validation in wave engine tests
  - Commit: v2 history plus wave_engine cell runner additions 2026-11-12
- [x] 23. Workfile boundary for program repositories
  - Class: P
  - Clause: P-WORKFILE-BOUNDARY-01
  - Wave: 6
  - Depends: 21
  - What to do / Must NOT do: handoffs, dockets, worklogs live in the state work area, never in program repos; scanner blocks violations.
  - References: scripts/scan-workfiles.mjs
  - Acceptance: node scripts/scan-workfiles.mjs && node --test test/workfile-boundary.test.mjs exits rc=0
  - Evidence: scripts/scan-workfiles.mjs
  - QA: workfile gate in the delivery gate list
  - Commit: v2 history (original hashes lost in tree catastrophe)

## Final verification wave

Run the full delivery gate list from AGENTS.md section five with the repo as cwd;
all commands exit 0 and the gate reports GREEN with 23 clauses.

## Commit strategy

One commit per kernel module or gate addition; every commit message names the clause
it serves. Reconstruction of this plan lands as its own commit with the lost-original
note preserved above.

## Success criteria

npm test green, rules validate reports 23 clauses, gate run GREEN, plan-check passes
on this file, and a seat can complete a sandbox test cycle without asking the owner
to hand-run anything except human-key actions.
