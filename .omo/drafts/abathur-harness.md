---
slug: abathur-harness
status: plan-written
intent: clear
review_required: true
plan_sha256: ad2d02e755f9307adf727591a49b4db161bdc976b00fbbbaebd43a43faab62a9
plan_review_state: reviewed-passed — ROUND-3 DOUBLE OKAY on final sha ad2d02e755f9307adf727591a49b4db161bdc976b00fbbbaebd43a43faab62a9 (218 lines). Receipts: momus bg_a72ce8fc/ses_f7b340087ffe19F6fMDkmDjgEB verdict "[OKAY] No blocking defects found" (sha stated in verdict, 15/15 R2 folds + all 13 ref clusters line-verified, waves+QA pass); oracle bg_e9333b96/ses_f7b33cbfcffe6rLoNz0oFnH2WL verdict {"status":"OKAY"} (independent fold re-verification + reseal/fitness-hack/leak escape-route scan closed, rubric/README:68/:75/thresholds/manifest/recommend/engine_* /border/swarm-zero-hits all re-checked). Non-blocking residues DELIBERATELY NOT applied (editing would invalidate the receipts' hash; recorded as executor-discretion): (1) matrix row-10 Blocks cell '11,13,14,15' should transpose to '11,12,14,15' — operative Blocked-by fields all correct, execution order unaffected (both reviewers); (2) line-53 'Target 5-8/wave' stale phrasing; (3) R2-10 optional items (copy-assets existsSync tolerance, 'sandbox manifest' producer naming). NEXT: live path+sha re-verify immediately before final handoff report; execution belongs to user ($start-work). [历史账目见下] (R2 receipts: BOTH fresh reviewers AMEND on sha a8d4d3ae… — work order R2-1..R2-10 in section below; R2-1..R2-9 ALL folded on disk (T5 adapter-level acceptance; T4 superset-globs rule + `genome seals`; T4 agentModel REQUIRED + T12/T13 digest & subset extension; T12 maskLiterals spec-home + build-mask-every-member + export pre-write scan; T6/T15 configDir-scope sentence; T14 judgment assertion + pinned pass rules; T7 val non-regression reword; matrix+per-todo Blocks transpose; T10 README:75 annotation corrected), R2-10 optional items left to executor discretion. New sha ad2d02e755f9307adf727591a49b4db161bdc976b00fbbbaebd43a43faab62a9 (218 lines); FRESH round-3 pair dispatched on it. [历史] round1 both AMEND on sha 0af53460…; ALL 13 items folded on disk: momus#1→T10 ref historian README:75, momus#2/oracle11a→T8 ref README:68, oracle#1→T11c overlay recipe+trusted-digests, #2→T4 no-reseal+T4 acceptance, #3→T8 artifact-path reject+acceptance fixture, #4→T7 t-CI n>=2+--reps clamp+T14 reps1-indeterminate-expected, #5→T14 normalization+G-gate, #6→T12 digest-covers-graders/agentModel+T13 provenance-subset, #7→T12 config-mask-list whole-bundle, #8→T2 fingerprint lock+T6 single-flight+T15 operator duties, #9→T1 copy-assets/files[]/prepack+T15 pack assertion, #10→verification-strategy RED stub protocol, #11c→draft split corrected 7/2, #11d→T6 sandbox-manifest defined, #11e→T2 runId schema, #11f→T2 friction.lock discipline, #11g→T11 unresolved ${ABATHUR_SELF_REPO} literal in spec, #11h→T8 opaque val aliases+canary. Sessions r1: momus bg_d44d18f0/ses_f7b721bedffemt8CRGZQ1Wh5aw, oracle bg_f0b0b222/ses_f7b71c461ffe2QDJmuaRq3FG4Q. Any plan change now invalidates the round → re-hash + fresh round if editing before receipts land.)
round2 sessions: momus bg_9aa485cf/ses_f7b52bd12ffekNSnQlQgWlGak5, oracle bg_b8938e8f/ses_f7b5250f2ffe7W1p7KOnHuwmMD (both dispatched against sha a8d4d3ae…, fresh sessions per protocol; on double-OKAY: live re-verify path+sha immediately before handoff).

## Round-2 findings work order (extracted from transcripts BEFORE verdict tails; full logs on disk: tool-output/tool_084bf25b2001crULHKitfFKk7K=momus, tool_084bf6e0e001cu2CSre29giAJk=oracle; both reviewers hash-verified a8d4d3ae; all 13 round-1 folds confirmed present; converging AMEND items to apply):
R2-1 BLOCKING T5 acceptance invokes CLI `run` (only exists after T9) + undefined `--no-model` flag → restate as adapter-level node --test determinism assertions; CLI loop stays in T9.
R2-2 BLOCKING T4 altered-spec re-registration reseal hole (new fingerprint, same repoPath, weakened globs ⇒ fresh manifest from tampered files; genomes/abathur-self.jsonc repo copy unsealed & score-neutral through promote) → add: new fp with equal repoPath but immutableGlobs NOT superset ⇒ exit 1; T11b seal concrete glob `genomes/abathur-self.jsonc`, replace ambiguous 'the glob list itself'.
R2-3 BLOCKING benchDigest omits runCommand template + timeoutS + judgeModel; agentModel used in T12/T13 but absent from T4 GenomeSpec.bench → add explicit bench.agentModel; digest := units+grader/seed/reset contents+graderCommand+judgeCommand+agentModel+judgeModel+runCommand+timeoutS+iface version; T13 subset += judgeModel.
R2-4 MED T12 mask application scope ambiguous (may cover only evidence/ at build; inspect-time detection = post-export leak; acceptance greps manifest only; mask list has no schema home) → mask EVERY member at build; `bundle export` scans whole bundle pre-write fail-closed (fixture: leaking export ⇒ exit 1); put maskLiterals under bundle section of spec (zod-strict home).
R2-5 LOW-MED single-flight enforced only within one <configDir>; same-machine multi-config-home against one wiki undocumented → one sentence T6 + T15 operator duties.
R2-6 MED T14 vs rubric scenario-05: 'judgment' component unowned (script dims E/F/G/H + judge A-D only) and normalized pass threshold unstated → grader adds script-first judgment assertion (pages outside _sandbox/this-session or >1 line ⇒ fail; reason present in final message); pin: full scenarios pass = raw Σ(w×d)≥10 ∧ G=1, score=Σ/12; scenario-05 pass = G∧H∧judgment, score=(G+H+judgment)/3.
R2-7 T7 'improvement on ALL val units (non-regression gate)' contradiction → 'no val unit regresses: val mean ≥ incumbent − CI half-width (ties allowed)'.
R2-8 TRIVIAL dependency-matrix Blocks column errors both directions (row 4 missing 7, row 2 missing 8) → recompute all Blocks as transposition of Depends-on.
R2-9 LOW T10 ref annotation misstates README:75 ('--confirm <sha256 of brief>' — actual: bare wiki-ops `delete <id> --confirm` presence flag; sha256 claim absent from README) → fix annotation; APPROVE PLAN-in-.omo/recovery claim verified true, keep.
R2-10 OPTIONAL copy-assets existsSync tolerance (T1 before T5 assets); define 'sandbox manifest' producer in T6; name package.json+tsconfig in T11c 'toolchain config'; drop '5-8/wave' claim.
VERIFIED-GOOD don't-touch: overlay non-degenerate + build trust chain sound; committed-dist double-blocked; all cited refs line-level accurate; waves 3/4/3/3/2; exit codes; runId/friction.lock/val-aliases/ABATHUR_SELF_REPO-literal landed.
NEXT: persist this list (done) → dispatch verdict-tail extractor → apply R2-1..R2-9 (+10 where cheap) → recompute sha → CAS draft round-3 dispatch → fresh momus+oracle pair.
pending-action: deliver handoff + ask start-or-review question (plan written + metis folded — see ## Metis)
approach: Standalone resumable TS CLI (border template), fully config-driven (name/path decoupled), evolving any registered genome via reflection→bench→stats→human-promotion; historian skill = first adapter instance; self-evolution hook per run; content-addressed lineage bundles enable future cross-instance federation (graft = import + local re-bench).
---

# Draft: abathur-harness

## Components (topology ledger)
- C1 genome-store | every generation = immutable git commit + manifest{parent, mutation rationale, bench digest}; genome identity = content fingerprint, NEVER name/path | active
- C2 bench-adapter | generic `opencode-fixture-scenarios` adapter (isolated-HOME sandbox per historian layout), train/val split in genome config, script-first scoring | active
- C3 evolution-engine | reflection mutator: transcripts+failed assertions → constrained diff via `opencode run` child sessions; path allowlist; budget caps | active
- C4 selection-stats | repeated runs, CI comparison vs incumbent (hr half_width discipline as template), Pareto (score, cost, turns) | active
- C5 lineage-ledger | append-only JSONL per-genome ledger; crash-resume | active
- C6 promotion-gate | `abathur promote` human-only; incumbent preserved; regression auto-demote; gate+kernel paths immutable to mutator (P5) | active
- C7 essence-ledger | mutation-outcome records; export format shared with C9; historian wiki publish deferred | active-as-format
- C8 self-evolution | engine registers ITS OWN repo as genome `abathur-self`; every `run` on any genome also emits a self-mutation candidate (friction digest of that run) into abathur-self's queue; self-bench = node --test suite + deterministic toy-genome replay; same human promote gate | active
- C9 federation | `abathur bundle export` → content-addressed portable bundle (generations, manifests, bench digests, evidence hashes); `abathur graft <bundle>` → import candidates into verification queue, MUST re-bench on LOCAL bench, val-beat incumbent to become eligible; peer scores are claims, not truth | active (export/import/graft-verify in v1; network transport OUT)

## Open assumptions (announced defaults)
| assumption | adopted default | rationale | reversible? |
|---|---|---|---|
| "插件" wording in m00032 | interpreted as colloquial; form stays standalone TS CLI per D4 (user-confirmed) | D4 was explicit after plugin-vs-CLI comparison; thin opencode tool adapter remains a possible later add-on | yes |
| train/val split | historian 7/2 per plan todo-14 (train=01,02,03,05,06,07,08; val=04,09), curator-editable; split stored in genome config (curator-owned, P5) | anti-overfit GEPA-style | yes |
| self-evolution coupling | candidate emission per run (cheap, always); candidate EXECUTION (self-bench run) only via explicit `abathur run --genome abathur-self` | full self-bench on every target run would multiply cost unboundedly | yes |
| scoring | deterministic assertions first; LLM judge only subjective dims; judge model family ≠ mutator family (config-enforced) | P6 | yes |
| test strategy | TDD node --test for deterministic core; E2E acceptance = real evolution run on historian bench, agent-executed QA, evidence .omo/evidence/abathur/ | family convention | yes |
| state/layout | XDG cache for sandboxes/worktrees; <repo>/.state/abathur for ledger; genome repos NEVER polluted | border/hr patterns | yes |

## Findings (cited - path:lines)
- Family map (detail in compressed block b1): magi=review-council plugin; border=fail-closed pre-push CLI (ledger/exit-code contract template); historian=wiki-skill EVAL harness (first genome); hr=Python model-bench CLI (statistics template); swarm=short-round plugin; VideoGen=greenfield.
- "Abathur" zero prior traces: pure bootstrap. All workspace paths are CONFIG VALUES, never code constants (S2).
- hr headless interface (bg_6fea92ae): truth = PostgreSQL hr.measurement, sweep id livebench-<ts>-<hex6>; recommend --json tri-state schema recommend.py:224-273; thresholds.yaml half_width per battery (engine.py:79-87); DSN via HR_DSN/hr.toml. NOT v1 fitness (model bench ≠ artifact bench); stats discipline reused.
- historian bench VERIFIED 2026-09-08 ~21:20 (direct disk reads, supersedes bg_bee28f63 claims where they conflict): scenarios/ = 9 FLAT FILES `scenarios/NN-slug.md` (01-new-finding … 09-timeline-week-groups); each = `## Brief` (incl. EVAL SANDBOX rule: `_sandbox/` is wiki root, real wiki read-only) + `## Materials` + `## Expected Behavior` + `## Grading Notes` (cite historian/scenarios/01-new-finding.md:1-32). seed_sandbox.sh → /opt/wiki-ops/wiki-ops.py (EXISTS, verified) seeds _sandbox fixtures (index, rocm-tuning, …). rubric.md at root; results/ = 7 sweep reports (2026-08-21 v1-vs-v2 … 2026-09-07 live-scan). HANDOFF.md (244 lines): open P0/P1 skill-defect list from 09-07 challenge round = ideal friction signal source for historian-genome mutations. NOT FOUND on disk (earlier bg report claims UNVERIFIED, do not cite as fact): scoring.mjs, results/2026-09-08* dir, 'plant-and-run' scenario, opencode v1.15.13 binary at /home/lab/opencode/binaries (path absent), 12-dim rubric claim, timeout/-c flag probe notes.
- Plan consequence: adapter unit = scenario FILE (config-listed train/val split over the 9 files); scoring = grader program per bench config (script-first remains P6 requirement regardless of historian's current state); historian genome ships as `*.local.jsonc`-style config referencing verified paths only.
- Evolution literature (bg_a2ea48a1): GEPA reflection+Pareto +10% at 35× fewer rollouts; population > hill-climb; Voyager: description drift ≠ behavior → fitness must measure executed tasks (grounds C9 graft re-bench rule).

## Decisions (with rationale)
- D1 (user m00017): Abathur = 进化/优化 harness — mutation → fitness-eval → selection.
- D2 (user m00021 quote): "本机有几个harness正在我的监督下进行进化…要求它们在监督下完成一个简单的任务，然后对产出进行评估，再去改harness，重新跑同样的任务" → mechanize the supervised loop; human = promotion gate.
- D3 pillars P1-P8 (see v2 history; folded into C1-C9).
- D4 (user m00029): standalone TS CLI, border template (long-running, crash-resumable).
- D5 (user m00029): first genome = historian skill (only trusted bench).
- D6 (user m00032): SELF-EVOLUTION — "每次给别人进化的时候自己也进化" → C8: abathur-self genome, per-run friction digest → self-candidate queue, same gate.
- D7 (user m00032): NAMING/PATH DECOUPLING — "注意命名和路径的解耦，我希望别的地方也可以使用" → zero hardcoded identifiers/paths; genome registry in config; identity = content fingerprint; adapter type registry, not switch-on-name; portable ~/.config/abathur + $ABATHUR_HOME env.
- D8 (user m00032): FEDERATION — "不同阿巴瑟之间今后可以沟通并整合各自进化的结晶，完成大规模群体进化" → C9 content-addressed bundles + graft-verify (peer crystallization re-benched locally); "今后" = v1 ships format+export/graft CLI; transport/discovery/auto-merge OUT.

## Scope IN (v1)
- `abathur` TS CLI (Node≥22 ESM, npm-installable, zero workspace-specific constants): commands genome add/list, run, status, promote, tombstone, bundle export, graft, self-eval; C1-C9 above.
- Generic `opencode-fixture-scenarios` bench adapter (isolated sandbox, config-declared train/val, per-run timeout, plugin-isolation fix via copied+overridden opencode.jsonc, script-first scoring hook).
- Historian genome instance (config file only — adapter validated on a bundled TOY genome in tests first).
- abathur-self registration + friction-digest emission + self-queue; self-bench = node --test + toy replay.
- Bundle format (schema_version, fingerprints, bench digests, evidence hashes) + export/import/graft-verify commands.
- Bilingual README, .omo conventions, anchor commit, TDD core, agent-executed QA per todo.

## Scope OUT (Must NOT have)
- No auto-promotion; no mutator write-access to bench assets/kernel/gate paths (P5 allowlist enforcement); no model-retraining/model-benching (hr owns); no non-historian genome configs shipped; no opencode plugin registration; no UI/dashboard; no parallel/distributed mutation; NO federation network transport/discovery/trust-layer (v1 = format + offline bundle graft); no auto-merge of peer lineages.

## Open questions
- (none)

## Approval gate
status: APPROVED (m00032 "动手吧" + additions folded as D6-D8).
next action: DELIVERED handoff + asked start-vs-high-accuracy question this turn (plan at .omo/plans/abathur-harness.md: 15 todos W1-W5, F1-F4 wave, TL;DR filled, structural self-check passed: 15x `- [ ] N.` + 4x `- [ ] F.` column-zero, wave labels reconciled 3/4/3/3/2). Await user's choice: $start-work or high-accuracy dual review (would flip review_required: true, run momus+oracle per full-workflow intake contract before handoff-complete).

## Metis gap analysis (DONE bg_d06e6b60, 15 findings — all dispositioned)
1 kernel boundary undefined → T4 kernel manifest out-of-tree + `kernel audit` at run start (T9/T10) + T11 seals enforcement files. 2 val-split/judge in mutable config → registry lives in harness config home OUTSIDE genome trees (T4). 3 historian fixtures stateful never-reset → resetCommand contract (T5 iface reset(), T6 run-order, T14 wiki _sandbox purge; E2E (e) equivalence). 4 phantom scoring.mjs/script-first premise → grader authored here, machine-checkable dims only script-first (T14). 5 scenario-format misdescribe → pre-metis disk verification had already fixed Findings (m00051); T5 refs warn against phantom files. 6 graft digest-mismatch + provenance → quarantined byte-equal rule + benchProvenance{} full fields (T12/T13, docs/federation.md T15). 7 crash-resume semantics → orphan reaping via active-children.jsonl + exactly-once accounting (T9). 8 budget exhaustion → inconclusive-not-score (T7, already). 9 concurrent locking → lock dir + PID staleness (T2, already). 10 opencode version coupling → --version probe + minVersion + recorded in provenance (T6/T12). 11 val leak via friction digests → content-scrub + canary-string tests (T8/T11). 12 evidence hash trust → bundle embeds redacted train-only evidence, inspect verifies bytes (T12). 13 fingerprint algorithm → sha256-canonical-v1, sorted path+content, invariance tests (T2/T4). 14 graft w/o local bench → pending-bench queue state (T13). 15 stats params → REQUIRED per-genome {halfWidth, minEffect, nReps} + Bonferroni 0.05, missing=config error (T4/T7).
