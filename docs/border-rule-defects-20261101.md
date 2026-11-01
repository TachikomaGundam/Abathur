# border exfil 规则缺陷报告（具名，2026-11-01）

报告方：阿巴瑟席。对象：`border 0.8.2+df644447…` 的 border-exfil 规则集。
背景：本仓 `border check` 在真实泄露 5 处修复后仍被 17 条 MEDIUM 阻断（`rc=1`），逐条比对均为误报。本报告按蜂群 `sibyl-20261101T094125Z-8b46` 的 must-fix 要求逐条给：现象、误报文本、精化建议、正/负样本。
处置姿态（本席已采纳）：仓侧**不自建豁免**（蜂群多数判「被扫仓经配置链自废规则=权限倒置」）；发布保持阻断（D），升级截止=机主对 C 路线裁定期限；本报告为具名升级件。

## 类 1：exfil-home-path 匹配任意 `/home/<name>`，非用户名感知

- 现象：`/home/u`、`/home/other`（测试夹具假用户名）触发「exposing a local username」。
- 实例：`src/test/worktree.test.ts:40,42-43`；`src/test/bundle.test.ts:340,345,347,348`；`src/test/plugin-tier1.test.ts:127-128`。
- 精化建议：谓词改为**与机器库中登记的本机家目录（或其用户名）比对**，而非任意 `/home/\w+` 形态。机器库已有 keys 面（`border status` 可证），家目录前缀属同级别的机器事实。
- 正样本（应触发）：文件含本机真实家目录字面量。
- 负样本（不应触发）：`/home/u`、`/home/other`、`/home/example`。

## 类 2：守卫自身的否定语境被当泄露

- 现象：`src/test/historian-genome.test.ts:40` 的 `assert.doesNotMatch(text, /\/home\//, "repo-tracked config must not embed /home/... literals")` 被 exfil-home-path 命中——**规则命中了禁止该形态的守卫本身**。
- 精化建议：规则跳过否定语境（`doesNotMatch` / 否定断言的**字面参数位**可静态识别）；整文件豁免过宽，明确不采。
- 配套（已在本仓落地，见同日提交）：元测试钉住该守卫正则仍存在——任何「为绕过规则而改写守卫」的动作会被机械抓住。
- 正样本：真配置文件里的 `/home/...` 字面量仍须触发。
- 负样本：`doesNotMatch(x, /\/home\//)` 不触发。

## 类 3：exfil-cred-location 命中 JS 语法 `process.env` / `f.env`

- 现象：`friction.test.ts:238,274,…`、`self-snapshot.test.ts:84,…` 的 `process.env`、`f.env`（JavaScript 成员表达式）被「env 文件」模式命中。这是**全 JS 仓通用**的规则作者缺陷，非本仓特性。
- 精化建议：env 文件模式排除成员表达式语境（`<ident>.env` 且 `<ident>` 非文件路径形态；`process.env`/`globalThis.env` 直接白名单）。属蜂群认定的「唯一正当的机器库改动形态=精化谓词」，不是放松。
- 正样本：`.env`、`~/.pypirc`、`SSHPASS=` 仍须触发。
- 负样本：`process.env.HOME`、`f.env`。

## 误报总账（17 条，绑定 `rc=1` 输出与规则版本）

绑定物：`border 0.8.2+df6444471d619a7f73a0af3992fa3c5df00f582a`；输出 `.omo/longrun/gate-recheck/out.log`（sha256 见台账条目）；下表为 `5 处真泄露修复后` 预期剩余。

| # | 文件:行 | 规则 | 命中文本 | 误报理由 |
|---|---|---|---|---|
| 1-3 | worktree.test.ts:40,42,43 | exfil-home-path | `/home/u` | 类 1 假用户名夹具 |
| 4-7 | bundle.test.ts:340,345,347,348 | exfil-home-path | `/home/other` | 类 1 假用户名夹具 |
| 8-9 | plugin-tier1.test.ts:127,128 | exfil-home-path | `/home/u/.npm-global/…` | 类 1 假用户名夹具 |
| 10 | historian-genome.test.ts:40 | exfil-home-path | `/\/home\//` | 类 2 守卫自身 |
| 11-12 | friction.test.ts:238,274 | exfil-cred-location | `env: f.env` | 类 3 JS 成员表达式 |
| 13-15 | self-snapshot.test.ts:84 (+2) | exfil-cred-location | `env: fx.harness.env` 等 | 类 3 JS 成员表达式 |
| 16-17 | 其余 plan-skill/plugin-tier1 行位（以复跑输出为准） | exfil-home-path | 夹具路径 | 类 1 |

行数以闸复跑输出为准逐条核销，不做笼统担保。

## 本席不做的事（留裁于机主）

1. 不建仓侧 `.border.yaml` 关规则（多数票：标准洗白路径）；
2. 不请求机器库全局放松（爆炸半径=所有仓）；
3. 不遮蔽/改写守卫换放行（判据禁止）；
4. 发布保持 `RELEASE-BLOCKED reason=gate-blocked`，直至机主对「上游规则精化（C 的正形）」定期限或另裁。
