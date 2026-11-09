# Abathur 计划模板（本仓自持）

本文件是阿巴瑟座席计划工件的**唯一模板权威**。`scripts/plan-check.mjs` 按本文件校验计划；
计划作者按本文件书写。模板最初从外部脚手架一次性导出八节标题，此后由本仓自持，
不跟随外部工具漂移（L-SINGLE-SOURCE：标题的权威在本文件，不在任何外部包）。

八节标题**逐字固定、顺序固定**：

1. `## TL;DR (For humans)`
2. `## Scope`
3. `## Verification strategy`
4. `## Execution strategy`
5. `## Todos`
6. `## Final verification wave`
7. `## Commit strategy`
8. `## Success criteria`

---

## TL;DR (For humans)

最后写。用非工程语言说明：交付什么、为什么这样做、**不会做什么**、工作量与风险。
禁止出现文件路径、任务编号、波次名、工具名。机读行保留：

`> TL;DR (machine): <工作量> · <风险> · <交付物>`

## Scope

### Must have

逐条列出必须存在的交付物，每条可被 `## Verification strategy` 中的一条判据验证。

### Must NOT have (guardrails, anti-slop, scope boundaries)

**非空**。至少一条。写法：禁用动作 + 原因 +（可选）替代路径。
本仓常用三条：不复制旧码冒充重构；不打补丁（修复必须落在某类机制里）；
不触碰生产安装、远端与主树已跟踪面（W0 白名单之外）。

## Verification strategy

> 零人工干预：所有验证由座席执行并落盘回执。

- 测试决策：TDD / 测试后置 / 不适用（须具名理由）。
- 判据形式：每条 = 命令 + 期望 rc + 输出关键行。
- 回执落点：`<state>/evidence/<slug>/<step>.log`，记录绝对路径与 sha256。

## Execution strategy

### Parallel execution waves

按依赖分层。每波 3–8 个任务；少于 3（最终波除外）说明拆分不足。

### Dependency matrix

| 任务 | 依赖 | 阻塞 | 可并发 |
| --- | --- | --- | --- |

波次无环：任务只能依赖**严格更早波次**的任务。`plan-check.mjs` 机械判定。

## Todos

> 实现与测试是同一条任务，不拆开。任务行必须**顶格**（列 0），形如 `- [ ] 12. 标题`。
> 缩进行属于该任务，字段名固定。占位符 `<...>` 一律禁止（计划必须是决策完整的）。

每条任务必须含以下字段（缺一 `plan-check.mjs` 即 rc=1）：

- `Class:` 所属方法学类，取值 `A`–`H` 或 `P`；可写组合如 `A/C`。
- `Clause:` 本任务实现的条款 id（与 `rules/registry.yaml` 对应）。
- `Wave:` 波次号（整数，从 1 连续）。
- `Depends:` 依赖的任务编号，逗号分隔；无依赖写 `none`。
- `What to do / Must NOT do:` 动作与禁令，面试官无上下文，写全。
- `References:` 证据或源码位置（`path:line`）。
- `Acceptance:` 可执行判据，命令 + 期望 rc。
- `Evidence:` 回执落点（含 `/` 的路径）。
- `QA:` 快乐路径 + 失败路径各一，写清工具与调用方式。
- `Commit:` `Y` + 提交信息格式，或 `N`。

## Final verification wave

> 全部任务完成后并发执行。全部 APPROVE 才算完成；结果呈报后等机主明确放行。

- [ ] F1. 计划合规审计（逐条对照 Acceptance 与实际回执）
- [ ] F2. 代码质量复核（类型、测试、无死代码、无复制）
- [ ] F3. 真实手工 QA（实际使用系统，不只看测试）
- [ ] F4. 范围保真（Must have 全在、Must NOT have 全无、无额外扩张）

## Commit strategy

写清提交粒度、消息格式、哪些产物不入库（`<state>/**` 等）、回执如何锚定。

## Success criteria

逐条可复算。每条 = 判据 + 命令 + 期望输出。禁止「基本完成」「大致可用」类措辞。
