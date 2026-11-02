# 外线提交逐笔裁定表（INCIDENT-20261103）

生成器：`/home/lab/workspace/harness/Abathur/scripts/gen-foreign-adjudication.py`（复算命令：`python3 scripts/gen-foreign-adjudication.py`）。
数据源：`/home/lab/workspace/harness/Abathur/docs/evidence-manifests/ACKNOWLEDGED-FOREIGN-COMMITS.txt` 的 44 枚 sha，逐笔读 `git show`。

**这张表不能由本席裁定。** 每一行的「裁定」列必须由具名人类签认（台账人类条目），
或由 `sibyl_audit`（`independence=INDEPENDENT`，审计会话可在引擎库对账）出意见后仍由人类签认。
在签认前，闸保持 `FAIL-PENDING` 红灯是**正确状态**。

| # | sha | 日期 | 主题 | 触及面 | 文件数 | 裁定（人类签认） |
|---|---|---|---|---|---|---|
| 1 | `1686dbc2d2d5` | 2026-11-03T03:03:30 | unit-parallel C3: anti-contamination sentry - one adapter, two sandboxes, one unit at two truth  | src×1 | 1 | ☐ |
| 2 | `78fec3f8a48d` | 2026-11-03T02:58:20 | unit-parallel C2 (v2 shared-spend): benchTarget units become concurrent tasks (batch<=4, reps se | src×1 | 1 | ☐ |
| 3 | `b6d4bd616368` | 2026-11-03T02:48:38 | unit-parallel C1: score(unit, sandboxDir?) - explicit sandbox threading through contract + fixtu | src×4 | 4 | ☐ |
| 4 | `c51d3c4dd05c` | 2026-11-02T16:05:22 | parallel-arms fixup (self-review catch): per-BATCH budget shard re-granted the full remaining to | src×1 | 1 | ☐ |
| 5 | `64f0df31fa37` | 2026-11-02T15:55:47 | parallel-arms engine half (owner-approved ticket): un-resumed candidate arms bench in batches of | src×1 | 1 | ☐ |
| 6 | `1ddb773c65f9` | 2026-11-02T15:15:29 | batch-3 wound-2: 'abathur kernel reseal <label> --confirm <label>' — promote-style human re-type | src×2 | 2 | ☐ |
| 7 | `9e13b4add19d` | 2026-10-28T16:46:19 | promote dual-sign (owner batch-2B ticket): promote row now carries nomRowHash (sha256 of the exa | src×6 | 6 | ☐ |
| 8 | `fec6bdaf8709` | 2026-10-28T16:27:23 | ledger hash chain (owner batch-2A ticket): every new record carries prevHash = sha256(canonical( | src×2 | 2 | ☐ |
| 9 | `9334e76567c9` | 2026-10-23T20:05:42 | fixup 6e342fd: candidate rows were missing the genomeFp stamp (154 was lease-only) — scoped resu | src×1 | 1 | ☐ |
| 10 | `6e342fdb8ad3` | 2026-10-23T19:51:47 | readResume scoped by genomeFp (owner-approved cross-line ticket): incumbent/candidate resume row | src×3 | 3 | ☐ |
| 11 | `54883cf0b3f7` | 2026-10-22T22:27:18 | mutator: pin --agent abathur (was default/sisyphus per owner finding #2) + open PRODUCT surface  | graders×1 | 1 | ☐ |
| 12 | `96b618de9c0c` | 2026-10-22T22:23:43 | flight-watch daemon: proactive reporting (INBOX verdict lines + STATUS.md heartbeat every 10min  | graders×1 | 1 | ☐ |
| 13 | `5ff6b2bbe367` | 2026-10-22T22:22:11 | grader C1+C3 (third-party audit): ESM require crash when fab-out exists -> import readdirSync; t | graders×1 | 1 | ☐ |
| 14 | `004dce185f7e` | 2026-10-20T13:56:53 | runner D-e24: s41/s41b rep window assigned 3600s (fell through to 1500 default => design exams r | graders×1 | 1 | ☐ |
| 15 | `6304a00c85d3` | 2026-10-19T21:53:24 | mutator brief: hard output-contract line at the recency position (F40 no-op: model summarized in | graders×1 | 1 | ☐ |
| 16 | `930aa05a262f` | 2026-10-16T22:38:12 | F38 prep: s41b routed, guidance = class-resolved judgment on reversed trap, one-card <=25 lines | graders×2 | 2 | ☐ |
| 17 | `732a70e366ba` | 2026-10-16T10:29:02 | windows widened for F37 clean re-baseline: s31b/s32 rep 3300->3600, engine timeoutS 3900 (two F3 | graders×1 | 2 | ☐ |
| 18 | `560f587908d4` | 2026-10-15T15:52:20 | grader v3.3 hotfix: restore readdirSync identifier (a replace('','') no-op line had silently del | graders×1 | 1 | ☐ |
| 19 | `8af8234b8283` | 2026-10-15T15:51:15 | mutate.sh FIXED: restore 4eeb4dc full file, replace only heredoc body (905c5c5 had eaten ECONOMY | graders×1 | 1 | ☐ |
| 20 | `905c5c5cc143` | 2026-10-15T10:35:15 | mutator guidance: s41-era post-convergence brief (blank slate = design-time manufacturability) | graders×1 | 1 | ☐ |
| 21 | `d692a4660443` | 2026-10-15T10:34:45 | s41 era wiring: v3.3 netlist-mfg branch (checker+netlist+erc+arithmetic eyes), shim route, mutat | graders×2 | 2 | ☐ |
| 22 | `4eeb4dc9057a` | 2026-10-14T16:58:03 | mutator guidance: clause-economy control run (F32 experiment on role-volume tax hypothesis; <=25 | graders×1 | 1 | ☐ |
| 23 | `09e6c8363a07` | 2026-10-12T22:13:41 | bench windows: s31b/s32 rep 3000->3300 (double-run probe: both arms delivered 5min past 3000s wa | graders×1 | 1 | ☐ |
| 24 | `7d44de0cacf6` | 2026-10-12T21:16:12 | grader v3 D-e22: claims regex accepts keyword-first markdown tables (probe-A board delivered rea | graders×1 | 1 | ☐ |
| 25 | `43117e7b12a9` | 2026-10-10T18:52:20 | graders 0.2.9 border fix: de-hardcode homedir + charCodeAt backslash (HANDOFF-0.2.9-BLOCKERS pat | graders×4 | 4 | ☐ |
| 26 | `0c264023a732` | 2026-10-09T17:12:26 | seed D-e16: pristine input snapshot gated by board presence not unit name (r40 lesson) | graders×1 | 1 | ☐ |
| 27 | `76ba1e8ae0f7` | 2026-10-08T21:05:35 | runner D-e15: DONE = contract marker grep (T1-idle degraded to existence-only after first turn-r | graders×2 | 2 | ☐ |
| 28 | `951bf4571bf8` | 2026-10-08T19:09:25 | runner D-e14: DONE = RESULT present AND team turn returned (existence-only anchor harvested live | graders×1 | 1 | ☐ |
| 29 | `d026ccb637ce` | 2026-10-08T14:10:23 | grader v2.1 D-e13: anti-skeleton digit guard (RESULT.md body <12 digits collapses outcome; Goodh | graders×1 | 1 | ☐ |
| 30 | `eb8b4163c328` | 2026-10-08T08:28:52 | D-e12b: arena key = genome-repo BASENAME (worktree gen dir unique per arm; the dirname variant c | graders×2 | 2 | ☐ |
| 31 | `d8aacc382e2b` | 2026-10-08T08:28:23 | D-e12: per-arm arena dirs (runner default + shim mirror) — flight-11 baseline-zero forensics: ca | graders×2 | 2 | ☐ |
| 32 | `ed0eaedd5f0e` | 2026-10-08T05:40:05 | shim D-e11: inject engine bookkeeping fields tokensEst/turns (parseGraderLine contract, verified | graders×1 | 1 | ☐ |
| 33 | `554239987eac` | 2026-10-08T03:47:54 | runner D-e10: DONE = RESULT.md EXISTENCE in the per-rep fresh arena (seed rm-rf's it every rep,  | graders×1 | 1 | ☐ |
| 34 | `c17342a56745` | 2026-10-08T01:21:33 | runner D-e9: DONE poll anchors on inner boot.stamp, not runner-side seed.log (engine r20-bench O | graders×1 | 1 | ☐ |
| 35 | `f42b47f1d79c` | 2026-10-08T01:18:38 | runner D-e8: r22 phaseA window 1500->2400 (flight-8 team was killed mid-turn at msg50 with deliv | graders×1 | 1 | ☐ |
| 36 | `c081c1832f71` | 2026-10-07T18:33:52 | approver D-e7: history-confirmed fire-and-ack grants (blocking POST vs long-turn deadlock was th | graders×1 | 1 | ☐ |
| 37 | `79cfec34ebf9` | 2026-10-07T17:31:54 | approver D-e6 instrumentation: 60s heartbeat (poll count, seen shas, msg count) to localize engi | graders×1 | 1 | ☐ |
| 38 | `20b0f9557557` | 2026-10-07T14:02:35 | runner D-e5: turn-wait inherits rep timeout + final RESULT recheck before MISSION_INCOMPLETE | graders×1 | 1 | ☐ |
| 39 | `ab7263cf0cbc` | 2026-10-07T12:35:30 | runner D-e4: pin HOME at entry + DONE-poll covers arena too (engine HOME sandboxing made marker  | graders×1 | 1 | ☐ |
| 40 | `287cf4ac1a96` | 2026-10-07T11:24:42 | runner D-e1/D-e2 fixes: self-allocate serve port (engine spawns lacked PCB_PRODUCTION_SERVE_PORT | graders×1 | 1 | ☐ |
| 41 | `ef3d3fb1415e` | 2026-10-07T05:04:57 | r20 runner: wire run-card seam (abathur-notes appended to brief verbatim) - engine candidates no | graders×1 | 1 | ☐ |
| 42 | `6d038b75c1c1` | 2026-10-07T04:14:47 | grader-engine.sh: default PCB_FORCE_ARENA to /tmp/r20-arena-<unit> for engine-lane invocations | graders×1 | 1 | ☐ |
| 43 | `e84d296b0a7b` | 2026-10-07T03:17:19 | grader-engine.sh rewrite: clean if/elif dispatch (s3x->v3, phaseA/B->v2); smoke: unit routing em | graders×1 | 1 | ☐ |
| 44 | `d18888f44dfd` | 2026-10-07T03:15:55 | grader-engine.sh phase-dispatch shim for engine lane | graders×1 | 1 | ☐ |

合计 44 笔；其中触及 `src/` 的 10 笔（对引擎面有效，须优先裁定）；其余为 `graders/pcb-agent/**` 与发布说明。

裁定口径建议（供人类参考，非裁决）：

1. **触及 `src/` 的 10 笔**：需逐笔判断「是否接受该改动进入证据基线」。它们已经在 HEAD 谱系里，且 `release/0.4.0` 与所有 tag 均不包含——即发布面干净、工作树脏。
2. **`graders/pcb-agent/**` 的 34 笔**：属他线器材长期寄放（迁移工单 `handoffs/GRADERS-MIGRATION-pcb-agent.md` 在册）。裁定应附带迁移判据，而不是逐笔豁免。
3. **任何一行**：签认后把该行改为 `<sha> PENDING` 也不解除红灯——红灯解除的唯一条件是 `ACKNOWLEDGED-FOREIGN-COMMITS.txt` 为空或闸改判；本表签认的作用是**记录人类已知情**，不改变闸的判败语义。
