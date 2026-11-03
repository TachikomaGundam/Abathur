---
name: abathur-plan
description: 进化座席计划能力操作手册（PLAN-SEG 协议）。当需要制定/执行/审计多段工作计划、登记计划开工与段末回执、恢复中断的计划时加载。触发词：计划、PLAN-SEG、五格、分段执行、plan、断点恢复、计划漂移。
---

# 进化座席计划手册（PLAN-SEG）

单一权威设计件：本仓 loop/proposals/planning-capability-design-20261022.md（v5，评审过会）。本手册是操作面；冲突时以设计件为准。

## 何时要计划（意图路由）

- CLEAR（目标、路径、验收都明确）→ 直接干，免计划。
- 影响 >1 文件、或触共享可变面（活 wiki/共享 git 树/机器账本）→ 必须有计划。
- 目标模糊（UNCLEAR）→ 宣布默认解释+边界条件+翻案信号，再动手。
- 同计划累计触碰不同文件 >3 或新增跨仓依赖 → 升格重写计划；跳升格须在账本显式声明理由。

## 计划工件：五格

`目标 / 路径 / 验收 / 禁项 / 回滚`，每格一行 `格名=值`。
- 占位符禁令：值不得为 `无/N/A/TBD/待定/略`；路径格至少一个绝对路径；验收格必须是一条可复算命令；禁项格写禁令或 `不适用=引用<条款号>`（裸「不适用」违规）。
- 三种语境：单代考题（PLAN-SEG 即计划，豁免五格工件）；战役（五格全）；架构（五格+评审）。

## 执行缝：PLAN-SEG 台账条目

字段间以 ASCII 0x1F 分隔，顺序固定，值单行（换行写字面 `\n`）：

```
[PLAN-SEG]␟plan=<前16hex>␟seg=P<n>␟目标=<短句>␟路径=<绝对路径空格列表>␟验收=<单条命令>␟禁项=<短句>␟回滚=<短句>
[PLAN-SEG-END]␟seg=P<n>␟cmd=<命令原文>␟exit=<码>␟log_sha256=<64hex>
```

- plan 哈希：五格值逐格 trim + NFC，按 `目标\n路径\n验收\n禁项\n回滚\n` 拼接，UTF-8 sha256 取前 16 hex。
- 段输出必须 tee 落盘（`.omo/evidence/plan-segs/<seg>.log`，stdout+stderr 同落盘）；END 条目记该文件的 sha256——审计方对文件重算，不信自报。
- 段号 P1 起连续；同账本只允许一个 plan 哈希（多版本冲突须先裁定）。
- 计划漂移检测：对计划工件现文件重算哈希，与台账不符 = 停段、重宣布、记伤。

## 机械校验

```
node skills/abathur-plan/plan-seg-check.mjs <账本文件> [--plan <计划工件>] [--seglogs <目录>]
```

rc=0 通过；rc=1 逐条 VIOLATION；rc=2 用法/环境错。判定面：字段齐备顺序、段号连续、五格非占位、plan 哈希匹配、END 回执格式与日志哈希。它判「生没生、碰没碰计划外的文件」，不判「做得对不对」。

## 诚实边界

此协议是留痕+可审计，不是物理拦截。单席极端压力下可跳过——压力服从性归考题面（SR4-69 族）。执行段实际触碰文件集合必须是该段路径格的子集（审计者自工具记录取）。

## 四段生命周期（draft → plan → review → execution；自 v2 重构起生效）

本节只增不改：上方五格协议仍是执行段的落账格式；本节在它之上增加计划的生命周期。

### 1 草案 draft
- 落点 `.omo/drafts/<slug>.md`。必填字段：`intent` / `classification` / `plan_path` / `status` / `next_action`。
- 新会话恢复时第一步完整读该文件，从字段继续；禁止凭聊天记忆重建状态。
- 状态机：`drafting → awaiting-approval → planned → reviewing → approved → executing → closed`。

### 2 计划 plan
- 落点 `.omo/plans/<slug>.md`。模板权威是 `docs/PLAN-TEMPLATE.md`（八节标题逐字、顺序固定）。
- 机械门：`python3 loop/plan_check.py <计划绝对路径>` 必须输出 `PLAN-CHECK OK ... rc=0`。
- 每条任务顶格书写，至少含：`Class:`（A–H 或 P）、`Clause:`、`Wave:`、`Depends:`、
  `Acceptance:`（命令 + 期望 rc）、`Evidence:`（路径）、`QA:`。
- 波次无环：任务依赖必须严格位于更早波次。

### 3 独立评审 review
- 调用 `sibyl_audit(artifact=<计划绝对路径>, goal=...)`，必须 `verdict=APPROVE` 且 `independence=INDEPENDENT`。
- 回执绑定计划 sha256；计划字节一变，旧回执失效，必须重审。
- 同一文档两轮 REJECT → 上呈机主，附全部回执；不自动开第三轮。

### 4 执行 execution
- 每波三件套：机器判据通过（回执落盘）/ `rules/registry.yaml` 增条款（含 check + exam_item 或 no_exam_reason）/ `.omo/evidence/` 落证据（绝对路径 + sha256）。
- 段末沿用上方 `[PLAN-SEG]` / `[PLAN-SEG-END]` 条目：命令原文 + exit + log sha256。
- 波次来源=计划的 `## Execution strategy`；实际与计划漂移即停段、重宣布、记伤。

