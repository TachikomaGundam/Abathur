# HANDOFF — 本会话剩余未作工作（新会话接续单）

- 交接时刻：2026-11-03（北京时间）
- 交接人：阿巴瑟席（会话 `ses_e71abdd1cffe6ItzlhIVZECLDu`）
- 权威仓：`/home/lab/workspace/harness/Abathur`
- 平行件：v2 重构交接在 `handoffs/HANDOFF-20261103-refactor-v2.md`（**已由机主在新会话开工**）。
  本件只收「重构之外、本会话遗留」的事，两件不重叠。

**通道约定**（实测）
- `沙箱`：bash 工具，仓目录读写绑定、`/home/lab` 其余 tmpfs、宿主 `/tmp` 不可见、无网。
  只给裸命令 + `workdir`，不要手打 bwrap 前缀。
- `宿主`：`interactive_bash` 起 tmux，能看全盘与网络。凡路径含 `~` 或 `Abathur-v2` 一律宿主。

---

## 0. 当前状态（交接时实测，可直接复算）

| 项 | 值 | 复算命令 | 通道 |
|---|---|---|---|
| 主树 HEAD | 交接时锚点 `f6dd7428…`；**以当场 `git rev-parse HEAD` 为准**（v2 W0 提交会推进，交接后实测已到 `8927b339…`） | `git rev-parse HEAD` | 沙箱 |
| 工作树改动 | **以当场输出为准**（交接时 15 条；v2 W0 在途会继续增加） | `git status --porcelain` | 沙箱 |
| npm 全局安装 | **空** | `ls -l ~/.npm-global/lib/node_modules/@tachikomagundam/` | 宿主 |
| 已发布版 | `0.4.1` | `npm view @tachikomagundam/abathur version` | 宿主 |
| bench 沙箱占用 | `113G` | `du -sh ~/.config/abathur/bench-sandboxes` | 宿主 |
| G84 队列 | 待跑 `g84-5-cand-sr469.json` | `ls .omo/exam-queue/*.json` | 沙箱 |
| 台账 907 收口 | 已入（内容锚，非位置锚） | `grep -c '事故907 彻查与晋升审计收口' .omo/evidence/INTENT-LEDGER.md` ≥1（交接时命中第 1522 行） | 沙箱 |

---

## R1. npm 全局安装（人类键，座席不得代按）

- 现状：dev-link 已撤除，`~/.npm-global/lib/node_modules/@tachikomagundam/` 为空，
  `which abathur` 无输出。中间的「无 abathur 命令」状态是合规的，不是故障。
- 恢复动作（**人类终端**）：`npm install -g @tachikomagundam/abathur@0.4.1`
- 验收：`abathur --version` 输出 `0.4.1`；`readlink -f $(which abathur)` 不指向任何工作树。
- 禁止：`npm link`、`ln -s` 指向 `/home/lab/workspace/harness/Abathur`（这正是 907 案的成因）。

## R2. G84 半播处置（冻结中，需一处决定）

- 现状：`SR4-63` 已作答（rc=0），`SR4-69` 已播种但未跑；
  `.omo/exam-queue/g84-5-cand-sr469.json` 在队；`.omo/exam-queue/running-1238289.json` 存在，
  **其 pid 1238289 交接时仍存活**（`/proc/1238289/cmdline` = opencode，cwd=本仓）——
  不得称「旧残留」。预检须分两层，**判据是记录内的 worker pid，不是 host_pid**：
  - 宿主层：`ls -l /proc/1238289 && tr '\0' ' ' < /proc/1238289/cmdline`
    → 存活且是 opencode 属**正常**（宿主进程在跑期间恒存活），不构成阻塞。
  - 作业层：`python3 -c "import json;d=json.load(open('.omo/exam-queue/running-1238289.json'));print(d)"`
    取其 pid 字段集，逐个 `ls -d /proc/<pid>`；全部不存在=无活体作业。
  - 汇总：`python3 loop/run_registry.py status`（注册表 start/exit 配对 + /proc 双源）。
- 默认（机主已宣）：重构期间不续跑。续跑授权**只属机主**。
- 放弃：`python3 loop/clean_run.py G84 SR4-69`（沙箱可跑；该脚本用法是 `<gen> <item>`，
  无 `clean` 子命令）；已判卷产物不得删。
- 续跑（仅在机主授权、且**作业层 pid 集全部不存在**时）：删除 `.omo/exam-queue/running-1238289.json`
  → 把 `.omo/exam-queue/g84-5-cand-sr469.json` 重新写入（内容 `{"gen":"G84","item":"SR4-69","stage":"candidate"}`）
  → 等 `[JOB-RECEIPT]` → 按既有流水收口。
- 验收：`ls .omo/exam-queue/*.json` 无 G84 条目；若存在 `.omo/evidence/loop-archive/G84/`，其中必须有 `BUNDLE.md` 且 `python3 -c "import json;json.load(open('.omo/evidence/loop-archive/G84/bundle.json'))"` rc=0。

## R3. 主树 10 条未提交改动（不得擅自处置）

交接时实测 15 条（**以当场 `git status --porcelain` 为准**；v2 会话在途会继续增加）：

```
 M README.md
 M package.json
 M src/test/d7-gate.test.ts
 M src/test/docs-currency.test.ts
 M src/test/release-contracts.test.ts
?? README.zh.md
?? docs/BORDER-EVIDENCE-PUBLICATION-v2.md
?? evidence/G68CAN/
?? examples/
?? handoffs/HANDOFF-20261103-refactor-v2.md
?? docs/PLAN-TEMPLATE.md
?? loop/plan_check.py
?? scripts/copy-similarity.py
?? scripts/fixtures/
?? handoffs/HANDOFF-20261103-session-residual.md
```
后 5 条属 v2 W0 白名单或本件自身（本件未跟踪）。

- 性质：事故前遗留的文档/测试工作，与 907 无关（已核：不在任何事故提交里）。
- 处置：**归 v2 重构的 W0 基线流程**（见重构交接件 §7「遗留脏项处置」）。
  本会话之后不得由别的会话擅自提交或回滚这批改动。
- 验收：v2 基线文件里逐条列出这 10 条的「纳入/保留」结论。

## R4. 外线 4 笔（未裁定，须人类或独立审签认）

- 现状：外线身份共 48 笔 = 44 笔在 `HEAD` 谱系 + 4 笔只在 `original/refs/heads/main`。
  44 笔已入 `docs/evidence-manifests/ACKNOWLEDGED-FOREIGN-COMMITS.txt`（PENDING，闸判 FAIL-PENDING）。
  隔离 ref 的提交数与声明行**以当场输出为准**：`python3 scripts/check-foreign-commits.py` 的
  `quarantined_ref_commits=` 字段与 `wc -l docs/evidence-manifests/QUARANTINED-REFS.txt`
  （交接时实测为 107 与 25 行，与本文件早期写的 151 不符，已按实测更正）。
- 写入规则：本席**不得**自行增删 sha 行；须人类签认，或 `sibyl_audit` APPROVE+INDEPENDENT 回执附卷。
- 验收：`python3 scripts/check-foreign-commits.py` 的判决从 `FAIL-PENDING` 变为可裁定态，
  或机主书面裁定「维持 PENDING」。

## R5. 晋升审计（已成文，后续不在本单）

- 产出：`docs/AUDIT-PROMOTIONS-20261103.md`（v5，sibyl `db86` APPROVE 2A/1R）。
- 机器事实：33 代 = 0 VERIFIED + 3 APPROVAL-ONLY + 24 ARCHIVE-ONLY + 6 无法核验；G73–G83 零批准。
- 未做：对「无法核验」和「仅归档」的**补救**（重跑/补证/宣布作废）不属本单，须机主定方向。
- 复算：`python3 scripts/promotion-inventory.py`；`python3 scripts/audit-promotions.py`（rc=1 为预期）。

## R6. 三个待载入的插件提交（重启后必须复核）

- `785fb9f` 车道认领修复；`5856494` 收口自动回收 + 回执保留；`0d1bf1a` **席位复发闸**
  （提交主题 `seat-recurrence: machine ledger + threshold escalation gate`，不是「闸内日志」）。
- 复核（三条，均有期望值）：`git log -1 --format=%s 0d1bf1a` 输出含 `seat-recurrence`；
  `grep -c "RECEIPT-ADDR-UNVERIFIED" .opencode/plugins/abathur-exam-runner.js` ≥1（在盘）；
  `ls -l .opencode/plugins/abathur-exam-runner.js` 的 mtime 晚于重启时刻（重启时刻由机主记录）。
- 行为验收：写 `.omo/exam-queue/verify-query.json`（`{"gen":"G84","item":"SR4-64","stage":"query"}`）
  并等一次 `[JOB-RECEIPT]`；期望 rc=0 且回执尾部含 `QUERY` 字样；`.omo/gate-blocks.jsonl` 可追加。
- 若未生效：无作业窗口重启 opencode（人类动作），不得在有作业时重启。

## R7. 卫生（部分已完成，余项待裁）

- 已做：tmux 旧会话清理过一轮，但交接时 `tmux ls` 仍有 **18 个空转会话**（复算：`tmux ls`，
  逐个 `tmux list-panes -a -F '#{session_name} #{pane_current_command}'`
  判空转——必须带 `-a`，否则只枚举当前 pane）；
  `/tmp/opencode` 449 个旧 txt 按 >72h 清理；
  `/tmp/abathur-loop-G82` 已回收（37 件验哈希）。
- 余项：`bench-sandboxes` 现 `113G`（比上次普查涨 9G）；10-20~10-31 档约 94G 未动。
  判据沿用：>14 天 ∧ 无活体进程 ∧ 状态零引用。**7 天档是否回收待机主裁**。
- 验收：`du -sh ~/.config/abathur/bench-sandboxes` 的数字与裁定一致。

## R8. 事故呈报（已交，如需修订走西比拉）

- 终件：`docs/REPORT-20261103-OWNER.md`（v4.1，sha256 `68a01381…`，sibyl `8e6c`/`868e` APPROVE）。
- 不要再改；若机主要求补充，改后必须重送 `sibyl_audit`。

## R9. 重构交接件的七轮驳回（已并入该件，不重复开环）

- 7 份回执全部 `INDEPENDENT`，全部 REJECT；最后一份 `sibyl-20261103T042224Z-a50a`。
- 残余 must-fix 已写进 `handoffs/HANDOFF-20261103-refactor-v2.md` 正文（基线条目集、算法单源、
  申诉判据、SR4-76 具名缺口）。
- **本件之后不再自动开第八轮**；如机主要求零驳回版本，须新会话按残余项逐条修。

---

## 执行顺序建议

1. R1（人类动作，最快解除「无 abathur 命令」状态）
2. R6（复核插件是否已载入；影响后续所有队列行为）
3. R2（G84 处置，二选一）
4. R3 → 移交 v2 W0（不单独动）
5. R4 / R5 / R7（需机主裁或人类签认）
6. R8 / R9 仅在被追问时处理

## 禁止事项

- 不得回滚或提交 R3 的 10 条改动（归属 v2 W0）。
- 不得 `npm link` 或符号链指向工作树。
- 不得在有作业运行时重启 opencode 或重建 `dist/`。
- 不得修改 `ACKNOWLEDGED-FOREIGN-COMMITS.txt` 的 sha 行。
