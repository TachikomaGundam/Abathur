# 沙箱重建方案 v3（吸收 f253 庭 23 条 must-fix）

## 0. 一句话结构

**决策权全部在 root 属主二进制 + root 属主登记册里；仓内的一切（插件、策略、脚本）都只是输入，不是权威。**

- 插件只能「调用」执行器，不能「决定」是否执行；
- 执行器读 `/etc/abathur/registry.json` 决定：这个项目在不在册、什么模式、什么策略；
- 模式（release/dev）由登记册字段决定，**argv/env 一律无权改**。

## 1. 吸收对照表（f253 → v3）

| must-fix | v3 落点 |
|---|---|
| 模式由调用方 flag 决定 | §1 登记册 `mode` 字段；二进制拒绝 `--dev`（对 mode=release） |
| tier 日志可伪造 | §5 root 属主追加日志 + 每行链哈希；校验脚本 non-zero |
| repin 无授权边界 | §3 只认「发布包内 manifest」，安装时由安装器写；仓内无 repin 脚本 |
| 入口清单可自编辑 | §4 清单随发布包走，root 安装时写入；自编辑无效 |
| V6 统计判据 | §7 V6 改为确定性 cgroup 拒绝 rc；p99 降为遥测 |
| 回环只有 8010 硬编码 | §6 策略声明式端口白名单 + 未声明即拒 |
| --test 无守卫 | §7 V12：生产态忽略 test 变量且哨兵字节不变 |
| 转发器令牌可读 | §6 抽象 socket + fd 传递 nonce + 速率上限；nonce=防滥用非边界 |
| 写门只管 write 工具 | §5 在 root 二进制内对**每个 spawn 入口**做 realpath 前缀检查 |
| watcher 死亡即放行 | §5 heartbeat 新鲜度检查，过期即拒 |
| V1/V2 不可证伪 | §7 用 nonce 标记的拒绝记录 + 网络故障区分码 |
| 无拒绝队列 | §8 三路拒绝都写 {what,why,expiry,命令} 队列 |
| 无 systemd 会话 | §7 V10 全拒 + 给一条逐字可跑的人工解除命令 |
| 供应面 node_modules | §4 release 态禁 `npm install`；dev 态具名风险 |

## 1. 登记册（唯一权威）

`/etc/abathur/registry.json`（root:root 0644，`O_NOFOLLOW` 打开，绝对路径编译期钉死）：

```json
{ "schema": 2,
  "projects": [ { "root": "/home/lab/workspace/harness/Abathur",
                  "mode": "release",
                  "policy_sha256": "…",
                  "entries_sha256": "…",
                  "enforcer_sha256": "…" } ] }
```

- 未在册：**不启用、不写任何文件、不报错**（零接触）
- 在册但策略/清单/执行器哈希不符：`SANDBOX-DENY reason=policy-mismatch`（fail-closed）
- `mode` 只认登记册；`--dev`、`SANDBOX_MODE`、插件输入一律被忽略；对 mode=release 传 `--dev` → 拒绝并记 `reason=mode-not-authorized`

## 2. 执行器（root 属主，唯一决策点）

`/usr/local/lib/abathur/enforcer`（root:root 0755，sha256 钉在 `/etc/abathur/enforcer.sha256`）

职责：
1. 读登记册，判定模式与策略
2. 校验路径（realpath 前缀）、入口清单、策略条目（含过期、receipt）
3. 起 cgroup scope（`MemoryMax`/`TasksMax`）与 bwrap
4. 写追加日志（root 属主，代理不可写）

插件（仓内，可写）只做一件事：`exec enforcer --project <abs> --argv-json <json>`。
插件被改坏 → 最坏是不调用执行器 → **但那不构成放行**：见 §5 的 spawn 入口闭合（未经过执行器的 spawn 由脚本自身拒绝）。

## 3. 注册与重登记（谁可以）

- 策略、清单、执行器全部随**发布包**分发；安装器（root）读包内 manifest 写登记册。
- 仓内不提供 repin 脚本；座席无法让登记册接受新策略。
- 开发迭代：走 dev 态（登记册 `mode=dev`，安装时可指定），日志 `tier=dev-advisory`，**不宣称有墙**。
- 测试：agent 在 release 项目改策略并提交 → 下一次调用 `SANDBOX-DENY reason=policy-mismatch`；重新安装发布包 → 恢复绿。

## 4. 入口清单（闭合枚举）

`entries.json`（随包）：列出全部可 spawn 入口（bash 工具、每个 MCP stdio、插件侧 child_process）。

- 不在清单内的 spawn → 拒绝（deny-by-default）
- 清单更新随发布，座席自编辑无效（哈希不匹配即拒）
- release 态禁 `npm install`（供应面变化必须走发布），dev 态允许并记具名风险

## 5. 文件面与 watcher

- 执行器在**每个 spawn 入口**做 realpath 前缀检查：写 `~/.config/opencode/**`、`$OPENCODE_CONFIG` → 拒
- 三种投放路径都测：write 工具、bash heredoc、MCP fs 服务
- watcher 心跳文件（root 属主）每 5s 刷新；执行器执行前检查新鲜度：过期 → `SANDBOX-DENY reason=watcher-dead`
- 立即拒绝（不等每日 timer）

## 6. 网络

- `network: none` → `--unshare-net`
- 放行条目：`{"entry":"127.0.0.1:8010","why":"推理代理","expires":"…","receipt":"…"}` → 经**抽象命名空间 unix socket** 转发，nonce 由 fd 传递（不放 env），速率上限 100 req/s
- 未声明端口一律拒（测试：8010 通、3000/8000/内网不通）
- 措辞更正：nonce = 防滥用标记，**不是边界**（同 uid 可读）

## 7. 验收（每行一条命令 + 退出码）

| # | 判据 | 命令 | 期望 |
|---|---|---|---|
| V1 | 未登记零影响 | fixture B `curl -m 3 https://example.com` | rc=0，且日志无该 fixture 记录 |
| V2 | 登记被约束（可证伪） | fixture A 同上；执行器写 nonce 拒绝记录 | rc≠0 ∧ nonce 在 root 日志中 |
| V3 | 策略不符即拒 | 改 fixture 策略一字节 | rc≠0 ∧ `reason=policy-mismatch` |
| V4 | 用户级零插件 | `assert-user-scope-clean.sh` | rc=0；放任意文件后 rc=1 |
| V5 | 过期即失效 | 过期条目 → 下一次调用（同一会话） | rc≠0 ∧ `reason=grant-expired` |
| V6 | cgroup 生效 | scope 内 fork 炸弹 | rc≠0（TasksMax 拒） |
| V7 | 入口闭合 | 加一个未登记 spawn 工具 | rc≠0 ∧ 无副作用文件 |
| V8 | 零残留 | 测试前后 root 侧快照 sha256 | 字节相同 |
| V9 | 未知入口拒绝 | 未登记工具执行 | rc≠0 |
| V10 | 无 systemd 会话 | 强制探针失败 | 全拒 ∧ `reason=no-cgroup-host` ∧ 队列给一条可跑命令 |
| V11 | 转发器边界 | 沙箱内 curl 8010 / 3000 | rc=0 / rc≠0 |
| V12 | test 变量生产态无效 | 设 `ABATHUR_SANDBOX_TEST_REGISTRY` 跑生产 fixture | 生产策略生效 ∧ 哨兵文件字节不变 |
| V13 | 模式不可降级 | release 项目传 `--dev` | rc≠0 ∧ `reason=mode-not-authorized` |

## 8. 拒绝队列（例外路径）

每次拒绝追加一行到 `/var/lib/abathur/deny-queue.jsonl`（root 属主，座席只读）：

```json
{"ts":"…","what":"network:127.0.0.1:8010","why":"未声明端口","expiry":"…","cmd":"sudo /usr/local/lib/abathur/enforcer grant …"}
```

座席可以读、可以呈报，**不能执行**——这是设计；命令只给人类，一次一条，逐字可跑。

## 9. 分期

- P1 止血与防复发：用户级零插件哨兵 + 文件面封堵 + 拒绝队列
- P2 权威面：登记册 + 执行器 + 发布集成
- P3 细化：cgroup、转发器、入口清单、V 全套

每期独立过审、独立验收。

## 10. 不做

不建账户、不改 sudoers、不装用户级插件、不写他项目目录、不在生产态静默裸跑、dev 态不宣称保护。
