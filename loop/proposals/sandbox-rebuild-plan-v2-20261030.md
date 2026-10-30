# 沙箱重建方案 v2（吸收 1156 庭 25 条 must-fix）

## 0. 威胁模型（v1 缺失，先补）

两类对手必须分开，否则设计必然自欺：

| 对手 | 能力 | 能否被同 uid 机制挡住 |
|---|---|---|
| 事故型 | 误操作、注入文本、写错路径 | 能 |
| 对抗型 | 与我同 uid、可改仓内文件、可改插件、可另起进程 | **不能**（自我执行恒等于无墙） |

结论：**对抗型只能由 root 属主、且在被约束进程不可写面里的执行器挡住**。因此本方案分两种运行态：

| 态 | 策略来源 | 执行器 | 承诺 |
|---|---|---|---|
| release（默认） | 已发布版本内、root 钉定 | root 属主二进制 | 硬墙，fail-closed |
| dev（开发迭代） | 工作树 | 同一二进制 + `--dev` | **advisory**，日志写 `tier=dev-advisory`，**不宣称有墙** |

dev 态只用于本线的 B/C 庭迭代；任何对外声明、任何生产 campaign 只认 release 态。

## 1. 作用域

- 插件只在 `<repo>/.opencode/plugins/`（项目级）
- 策略只在 `<repo>/.abathur/sandbox.json`
- **用户级目录零约束类插件**；由哨兵按 sha256 清单断言（不是关键词 grep）

哨兵：`scripts/assert-user-scope-clean.sh`
- 计算 `~/.config/opencode/plugins/**` 的 sha256 清单，与 root 钉定的空清单比较
- 安装时 + 每次 release 前 + 每日 timer 跑
- 测试：放入任意命名的文件（`friendly-helper.js`）→ exit 1；移除 → exit 0

## 2. 登记册与 pin（治 v1 的哈希漂移 DoS）

`/etc/abathur/sandbox-registry.json`（root:root 0644）：

```json
{ "projects": [ { "root": "/path", "policy_git_sha": "<commit>", "policy_blob_sha256": "<blob>", "enforcer_sha256": "<bin>" } ] }
```

- 绑定 **git commit 的 blob 哈希**，不是工作树哈希 → `git checkout`/正常编辑不再误触发
- 策略变更走正常提交 → 发布流程重新登记（与既有发布门同一条流水线，不再新增人类动作）
- 未提交的工作树改动：release 态拒绝（`SANDBOX-DENY reason=policy-dirty`），dev 态 `tier=dev-advisory`
- 未登记项目：不启用，且**不写任何文件**（零接触）

**自动重登记（治「无修复路径」）**：`scripts/repin.sh` 由发布驱动调用（root 侧已有发布门），测试：fixture 仓改策略并提交 → repin 后 next bash 绿；不做提交 → 仍拒绝。

## 3. 权限按需 + 棘轮（回执放 root 侧）

策略条目：
```json
{ "what": "network", "entry": "127.0.0.1:8010", "why": "本机推理代理", "expires": "2026-11-30", "receipt": "<root 侧登记号>" }
```

- 回执**只从 root 属主登记册**读取（不是 `~/.local/share/abathur` 的同 uid 链）
- 过期在**每次执行时**复检（不是加载时）
- 测试：伪造本地链条目 → 仍拒；过期条目 → 下一次调用被拒并具名

**字段→原语映射（治「策略无执行映射」）**：

| 字段 | 原语 |
|---|---|
| network:none | `--unshare-net`（回环随之断，见下） |
| network 放行 127.0.0.1:8010 | 专用 unix socket 转发器（非 host netns），带每会话令牌；测试：可达 8010、不可达 3000/8000/内网 |
| mounts/devices | bwrap `--ro-bind` / `--dev-bind` |
| limits | cgroup v2 `MemoryMax` + `TasksMax`（**不是 PIDsMax**） |

## 4. 资源隔离与可用性

- 每项目独立 scope：`systemd-run --user --scope -p MemoryMax=… -p TasksMax=…`
- **无 user systemd 会话**（容器/chroot/无 linger）→ **拒绝执行**，日志 `SANDBOX-DENY reason=no-cgroup-host`，绝不静默裸跑
- 安装时能力探针：`systemd-run --user --scope -p PrivateNetwork=yes /bin/true` + 断言 netns inode 与宿主不同；探针失败 → 该 host 一律 deny（具名 `SANDBOX-UNAVAILABLE`）
- fork 炸弹测试本身放在一次性 scope + 超时 + 事后 pids 计数

## 5. 覆盖闭合（治「枚举不完」）

`scripts/spawn-entries.json`（版本化、哈希钉定）列全部可 spawn 入口：
- `bash` 工具、每个 MCP 服务的 stdio 启动、插件侧 `child_process`
- **未知入口 = 拒绝**（deny-by-default），不是「没包就不管」
- node_modules 供应面：`npm install` 在 release 态被禁；dev 态记录 `tier=dev-advisory` 并具名风险

## 6. 文件面封堵（治「write 工具可种插件」）

- 工具层拒绝写 `~/.config/opencode/**` 与 `$OPENCODE_CONFIG`
- inotify 实时监视该目录，出现新文件立即拒绝后续 bash（不等每日 timer）
- 测试：会话内用 write 工具投放 `friendly-helper.js` → 下一次 bash 立即被拒

## 7. 爆炸半径测试（agent 可跑）

- 测试态登记用 `ABATHUR_SANDBOX_TEST_REGISTRY` 指向 fixture 注册表；该变量**只被 root 二进制在 `--test` 模式消费**，生产态忽略
- 测试前占用闸：`loop/run_registry.py status` 有活体或存在 `abathur run` → 中止
- 断言：A（登记）curl 断/docker 不可达；B（未登记）正常；两日志 tier 行不同；结束后生产注册表与用户配置 sha256 字节不变
- trap 清理 + 零残留

## 8. 验收（每行一条命令 + 退出码）

| # | 判据 | 命令 | 期望 |
|---|---|---|---|
| V1 | 未登记不受影响 | fixture B: `curl -m 3 https://example.com` | rc=0 |
| V2 | 登记被约束 | fixture A: 同上 | rc≠0 且日志有 `tier=release` |
| V3 | 策略缺失/脏/篡改 | 删/改 fixture 策略后跑 bash | rc≠0 + `SANDBOX-DENY reason=…` |
| V4 | 用户级零插件 | `assert-user-scope-clean.sh` | rc=0；放任意文件后 rc=1 |
| V5 | 过期即失效 | 造过期条目 → 同一会话下一次调用 | rc≠0 |
| V6 | 资源隔离 | A 内 fork 炸弹，B 内延迟探针 | A 被 TasksMax 拒；B p99 增幅 <20% |
| V7 | 入口闭合 | 加一个未登记的 spawn 工具 | guard 测试 rc≠0 |
| V8 | 零残留 | 测试后比对注册表与用户配置 sha256 | 字节不变 |
| V9 | 未知入口拒绝 | 未登记 spawn 工具执行 | rc≠0 且无副作用文件 |

## 9. 分期（先小后大）

- P1：作用域解绑 + 哨兵 + 文件面封堵（止血与防复发）
- P2：登记册 + release 钉定 + 自动重登记
- P3：cgroup、socket 转发器、入口闭合
- 每期独立过审、独立验收；P1 未过不复核 P2

## 10. 明确不做

不建账户、不改 sudoers、不装用户级插件、不写他项目目录、不在生产态静默裸跑。
