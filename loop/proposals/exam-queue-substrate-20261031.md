# 考场作业基底（队列 + 唤醒）一次性重构设计 — 2026-10-31

状态：待实现（本文件即五格计划，实现后同文件追加验收回执）
适用：`/home/lab/workspace/harness/Abathur/.opencode/plugins/abathur-exam-runner.js` 及其存储面 `.omo/exam-queue/`

## 0. 为什么现在写这个（不变量先行）

机主本日点名两件事：回执碎片化怎么解决、计划性去哪了。诊断结论：我此前是**打补丁**——先补 `agent` 字段，再想合并，再想探测器。同一个子系统三天内已被我动了三次，按 `L-INVARIANT-FIRST`，第二次复发就该做结构修复，我迟了一轮。本文件把「作业执行 + 唤醒」当一个整体，给出不变量、状态机、对账与验收，然后**一次性**改完。

## 1. 被消灭的病类（全部有实测在案）

| 编号 | 病 | 实测证据 |
|---|---|---|
| P1 | 静默丢件：作业跑完但结果与回执都丢，无任何痕迹 | 2026-10-31 重启窗口：`running.json` 残留 `cand-g64v-sr469`，`done/` 无对应 result，候选实际已 `state=COMPLETE`（`/tmp/abathur-loop-G64V/SR4-69/harness/candidate_state.json`） |
| P2 | 回执错人：文本注入不指定 agent，由会话当前选中的 agent 作答 | `last-session.txt`=`ses_e71abdd1cffe6ItzlhIVZECLDu`，其 `session_info` 显示 `Agents Used: abathur, Sisyphus - ultraworker` |
| P3 | 唤醒放大：每个作业一条回执，24/40 条对应 <1s 作业 | `.omo/evidence/receipt-fragmentation-review-20261030.md` 及评审票 `sibyl-20261030T200101Z-2e5f` |

评审席另指出的两处，本设计按它的要求补齐：合并必须有**有界时延**；「无静默丢件」必须有**探测器与对账**，不能只写在文档里当承诺。

## 2. 不变量（每条都可机械判）

- **I1 无静默终态**：任一被取走的作业名，最终必在 `done/<name>.result.json` 或 `rejected/<name>.json` 留下终态记录；取件后崩溃由启动对账补写 `kind="INTERRUPTED"` 记录。
- **I2 回执具名**：回执投递必须带 `agent`，且正文含 `[seat=<agent>]`；投递结果写审计行。
- **I3 唤醒有界**：回执按窗口合并，最坏延迟 ≤ `ABATHUR_RECEIPT_COALESCE_MS`（默认 45s）；一次合并回执逐条列作业名/rc/耗时/结果路径。
- **I4 单并发**：同一时刻最多一个作业在跑（沿用现状，不加并发）。
- **I5 可审计**：每次状态迁移写一行 `runner.log`：`TAKE/DONE/RECONCILED/RECEIPT-SENT/RECEIPT-FAIL`。

## 3. 设计

### 3.1 状态机

```
queue/<name>.json --take--> running.json{name,...,started_at,pid} --spawn--> child
child exit -> done/<name>.result.json -> pendingReceipts.push -> (窗口到) 合并投递
启动/轮询对账: running.json 存在且 (pid 不在 /proc 或 无 done 记录) -> 补写 INTERRUPTED 终态 + 合并投递
```

### 3.2 对账（消灭 P1 的机制，不是承诺）

启动时与每次轮询前调用 `reconcile()`：

1. 读 `running.json`；无则返回。
2. 若其 `pid` 存在且 `/proc/<pid>` 可达 → 仍在跑，返回。
3. 否则：若 `done/<name>.result.json` 已存在 → 只清 `running.json`（正常收尾残影）。
4. 否则补写 `done/<name>.result.json`：`{..., rc: -1, kind: "INTERRUPTED", elapsed_s: null, tail: "进程在结果落盘前消失；可能已有工件，先查 run dir 再决定重跑"}`，并排队一条响亮回执。

判活一律读 `/proc`（禁 `pgrep` 自匹配，G45 案在册）。

### 3.3 合并回执（消灭 P3，且有界）

- 作业收尾不再直接投递，改为 `queueReceipt(line)` 入队。
- 首个入队启动定时器；到期或队列长度 ≥ `ABATHUR_RECEIPT_BATCH_MAX`（默认 8）立即 flush。
- flush 把窗口内所有条目拼成**一条**消息：首行 `[JOB-RECEIPT][seat=…] 完成 N 件`，其后每件一行（名字、stage、rc、用时、结果路径）。无条目不发。
- 单件窗口与现状等价：只多等 ≤45s，不多发一条。

### 3.4 地址（P2，已落地，本设计收编为不变量）

`body.agent` 显式指定；`last-session.txt` 改为 `{"id","agent"}`；读取时比对 `agent`，不符只记 `RECEIPT-ADDR-UNVERIFIED`，并仍在投递时点名 agent（点名即消除歧义）。

## 4. 五格计划

- **目标**：作业终态零静默丢失；回执按窗口合并且具名；每次迁移可审计。
- **路径**：`/home/lab/workspace/harness/Abathur/.opencode/plugins/abathur-exam-runner.js`（唯一改动文件）；证据 `/home/lab/workspace/harness/Abathur/.omo/exam-queue/runner.log`；自测队列文件同目录。
- **验收**：①`node --check` 过；②连续入队 2 个 <1s 的 query 作业 → 观察 `runner.log` 出现 1 条 `RECEIPT-SENT n=2`；③人为留一个假 `running.json`（pid 不存在、无 done 记录）→ 下一次轮询出现 `RECONCILED` 行 + `done/<name>.result.json` 内 `kind=INTERRUPTED`；④回执正文含 `[seat=abathur]`。
- **禁项**：不改题库与判卷逻辑；不加并发；不把 `pid` 判活改成 `pgrep`；不删除既有 `done/` 证据。
- **回滚**：`git revert` 单文件提交即可；存储面格式向后兼容（旧纯文本 `last-session.txt` 仍可读，仅标未验证）。

## 5. 验收回执（实现后填写）

| 验收项 | 状态 | 回执 |
|---|---|---|
| ①`node --check` 通过 | 达成 | 输出 `SYNTAX_OK`（2026-10-31，本仓 cwd） |
| ②两枚秒级作业合并为一条回执 | **达成** | 重启加载后：`runner.log` 有 `05:41:41 TAKE st1-query` / `05:41:43 TAKE st2-query`（两作业 1s、0.6s 完成，各自未发独立回执）；`05:42:17` 收到的单条消息正文首行为 `[JOB-RECEIPT][seat=abathur] 合并回执 3 件（窗口 45s，本批等多于此值即投递）`，逐条列出 3 项 |
| ③留置假 `running.json` 触发 `RECONCILED` + `kind=INTERRUPTED` | **达成** | `runner.log:107` → `2026-10-31T05:41:32.877Z RECONCILED selftest-stale kind=INTERRUPTED`；`done/selftest-stale.result.json` 内容 `rc=-1, kind=INTERRUPTED, tail=进程在结果落盘前消失…` |
| ④回执正文含 `[seat=abathur]` | **达成** | 上述合并回执首行实读；`runner.log:114-115` → `05:42:17.878 FLUSH n=3` / `05:42:17.889 RECEIPT-SENT sid=ses_e71abdd1cffe6ItzlhIVZECLDu agent=abathur verified=false` |

自测口径说明（防误读）：②③两项由本席在重启后当场发起，作业名为 `selftest-stale`/`st1-query`/`st2-query`（gen=G99T，非真实世代），其 `done/` 记录为自测产物保留作证，不代表任何真实考试的终态。

地址校验的实测边界（如实记录，不粉饰）：`last-session.txt` 落盘为 `{"id":"ses_…","agent":"unknown"}`，因为引擎的 `chat.message`/`tool.execute.before` 钩子输入不带 agent 字段 —— 于是 `verified` 恒为 `false`。这不影响投递正确性：投递靠 `body.agent` 显式点名（本次合并回执确由本席作答即为实证），**不靠**文件自述身份。故补一条不变量：**I6 地址可信度来自投递时点名，不来自地址文件的自述**；`verified` 字段仅作诊断信号，不得作为正确性依据。

P1 的真实标本（设计动因，非事后编造）：`.omo/exam-queue/runner.log` 有 `2026-10-31T05:27:22Z START cand-g64v-sr469` 而无对应 `DONE`，`done/` 无 `cand-g64v-sr469.result.json`，`running.json` 残留 —— 宿主被重启杀死在「子进程已写完工件、插件未写终态」之间；候选实际 `state=COMPLETE`。旧代码永久遗忘，新代码补 `INTERRUPTED`。

同窗达成的夹具修复验证（与本设计同一子系统的上游病）：SR4-69 补齐播种校验器与题面格式模板后，验证局 G64V 判卷 `aggregate=PASS`、S1-S4 全 PASS、`canary_kill=false`，判卷独立复跑校验器 `rc=0` 且播种件哈希与正本同值。证据：`.omo/evidence/loop-archive/G64V-SR4-69/VERDICT.json`（含候选会话 `ses_e6f92b660ffeXRHJePmaW8PQcG`、判卷会话 `ses_e6f8ea654ffeTRZRr88HCRlF0K`）。G63 的 FAIL 原样归档未改；`plan-seg-discipline` 债务仍挂（验证局非正式世代，不销账）。

