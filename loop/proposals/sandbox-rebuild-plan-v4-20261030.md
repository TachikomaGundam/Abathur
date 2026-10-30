# 沙箱重建方案 v4（吸收 5ae7 庭；关键变化=如实划定硬墙边界）

## 0. 结论先行：硬墙只有一种形态

同 uid 的对抗者无法被同 uid 的代码挡住。因此：

| 形态 | 启动方式 | 承诺 | 对抗同 uid |
|---|---|---|---|
| **hard（硬墙）** | 根属主启动器把**整个会话**放进命名空间 | 全继承，无需逐命令判定 | 有效（逃逸需内核漏洞） |
| **advisory（软墙）** | 普通 `opencode` + 仓内插件逐命令包裹 | 仅防事故，**明确不防对抗** | 无效 |

**不再声称「逐命令包裹是墙」**——第 5ae7 庭指出：插件在 agent 可写面，删掉它即可绕过。如实降级。

## 1. hard 形态（唯一硬墙）

启动器 `/usr/local/bin/abathur-ai`（root 属主）在 `bwrap` 内 exec opencode：

- 挂载面：`/usr` 只读、工作区读写、**`~/.config/opencode` 与 `$OPENCODE_CONFIG` 与 `node_modules` 只读绑定**（这是真正的写墙，不是 argv 检查：运行时拼路径也写到只读层 → EROFS）
- 密钥面（`.ssh`/`.gnupg`/`.npmrc`/`.config/gh`/keyrings/`.Xauthority`）**不挂载**
- 网络：`--unshare-net`；放行端点经抽象 unix socket 转发（fd 传 nonce，速率上限）
- 资源：`systemd-run --user --scope -p MemoryMax -p TasksMax`
- 会话内所有 spawn 都继承这套边界 → 无「未经过执行器」的路径

弃权声明（写进安装输出）：用户若改用普通 `opencode` 启动，即处于 advisory 形态，不享受硬墙。

## 2. advisory 形态（保留，但改名）

普通 opencode + 仓内插件：逐命令包裹、拒绝未知、写日志 `tier=advisory`。

- 目的：防事故（例如误执行 `rm -rf`）、给检测信号
- **不宣称**能挡住有意绕过
- 用户级目录零约束插件（哨兵按 sha256 清单断言）

## 3. 与机主既有约束的关系

- 单行安装：装包即装好启动器与哨兵
- 不转嫁工作：日常无需人类动作；例外路径见 §5
- 他线零影响：启动器只服务本线；普通 opencode 不再被任何用户级插件污染

## 4. 权威面

| 对象 | 属主 | 作用 |
|---|---|---|
| 启动器 | root | 唯一硬墙入口 |
| `/etc/abathur/registry.json` | root | 哪些项目用 hard、策略哈希 |
| `/etc/abathur/grants.json` | root | 例外放行（端口/入口），带 expires |
| `/var/lib/abathur/deny-queue.jsonl` | root | 拒绝队列（去重+封顶） |
| 仓内策略/插件 | 座席 | **只是 advisory 的输入**，不参与 hard 判定 |

## 5. 例外路径（人类，一条命令）

`sudo /usr/local/lib/abathur/sandbox-grant --project <abs> --what network:127.0.0.1:3000 --expires 2026-11-30`

- 写 grants.json（版本化、追加式审计行）
- 拒绝队列每条自带完整命令（无省略号、路径转义、`bash -n` 通过）
- 队列去重键 `(what,why)`，计数+首末时间；窗口内超 20 条转「升级态」并停止新增

## 6. 恢复（注册表/启动器损坏）

`docs/sandbox-recovery.md`：一条逐字可跑的命令重装启动器与登记册（不再发布新版本），验收=V1/V2 在 30 分钟内复绿。

## 7. 验收（每行一条命令 + 期望退出码）

| # | 判据 | 命令 | 期望 |
|---|---|---|---|
| V1 | 未登记项目零影响 | `curl -m 3 https://example.com` | rc=0 |
| V2 | hard 会话断网 | 会话内同命令 | rc≠0 且 `SANDBOX-NET-UNAVAILABLE` |
| V3 | 配置只读墙 | `touch /home/lab/.config/opencode/x` | rc≠0 且 EROFS |
| V4 | 运行时拼路径同样被挡 | `python3 -c "open('/home/lab/.config/opencode'+'/y','w')"` | rc≠0 且 EROFS |
| V5 | 前缀边界不误伤 | `touch /home/lab/.config/opencode_evil/z` | rc=0 |
| V6 | 密钥面不存在 | `ls /home/lab/.ssh` | rc≠0 |
| V7 | 用户级零插件 | `assert-user-scope-clean.sh` | rc=0；放任意文件 → rc=1 |
| V8 | 放行端口可用 | `curl 127.0.0.1:8010` | rc=0 |
| V9 | 未放行端口不可用 | `curl 127.0.0.1:3000` | rc≠0 |
| V10 | 资源上限生效 | scope 内 fork 炸弹 | rc≠0 |
| V11 | grant 生效并可过期 | grant 3000 → curl rc=0；过期后 rc≠0 | 两段 |
| V12 | 队列命令可跑 | 触发拒绝 → 取队列命令 `bash -n` | rc=0 |
| V13 | 前缀攻击不越界 | 路径含空格/分号/$() → 队列命令 | 解析为目标 argv，无注入 |
| V14 | advisory 如实标注 | 普通 opencode 内读日志 | `tier=advisory` |

## 8. 分期

- P1（今天可做，**detection-only**）：用户级零插件哨兵 + 拒绝队列骨架 + 文档
- P2：启动器 hard 形态（ro-bind 墙、网络、资源）+ 登记册
- P3：grants、转发器、恢复文档、V 全套 CI

P1 的自我标签：**检测与摩擦，不是封堵**（写入本身不会被阻止，只会在哨兵里现形）。

## 9. 不做

不建账户、不改 sudoers、不装用户级约束插件、不声称软墙能挡对抗、不在生产态静默裸跑。
