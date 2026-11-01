# PROMOTION RECORD (derived view -- regenerate, never hand-edit)

This page's own assertions carry no values: every state comes from a probe and every
address is a pointer. The only literals on the page are inside QUOTED ballot demands in
section 3, which belong to the ballots and are shown in full on purpose; a quotation is
not this page asserting a number. To check a line, open the pointer, then run every
probe at once with:

```
python3 loop/nomination_manifest.py --run-probes <manifest.json> && python3 loop/nomination_manifest.py G66 --write
```

## 0. What changed

The previous record restated disk values in prose, so every restatement needed a human
to guard it; every audit of that layer rejected exactly that layer. This record removes the
restatement instead of gating it: values are only ever pointed at, states only ever come
from probes, gaps are enumerated from directories, and the status vocabulary has no
'landed'. Most rows in section 3 were raised against the retired design; they stay
MANUAL until someone binds a probe, and MANUAL is not a claim of completion.

## 1. Claims

| id | claim | pointer | state |
| --- | --- | --- | --- |
| G66.terminal_state | G66 bundle field terminal_state equals the promotion contract | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66/bundle.json#terminal_state` | PASS |
| G66.nominatable | G66 bundle field nominatable equals the promotion contract | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66/bundle.json#nominatable` | PASS |
| G66.canaries_killed | G66 bundle field canaries_killed equals the promotion contract | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66/bundle.json#canaries_killed` | PASS |
| G66.closed_at | G66 bundle records a close timestamp | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66/bundle.json#closed_at` | PASS |
| G66.SR4-64.verdict | G66 SR4-64 verdict equals PASS (promotion contract for a run) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66/bundle.json#items.0.verdict` | PASS |
| G66.SR4-64.verdict.present | G66 SR4-64 verdict is recorded | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66/bundle.json#items.0.verdict` | PASS |
| G66BCAN.canaries_killed | G66BCAN bell killed at least one canary | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66BCAN/bundle.json#canaries_killed` | PASS |
| G66BCAN.closed_at | G66BCAN bundle records a close timestamp | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66BCAN/bundle.json#closed_at` | PASS |
| G66BCAN.SR4-64.verdict | G66BCAN SR4-64 verdict equals FAIL (promotion contract for a bell) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66BCAN/bundle.json#items.0.verdict` | PASS |
| G66BCAN.SR4-64.verdict.present | G66BCAN SR4-64 verdict is recorded | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66BCAN/bundle.json#items.0.verdict` | PASS |
| G66CAN.canaries_killed | G66CAN bell killed at least one canary | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66CAN/bundle.json#canaries_killed` | PASS |
| G66CAN.closed_at | G66CAN bundle records a close timestamp | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66CAN/bundle.json#closed_at` | PASS |
| G66CAN.SR4-64.verdict | G66CAN SR4-64 verdict equals FAIL (promotion contract for a bell) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66CAN/bundle.json#items.0.verdict` | PASS |
| G66CAN.SR4-64.verdict.present | G66CAN SR4-64 verdict is recorded | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66CAN/bundle.json#items.0.verdict` | PASS |
| G66GCAN.canaries_killed | G66GCAN bell killed at least one canary | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66GCAN/bundle.json#canaries_killed` | PASS |
| G66GCAN.closed_at | G66GCAN bundle records a close timestamp | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66GCAN/bundle.json#closed_at` | PASS |
| G66GCAN.SR4-64.verdict | G66GCAN SR4-64 verdict equals FAIL (promotion contract for a bell) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66GCAN/bundle.json#items.0.verdict` | PASS |
| G66GCAN.SR4-64.verdict.present | G66GCAN SR4-64 verdict is recorded | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66GCAN/bundle.json#items.0.verdict` | PASS |
| G66HCAN.canaries_killed | G66HCAN bell killed at least one canary | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66HCAN/bundle.json#canaries_killed` | PASS |
| G66HCAN.closed_at | G66HCAN bundle records a close timestamp | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66HCAN/bundle.json#closed_at` | PASS |
| G66HCAN.SR4-64.verdict | G66HCAN SR4-64 verdict equals FAIL (promotion contract for a bell) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66HCAN/bundle.json#items.0.verdict` | PASS |
| G66HCAN.SR4-64.verdict.present | G66HCAN SR4-64 verdict is recorded | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66HCAN/bundle.json#items.0.verdict` | PASS |

## 2. Audits (pointers into the engine run store)

Outcome and independence are read from the store, not restated by this page.

| run | verdict | independence | pointer | state |
| --- | --- | --- | --- | --- |
| sibyl-20261031T073307Z-d18a | REJECT | INDEPENDENT | `/home/lab/.sibyl/runs.json#sibyl-20261031T073307Z-d18a` | RESOLVES |
| sibyl-20261031T080624Z-6ebc | REJECT | INDEPENDENT | `/home/lab/.sibyl/runs.json#sibyl-20261031T080624Z-6ebc` | RESOLVES |
| sibyl-20261031T081522Z-e921 | REJECT | INDEPENDENT | `/home/lab/.sibyl/runs.json#sibyl-20261031T081522Z-e921` | RESOLVES |
| sibyl-20261031T113454Z-c324 | REJECT | INDEPENDENT | `/home/lab/.sibyl/runs.json#sibyl-20261031T113454Z-c324` | RESOLVES |
| sibyl-20261031T120500Z-9343 | REJECT | INDEPENDENT | `/home/lab/.sibyl/runs.json#sibyl-20261031T120500Z-9343` | RESOLVES |
| sibyl-20261031T123025Z-24fc | REJECT | INDEPENDENT | `/home/lab/.sibyl/runs.json#sibyl-20261031T123025Z-24fc` | RESOLVES |
| sibyl-20261031T123750Z-eea4 | REJECT | INDEPENDENT | `/home/lab/.sibyl/runs.json#sibyl-20261031T123750Z-eea4` | RESOLVES |

## 3. Must-fix items (quoted from ballots; quote text is not this page's own assertion)

Status is a probe result or the literal word MANUAL. There is no 'landed' status
here, so no completion can be claimed without a runnable check. Each demand is
quoted in full; the pointer gives its line in the machine copy.

| audit | line | demand (quoted) | full text | state |
| --- | --- | --- | --- | --- |
| sibyl-20261031T073307Z-d18a | 1 | 更正 G66CAN closed_at 面值 06:35:39Z→06:38:32Z（磁盘 bundle.json 实读值），更正条与更正后工件哈希同回合入账，批准戳只可落在更正后版本 | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#sibyl-20261031T073307Z-d18a#1` | MANUAL |
| sibyl-20261031T073307Z-d18a | 2 | 为本代补判卷事件独立回执：从引擎会话库导出判卷会话 ID+起止时间戳+哈希收据入 G66 归档（或按新 run_judge.py 逻辑重取回执），并把『工具链字节在判卷调用时刻』的锚（如 c91c057 diff 内容与父提交时间实测）随呈报落盘——否则第②问『披露是否完整』的答案只能是：缺口在册但本代证据链不可独立复核 | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#sibyl-20261031T073307Z-d18a#2` | MANUAL |
| sibyl-20261031T073307Z-d18a | 3 | 以修复后的 plant_sr4_64_can.build_transcript 重跑一次干净铃测（G66CAN2）并归档，自测记录给绝对路径——现役铃测的 S3 判据部分建立在已知损坏的转录通道上，修复不经重跑即宣布生效不符合本机构自己的修法闭环定义 | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#sibyl-20261031T073307Z-d18a#3` | MANUAL |
| sibyl-20261031T080624Z-6ebc | 1 | §三 三枚工装哈希改为落盘重算回执：跑 `git show 7a5871b^:loop/run_judge.py \| sha256sum`（及 looplib.py、bundle_close.py 同款）输出存入 .omo/evidence/，并给 verify_nomination_literals.py 增 OK-GIT 模式（对 git blob 重算 sha256）替代文档文本回声匹配；复核判据=回执文件在盘且哈希与 eab81224…/8d98fef6…/bfa80be7… 前缀逐字一致 | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#sibyl-20261031T080624Z-6ebc#1` | MANUAL |
| sibyl-20261031T080624Z-6ebc | 2 | §七 补一行 G65 审计态引用：注明 sibyl-20261031T073920Z-3fc9 REJECT 1A/2R 与台账锚 INTENT-LEDGER.md:1011；复核判据=NOMINATION.md §七 含该 run id 与台账行号，grep 可命中 | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#sibyl-20261031T080624Z-6ebc#2` | MANUAL |
| sibyl-20261031T081522Z-e921 | 1 | Run loop/verify_nomination_literals.py against the final NOMINATION.md, save full stdout including the roots arguments to /home/lab/workspace/harness/Abathur/.omo/evidence/g66-literals-final.txt, and cite that absolute path in §十三之二 replacing the prose-only checked=23 unmatched=2 claim. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#sibyl-20261031T081522Z-e921#1` | MANUAL |
| sibyl-20261031T081522Z-e921 | 2 | In §十三之二, close the unmatched=6 ledger: either enumerate the six unmatched items of that run with their subsequent disposition, or strike the number and mark the intermediate run as unrecoverable (no persisted receipt). | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#sibyl-20261031T081522Z-e921#2` | MANUAL |
| sibyl-20261031T113454Z-c324 | 1 | Register CONVERGED and every §2 verdict literal in facts.json with field sources, or rewrite the preamble to state exactly which value classes gate ① covers. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#sibyl-20261031T113454Z-c324#1` | MANUAL |
| sibyl-20261031T113454Z-c324 | 2 | Add the deferred disposition half: a per-ballot must-fix table citing all six REJECT ballots by absolute path, each item marked landed, superseded, or open, with correction traces for any deleted section. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#sibyl-20261031T113454Z-c324#2` | MANUAL |
| sibyl-20261031T113454Z-c324 | 3 | Cite .omo/exam-queue/done/g66-4-judge.result.json (path plus sha256) in the page, add it to the archive list, and rewrite gap 1: session id is disk-recoverable, only the engine session record is absent. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#sibyl-20261031T113454Z-c324#3` | MANUAL |
| sibyl-20261031T113454Z-c324 | 4 | Send the regenerated 08:37:56Z page to one fresh independent audit and bind the receipt before promotion instead of shipping unaudited on a generator-only guarantee. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#sibyl-20261031T113454Z-c324#4` | MANUAL |
| sibyl-20261031T120500Z-9343 | 1 | Correct 6ebc m2 status: either restore the G65 sibyl-20261031T073920Z-3fc9 REJECT 1A/2R row into §五 (satisfying both 6ebc m2 and c324 m8) or mark 6ebc m2 open/superseded with a named reason; the page must not assert landed for content it does not contain. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#sibyl-20261031T120500Z-9343#1` | MANUAL |
| sibyl-20261031T120500Z-9343 | 2 | Re-register facts.json sources for G66CAN closed_at and the must-fix hash prefixes to point at loop-archive/G66CAN/bundle.json and .omo/evidence/g66-tooling-blob-hashes.txt, then re-run the verifier so those literals show RECOMPUTED/verbatim-against-primary instead of dispositions.json echo. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#sibyl-20261031T120500Z-9343#2` | MANUAL |
| sibyl-20261031T120500Z-9343 | 3 | Replace template traces in the disposition table with per-item traces that grep-hit the current page (d18a m7 and c324 m7 especially: cite where the post-seal drift disclosure and pack-time hash actually sit, or add the missing 'pack-time hash inferred from 7a5871b^ blob + receipt timing' sentence). | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#sibyl-20261031T120500Z-9343#3` | MANUAL |
| sibyl-20261031T120500Z-9343 | 4 | Reconcile d18a m10 and c324 m5 status to the §六 auto-disclosure that satisfies them (mark landed-with-trace to the auto-line, or record why the auto-line does not count) so the open/open/landed triangle over one requirement is resolved. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#sibyl-20261031T120500Z-9343#4` | MANUAL |
| sibyl-20261031T123025Z-24fc | 1 | must-fix 需求文本纳入值禁写检查（复用 HEX_RUN/ISO_RUN 或按时间样式扩展），或对其中的面值改为指针引用；至少让 main 的主闸能抓住『HH:MM:SSZ』类裸面值 | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#sibyl-20261031T123025Z-24fc#1` | MANUAL |
| sibyl-20261031T123025Z-24fc | 2 | §1 状态改用 json_equals（或探针带期望值）区分字段语义：canaries_killed=[]、nominatable=true、verdict==PASS 各按其主张断言，否则 CAN 卷的 FAIL/false 值不得标 PASS | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#sibyl-20261031T123025Z-24fc#2` | MANUAL |
| sibyl-20261031T123025Z-24fc | 3 | 在页面或 gaps 中逐字呈现 bundle 的三枚 stamps（PERFORMANCE-ONLY-IN-LOOP / MODEL-DIVERSITY-PENDING / CONDITIONAL(D1a)），或为其各生成一条缺口条目；enumerate_gaps 新增规则须由数据发现而非手写 | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#sibyl-20261031T123025Z-24fc#3` | MANUAL |
| sibyl-20261031T123025Z-24fc | 4 | 修正 G-gate 文案与 gate.txt 只追加事实的矛盾（改为具名『生成器自身不锚定源码、仅锚页面哈希』一类真实缺口） | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#sibyl-20261031T123025Z-24fc#4` | MANUAL |
| sibyl-20261031T123025Z-24fc | 5 | demand 截断改为可续读：页内标注截断并指向 mustfix.json 全文指针，或提高上限且保证不在路径中间切断 | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#sibyl-20261031T123025Z-24fc#5` | MANUAL |
| sibyl-20261031T123750Z-eea4 | 1 | Replace §1 existence probes with per-row expected-value assertions (nominatable==true, canaries_killed==[] vs non-empty per contract, verdict==PASS/FAIL per row's own claim) and re-run; no row carries PASS unless its probe encodes that row's claim. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#sibyl-20261031T123750Z-eea4#1` | MANUAL |
| sibyl-20261031T123750Z-eea4 | 2 | Give every §3 row a unique resolvable pointer (per-audit file or audit-scoped index) and add a probe byte-matching the page quote against the pointed file, closing the truncation guard. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#sibyl-20261031T123750Z-eea4#2` | MANUAL |
| sibyl-20261031T123750Z-eea4 | 3 | Recover or export the six MISSING sibyl ballot records into a git-tracked path and anchor sha256 of mustfix.json plus the export in a git-tracked receipt, or mark §3 quotes UNVERIFIABLE-AGAINST-BALLOT in the header. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#sibyl-20261031T123750Z-eea4#3` | MANUAL |
| sibyl-20261031T123750Z-eea4 | 4 | Remove or probe-bind numeric restatements in the page's own text: §0 'five audits in a row' (or bind it to a count over the ballot list) and G-git 'under 1%' (probe-computed percentage or pure pointer), so the no-values preamble becomes true. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#sibyl-20261031T123750Z-eea4#4` | MANUAL |
| sibyl-20261031T123750Z-eea4 | 5 | Replace G-anomalies' directory pointer with per-anomaly entries (bundle path + field pointer) or mark ABSENT with named boundary; PASS on 'adverse facts exist' requires anomaly-level probes. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#sibyl-20261031T123750Z-eea4#5` | MANUAL |
| sibyl-20261031T123750Z-eea4 | 6 | Deduplicate §1 claim ids (contract/plain suffix) and make the top re-run command verbatim runnable: absolute script path and the actual manifest path instead of '<manifest.json>' placeholder. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#sibyl-20261031T123750Z-eea4#6` | MANUAL |

## 4. Gaps (enumerated, not curated)

| id | text | pointer | state |
| --- | --- | --- | --- |
| G-git | the archive, the ledger and the gate receipts live under .omo, which git does not track; the coverage ratio is recomputed by the probe and is not restated here | `/home/lab/workspace/harness/Abathur/.gitignore#file` | PASS |
| G-manifest | no git-tracked evidence manifest for this generation (earlier generations had one) | `/home/lab/workspace/harness/Abathur/docs/evidence-manifests#dir` | PASS |
| G-gate | gate receipts are append-only but live under .omo, which git does not track: they survive on this machine only | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/gate.txt#file` | PASS |
| G-stamp-1 | permanent disclosure stamp: PERFORMANCE-ONLY-IN-LOOP | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66/bundle.json#stamps.0` | PASS |
| G-stamp-2 | permanent disclosure stamp: MODEL-DIVERSITY-PENDING | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66/bundle.json#stamps.1` | PASS |
| G-stamp-3 | permanent disclosure stamp: CONDITIONAL(D1a) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66/bundle.json#stamps.2` | PASS |
| G-mustfix-unprobed | must-fix items without a machine probe are listed as MANUAL; their completion cannot be asserted by this page | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#items` | PASS |
| G-anomaly-G66-SR4-64 | judge-recorded anomaly for G66/SR4-64 (adverse fact; text is at the pointer, not restated here) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66/bundle.json#items` | PASS |
| G-anomaly-G66BCAN-SR4-64 | judge-recorded anomaly for G66BCAN/SR4-64 (adverse fact; text is at the pointer, not restated here) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66BCAN/bundle.json#items` | PASS |
| G-anomaly-G66CAN-SR4-64 | judge-recorded anomaly for G66CAN/SR4-64 (adverse fact; text is at the pointer, not restated here) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66CAN/bundle.json#items` | PASS |
| G-anomaly-G66GCAN-SR4-64 | judge-recorded anomaly for G66GCAN/SR4-64 (adverse fact; text is at the pointer, not restated here) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66GCAN/bundle.json#items` | PASS |
| G-anomaly-G66HCAN-SR4-64 | judge-recorded anomaly for G66HCAN/SR4-64 (adverse fact; text is at the pointer, not restated here) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66HCAN/bundle.json#items` | PASS |
