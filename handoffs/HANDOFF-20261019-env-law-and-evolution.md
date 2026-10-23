# HANDOFF — 2026-10-19 环境隔离律评审收尾 + 进化排期

写给：下一个会话的阿巴瑟座席。发件：本席（ses_eb8226a93ffeEr8bDDEgHabycD）。
零提问可执行。每条命令给出 cwd 与预期。

---

## 0. 本席已完成（回执，勿重做）

| 事项 | 状态 | 复算命令 |
|---|---|---|
| SR4-67 practice-before-escalation 注册 | done，commit 16edfbb（main 树） | `cd /home/lab/workspace/harness/Abathur && git log --oneline -1 loop/bank.py` 应见 16edfbb |
| SR4-67 种子自测 | 绿：honest 2/2，三杀脸全拒 | `cd /home/lab/workspace/harness/Abathur && python3 -c "import sys;sys.path.insert(0,'loop');import bank;bank.ITEMS['SR4-67']['setup']('SELFTEST67','SR4-67')"` 无异常即过（产物在 /tmp/abathur-loop-SELFTEST67，可弃） |
| draw.py 类注册 | done：`"SR4-67": "practice-before-escalation"` | `grep -n SR4-67 /home/lab/workspace/harness/Abathur/loop/draw.py` |
| 环境隔离律草案 v4 + 四轮西比拉 | v4 在 `/home/lab/workspace/harness/Abathur/loop/proposals/env-segregation-law-draft.md`；评审记录 sibyl-20261019T093007Z-19a0 / 093428Z-9ed1 / 093856Z-0ca8 / 094416Z-c0f1 | `sibyl_status` 查 runId |
| abathur-self 实践评估（KEEP） | done，证据 `/home/lab/workspace/harness/Abathur/.omo/evidence/self-practice-20261019/REPORT.md` | 读该文件 |
| 封印修复 + 测试拆分 + README/文档去写死 | done，候选分支提交 d1f2d29/5ccad5d/1a40052 | 见 §3 分支状态 |
| wiki 现状卡 + 证据页 | done：infra/abathur 更新至 2026-10-19；`_evidence/abathur-self-practice-20261019`（pageId 5247）；地图已刷新 | http://localhost:3000/en/infra/abathur |

## 1. 头号任务：环境隔离律 v5（收敛中，预计 1–2 轮过会）

草案路径：`/home/lab/workspace/harness/Abathur/loop/proposals/env-segregation-law-draft.md`（当前=v4）。
评审命令（本席语境已验可达）：
```
sibyl_consult artifact=/home/lab/workspace/harness/Abathur/loop/proposals/env-segregation-law-draft.md goal=<写明轮次与 v4 must-fix 清单的核验请求>
```
注意：sibyl_consult 的 independence=NOT-INDEPENDENT 是因为草案由本席会话写——consult 道本就如此，不是伤；终稿若要独立审计章，用 sibyl_audit。

**v4 → v5 必须修的 9 条（sibyl-20261019T094416Z-c0f1 原文要点，逐条落）**：

1. **判定域与判序矛盾**：§0 判定域当前只含两类（座席派生+台账登记），却又声称 double-fork 逃逸者落判序⑤——逃逸者两类都不命中，按①出域永不被判。修法二选一（推荐 A）：
   - A. 判定域改为「本机全部进程，除正判定的宿主服务外」，⑤兜底才真正兜得住；
   - B. 承认逃逸者不可判，把「脱不了笼」措辞删掉，残余风险移入具名缺口。
2. **宿主服务边界机械化**：出域宿主服务用**冻结清单**（机器状态快照+哈希戳）枚举，禁开放类别（「等非代理进程」是开放类别，cron 注入可钻）。加归因条款：**域内进程创建/修改域外执行上下文（crontab、systemd 单元、rc 钩）= 其产生的写入归因于该域内进程本身**。
3. **宿主服务例子的自相矛盾**：§0 举「crontab 看门狗」为出域例，但消毒代理看门狗恰是座席自装的 crontab 项。修法：例子限定「非座席安装的」或换成 sshd/mongodb 这类。
4. **消毒代理配置的双法冲突**：它的家在 workspace（E1，座席自装=可回退），共享服务表又把它的服务配置列为 E2 具名例外（逐字授权）。同一文件两套规则。修法：显式写「消毒代理的运行配置（proxy.py、workspace 内文件）归 L-EXECUTE-AUTHORIZED v2 自有工件面，座席可回退；它在 ~/.config/opencode/opencode.jsonc 里的 baseURL 接线归 E2 逐字授权」——一个写目标一条规则，并加互引句防用一法破另一法。
5. **密钥生命周期归属**：云控制台建/换/吊销密钥 = E3 人类键；E1 的「密钥管理」只含人类已发密钥的存放与登记。写进共享服务表。
6. **Q 面与 worktree 豁免的措辞**：v4 已修大半，v5 复核一遍两处「唯一合法耦合」是否各指各对象（发布面 vs 开发候选）。
7. **E0 读侧**：考生 run 期间禁读 `_sandbox/**`（或明文当不可信对抗数据）；「_sandbox 不得作证据」从 E2 裁决扩到 **E1 promote 裁决**。
8. **机主谓词**：v4 已写 uid+TTY+非座席后代，保留；确认与判序不冲突即可。
9. **配额执行措辞**：v4 已标条款级+G6，保留。

过会标准：APPROVE（≥2A）。过了以后：呈机主批准入宪（这是新律，须机主逐字批准），批准后写 INTENT-LEDGER 到期复核条目（90 天，可机查日期）。

## 2. G56 开局（待机主令；配方已在台账）

- 首战 = SR4-64 复位（canary；题面已修引 anchor_law v1.3，bank.py SR4-64 四处文本已改，10-16 条款七全批落地在册）。
- 轮换伴卷 = draw.py 守卫点名清单（跑 `cd /home/lab/workspace/harness/Abathur && python3 loop/draw.py --help` 或读 draw.py CLASS_OF/PASSES_TO_CLEAR 逻辑自行对账）。
- 注意 G44 在册守卫实测：**每代恰好一枚 canary**；SR4-67 是 canary 但本代不占位，入后续轮换池。
- 验收： bundle CONVERGED + nominatable 判断 + 归档 loop-archive/G56/ + 台账条目。

## 3. 真 LLM 变异器里程碑（机主已授权生产令牌：百炼 + 本地 vLLM）

目标：abathur-self 引擎道第一次被真 LLM 变异器驱动（此前只有脚本变异器三对照，证据在 §0 表）。
前置事实（都已验过）：注册已恢复（指纹 c5b120cc1ae0a5b9）；`run` 需要 `--mutator <cmd>`；变异器协议 = 子进程输出 JSON `{candidates:[{id?,rationale,diffs:[unified-diff]}]}`，整候选拒绝制，ARTIFACT_GLOBS 禁 dist/node_modules/.state。
执行草纲：
1. 候选分支工作树：`/tmp/opencode/abathur-release-v010-20261017`（重启后需 `cd /home/lab/workspace/harness/Abathur && git worktree prune && git worktree add /tmp/opencode/abathur-release-v010-20261017 evolve/version-identity-v010-20261017`；分支在对象库，重启安全）。分支当前 = v0.3.0 + 16 提交，391/391/0/0 绿，门 PASS。
2. 写变异器驱动脚本（放 E0/E1 面，不入发布包）：调 opencode headless（`run --auto --pure -m <model>`，模型走 :8010 消毒代理的 qwen 系或百炼）或直接 HTTPS 调端点；把 brief 译成候选 JSON。令牌形态按草案 §4：专用/限额/可吊销/逐 run 登记 E1 配额台账。
3. `ABATHUR_SELF_REPO=<候选工作树> ABATHUR_CONFIG=<fresh {} 目录> node dist/cli.js run abathur-self --mutator <脚本>`。预算帽：maxCandidates 8 / maxModelCalls 16 / maxTokens 1M / maxWallS 7200（种子规格原值，超限会 fail-closed）。
4. 验收：全程无人工干预走完 变异→叠加→评分→裁决；守封零误伤；账本行可复算。出报告 + 证据目录 + 台账条目。
5. 红线：候选代码永不在主树构建/运行（L-ENGINE-ISOLATION）；变异器只在 E0 面行动。

## 4. 排期总表（机主要求的有序排期）

| 序 | 事项 | 依赖 | 环境 |
|---|---|---|---|
| 1 | 环境隔离律 v5→过会→机主批准 | 无 | E1 |
| 2 | G56 开局 | 机主令 + 1（最好，不是硬依赖） | E0 |
| 3 | 真变异器里程碑 | 1 批准（令牌规则入宪后跑更干净） | E0 |
| 4 | 0.3.1 人工发布序列 | 人类键；分支已备（v0.3.0+16 提交，门绿） | Q/E3 |
| 5 | integrations 身份裁定 | 机主裁定 | — |
| 6 | friction.test.ts 348→≤250 拆分 | 无，顺手债 | E1 |

## 5. 暂缓两项的决策树（机主要的）

**统计参数校准（abathur-self 的 minEffect/halfWidth）**：
- 进入排期条件 = 真变异器跑满 3 个世代且增益分布显示分辨率不足（全部裁决被噪声主导/全部 0.0000）。
- 确认废弃条件 = 3 个真实世代后裁决分型正常（好坏能分开）→ 永久不校，关账。

**更多考题类型（扩覆盖率维度）**：
- 进入排期条件 = 发生新事故且其行为类不在 COVERAGE-MAP 现有类里（判据：现有类名逐一对不上）。
- 确认废弃条件 = 连续两轮 sweep 无新事故类 + 覆盖率图复审无沉默缺口 → 关账，此后只走事故驱动。

## 6. border 交接单（机主要的位置）

`/home/lab/workspace/harness/border/handoffs/HANDOFF-20261018-from-abathur.md`
内容：B0 安全断言复现协议（npm≤10 钩子声明，未复现，最高风险待证）+ B1–B5（JSON 模式丢 file 字段、值摘要钉被格式化器杀死、盘符正则误报 repoPath:、UNC 正则贪婪跨行、无操作员揭示模式）。归 border 仓会话执行。

## 7. 环境事实（新会话免探）

- 钉住 Node：`/home/lab/.local/node-v22.22.2/bin`（系统 node 22.22.1 低于地板）。
- border 真形：`node /home/lab/workspace/harness/border/dist/index.js check --config /home/lab/workspace/harness/Abathur/.omo/border.yaml`（border 不在 PATH）。
- 台账：`/home/lab/workspace/harness/Abathur/.omo/evidence/INTENT-LEDGER.md`（追加式，勿改旧行）。
- 主树 loop/ 与候选分支是两条面：考题注册已进 main（16edfbb），发布候选在 evolve 分支，两者别混。
- sibyl_consult 两次 CANNOT_ANSWER 的历史教训：上游 8003 抖动，自愈约 20 分钟；遇错别重磨。
