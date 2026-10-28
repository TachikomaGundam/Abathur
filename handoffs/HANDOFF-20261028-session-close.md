# HANDOFF 2026-10-28 收窗交接（阿巴瑟席）

> 生成时刻：2026-10-28T16:12+08:00（系统时钟实测）
> 台账尾：`.omo/evidence/INTENT-LEDGER.md` 最后条目 ts=2026-10-24T20:31:52Z（链 `994176a8289f → c0fa77fceae3`）
> 最近提交：`5e05ca3`

---

## 0. 三十秒交接

**当前主线**：方案 D（单用户 + 工具面沙箱）已装好第一段。bash 工具从此走 bwrap 沙箱，**正常 `opencode` 启动即生效**（插件已进 `~/.config/opencode/opencode.jsonc`，插件本体在 root 侧）。
逃生阀：仅人类可用 `ABATHUR_SANDBOX=0 opencode`；座席无法关闭自己的沙箱。
`abathur-ai` 作为可选入口保留（额外钉定 opencode 字节、屏蔽项目配置），不是必需。

**下一位先做两件事**：
1. 确认机主已轮换 npm token（硬链测试把 token 读进了会话记录）。
2. 观察 `abathur-ai` 会话有没有工具报错（沙箱可能挡掉某些命令），把失败命令记成清单。

---

## 1. 本窗已完成（均有机器回执）

| # | 事项 | 结果 |
|---|---|---|
| 1 | 0.4.1 发布 | 机主执行三键后闭环：registry latest=0.4.1、装机 `abathur --version`=0.4.1；工作树 dist=0.4.0（惯例正常） |
| 2 | G59 晋升 | AGENTS.md 晋升条款已落，台账批准条目在册 |
| 3 | SimpleCut 证据剥离 | 1.7G 迁至 `/home/lab/workspace/harness/SimpleCut/.omo/evidence/`；本仓侧 grep 已净 |
| 4 | 四隔离条款 | v37 定稿，sibyl 2A/1R 过会（提交 `f2ad112`） |
| 5 | R-ISO 落地项 1 | 黄金 manifest + `scripts/check-frozen-a.sh`，三向验收过（提交 `9f6f4b8`） |
| 6 | R-ISO-3 安装器 | v4 结构重设计（凭据改官方工具重发、sudoers 改删专属文件、双向功能谓词、死锁前置闸）；**未 --apply**（提交 `fe540ce`） |
| 7 | 方案 D 设计 | v1→v12 共 12 版，sibyl 11 轮评审（全部 REJECT，末轮有席明言「剩余为一行字面，不值再开一代」）；机主裁决「D」 |
| 8 | 方案 D 落地 | 沙箱/启动器/配置 root 化/D2 接线/入口 `abathur-ai` 全部安装并实测（提交 `5e05ca3`） |
| 9 | 孤儿 campaign 修复 | `loop/run_registry.py` + runner 双源活体判定（替代裸 pgrep），AGENTS.md 开工三步已改 |
| 10 | 代码污染复查 | 他仓代码面净；本仓台账 6 条 `[line:simplecut]` 历史条目具名标注（哈希链不可删） |

---

## 2. 现在应该做什么（按优先级）

### P0（不完成则后续无意义）

1. **轮换 npm token**（仅机主可做）
   网页 npmjs.com → Access Tokens → 吊销 → 重发 → `npm login` 更新 `~/.npmrc`。
   理由：硬链探针把 `~/.npmrc` 内容读进了会话转录。

2. **重启一次 opencode**（插件在启动时加载，本窗开着的会话仍是旧的），然后正常使用，收集沙箱误伤清单。
   观察点：git 命令、npm 装包、python venv、nvidia-smi、systemctl 状态查询。
   若某条命令确实需要裸执行，由人临时开 `ABATHUR_SANDBOX=0 opencode`，不要给座席开关。

### P1（方案 D 剩余两段）

3. **D1 文件工具白名单**：给 read/write/edit/grep/glob 加路径策略。
   - 做法：新插件拦截 `tool.execute.before` 的同名工具，按白名单判定 `args.filePath`/`args.path`，越界即抛错。
   - 风险：宿主进程内执行，AI 若能让 bash 之外的通道读文件仍可绕过（R-D1 已具名）。所以它不是硬边界，只是降低误触。
   - 决策点：是否值得为「软墙」再写一个插件——建议先跑 P0-2 收集数据再定。

4. **MCP stdio 执行面包沙箱**：`sandbox-bash` 只管 bash；stdio MCP 目前裸跑。
   做法：MCP 配置里把 command 换成 `sandbox-exec` 包裹；需先枚举当前 MCP 清单。

### P2（已批准、未开工）

5. **工具包测试能力**（机主 2026-10-24 批准开工，用 AIHR 做试点，禁硬耦合）
   - 设计已过会：`loop/proposals/toolkit-testing-design-v9-final-20261023.md`（2A/1R）
   - 首步：`/home/lab/workspace/harness/hr` 作为试点仓，跑 1658 项基线（注意 `tests/test_bootstrap_properties.py` 缺 `hypothesis`，贡献 0 项，属具名缺口 G1）
   - 禁止：把 AIHR 的路径/常量写进阿巴瑟代码

### P3（等机主或等时机）

6. **四隔离条款正式入宪**：v37 已过会，条文在 `loop/proposals/four-isolation-law-draft.md`；入宪需要机主签署条目。
7. **R-ISO-3 是否 `--apply`**：改了 sudoers 之后座席再无 root，需机主决定时机。
8. **R-ISO 落地项 2–9**：条款入宪后开工；项 5（比对内建引擎）曾被在跑 campaign 堵住，现在 registry 显示 FREE。
9. **G60 考代**：C60CAN/SR4-70 已在 2026-10-23 跑过一轮（judge DONE），是否作为正式 G60 需查归档。

---

## 3. 机器事实（交接必须知道）

```
人类入口          /usr/local/bin/abathur-ai  -> /usr/local/lib/abathur/launcher
启动器            /usr/local/lib/abathur/launcher      sha256 3248ae19cd15da0b…  0755 root:root
沙箱              /usr/local/lib/abathur/sandbox-exec  sha256 550f485fafbe8866…  0755 root:root（v10：/tmp/opencode 跨调用持久）
沙箱配置树        /usr/local/lib/abathur/xdg/opencode  63M  root:root  全树 a-w
opencode 字节钉定 /etc/abathur/opencode.sha256         0644 root:root
日志切片单元表    /etc/abathur/log-units.conf          0644 root:root（4 单元，一行一个）
会话工作目录      /var/empty/abathur                   0755 root:root
```

**座席权限现状（2026-10-28 实测）**：bash 工具的 `sudo*` 被 opencode 权限规则拒绝，座席无法自行提权；root 侧改动一律由人类执行。跨调用临时文件用 `/tmp/opencode/`（沙箱内已持久），其余 `/tmp` 每次调用都是私有 tmpfs。

**关键运维规则**：
- opencode 升级后必须同步 `/etc/abathur/opencode.sha256`，否则启动器 fail-closed 拒绝启动（R-D23，预期行为）。
- 插件本体在 root 侧：`/usr/local/lib/abathur/xdg/opencode/plugins/sandbox-bash.js`（改它要 sudo）。人类配置里只放一行引用，见 `~/.config/opencode/opencode.jsonc`（备份 `opencode.jsonc.bak-20261028-sandbox-plugin`）。
- `abathur-ai` 入口用的是 root 侧整份配置快照（63M，一次性快照无自动同步）；日常用普通 `opencode` 即可。
- 当前配置副本是**一次性快照**，没有自动同步机制；这是个已知缺口，见 P1 之后的待办。

**常用探测**：
```
python3 loop/run_registry.py status      # 是否有 campaign/考代在跑（禁 pgrep）
sudo -n true                             # 座席是否仍有免密 root（现在还有）
sysctl kernel.yama.ptrace_scope          # 现在是 3，重启会回 1
```

---

## 4. 本窗踩过的坑（新入账，不要重复）

1. **压缩摘要会虚构**：本窗出现过整段「notes 审查子系统」和 v33 迭代的摘要，磁盘零存在。**任何工件存在性/版本号，先探测再落账**；已落一条更正条目（`9266bf5fe0dd`）。
2. **ptrace=3 是干跑误写的**：v3 安装器没把 sysctl 写入关进 `--apply`。v4 已修。重启回 1 即可，**不需要 3**——PID 命名空间已经挡住进程可见性。
3. **本机 sudo 是 sudo-rs**，不做命令参数匹配。所有「sudoers 空参钉死」类设计在这台机器上无效。
4. **bwrap 按路径挂载，不看 inode**：硬链进工作区可读禁面（R-D18，已实证）。启动闸 + 每日扫描只能减轻，不能封死。
5. **`pkill -f` 会匹配到自己的 shell**（G45 老病，本窗又犯一次）。杀进程用 pid。
6. **哈希/票面数字只能从实测粘贴**，凭记忆写本窗犯了两次（e090 庭）。
7. **工件落盘立即提交**：`scripts/toolkit-exec.sh` 等文件曾无故消失，`scripts/` 目录 mtime 倒流，归因未定（DISPUTED）。没提交的工作等于不存在。

---

## 5. 待机主决定

| 事项 | 为什么需要机主 |
|---|---|
| npm token 轮换 | 网页操作 + 账户权限 |
| 四隔离条款签署 | 入宪需要人类签署条目 |
| R-ISO-3 是否 apply | 一旦执行，座席永久失去 root |
| D1 软墙是否值得做 | 收益有限（可绕过），成本是一个插件 |
| 工具包测试试点范围 | 是否只 AIHR，还是加上 historian / PCB |

---

## 6. 回执索引（绝对路径，当场可查）

- 台账：`/home/lab/workspace/harness/Abathur/.omo/evidence/INTENT-LEDGER.md`
- 方案 D 设计（含安装回执）：`/home/lab/workspace/harness/Abathur/loop/proposals/tool-surface-sandbox-d-v12-20261024.md`
- 四隔离条款：`/home/lab/workspace/harness/Abathur/loop/proposals/four-isolation-law-draft.md`
- 账户分离方案（已否决，留作对照）：`/home/lab/workspace/harness/Abathur/loop/proposals/ai-uid-separation-v17-20261024.md`
- R-ISO-3 安装器：`/home/lab/workspace/harness/Abathur/scripts/install-isolation.sh`
- 黄金清单：`/home/lab/workspace/harness/Abathur/.omo/evidence/golden-manifest-0.4.0.txt`
- 工具包测试设计：`/home/lab/workspace/harness/Abathur/loop/proposals/toolkit-testing-design-v9-final-20261023.md`
- 沙箱接线插件：`/usr/local/lib/abathur/xdg/opencode/plugins/sandbox-bash.js`
