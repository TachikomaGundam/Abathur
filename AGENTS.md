# Abathur 仓级规则（本仓=阿巴瑟进化引擎+考场，opencode 在本仓工作时自动加载本文件）

本文件是本仓项目义务的**唯一权威面**。全局宪章（~/.config/opencode/AGENTS.md）只载通用纪律，不下达项目任务。两文件冲突时：通用纪律以全局宪章为准，项目事实以本文件为准。

## 车道绑定（L-LINE-BINDING 的本仓落点）

- 本仓座席 = 阿巴瑟席（进化司机）。他线座席（AIHR/PCB/史官/SimpleCut 等）进入本仓 = 客席：只读 + 最小语义修正（L-GOVERNANCE-REMEDY 规矩），不得动本仓的门条款、不得向本仓直提非本线代码。
- 已知越界在案：2026-09-30 graders/pcb-agent/ 整目录混入本仓（迁移工单：handoffs/GRADERS-MIGRATION-pcb-agent.md）；2026-10-22 晚三个跨线提交（5ff6b2b/96b618d/54883cf，保留至迁移执行）。
- 座席总表以全局宪章「座席登记」节为单一权威源。

## 开工三步（本仓版）

1. 读台账尾：.omo/evidence/INTENT-LEDGER.md（追加式证据账本，哈希链见 .omo/anchor/chain.md 协议；条目须带线标，如 [line:abathur]）。
2. 动 loop/bank.py 或共享树面前：双通道占用探测（pgrep -af 'abathur run' + ps 交叉）。占用=排队，绝不写。
3. 动 harness 状态前：查机构记忆（historian_read/historian_search），页过期就在笔记里标过期，不默信不默改。

## 本仓职责面

- 引擎：src/（TypeScript，node:test；npm test = 构建+全量）。生产 campaign 只跑已发布冻结安装，工作树开发不替换生产（L-ENGINE-ISOLATION）。
- 考场：loop/（bank.py 考题库、draw.py 抽签、宪章快照、proposals/ 提案）。
- 发布：隔离 checkout 制件（L-RELEASE-TREE-ISOLATION），scripts/release-lease.sh 拿轮，.git/hooks/pre-push 强制收据+租约；main 永远钉最后发布版，版本颠簸只在发布支。
- 证据：.omo/evidence/（台账、smoke、loop-archive、调研报告）。临时文件卫生是交付物的一部分。

## 环境真相（机器实测，更新时改写日期）

- 引擎 CLI 全局安装=npm 冻结版（发布包）；工作树构建=node dist/cli.js。两版本不一致时以 `node dist/cli.js --version` 与 `abathur --version` 双读为准。
- repoPath 含 ${VAR} 字面量的基因组，先导出对应 ABATHUR_*_REPO 环境变量再跑任何 repoPath 相关命令（引擎在 FS 缝解析，不设则 fail-closed exit 2，这是设计不是故障）。
- 活 wiki（http://localhost:3000）读为主：_sandbox/** 可自由写，内容页写/删需机主明确确认。
- 本机边检工具=border（不在 PATH，真形：node /home/lab/workspace/harness/border/dist/index.js check --config <绝对路径>）——本机个例，写进可移植面时只准称「门检工具」（L-MACHINE-LOCAL）。

## 监督教义（进化回路自我审计，2026-09-21 修订）

进化对象不只是被测基因组，监督者自己的判断也在范围内。三条已命名失败：只测可测不测重要；在工件上收令而非意图上收令；从不审计尺子。对应长期对策：意图台账（令以机主原话+验收判据登记，工件交付不收令，判据满足才收）；覆盖图先于课程主张（无题维度=具名缺口+计划，不许沉默）；尺子健康检查（同行为双跑噪声探针+结构公平检查，伤尺退役要响亮）；abathur-self 有自己的考道（监督失败即考题素材）。
