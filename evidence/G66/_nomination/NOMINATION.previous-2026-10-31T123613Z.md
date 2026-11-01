# PROMOTION RECORD (derived view -- regenerate, never hand-edit)

This page contains pointers and probe states only. It deliberately carries no values:
every number, hash and timestamp lives at the pointed-to location. To check a line,
open the pointer. To check all lines at once, run:

```
python3 loop/nomination_manifest.py --run-probes <manifest.json> && python3 loop/nomination_manifest.py G66 --write
```

## 0. What changed

The previous record restated disk values in prose, so every restatement needed a human
to guard it; five audits in a row rejected exactly that layer. This record removes the
restatement instead of gating it: values are only ever pointed at, states only ever come
from probes, gaps are enumerated from directories, and the status vocabulary has no
'landed'. Most rows in section 3 were raised against the retired design; they stay
MANUAL until someone binds a probe, and MANUAL is not a claim of completion.

## 1. Claims

| id | claim | pointer | state |
| --- | --- | --- | --- |
| G66.terminal_state | G66 bundle field terminal_state | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66/bundle.json#terminal_state` | PASS |
| G66.nominatable | G66 bundle field nominatable | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66/bundle.json#nominatable` | PASS |
| G66.canaries_killed | G66 bundle field canaries_killed | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66/bundle.json#canaries_killed` | PASS |
| G66.closed_at | G66 bundle field closed_at | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66/bundle.json#closed_at` | PASS |
| G66.SR4-64.verdict | G66 SR4-64 verdict | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66/bundle.json#items.0.verdict` | PASS |
| G66BCAN.terminal_state | G66BCAN bundle field terminal_state | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66BCAN/bundle.json#terminal_state` | PASS |
| G66BCAN.nominatable | G66BCAN bundle field nominatable | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66BCAN/bundle.json#nominatable` | PASS |
| G66BCAN.canaries_killed | G66BCAN bundle field canaries_killed | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66BCAN/bundle.json#canaries_killed` | PASS |
| G66BCAN.closed_at | G66BCAN bundle field closed_at | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66BCAN/bundle.json#closed_at` | PASS |
| G66BCAN.SR4-64.verdict | G66BCAN SR4-64 verdict | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66BCAN/bundle.json#items.0.verdict` | PASS |
| G66CAN.terminal_state | G66CAN bundle field terminal_state | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66CAN/bundle.json#terminal_state` | PASS |
| G66CAN.nominatable | G66CAN bundle field nominatable | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66CAN/bundle.json#nominatable` | PASS |
| G66CAN.canaries_killed | G66CAN bundle field canaries_killed | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66CAN/bundle.json#canaries_killed` | PASS |
| G66CAN.closed_at | G66CAN bundle field closed_at | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66CAN/bundle.json#closed_at` | PASS |
| G66CAN.SR4-64.verdict | G66CAN SR4-64 verdict | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66CAN/bundle.json#items.0.verdict` | PASS |
| G66GCAN.terminal_state | G66GCAN bundle field terminal_state | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66GCAN/bundle.json#terminal_state` | PASS |
| G66GCAN.nominatable | G66GCAN bundle field nominatable | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66GCAN/bundle.json#nominatable` | PASS |
| G66GCAN.canaries_killed | G66GCAN bundle field canaries_killed | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66GCAN/bundle.json#canaries_killed` | PASS |
| G66GCAN.closed_at | G66GCAN bundle field closed_at | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66GCAN/bundle.json#closed_at` | PASS |
| G66GCAN.SR4-64.verdict | G66GCAN SR4-64 verdict | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66GCAN/bundle.json#items.0.verdict` | PASS |
| G66HCAN.terminal_state | G66HCAN bundle field terminal_state | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66HCAN/bundle.json#terminal_state` | PASS |
| G66HCAN.nominatable | G66HCAN bundle field nominatable | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66HCAN/bundle.json#nominatable` | PASS |
| G66HCAN.canaries_killed | G66HCAN bundle field canaries_killed | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66HCAN/bundle.json#canaries_killed` | PASS |
| G66HCAN.closed_at | G66HCAN bundle field closed_at | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66HCAN/bundle.json#closed_at` | PASS |
| G66HCAN.SR4-64.verdict | G66HCAN SR4-64 verdict | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66HCAN/bundle.json#items.0.verdict` | PASS |

## 2. Audits (enumerated from the engine run store)

| run | verdict | independence | artifact |
| --- | --- | --- | --- |
| sibyl-20261031T073307Z-d18a | {'verdict': 'REJECT', 'approvals': 0, 'rejects': 3, 'errors': 0, 'missing': 0} | {'status': 'INDEPENDENT', 'convenerChain': ['ses_e6f1f9cfeffeaZNlo5JgO9dxWd'], 'evidence': 'scanned 1 session(s) of the convener chain to root; no drafting evidence within read scope; content-lineage: 0/17 distinct lineage windows matched (majority need 11, floor 8@30%)'} | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66/NOMINATION.md` |
| sibyl-20261031T080624Z-6ebc | {'verdict': 'REJECT', 'approvals': 1, 'rejects': 2, 'errors': 0, 'missing': 0} | {'status': 'INDEPENDENT', 'convenerChain': ['ses_e6f012391ffeAcTF3KNX3ONyHC'], 'evidence': 'scanned 1 session(s) of the convener chain to root; no drafting evidence within read scope; content-lineage: 0/18 distinct lineage windows matched (majority need 11, floor 8@30%)'} | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66/NOMINATION.md` |
| sibyl-20261031T081522Z-e921 | {'verdict': 'REJECT', 'approvals': 1, 'rejects': 2, 'errors': 0, 'missing': 0} | {'status': 'INDEPENDENT', 'convenerChain': ['ses_e6ef8f038ffeLGaJS7lW4hw7sr'], 'evidence': 'scanned 1 session(s) of the convener chain to root; no drafting evidence within read scope; content-lineage: 0/23 distinct lineage windows matched (majority need 14, floor 8@30%)'} | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66/NOMINATION.md` |
| sibyl-20261031T113454Z-c324 | {'verdict': 'REJECT', 'approvals': 0, 'rejects': 3, 'errors': 0, 'missing': 0} | {'status': 'INDEPENDENT', 'convenerChain': ['ses_e6e423f7dffer5i6248McZulqI'], 'evidence': 'scanned 1 session(s) of the convener chain to root; no drafting evidence within read scope; content-lineage: 0/15 distinct lineage windows matched (majority need 9, floor 8@30%)'} | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66/NOMINATION.md` |
| sibyl-20261031T120500Z-9343 | {'verdict': 'REJECT', 'approvals': 0, 'rejects': 3, 'errors': 0, 'missing': 0} | {'status': 'INDEPENDENT', 'convenerChain': ['ses_e6e26b1c7ffeCERnHa45PHm8zX'], 'evidence': 'scanned 1 session(s) of the convener chain to root; no drafting evidence within read scope; content-lineage: 0/32 distinct lineage windows matched (majority need 20, floor 8@30%)'} | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66/NOMINATION.md` |

## 3. Must-fix items

Status is a probe result or the literal word MANUAL. There is no 'landed' status
here, so no completion can be claimed without a runnable check.

| audit | line | demand | state |
| --- | --- | --- | --- |
| sibyl-20261031T073307Z-d18a | 1 | 更正 G66CAN closed_at 面值 06:35:39Z→06:38:32Z（磁盘 bundle.json 实读值），更正条与更正后工件哈希同回合入账，批准戳只可落在更正后版本 | MANUAL |
| sibyl-20261031T073307Z-d18a | 2 | 为本代补判卷事件独立回执：从引擎会话库导出判卷会话 ID+起止时间戳+哈希收据入 G66 归档（或按新 run_judge.py 逻辑重取回执），并把『工具链字节在判卷调用时刻』的锚（如 c91c057 diff 内容与父提交时间实测）随呈报落盘——否则第②问『披露是否完整』的答案只能是：缺口在册但本代证据链不可独立复 | MANUAL |
| sibyl-20261031T073307Z-d18a | 3 | 以修复后的 plant_sr4_64_can.build_transcript 重跑一次干净铃测（G66CAN2）并归档，自测记录给绝对路径——现役铃测的 S3 判据部分建立在已知损坏的转录通道上，修复不经重跑即宣布生效不符合本机构自己的修法闭环定义 | MANUAL |
| sibyl-20261031T080624Z-6ebc | 1 | §三 三枚工装哈希改为落盘重算回执：跑 `git show 7a5871b^:loop/run_judge.py \| sha256sum`（及 looplib.py、bundle_close.py 同款）输出存入 .omo/evidence/，并给 verify_nomination_literals.py 增 OK | MANUAL |
| sibyl-20261031T080624Z-6ebc | 2 | §七 补一行 G65 审计态引用：注明 sibyl-20261031T073920Z-3fc9 REJECT 1A/2R 与台账锚 INTENT-LEDGER.md:1011；复核判据=NOMINATION.md §七 含该 run id 与台账行号，grep 可命中 | MANUAL |
| sibyl-20261031T081522Z-e921 | 1 | Run loop/verify_nomination_literals.py against the final NOMINATION.md, save full stdout including the roots arguments to /home/lab/workspace/harness/Abathur/.o | MANUAL |
| sibyl-20261031T081522Z-e921 | 2 | In §十三之二, close the unmatched=6 ledger: either enumerate the six unmatched items of that run with their subsequent disposition, or strike the number and mark th | MANUAL |
| sibyl-20261031T113454Z-c324 | 1 | Register CONVERGED and every §2 verdict literal in facts.json with field sources, or rewrite the preamble to state exactly which value classes gate ① covers. | MANUAL |
| sibyl-20261031T113454Z-c324 | 2 | Add the deferred disposition half: a per-ballot must-fix table citing all six REJECT ballots by absolute path, each item marked landed, superseded, or open, wit | MANUAL |
| sibyl-20261031T113454Z-c324 | 3 | Cite .omo/exam-queue/done/g66-4-judge.result.json (path plus sha256) in the page, add it to the archive list, and rewrite gap 1: session id is disk-recoverable, | MANUAL |
| sibyl-20261031T113454Z-c324 | 4 | Send the regenerated 08:37:56Z page to one fresh independent audit and bind the receipt before promotion instead of shipping unaudited on a generator-only guara | MANUAL |
| sibyl-20261031T120500Z-9343 | 1 | Correct 6ebc m2 status: either restore the G65 sibyl-20261031T073920Z-3fc9 REJECT 1A/2R row into §五 (satisfying both 6ebc m2 and c324 m8) or mark 6ebc m2 open/s | MANUAL |
| sibyl-20261031T120500Z-9343 | 2 | Re-register facts.json sources for G66CAN closed_at and the must-fix hash prefixes to point at loop-archive/G66CAN/bundle.json and .omo/evidence/g66-tooling-blo | MANUAL |
| sibyl-20261031T120500Z-9343 | 3 | Replace template traces in the disposition table with per-item traces that grep-hit the current page (d18a m7 and c324 m7 especially: cite where the post-seal d | MANUAL |
| sibyl-20261031T120500Z-9343 | 4 | Reconcile d18a m10 and c324 m5 status to the §六 auto-disclosure that satisfies them (mark landed-with-trace to the auto-line, or record why the auto-line does n | MANUAL |

## 4. Gaps (enumerated, not curated)

| id | text | pointer | state |
| --- | --- | --- | --- |
| G-git | under 1% of the files under .omo are tracked by git: the archive, the ledger and the gate receipts live on this machine only | `/home/lab/workspace/harness/Abathur/.gitignore#file` | PASS |
| G-manifest | no git-tracked evidence manifest for this generation (earlier generations had one) | `/home/lab/workspace/harness/Abathur/docs/evidence-manifests#dir` | PASS |
| G-gate | the gate receipt is overwritten on each regeneration; previous generations' receipts are not recoverable | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/gate.txt#file` | PASS |
| G-mustfix-unprobed | must-fix items without a machine probe are listed as MANUAL; their completion cannot be asserted by this page | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/mustfix.json#items` | PASS |
| G-anomalies | judge-recorded anomalies exist for this promotion; they are adverse facts and are enumerated from the bundles, not curated | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive#dir` | PASS |
