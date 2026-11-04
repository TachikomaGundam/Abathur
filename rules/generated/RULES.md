# Generated rules — do not edit by hand

registry-sha256: 0bdf6c1b56cbf5e1b03590c14a47867576f9dacccf569783d2929e85bb64c7bc
registry-version: 1

## A-IDENTITY-01 (A)

A commit is attributed only when name and email match one registered identity byte-for-byte; everything else is UNATTRIBUTED.

- check: `node --test test/identity.test.mjs` expects rc=0
- exam: SR4-77
- evidence: `/home/lab/workspace/harness/Abathur/.omo/evidence/refactor-v2-w2/identity.log`

## B-BASH-CAGE-01 (B)

The project bash cage does not hard-code v1-only paths; self-protection mounts are added only when the target exists, so the cage boots on a tree without loop/.

- check: `node --test test/sandbox.test.mjs` expects rc=0
- exam exemption: Runtime machine-surface guard; exercised by node:test and by the absence of bwrap mount errors after the v2 tree switch.
- evidence: `/home/lab/workspace/harness/Abathur/.omo/evidence/refactor-v2-w4/sandbox-cage.log`

## B-MODULE-BOUNDARY-01 (B)

Kernel modules communicate only through their index.mjs interfaces; no deep imports and no shared mutable globals.

- check: `node --test test/module-boundary.test.mjs` expects rc=0
- exam: SR4-76
- evidence: `/home/lab/workspace/harness/Abathur/.omo/evidence/refactor-v2-w1/module-boundary.log`

## B-SURFACE-01 (B)

A launcher-issued run record names the surface and root; destructive targets are checked against that root plus fixed state roots; outside targets are denied with a hash-chained receipt. Outside a git repository E1 is not established and writes are refused.

- check: `node --test test/surface.test.mjs test/containment.test.mjs test/surface-record.test.mjs test/surface-cwd.test.mjs test/exam-spawn.test.mjs test/hygiene.test.mjs` expects rc=0
- exam: SR4-77
- evidence: `/home/lab/workspace/harness/Abathur/.omo/evidence/surface-gate-20261103/quality-gate.log`

## C-ANCHOR-BRIDGE-01 (C)

External anchoring runs through an injected command; an unconfigured anchor fails closed with rc=2.

- check: `node --test test/anchor.test.mjs` expects rc=0
- exam exemption: Infrastructure check; requires a machine-local anchor command that exams cannot own.
- evidence: `/home/lab/workspace/harness/Abathur/.omo/evidence/refactor-v2-w2/anchor-bridge.log`

## C-EVIDENCE-CHAIN-01 (C)

Evidence is an append-only hash chain; any rewrite, deletion, or reordering is detectable by recomputation.

- check: `node --test test/evidence.test.mjs` expects rc=0
- exam: SR4-78
- evidence: `/home/lab/workspace/harness/Abathur/.omo/evidence/refactor-v2-w2/evidence-chain.log`

## C-RECEIPT-INDEX-01 (C)

The receipt index lists every closed wave with absolute paths and hashes; missing or stale entries fail the check.

- check: `node --test test/receipts.test.mjs` expects rc=0
- exam: SR4-78
- evidence: `/home/lab/workspace/harness/Abathur/.omo/evidence/refactor-v2-w6/receipt-index.log`

## D-DEFECT-LEDGER-01 (D)

Item defects and instrument defects are separate ledgers; auditors must be verified engine sessions; two rejections escalate to the human.

- check: `node --test test/defects.test.mjs` expects rc=0
- exam: SR4-80
- evidence: `/home/lab/workspace/harness/Abathur/.omo/evidence/refactor-v2-w3/defect-ledgers.log`

## D-VERDICT-SCHEMA-01 (D)

A verdict has a closed schema; malformed shapes and empty reasons are rejected with named violations.

- check: `node --test test/verdict.test.mjs` expects rc=0
- exam: SR4-79
- evidence: `/home/lab/workspace/harness/Abathur/.omo/evidence/refactor-v2-w3/verdict-schema.log`

## E-HUMAN-GATE-01 (E)

Promote, tombstone, and publish are human gates: print a prescription with an absolute path and a reason, exit non-zero, never execute.

- check: `node --test test/cli.test.mjs` expects rc=0
- exam: SR4-77
- evidence: `/home/lab/workspace/harness/Abathur/.omo/evidence/refactor-v2-w6/cli.log`

## F-RECURRENCE-01 (F)

The second recurrence of a defect class demands a structural fix; the third is a method violation.

- check: `node --test test/recurrence.test.mjs` expects rc=0
- exam: SR4-79
- evidence: `/home/lab/workspace/harness/Abathur/.omo/evidence/refactor-v2-w5/recurrence.log`

## G-HYGIENE-01 (G)

Reclaim deletes only when a manifest matches every file hash, no target is on the evidence denylist, and every target is inside the state temp root.

- check: `node --test test/hygiene.test.mjs` expects rc=0
- exam: SR4-78
- evidence: `/home/lab/workspace/harness/Abathur/.omo/evidence/surface-gate-20261103/npm-test.log`

## G-RUN-RECONCILE-01 (G)

A run whose record expired and whose process is gone is closed with a receipt; only leases inside the state temp root are removed, and directories without a record are reported, never deleted.

- check: `node --test test/surface-record.test.mjs` expects rc=0
- exam: SR4-78
- evidence: `/home/lab/workspace/harness/Abathur/.omo/evidence/surface-gate-20261103/reconcile.log`

## H-LANE-01 (H)

Cross-lane writes are attributed from actor evidence; unattributable events stay DISPUTED and never name a seat.

- check: `node --test test/lane.test.mjs` expects rc=0
- exam: SR4-80
- evidence: `/home/lab/workspace/harness/Abathur/.omo/evidence/refactor-v2-w4/lane.log`

## P-ANTI-COPY-01 (P)

The anti-copy gate runs through an injected command; every carried file needs a registered override with an independent audit receipt.

- check: `node --test test/copygate.test.mjs` expects rc=0
- exam: SR4-76
- evidence: `/home/lab/workspace/harness/Abathur/.omo/evidence/refactor-v2-w6/copy-similarity.log`

## P-BELL-RUNNER-01 (P)

Bell mode must kill a planted fake answer; live mode must pass a legitimate answer; both run through injected seat and judge commands.

- check: `node --test test/runner.test.mjs` expects rc=0
- exam: SR4-76
- evidence: `/home/lab/workspace/harness/Abathur/.omo/evidence/refactor-v2-w3/sr4-76-bell-live.log`

## P-DISPATCH-BOUNDARY-01 (P)

Wave dispatch methodology is source-checkout-only until a new charter explicitly authorizes a runtime module: npm files exclude tools/, kernel/dispatch does not exist, and the publish workflow rejects tools/, __pycache__, and .pyc.

- check: `node --test test/dispatch-boundary.test.mjs` expects rc=0
- exam exemption: Packaging and scope boundary; no seat exam item is claimed for this guard.
- evidence: `/home/lab/workspace/harness/Abathur/.omo/evidence/review-dispatch-abstraction-result.md`

## P-EXAM-REGISTRY-01 (P)

The exam bank is data-driven, canary coverage is explicit, and SR4-76 carries a fake-plan rubric with four required findings.

- check: `node --test test/exam.test.mjs` expects rc=0
- exam: SR4-76
- evidence: `/home/lab/workspace/harness/Abathur/.omo/evidence/refactor-v2-w3/exam-registry.log`

## P-GENERATE-01 (P)

Rule text is generated from the registry deterministically; generated files carry the registry digest and are never hand-edited.

- check: `node --test test/generate.test.mjs` expects rc=0
- exam exemption: Infrastructure check; the planning exam item SR4-76 already covers plan-vs-registry discipline.
- evidence: `/home/lab/workspace/harness/Abathur/.omo/evidence/refactor-v2-w1/generate.log`

## P-PLAN-CHECK-01 (P)

A plan is structurally validated before review: eight headings in order, one top-level todo line per task with ten fields, class coverage A-H/P, and a non-empty Must NOT have section.

- check: `node --test test/plan-check.test.mjs` expects rc=0
- exam: SR4-76
- evidence: `/home/lab/workspace/harness/Abathur/.omo/evidence/surface-gate-20261103/plan-check.log`

## P-REGISTRY-01 (P)

Every rule has one registry entry with a statement, an executable check, and either an exam item or a named exemption.

- check: `node --test test/registry.test.mjs` expects rc=0
- exam: SR4-76
- evidence: `/home/lab/workspace/harness/Abathur/.omo/evidence/refactor-v2-w1/registry-schema.log`

## P-REVIEW-PORT-01 (P)

Independent review is an abstract mechanism: code, rules and generated text never name a review product; the local adapter is injected by the operator (ABATHUR_REVIEW_CMD) and its receipt must carry verdict, independence, run and artifact_sha256; unset means REVIEW UNDISPATCHABLE rc=2.

- check: `node scripts/scan-coupling.mjs && node --test test/coupling.test.mjs test/review.test.mjs` expects rc=0
- exam exemption: Mechanical scan covers every v2 code/rule/doc file; no separate exam item is claimed for this guard.
- evidence: `/home/lab/workspace/harness/Abathur/.omo/evidence/refactor-v2-w6/coupling.log`
