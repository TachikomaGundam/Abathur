# 设计提案：放出子进程的完成回执机制（spawn-completion-receipt）

日期：2026-10-23。提出触发：机主当日指出「你放出的 session 没有触发你继续进行下一步的回执，如同 opencode 里 subagent 一样」。

## 1. 不变量与病类（L-INVARIANT-FIRST）

**要恢复的不变量**：每一个被座席放出的 loop 子进程（candidate/judge），在持久注册表里必有恰好一条 start 记录与恰好一条终态回执（exit）；任何座席、在任何会话、不问任何人，都能机械回答三个问题——谁在跑、谁跑完了待收割、每件事的下一步是什么。

**要消灭的病类**：孤儿 campaign。子进程脱悬（nohup/setsid，父进程=1）后，终态只落在 /tmp 散文件里，没有任何跨会话可发现的完成信号；「继续下一步」靠座席人肉 ps 轮询。会话一断，run 无人收割，且叙事面与磁盘漂移无法被机械校验。

**实锤两案**：

1. 2026-10-23 G58：上一席 19:27 台账声明开跑 SR4-64+SR4-65，19:44 交接件写「无 campaign 在跑」，19:45 考生会话实际启动——交接件与磁盘直接冲突，新席靠手动 `ps` 才撞见在跑进程（pid 429334 / 511257 / 582760）。
2. 2026-10-12 G45 窗监督事故（已在册）：nohup 组杀连坐 + pgrep 自匹配假报 5.2 小时——人肉探测这条路本身已被判过病。

## 2. 现状机制（探测所得，2026-10-23）

- `loop/run_candidate.py`：终态写 `candidate_state.json`（COMPLETE / INFRA_FAILED）于 `/tmp/abathur-loop-<gen>/<item>/harness/`。
- `loop/run_judge.py`：终态写 `judge-work/verdict.json`。
- 两者终态都只在 run 目录内；没有任何注册表、没有给座席的回执、开工三步的占用探测是裸 `pgrep`（G45 已证其假报病）。
- opencode 侧本就有后台任务完成通知（background task 机制）——座席放跑时没用它，用了 nohup 式脱悬。

## 3. 设计（R1–R5）

- **R1 注册表**：新增 `.omo/evidence/loop-runs.jsonl`，append-only 证据账本（归 L-STATE-ATOMIC/L-WRITE-ORDER 管辖，flock 串行，内容不经 shell 展开）。行 schema：`{ts, gen, item, role(candidate|judge), event(start|exit|harvested), pid, pgid, rc, state_path, state_sha256, note}`。
- **R2 runner 埋点**：`run_candidate.py` / `run_judge.py` 启动时写 start（pid/pgid/时刻/会话标题）；`try/finally` 保证一切退出路径（含 REFUSAL、INFRA_FAILED、异常）都写 exit，并携带终态文件路径+sha256 配对。埋点代码是 runner 自有义务，不靠座席记得。
- **R3 开工机械检查**：新增 `loop/run_registry.py status`——读注册表，对每条 start 无 exit 的行做活体双源判定（`/proc/<pid>` 存在 ∧ cmdline 含 gen/item；禁用 pgrep，G45 教训），分类输出：RUNNING / EXITED-UNHARVESTED / ORPHAN-SUSPECT（无 /proc 且无 exit 回执），并对每项给出下一步动作（跑判卷 / 归档 / bundle 收尾 / 呈报）。仓级 AGENTS.md 开工三步第 2 步由裸 pgrep 换成它。
- **R4 会话内触发**：座席在会话内放跑一律走 opencode 后台任务（完成即通知，与 subagent 同机制）；脱悬 spawn 只作 fallback，且无论哪种方式 R3 都必须能捡到——回执不依赖通知通道存活。
- **R5 收割闭环**：收割动作（判卷齐→sweep archive→bundle close→台账收尾）完成后向注册表写 `harvested` 事件；start→exit→harvested 三段齐才算一run结清。

## 4. 五格计划（PLAN-SEG）

- **目标**：上节不变量落地；孤儿 campaign 病类机械可检出、可交接。
- **路径**：①`loop/run_registry.py`（新增）②`run_candidate.py`/`run_judge.py` 埋点（各一处 try/finally + start 写）③仓级 AGENTS.md 开工三步第 2 步改指 ④演练验收。
- **验收**：a) 演练——放一个真 candidate，中途杀席，新会话 `run_registry.py status` 必须报出 ORPHAN/待收割与正确下一步；b) exit 行 state_sha256 与磁盘终态文件重算一致；c) 双开写不串行损坏（flock）；d) `npm test` 全绿（若触及引擎面——本设计不触及，预期不跑引擎测试，只跑 loop 侧演练）；e) G45 式 pgrep 自匹配构造：status 输出零假报。
- **禁项**：实现不得在 campaign 占用期动 runner（等 G58 收工）；不引入守护进程/cron/systemd 监视器（域外执行归因问题，L-ENV-SEGREGATION 八项枚举）；注册表只是追加式证据账本，不升格为权威状态文件；不改动判卷/评分语义分毫。
- **回滚**：三件皆纯新增或单行改指，逐个可逆；注册表文件弃用即停写，无状态迁移负担。

## 5. 与既有条款的关系

- 对治 L-REPORT-UPWARD 谱系的「会话断档→叙事漂移」：注册表给交接件一面机械校验墙——「无 campaign 在跑」这类句子从此可被一行 status 输出证伪。
- 与 G44/SR4-63（接收席预检）互补：那条管工单进门前，本条管子进程出门后。
- 不放开任何键权；不改变 promote/tombstone 的人类门属性。

## 6. 待裁

1. 注册表落点：`.omo/evidence/loop-runs.jsonl`（本提案默认）vs 部署家 `${ABATHUR_HOME}`——前者随仓走、后者跨仓；考场是本仓产物，默认前者。
2. 是否送一轮西比拉评审（本文档自觉规模小、纯新增、不改语义；按近期先例由机主定）。
