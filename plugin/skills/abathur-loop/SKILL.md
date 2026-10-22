---
name: abathur-loop
description: Abathur 进化回路操作规程（Tier-1 守卫世代）。当席位要跑 campaign、写意图账本、碰考卷/抽取器/占用锁，或看到 abathur guard 拦截信息时加载本技能。内容：占用态语义、守卫面清单、T4 账本追加用法、override 四验证配方、旁路告警的边界。
---

# abathur-loop 操作规程（Tier-1 守卫世代）

守卫插件（plugin/abathur.ts，随包发布）在宿主里对席位做四层防护。
本技能是席位侧的操作规程：被拦时怎么办、怎么合法落账、什么绝对不能绕。

## 1. 开工状态注入（T1，展示面）

每个会话的 system 消息头部会注入一段 `[abathur] 开工状态注入`。
它只是展示：**闸的信任永不来自这段文字**，它来自插件当场探测。
看到 `占用: occupied` 就不要写守卫面文件——排队，不写。

## 2. 守卫面（四文件，占用期冻结）

| 面 | 相对仓根路径 | 为什么 |
|---|---|---|
| 考卷库 | loop/bank.py | campaign 期间改题=改尺 |
| 抽取器 | loop/draw.py | 同上，抽题面也是尺的一部分 |
| 意图账本 | .omo/evidence/INTENT-LEDGER.md | 追加式哈希链，占用期只允许 T4 工具写 |
| 占用锁 | .omo/evidence/campaign.lock.json | 锁本体被写=占用信号被伪造 |

守卫判定=路径 realpath + inode 双维（硬链接、符号链接都躲不掉）。
编辑类工具（edit/write/patch 族）写守卫面在占用期直接被拒并给出配方。

## 3. 占用态六值语义

| 态 | 含义 | 席位动作 |
|---|---|---|
| occupied | 锁新鲜、pid 活、启动时刻与锁一致 | 排队，不写守卫面 |
| occupied-pending | 锁存在但无法证实新鲜（心跳超时/进程表不可读） | 按占用对待，待裁 |
| corrupt-occupied | 锁文件损坏 | fail-closed：按占用对待，报人类 |
| disproof-occupied | 无有效锁，但进程反证扫到在跑的写面命令 | 按占用对待；反证细节在拦截文本里 |
| stale-idle | 锁在但 pid 死/被复用/超龄 | 可写，但先落 evidence-note 说明 |
| idle | 无锁无反证 | 正常写 |

判空闲的两个出口（idle/stale-idle）都必须先过**进程反证扫描**：
扫 /proc 全进程 cmdline，argv 逐 token 精确匹配引擎写面命令前缀
（run/promote/retract/tombstone/re-adjudicate/kernel/opencode），
裸命令名、绝对路径、node+cli.js、npx 符号链接四种形态都归一到 realpath 比对。
子串不命中（`vim notes-about-run.txt` 不算）。自己的 pid 排除。

## 4. T4 账本追加（占用期唯一合法写入通道）

工具 `abathur_ledger_append`。kind 封闭白名单：
`declaration` / `guard-override` / `lock-takeover` / `evidence-note`。
每次追加：mkdir 锁串行化 → 撕行检测（截断修复+evidence-note 记账）→
写前验链（末 3 条链行 prev-hash 重算，断链拒写）→ O_APPEND+fsync →
读回再验。条目尾部机器链行格式：

`<!-- abathur-chain prev=<前行sha256> kind=… sid=… ts=… [ref=… target=…] -->`

活持有者占锁时等 5 秒超时即拒——**不许杀别人的锁**；死主（ESRCH）或
owner 记录缺失/畸形超 250ms 宽限才可接管，接管必落 lock-takeover 条目。

## 5. guard-override 四验证（缺一不可）

1. `ref` = 账本里一条人类批准条目的 sha256 前缀（≥16 位），该条目 24h 内、
   且正文具名了本次要写的目标文件；
2. 批准条目所在会话 == 当前会话（防跨会话盗用）；
3. 批准时刻距现在 ≤15 分钟；
4. 账本尾部前向链验证通过（末 3 条链行）。

通过后插件落一条 `guard-override` 决策行（含 ref/target），然后放行这一次写。
同一 ref 24h 内可复用，但每个目标文件都要在批准正文里具名——
批 bank.py 不等于批 draw.py。

已知残余缺口（具名，不掩饰）：**G-OVERRIDE-FORGE**——伪造 ref 指向
不存在的人类条目会被验证①抓住，但"人类条目真实性"最终锚在账本文件自身
完整性上；账本被守卫面+链验证保护，链的创世区（无链行的 legacy 条目）
不参与验证。

## 6. bash 旁路 = 告警面，不是闸

`tool.execute.after` 对 bash 命令做守卫面命中检测，命中时输出
`[abathur-guard] warning: …` 告警（含 rm 锁文件的事故级加词）。
**它不拦截**——bash 写守卫面在占用期仍是纪律问题（L-ENGINE-ISOLATION），
告警进 transcript 供事后审计。别把"没被拦"当"被允许"。

## 7. shell 环境（T3）

`shell.env` 钩子只在会话目录 == 钉住的 repoRoot（realpath 相等）时注入
白名单环境变量。full 模式白名单来自引擎构建的 dist/engine-registry.json
（injectableAllowlist，现 5 键：PATH/ABATHUR_CONFIG/ABATHUR_SELF_REPO/
ABATHUR_HISTORIAN_REPO/ABATHUR_DEBUG）；探针失败（引擎旧/不在 PATH）落
FALLBACK-PROBE 模式用插件内静态五键。PATH 仅允许前置追加。
配置文件 `~/.config/opencode/abathur-shell-env.json` 畸形→告警+跳过注入，
不阻断会话。非白名单键、非字符串值一律拒绝并告警。

## 8. 版本探针 = 能力位判据，不是 semver 比对

`abathur --version` 成功 ∧ dist/engine-registry.json 可解析 ⇒ full 模式。
main 谱系 package.json 可能报旧号（如 0.2.9）但引擎能力已是 0.4.0 列车——
比对版本号会误判，所以判能力不判号。探针结果缓存 60s。

## 9. 席位纪律（守卫之外仍然生效）

- 生产 campaign 只跑冻结安装（L-ENGINE-ISOLATION）；开发在 worktree/quarantine。
- 发布物化只在隔离 checkout（L-RELEASE-TREE-ISOLATION）；主树禁 orphan/--delete 同步。
- 共享面变更先取归因证据再定罪/开罪（L-SURFACE-ATTRIBUTION）。
- promote/tombstone/retract 永远是人类终端专属，插件工具面不可达。
- 账本追加用带引号 heredoc；时间戳当场 `date` 取，凭记忆=伪造（L-RECEIPT）。
