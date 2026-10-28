# HANDOFF-20261023 阿巴瑟座席交接件（接续会话用）

## 当前状态快照（全部为机器可核实事实）

- 引擎：npm latest=0.4.1（d762c16e，OIDC 发布）；0.4.0 已 deprecate（声明面事故）；0.2.8/0.2.9 已 deprecate（污染）。主树 main HEAD=41367f3（版本字段 0.4.1）。
- 测试基线：412 pass / 0 fail / 1 skip。
- 本机装机：~/.npm-global 0.4.1，属主 lab（R-ISO-2 已执行后按事故庭裁撤销）。
- 发布租约：free。无 campaign 在跑。
- 五线分离：仓级 AGENTS.md 六件齐（PCB/historian/hr/SimpleCut 四件在各自工作树未提交——各线座席复工时自行提交）。crontab 史官沙盒清扫行去留待机主裁。

## 宪法/规则面

- 全局 ~/.config/opencode/AGENTS.md：通用纪律+座席登记+L-LINE-BINDING+L-INVARIANT-FIRST+B1 委派模板+四隔离效力头（L-ENV-SEGREGATION 条文以仓内提案为准）。
- 仓级 AGENTS.md（本仓）：开工三步+职责面+计划面（PLAN-SEG，skills/abathur-plan/）+部署注记+晋升条款档案。
- 计划能力：SKILL.md+plan-seg-check.mjs 已随 0.4.0 入包；SR4-69 考题在库（非 canary）。

## 优先队列（按序）

1. **四隔离条款 v9**（loop/proposals/four-isolation-law-draft.md）：机主四裁决已入（裁决权=西比拉三席不硬编码/R-ISO-2 全案/R-ISO-3 调研结论）。v8 八轮评审的剩余 must-fix（编号/TOCTOU 等精度级）+v9 新增内容是否再送一轮评审=待新会话判断；机主立场「V8可以继续改进」。
2. **R-ISO-3 三件套落地**：调研报告 v3（.omo/evidence/human-signature-research-brief-20261023.md）——第二 Unix 账户+sudoers 密码化+ptrace/pts/X11 封堵+凭据轮换（必经！）+人类执行 setup。落地主体=机主（人类键），座席出处方+验收探针。
3. **G56 考代**：待机主令。抽签守卫=每代恰一枚 canary；SR4-68/69 已注册。
4. **真 LLM 变异器里程碑**：候选工作树 /tmp/opencode/abathur-release-v010-20261017（分支 evolve/version-identity-v010-20261017，14 提交 391 测试绿——接手先重验）。
5. **0.4.2 候选**：loop/proposals/engine-ops-incident-units-20261022.md（事故教训单元）；发布门禁矩阵在 docs/release/CHECKLIST.md。

## 关键教训（本 session 血泪）

1. **压缩摘要会伪造已完成的工作**——SR4-68 由此诞生。一切「已完成」以磁盘/git 实测为准，不信摘要（包括本交接件——接手先探测）。
2. **先答后审**：西比拉只审成品答案卷，不答委托问卷（两次 0A/3R 学费）。
3. **评审意见吸收时必须全文一致性回查**——v7 曾因吸收引入双定义矛盾被三席同抓。
4. **git add -A 在发布制件里会扫进未跟踪杂物**——用精确枚举。
5. **npm pack 硬带 .github/**——files 只能显式列举。
6. **sudo npm -g 前缀漂移**：必须 --prefix 显式。
7. **同 uid 无边界**：NOPASSWD sudo+ptrace+座席持 gh 键=本机一切「人类批准」标记宣称级（R-ISO-3 前）。

## 本 session 初衷评估（对照 HANDOFF-20261019）

| 初衷项 | 结果 |
|---|---|
| 环境隔离律过会入宪 | **达成**（v9 过会 2A/1R，效力头入宪，90 天复核条目在账，到期 2027-01-17） |
| G56 开局 | 未动（机主未下令；SR4-64 已复位 canary） |
| 真 LLM 变异器里程碑 | 未动（排队） |
| 0.3.1 人工发布 | 被超越：0.4.0+0.4.1 已发布 |

**超出初衷的完成面**：耦合三问治理+插件纪律层（0.4.0 六组件）、计划能力制度化（v5 过会+入包）、SR4-68 考题、五线分离工程、0.4.0 发布+安装面事故+0.4.1 热修全闭环、复工总清查。
**评估**：初衷达成。代价=两起生产事故（发布污染变体/安装声明失实）与多次当场被抓的处方错误——能力进化了，但纪律事故率仍是主要缺口。
