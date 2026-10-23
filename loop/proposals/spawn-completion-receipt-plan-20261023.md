# PLAN-SEG 计划：spawn-completion-receipt 实现（2026-10-23）

设计件：loop/proposals/spawn-completion-receipt-design-20261023.md（R1-R5）。
批准：机主 2026-10-23 逐字令『全部依次执行』（含提案两项待裁的裁授权——注册表落点取默认 .omo/evidence/loop-runs.jsonl；实现先行、评审后补与否由呈报时机主定）。

目标=每个放出的 loop 子进程在 .omo/evidence/loop-runs.jsonl 必有 start/exit 配对回执，python3 loop/run_registry.py status 机械输出谁在跑/谁待收割/下一步
路径=/home/lab/workspace/harness/Abathur/loop/run_registry.py /home/lab/workspace/harness/Abathur/loop/run_candidate.py /home/lab/workspace/harness/Abathur/loop/run_judge.py /home/lab/workspace/harness/Abathur/AGENTS.md
验收=python3 loop/run_registry.py status 输出 RUNNING/EXITED-UNHARVESTED/ORPHAN-SUSPECT 三分类且 G58 遗留行配对正确 && node skills/abathur-plan/plan-seg-check.mjs .omo/evidence/INTENT-LEDGER.md --plan loop/proposals/spawn-completion-receipt-plan-20261023.md 退出码 0
禁项=不改判卷/评分语义分毫；不引入守护进程/cron/systemd 监视器（L-ENV-SEGREGATION 归因枚举）；注册表仅追加式证据账本不升格权威状态文件；只在无 campaign 占用窗口动 runner（当前已实测无占用）
回滚=git checkout -- loop/run_candidate.py loop/run_judge.py AGENTS.md && rm loop/run_registry.py，注册表文件弃用即停写

## 段划分

- P1：新建 loop/run_registry.py（append_event + status + mark-harvested，flock 串行，/proc 双源活体判定，禁 pgrep）
- P2：run_candidate.py / run_judge.py 埋点（start 于入口，exit 于 try/finally，携带终态文件路径+sha256）
- P3：AGENTS.md 开工三步第 2 步改指 run_registry.py status + 演练验收（构造 start 无 exit 行→status 须报 ORPHAN-SUSPECT；exit 行 sha256 与磁盘重算一致；plan-seg-check rc=0）
