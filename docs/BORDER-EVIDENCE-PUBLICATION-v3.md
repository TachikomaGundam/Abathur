# 证据发布方案 v3（取代 v2；回应 `sibyl-20261102T054147Z-9536` 的 15 条 must-fix）

状态：待独立审。作者=阿巴瑟席。日期=2026-11-02。基线提交 `d1f4d01302484195856f9532cdedcf2fa0f0900a`。

## 0. 决策（单一，不是菜单）

**P3**：新建公开仓，发布集=**基线提交 `d1f4d01` 的导出树减去 `evidence/`**；证据只进内部仓；公开面附清单（含提交指针）。

**在此基线该 P3 还不能过闸**：代码侧有 **46** 条阻断命中（详见 §4）。本方案不假装能过，先点名这 46 条与解法。

## 1. 实测事实（脚本已入仓，可复算）

复算工具：`/home/lab/workspace/harness/Abathur/scripts/border-findings-agg.py`，sha256 `08be55ec80cc126a6d70193cc15a8a9b40ede7a2572c0b68fa09fec5600869be`。
输入：`border check --json` 输出（主机侧跑，本次落在 `/tmp/opencode/border.json`；**报告文件本身是易失的**，见 §9 缺口 1）。

| 事实 | 值 | 命令（逐字可跑） |
|---|---|---|
| 严重度闭合 | CRITICAL 8933、MEDIUM 4593，合计 13526 | `python3 scripts/border-findings-agg.py <报告> severity` |
| 位置分布闭合 | 7409 evidence/ + 773 loop/ + 472 .omo/ + 87 顶层 + 64 handoffs/ + 44 scripts/ + 43 src/ + 19 docs/ + 9 归档 + 5 graders/ + 4 .opencode/ + 4 无路径 = **8933** | `… table`（内含 `assert ==`） |
| 规则类闭合 | path **8372**、content **561**，合计 8933 | `… classes`（内含 `assert`；未分类规则直接断言失败） |
| content 细分 | ai-session-artifact 382 + exfil-rfc1918 126 + generic-api-key 32 + exfil-ssh-target 15 + identity-not-allowlisted 4 + aws-access-token 2 = **561** | 同上（by rule 表） |
| 公开 tip 路径命中 | **46**（path 39 / content 7） | `… tip --repo <仓> --ref origin/main` |
| 祖先命中 | **136**（全是 content 类） | `… ancestry --repo <仓> --ref origin/main` |

## 2. 为什么 8933 不是「发布集」的数字

闸扫的是**工作区**（报告里自带 `working tree is dirty`）。工作区含 `.omo/`（未跟踪）与 `evidence/`（跟踪但不发布）。
发布集只有：**`git archive d1f4d01` 的树，去掉 `evidence/`**。
所以 8933 里 7409+472 属于不发布面；进入发布判定的是代码侧与文档侧，金额见 §4。

## 3. 46 条代码侧阻断：逐组处置

| 组 | 条数 | 类 | 实体（掩码/位置） | 处置建议 | 状态 |
|---|---|---|---|---|---|
| A | 37 | path | `src/**` 的正则字面量含 `\\\\…` 反斜杠路径模式（Windows 路径处理） | 判为**规则误报**：`path-pattern` 在正则源码上命中；建议上游精化（不把正则字面量当路径）。代码侧不改 | 待上游/待裁 |
| B | 2 | path | `README.md:275,556` 出现本机家目录示例 | **修文档**：改写成 `/home/<user>/…` 占位 | 可立即做 |
| C | 5 | content | `graders/historian/grader-core.mjs` 历史行 34/39/41 `VERIFY_* = "HIST11…"` | 夹具常量。机器依据：同文件相邻行是评分夹具路径常量（`_sandbox/eval10/...`）；值形不是任何厂商 key 格式 | 定性有据；**放行权归机主** |
| D | 2 | content | `src/test/fixtures-wt.ts:20` 的 git 身份夹具邮箱字段（用户名 + 分隔符 + 本地域，本文件不转录字面量） | git 身份夹具（同行是固定用户名），本地域形态 | 定性有据；放行权归机主 |

**结论**：P3 过闸在 B 修完 + A/C/D 获得具名裁定（上游精化或机主具名降级）后才可能。**我不自行豁免**。

## 4. 清单格式（含提交指针，已实现）

`scripts/publish-evidence.py`（sha256 `40ff014aa061738abd54c7f6b230d290fb810f0f990d3762a48fd2e83e4ff02c`）现写出 `evidence/<GEN>/MANIFEST.json`：

```json
{"commit": "<HEAD at publish>", "files": [{"path": "...", "sha256": "...", "git_blob": "..."}]}
```

实测样例：`/home/lab/workspace/harness/Abathur/evidence/G73/MANIFEST.json`（`commit=d1f4d013…`）。

## 5. 文件名白名单（已实现，不再是缺口）

同脚本内 `check_name()`：段长 ≤64、字符集受限、禁止 `@`、IPv4 形态、`://`、盘符反斜杠、深度 >3。
拒绝证据（实跑）：

```
REFUSED SR4-52/10.1.2.3.log      -> manifest name not publishable
REFUSED SR4-52/user@host.txt     -> manifest name not publishable
REFUSED SR4-52/a/b/c/d.json      -> manifest name too deep
OK   SR4-52/judge-work/session.txt
```

## 6. 验收口径

- 对象：**具名提交的导出树**（P3 首版=`d1f4d01`），不是工作区；裁决到发布之间树变了即作废，须重取基线。
- 判据：对该树跑 `border check` → `rc=0`（MEDIUM 允许）。
- **未验证项**：MEDIUM 是否真不阻断 rc，我只见到 `--help` 的文字（`0 pass (MEDIUM/INFO/LOW allowed) | 1 gate-blocked (CRITICAL/HIGH)`），**没有实测过 MEDIUM-only 场景**。按 must-fix，这里标 `UNVERIFIED-EMPIRICAL`。
- **当前验收未通过**：基线含 §3 的 46 条，预期 rc=1。本方案**不自称可过**。

## 7. 公开历史 136 条：机主二选一（并列，不预设）

- **H1 接受**：承认这 136 条永久公开（内容类：会话工件与内网地址形态），不清洗；
- **H2 清洗**：按既有历史重写流程处理公开仓，代价=改写公开历史、需机主持键。

## 8. 逐类处置（补 v2 缺失的 completeness）

| 类 | 条数 | 位置 | 处置 |
|---|---|---|---|
| path 类 8372 | 8372 | 主要是 `evidence/`（7409）与 `loop/`、`.omo/` | 不发布面，闸不会看到（待 §6 在导出树上验证，未验证） |
| ai-session-artifact 382 | 382 | `.omo/` | 不发布面；但公开历史有 136（见 §7） |
| exfil-rfc1918 126 | 126 | `.omo/evidence` 运行日志 | 不发布面；历史归属见 §7 |
| generic-api-key 32 | 32 | graders + .omo | 其中 5 条属 §3-C；其余在 `.omo/` 不发布面 |
| exfil-ssh-target 15 | 15 | src/test 夹具 + .omo | 其中 2 条属 §3-D |
| identity-not-allowlisted 4 / aws 2 | 6 | 不发布面 | 随 evidence/.omo 排除 |

## 9. 缺口（不藏）

1. `border check --json` 报告落在 `/tmp`，重启即失；本方案未把它纳入哈希链账本。**结论页数字依赖的输入本身未持久化**。
2. 「不发布面」的结论尚未在**导出树**上实跑验证（§6 未执行）。
3. A 组 37 条属规则误报，但我没有上游修复权，也未拿到裁定。
4. MEDIUM rc 语义未实测。
5. 公开历史 136 条未处置，等你选 H1/H2。
