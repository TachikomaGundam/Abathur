# PROMOTION RECORD (derived view -- regenerate, never hand-edit)

This page contains pointers and probe states only. It deliberately carries no values:
every number, hash and timestamp lives at the pointed-to location. To check a line,
open the pointer. To check all lines at once, run:

```
python3 loop/nomination_manifest.py --run-probes <manifest.json> && python3 loop/nomination_manifest.py G66 --write
```

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

## 4. Gaps (enumerated, not curated)

| id | text | pointer | state |
| --- | --- | --- | --- |
| G-git | under 1% of the files under .omo are tracked by git: the archive, the ledger and the gate receipts live on this machine only | `/home/lab/workspace/harness/Abathur/.gitignore#file` | PASS |
| G-manifest | no git-tracked evidence manifest for this generation (earlier generations had one) | `/home/lab/workspace/harness/Abathur/docs/evidence-manifests#dir` | PASS |
| G-gate | the gate receipt is overwritten on each regeneration; previous generations' receipts are not recoverable | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G66/gate.txt#file` | PASS |
| G-anomalies | judge-recorded anomalies exist for this promotion; they are adverse facts and are enumerated from the bundles, not curated | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive#dir` | PASS |
