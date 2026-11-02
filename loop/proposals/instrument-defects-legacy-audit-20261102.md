# 存量器具伤补审计（四例）

目的：为 `instrument_defects.jsonl` 的 legacy 条目取得独立审计依据。逐例请判断 ①缺陷是否真实存在过 ②是否已修复 ③证据是否足以支撑入账。判据只用本页给出的仓内可复算引用。

## 例 1 — INS-20261031-G82SCAN / class=scanner-false-positive

- 主张：`loop/boundary_read_scan.py` 曾把候选报告正文里的**引用文字**（一句诚实披露「stamp 硬依赖 /home/lab/** 故未盖章」）当作越界读取，开出 incident，使 G82 `nominatable=false`。
- 修复：提交 `29b2214`（扫描改按访问目标语义：write/edit/read 看 filePath，bash 看命令文本）；契约 `loop/test_boundary_scan.py`（5 例）。
- 修复后证据：G83 `SR4-62` 的 `candidate_state.json` 中 `boundary_read_anomalies=[]`；G83 `bundle.json` 中 `incidents=[]`、`nominatable=true`。
- 待验：`git show 29b2214 --stat`；`python3 loop/test_boundary_scan.py`；`.omo/evidence/loop-archive/G82/bundle.json` 的 `incidents` 文本；`.omo/evidence/loop-archive/G83/SR4-62/candidate_state.json`。

## 例 2 — INS-20261025-SR469SIG / class=seed-signature-mismatch

- 主张：`setup_sr4_69` 的签名与 `loop/seed_item.py` 的调用约定不符（`(ws)` vs `(gen, item)`），播种时抛 TypeError，题无法开考。
- 修复：提交 `09ffecc`（修签名 + 题库契约测试 + 宿主侧 clean 通道）；契约 `loop/test_bank_contract.py` 内含「setup 禁读 .omo」AST 谓词与夹具钉版存在检查。
- 修复后证据：提交 `f60779a` 补齐 SR4-69 夹具（播种校验器 + 题面格式模板 + 信号改 cwd=workshop）。
- 待验：`git show 09ffecc --stat`；`python3 loop/test_bank_contract.py`。

## 例 3 — INS-20261026-VERDICT-SHAPE / class=verdict-validator-gap

- 主张：判官输出曾无形状校验——信号集合缺失/取值越界/aggregate 与信号不自洽时仍可被当作有效票面落盘。
- 修复：提交 `a02a4a2`（fail closed on empty roster、judge-declared hgf、stale verdicts、unseeded memory hash、self-attested reroll tickets、unvalidated verdict shape）；现行实现 `loop/run_judge.py` 的 `verdict_problems()`，不通过即写 `verdict-problems.txt` 并 exit 3。
- 待验：`git show a02a4a2 --stat`；`grep -n "def verdict_problems" -A 30 loop/run_judge.py`；`grep -n "verdict-problems.txt" loop/run_judge.py`。

## 例 4 — INS-20261101-TIMEOUT / class=timeout-default

- 主张：回合闸曾用全局默认 1200s，长题（如 SR4-52/SR4-64/SR4-65）在此被误判为 infra 失败/中断。
- 修复：提交 `7e518a1`（per-item turn ceiling + 超时后会话续跑）；具名旋钮 `.omo/tooling.json#item_turn_timeout`（SR4-52/SR4-64/SR4-65 = 2400s）。
- 修复后证据：G79 `d953b95` 记录「resume-after-turn-timeout」；SR4-65 续跑先例。
- 待验：`git show 7e518a1 --stat`；`grep -n "item_turn_timeout" -A 6 loop/looplib.py`；`.omo/tooling.json` 的 `item_turn_timeout` 段。

## 请审计方回答（逐例三问）

1. 缺陷是否存在过（依据本页引用，不得凭本页自述采信）
2. 是否已修复（同上）
3. 证据是否足以支撑 `severity=blocking` 的 legacy 入账（若不足，指出缺哪一份）

若某例证据不足，请直接判该例不通过，不要合并成一句整体结论。
