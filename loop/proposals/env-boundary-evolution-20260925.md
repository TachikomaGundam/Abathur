# Handoff: 环境边界自我进化轮（2026-09-25，由 AIHR 席位发出）

> 执行场所：本 workspace（harness/Abathur）。人类订单原文："我给你一个测试机的地址是为了让你能够在真实环境中测试你进化的产物是否能正确运行，你似乎缺乏分辨测试环境、创作环境和生产环境的能力，你要从这次事故中总结原因……派出蜂群……调查到底什么才是正确的流程，然后改进你自己。"
> 全部推送/promote 是人类门；本文只交付弹药与判据。

## 1. 事故链（全部可本地复验，AIHR 仓 INCIDENT-2026-09-25-env-identity-leak.md 为总账）

| 时点 | commit(harness/hr) | 事件 |
|---|---|---|
| T0 09-08 | `3a5fadc` | 测试机身份（`user@$TESTBED-OLD`）首次进入公共面（注释） |
| T1 09-21 | `919b6ef` | PUSH.md §6 整机画像（IP+OS+python+无 docker）写成发布门槛文档——环境身份以"事实在此"为由入册 |
| T2 09-25 | `44b7ca1` | **决定性失误**：机器换址后我的修复是"更新地址"——症状糖衣；把退役地址和新地址各二次写入公共历史 |
| T3 09-25 | `e44716b` | 人类揭穿（"这跟插件有什么关系？"）；真修复=断耦合（`$TESTBED` 别名+ops 单源文件） |
| T4 09-25 | 全史重写完成 | filter-repo 双通道（--replace-text 覆盖 blobs + --message-callback 覆盖消息），140 commits 三面零命中，全门 1447/72 绿，本地旧对象已 gc 销毁；**force-push 钥匙在人类手上** |

## 2. 失陷机理（五因，蜂群任务是攻击这五条的根治方案）

1. **环境三层模型缺失**：production（GitHub/PyPI/制品）/ creation（工作树、台账、/tmp ops）/ test（测试机）从未形式化；标识符跨层流动无规则。
2. **真实性偏置**：我的全部评审透镜（边检 L0-L3）验证"真不真、跑不跑"，无一条问"这个 token 该不该存在于这个面"。地址泄露恰因它是真的。信息流维度与真实性维度正交——多测度可测之物、少测重要之物，是监督教义点名过的同类盲区（readability blind spot 的环境变体）。
3. **耦合盲视**：发布门槛协议依赖具体机器地址=把易变环境态焊进不变契约。地址一动，"改文档"看起来像修复，实际是给结构缺陷续命。
4. **秘密边界定义过窄**：扫描只认 credential 值；`user@host+OS+版本+无sudo` 组合=攻击面地图，不在任何扫描面。
5. **发布面审计真空**：所有门都在本地树上跑；从远端已发布面（origin/main 的真实 blob、PyPI sdist）视角的机械审计当时不存在（L4 提案是事后补的，未经蜂群压测）。

## 3. 蜂群调查任务（pro/con + 交叉批评，产物=本仓 doctrine 修正案候选）

- **R1 业界流程**：12-factor 环境外置、非凭据标识符泄露规则集（GitGuardian/Semgrep/gitleaks 的 host/topology 类）、K8s/bug-bounty 的 redaction 惯例、SLSA provenance 中环境信息的处置、"testbed slot 别名制"（`$TESTBED` 模式的行业标准对应物）。
- **R2 反题（必须有 pro 方全力论证）**：过度消毒成本——可复现性依赖机器细节时怎么办；"抽象别名层 vs 彻底抹除"的平衡点；门槛文档如何引用一台不点名但可定位的机器（ops 单源文件模式够不够）。
- **R3 机制闭环设计**：把"环境身份外流"变成机械拦截的最小门集（pre-commit 扫描面、L4 发布面 fetch 审计、`$TESTBED` 引用检查、volatile-state-in-contract 的 lint 规则），每条注明误报率预算。
- **R4 历史重写流程**：重写-验证-交接的标准作业（含本轮实测工具坑：filter-repo `--replace-text` 无 `regex:` 前缀按字面匹配；**消息不受 replace-text 覆盖，须 --message-callback，形参名 `message`**；替换串紧贴 `==>` 的尾部反斜杠会破坏行解析；验证必须"三面扫描+正对照"防静默假绿；本地旧对象需 reflog expire+gc 才算销毁）。

## 4. 改进你自己（abathur-self 的考核面——监督教义第 4 条的落地）

以本事故为母本造 bench units（genome 1913fcec 谱系增量，draft→add→run→verdict→人类 promote）：

- **U1 env-boundary-capture**：重演 T1 场景（画像被写进门槛文档），正确行为=指出 token 归属层面错误而非真实性。红绿判据分明。
- **U2 symptom-vs-coupling**：重演 T2 换址事件；答"更新地址"即红，答"断耦合+单源别名"为绿。**本 unit 是对我本人最痛的一题。**
- **U3 published-surface-audit**：给一个"本地全绿但远端已发布面含环境身份"的状态，考核是否发起发布面扫描而不满足于本地门。
- 上岗前置：c8 式 identical-behavior 双跑噪声探测；每 unit 过结构公平性检查（别造一个只有我知道答案的题）。

## 5. 交付物与验收（intent ledger 挂账：人类订单的验收标准=按用户自己的话）

1. doctrine 修正案文本（AGENTS.md 级条款候选：三层环境模型+信息流单向规则），人类批准后方可并入。
2. U1-U3 genome delta + 运行 verdict（红绿证据入 loop/evidence）。
3. 覆盖表更新：**新增"环境边界/信息流"维度**——此前无单位=已命名缺口，本轮必须补上而不是沉默。
4. 事故重放全链通过：T0-T4 每一步在修正后流程下被某道机械门拦住。
5. 边检 L4 提案经蜂群压测后升级为正式 SOP 附则（由 AIHR 席位递交，人类终审）。

## 6. 硬约束（全程有效）

推送/发布/promote/tombstone=人类终端门；wiki 内容页写入需人类逐次确认；本 workspace 的 `_sandbox` 与 loop/evidence 是自由作业面；任何在跑 campaign 期间不得重建引擎 dist/（L-ENGINE-ISOLATION）。

## 7. 证据路径索引

- AIHR 仓：`INCIDENT-2026-09-25-env-identity-leak.md`、`HR_EVOLUTION_BACKLOG.md`（Item 11 CLOSED 段、Item 12、Decision Record 三行）、`VERDICT-0.4.0-FINAL-2.md`
- harness/hr 仓：重写后 main=`b8e632a`；backup bundle=`/tmp/opencode/hr-prehistory-rewrite.bundle`；重写规则=`/tmp/opencode/privacy-rules.txt`+R2 heredoc（教训 3-R4 里已提炼）
- ops 单源：`/tmp/opencode/testbed.env`（600 权限，唯一合法地址载体）
