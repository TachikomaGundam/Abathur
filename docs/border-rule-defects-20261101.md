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

## 类 3：exfil-cred-location 命中 `<长标识符>.env` 成员访问（**本段已就地更正 2026-11-01**）

- 更正声明：本节初版写「命中 `process.env` / `f.env`」——**错**。该说法由我 grep 源文件推断，未经规则源码复核。读 `border/src/exfil/rulesPath.ts:36-44` 后确认：
  - `envTokenIsLocation()` 对接收者为 `process`/`os` 的 token **直接返回 false**；
  - 1 字符接收者（`f.env`）因 `receiver.length >= 3` 不成立也 **false**；
  - 真正触发的是**接收者 ≥3 字符**的成员访问：`opts.env`、`fx.harness.env`（代码把 `opts`/`harness` 误判为文件干）。
- 边检输出本身（`.omo/evidence/gate4-full-20261101.txt`）只给「文件 + 规则 + 消息」，**不给命中 token 与行号**；此前表中的行号与代表命中均为我 grep 所得，属推断，已标注。
- 精化建议（最小语义修正，不放宽）：
  1. 无 `/` 与 `~` 的 token，仅当「点号分隔的接收者」是**文件名形态**（`[a-z0-9][a-z0-9_-]*`，全小写、无大写字母）才算位置；
  2. camelCase / 多段式接收者（`opts`、`harness`、`fx.harness`）视为属性访问，不命中；
  3. 现存的 `process`/`os` 排除与 `?.env` 排除保持不变。
- 正样本（须仍触发）：`.env`、`staging.env`、`secrets.env`、`deploy/staging.env`、`~/.pypirc`、`SSHPASS=`。
- 负样本（须不触发）：`process.env`、`o.env`、`opts.env`、`fx.harness.env`、`input?.env`、`prod.env.example`。

## 误报总账（20 条，绑定 `rc=1` 输出与规则版本）

绑定物：`border 0.8.2+df6444471d619a7f73a0af3992fa3c5df00f582a`；闸完整输出已封存 `.omo/evidence/gate4-full-20261101.txt`（`PRECHECK-DISPATCHED ... rc=1`，20 条 MEDIUM 逐行原文，哈希见台账）。**逐行数以该封存件为准**，下表为分类总账：

| # | 文件 | 条数 | 规则 | 代表命中 | 误报类别 |
|---|---|---|---|---|---|
| 1 | src/core/worktree.ts | 1 | exfil-cred-location | `const env = opts.env ?? process.env;`（:168） | 类 3 JS 成员表达式 |
| 2 | src/test/bundle.test.ts | 5 | exfil-home-path | `/home/other/...` 夹具 | 类 1 假用户名 |
| 3 | src/test/friction.test.ts | 2 | exfil-cred-location | `env: f.env` | 类 3 |
| 4 | src/test/historian-genome.test.ts | 1 | exfil-home-path | 守卫自身 `doesNotMatch(text, /\\/home\\//)` | 类 2 |
| 5 | src/test/plan-skill.test.ts | 2 | exfil-home-path | `/home/dev/...` 夹具（真泄露换假名后仍触发同形态） | 类 1 |
| 6 | src/test/plugin-tier1.test.ts | 2 | exfil-home-path | `/home/u/...` 夹具 | 类 1 |
| 7 | src/test/self-snapshot.test.ts | 3 | exfil-cred-location | `env: fx.harness.env` 等 | 类 3 |
| 8 | src/test/worktree.test.ts | 4 | exfil-home-path | `/home/u/...` 夹具 | 类 1 |

计数更正（如实）：本报告初版写 17 条、并曾称「全部在 src/test」——两者皆错。错因：我当时用 `grep 'src/test/'` 统计，把 `src/core/worktree.ts` 的一条挤出视野（正是「只数测得到的」病）。本次总数与分类以封存件逐行重数：20 条 = 类1×13 + 类2×1 + 类3×6，真泄露（5 处，含 `os.homedir()` 守卫针悖论 3 处与夹具真用户名 2 处）已修，修后闸输出中不再出现。

## 本席不做的事（留裁于机主）

1. 不建仓侧 `.border.yaml` 关规则（多数票：标准洗白路径）；
2. 不请求机器库全局放松（爆炸半径=所有仓）；
3. 不遮蔽/改写守卫换放行（判据禁止）；
4. 发布保持 `RELEASE-BLOCKED reason=gate-blocked`，直至机主对「上游规则精化（C 的正形）」定期限或另裁。
