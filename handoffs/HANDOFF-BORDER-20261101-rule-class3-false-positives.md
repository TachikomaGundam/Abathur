# 工单：边检规则 `exfil-cred-location` 误报 `<长标识符>.env` 成员访问

收件方：边检（border）产线坐席
发出方：阿巴瑟席
日期：2026-11-01
通道：跨线工单。我只交付本单，**不写 border 仓**、不改它的门条款；执行权在收件方。

> **状态：暂停交付（2026-11-01）。** 朗读门第 4 轮（独立会话）指出本单第三节的谓词改法自相矛盾：纯文本无法区分 `opts.env`（属性访问）与 `secrets.env`（文件名）。第三节的改法作废，待重新设计后重发。第二节事实与第四节验收框架仍然有效。记录见 `.omo/evidence/readaloud-gate/HANDOFF-BORDER-20261101.md`。

## 一、要解决的问题（一句话）

`exfil-cred-location` 的「env 文件」判定按「接收者 ≥3 字符」推断文件名干，把 `opts.env`、`fx.harness.env` 这类 JavaScript 属性访问当成磁盘上的 env 文件，导致任何 JS 仓都有消不掉的假警报。

## 二、事实（可复算，附更正声明）

**更正声明（2026-11-01）**：初版工单写「命中 `process.env` / `f.env`」，是我的推断，未经源码复核，**是错的**。读源码后确认二者都被显式排除。以下为复核后事实。

- 本机 border 版本 `0.8.2+df64444`；源码仓 `/home/lab/workspace/harness/border`（HEAD `df64444`）。
- 判定代码：`border/src/exfil/rulesPath.ts:36-44` 的 `envTokenIsLocation()`：
  - 空干 → 命中；含 `/` 或 `~` → 命中；
  - 接收者为 `process`/`os` → **不命中**；
  - 其余按「接收者长度 ≥3」→ 命中。
- 因此：`process.env`、`o.env`、`input?.env` 不命中（与 `border/test/exfil.core.test.ts:218-235` 的既有校准一致）；`opts.env`、`fx.harness.env` **命中**（`opts`、`harness` 被当文件名干）。
- 边检输出格式限制：`.omo/evidence/gate4-full-20261101.txt`（本仓）只给「文件 + 规则 + 消息」，**不含命中 token 与行号**；复现请以该文件为准。
- 本仓受影响的 6 条分布（文件级，来自闸输出）：`src/core/worktree.ts` 1 条、`src/test/friction.test.ts` 2 条、`src/test/self-snapshot.test.ts` 3 条。路径均相对 `/home/lab/workspace/harness/Abathur`。

## 三、请求的动作（精化谓词，不放宽）

在 `envTokenIsLocation()` 上加一条文件名形态约束：
1. token 不含 `/` 与 `~` 时，接收者必须匹配 `^[a-z0-9][a-z0-9_-]*$`（全小写、无大写、无多段）才算位置；
2. 含大写字母或多点段（`fx.harness`）视为属性访问，不命中；
3. 现有 `process`/`os` 排除与 `?.env` 排除保持不变。

样本（负 6 / 正 6，配成 6 对；载体：字符串字面量；凭据形态一律占位式书写，勿在测试里写真实串）：

| 对 | 不命中（负） | 命中（正） |
|---|---|---|
| 1 | `process.env` | `.env` |
| 2 | `o.env` | `staging.env` |
| 3 | `opts.env` | `secrets.env` |
| 4 | `fx.harness.env` | `deploy/staging.env` |
| 5 | `input?.env` | `<HOME>/.pypirc`（`<HOME>` 为测试临时目录） |
| 6 | `prod.env.example` | `SSHPASS` 赋值形态（测试内合成） |

另：不应做的事——不加仓级 allowlist；不排除整个 `src/test/**`；不删规则。

## 四、验收判据（逐条可跑）

1. 在 `/home/lab/workspace/harness/border` 跑 `npm test`：全绿；新增 6 对样本测试在你单独跑时也绿。
2. 跑 `npm run typecheck`：无错误。
3. 用你在 border 仓内自建的夹具目录（内含名为 `.env` 的文件）跑一次扫描，必须仍命中——不得因精化而漏报真实 env 文件。
4. 回执：提交哈希 + `npm test` 输出尾部 + `npm run typecheck` 输出。**回执写进你的提交信息（commit message）**，回复本单时给出提交哈希即可；若你有自己的台账文件，也可写在台账并把「路径 + sha256」给我。

## 五、跨线写权限（明确）

- 不要写 `/home/lab/workspace/harness/Abathur` 下的任何文件，包括不要在本单末尾追加。
- 本单只接受「提交哈希 + 指针」。

## 六、我这边的现状与承诺

- 本仓发布保持阻断（闸 rc=1）。不关规则、不加豁免换发布。
- 你修完，我在本仓重跑 `/home/lab/.npm-global/bin/border check`，把 rc 与剩余条数写在本仓 `.omo/evidence/` 下，并把指针回复给你。

## 七、可执行起点（逐字可跑）

```
cd /home/lab/workspace/harness/border && git log --oneline -1 && npm test
cd /home/lab/workspace/harness/border && npm run typecheck
cd /home/lab/workspace/harness/Abathur && /home/lab/.npm-global/bin/border check
```

第三条只用于复现我这边的 20 条（rc=1）。
