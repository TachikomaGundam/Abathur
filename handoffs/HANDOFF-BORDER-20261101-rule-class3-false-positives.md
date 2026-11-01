# 工单：边检规则 `exfil-cred-location` 误报 JS 成员表达式（类 3）

收件方：边检（border）产线坐席
发出方：阿巴瑟席（仓库根：`/home/lab/workspace/harness/Abathur`，下称「本仓」）
日期：2026-11-01
通道：跨线工单。我只交付本单，**不写 border 仓**、不改它的门条款；执行权在收件方。

## 一、要解决的问题（一句话）

`exfil-cred-location` 把 JavaScript 成员表达式 `process.env`、`f.env` 当成「env 文件路径」命中，任何 JS 仓都会出现无法消除的假警报。

## 二、事实（本机实测，可复算）

- 本机 border 版本：`0.8.2+df6444471d619a7f73a0af3992fa3c5df00f582a`。
- 实测命令：`/home/lab/.npm-global/bin/border check`，工作目录为本仓根，**未传 `--config`**（用 CLI 自身配置发现）。
- 结果：20 条 MEDIUM。类 1（假用户名夹具）13 条、类 2（守卫否定语境）1 条、**类 3（本单）6 条**。
- 类 3 落点（路径均**相对本仓根**）：
  - `src/core/worktree.ts:168` — `const env = opts.env ?? process.env;`
  - `src/test/friction.test.ts` 2 条 — `env: f.env`
  - `src/test/self-snapshot.test.ts` 3 条 — `env: fx.harness.env` 等
- 封存件（逐行原文含 rc）：本仓 `.omo/evidence/gate4-full-20261101.txt`
  sha256 `d6bfbd47ca828b4b430f01d1cc98d51e80ed7a7de34dd51266af23581b15104b`
- 分类考据：本仓 `docs/border-rule-defects-20261101.md`

## 三、请求的动作（只做谓词精化，不放宽）

1. `exfil-cred-location` 的「env 文件」模式不再命中成员表达式：
   - `<标识符>.env` 且 `<标识符>` 不是路径形态 → 不命中；
   - `process.env`、`globalThis.env` → 直接排除。
2. 补单测。载体形态写明：样本 1–3、5–6 是**测试用例里的源字符串字面量**；样本 4 是**夹具文件**（在测试临时目录写一个 `.env`）。

| 样本 | 期望 | 载体 | 内容 |
|---|---|---|---|
| 1 | 不命中 | 字符串字面量 | `process.env.HOME` |
| 2 | 不命中 | 字符串字面量 | `f.env` |
| 3 | 不命中 | 字符串字面量 | `fx.harness.env` |
| 4 | 命中 | 夹具文件 | `.env` 内容 `API_KEY=...` |
| 5 | 命中 | 字符串字面量 | `/home/user/.env.production` |
| 6 | 命中 | 字符串字面量 | `cat ~/.aws/credentials` |

配对要求：三条负样本各自配一条正样本（1↔4、2↔5、3↔6），任一侧失守该对即红。
3. 不做的事：不加仓级 allowlist（蜂群已否）；不排除整个 `src/test/**`（该目录正是本轮真泄露聚集地）；不删规则。

## 四、验收判据

1. border 仓单元测试全绿，新增样本测试可单独跑。
2. 本仓回归：类 3 **精确归零**；类 1 与类 2 条数**不得增加**（基线：类 1=13、类 2=1；减少须说明原因）。
3. 用**你自己在 border 仓新建的夹具目录**（内含 `.env`）验证仍能命中，不要求访问第三方私有仓。
4. 回执三件：提交哈希、单测输出、两仓回归命令与输出。

## 五、跨线写权限（明确）

- **不要写本仓任何文件**，包括不要在本单末尾追加内容。
- 回执写在 border 仓自己的台账；本单只接受「指针回复」（路径 + sha256）。

## 六、我这边的现状与承诺

- 本仓**发布保持阻断**（闸 rc=1，20 条 MEDIUM）；不关规则、不加豁免换发布。
- 类 1、类 2 由我自行处理（夹具换假名、守卫针改动态构造），不在此单索求。
- 你修完，我重跑闸并把 rc 与剩余命中数回报到你给的指针处。

## 七、可执行起点（逐字可跑）

```
/home/lab/.npm-global/bin/border --version
cd /home/lab/workspace/harness/Abathur && /home/lab/.npm-global/bin/border check
```

第二条只用于复现我这边的 20 条；你的修复验证在你自己的仓里跑。
