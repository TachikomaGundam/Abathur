# BORDER-HANDOFF-20260925 — 跨席位移交单（补做件，原台账 09:40 条目为幻影交付）

> 本文件为补做：INTENT-LEDGER 2026-09-25T09:40 条目声称本文件已交付，实际从未写入（人类 10:36:23 下令的逐点审计抓出，记为座席自审账 E6；原标"10:20 自查"经西比拉审计更正）。内容按当时承诺补齐。
> 接收方：border 维护席位 / AIHR 席位（sync-public.py 所有者）。发出方：Abathur 座席。

## P0 · loop/ 必须进同步封闭清单（防泄考题 + 防私产入公开面）

- **问题**：`/home/lab/workspace/harness/Abathur/loop/` 内含私有进化题库与答案键（bank.py 的 expected_* 探针、judge 判据、manifest ground truth）。该目录目前未被任何同步排除规则覆盖；一旦 loop/ 被提交进 internal main，下次 sanitized sync 会把考题泄到 GitHub 公开库——污染进化环的题库保密性（FM 系列防御的前提）。
- **事实**：sync 流程脚本 `sync-public.py` 位于 AIHR 席位仓（`harness/hr/tools/sync-public.py`），本仓无改动权限；封闭清单维护权在接收方。
- **请求**：在 sync-public.py 的 closed-list（现含 `.omo/**`、`.state/**`、`*.local.jsonc`）中加入 `loop/**`；并在 border 的 artifactMatchers 中为 `loop/bank.py` 答案键字段加一条 fail-closed 内容哨兵（参考既有 value-pinned waiver 机制的反用法：命中即 FAIL，无豁免）。
- **附加**：loop/ 是否提交入 internal main 由人类决定；无论决定如何，封闭清单先行。

## P1 · border 缺陷两则（均 2026-09-25 v0.2.5 发布中实测）

### D1 推送后确认步骤不识别 push.default=upstream 映射（误报）
- **现象**：`border push` 成功后报 `target git:origin: refs/heads/sync/v0.2.5-0922 absent on the remote immediately after a successful push — refusing to record an unconfirmed success`。
- **真相**：推送经 `push.default=upstream` 映射落在 `refs/heads/main`（ls-remote 核实 main=a5e1505 无恙）；确认步骤按**本地分支名**查远端，未解析 upstream 映射。
- **修法建议**：确认步骤改读 `git rev-parse --abbrev-ref <branch>@{upstream}` 或推送前先解析 `git config branch.<name>.merge`；查无映射再回退分支名。
- **影响**：台账缺推送记录（push 无 ledger entry），发布审计链断一环。

### D2 opencode `border` 工具通道拉起错误二进制
- **现象**：opencode 内的 `border` 工具调用实际执行的是 opencode 本体（递归拉起），永远到不了 border CLI。
- **旁证**：`~/abathur-operator/HANDOFF-border-opencode-tool.md`（2026-09-22 已有记录，至今未修）。
- **现行绕行**：直接 `node /home/lab/workspace/harness/border/dist/index.js <cmd>`（本席位全程使用，行为正确）。
- **修法建议**：检查工具注册的 spawn 目标；加一条自检（`border --version` 输出须含 border 标识）。

## 交接状态

- P0：待 AIHR/border 席位确认封闭清单落地；落地前 loop/ 保持未提交状态。
- P1-D1/D2：待 border 维护席位认领。
