# 提案：AI 工作账户与人类账户分离（三账户模型）

日期：2026-10-24
状态：待裁决（送蜂群辩论）
提案人：阿巴瑟座席

## 1. 一句话问题

人类与 AI 共用 Unix 账户 `lab`，导致任何"在 lab 内部收权"的措施都无法建立边界；是否应把 AI 迁移到独立非 root 账户。

## 2. 机器实测现状（2026-10-24，本机）

| 事实 | 证据（可复算命令） | 输出 |
|---|---|---|
| AI 与人类同 uid | `id lab` | uid=1000(lab) gid=1000(lab) |
| AI 在特权组 | `id lab` | sudo, docker, lxd, input, adm, video, render, plugdev |
| docker 组 = root 等价 | `head -1 /etc/shadow`（失败）；`docker run --rm -v /etc/shadow:/h/shadow:ro --entrypoint awk <img> -F: 'NR==1{print $1, length($2)}' /h/shadow` | 直接读 Permission denied；容器内 `root hashlen=1` |
| input 组 = 键盘可读 | `ls -l /dev/input/event*` | `crw-rw---- root:input` |
| 人类家目录是唯一有效边界 | `stat -c '%a %U:%G' /home/lab` | 750 lab:lab |
| AI 工作区在人类家内 | `stat -c '%a %U:%G' /home/lab/workspace` | 775 lab:lab，38G |
| OpenCode 状态库全局可写 | `stat -c '%a' ~/.local/share/opencode/opencode.db` | 777，8.2G |
| sudo 使用密度 | 会话库只读查询 | 82,174 次 bash 调用中 1,323 次含 sudo（1.6%），涉及 168 会话 |
| sudo 用途分布 | 同上 | journalctl/dmesg 165、systemctl 141、root 跑脚本 128、rm/mv/cp 119、sudo -n 探测 114、ipmitool 80、docker 76、chown 74、tee /etc 63、nvidia/modprobe 36、apt 16、npm 全局 11、切用户 5、防火墙 4、mount 1 |
| 免 root 替代已存在 | `ls -ld ~/.npm-global`；`docker ps` | lab 属主（npm -g 不需 sudo）；docker 组免 sudo 可用 |
| 常驻服务以 root 运行 | `systemctl list-units` | dsv4-control、qwen38-control、llm-monitor、gpu-fan-control、vllm-stall-capture、docker |
| ptrace 现状 | `sysctl -n kernel.yama.ptrace_scope` | 3（误写事故遗留；内核单向棘轮，写 0/1/2 均 EINVAL，只能重启回退） |

## 3. 根因

一个 uid 同时承载三种角色：人类操作者、AI 执行体、外写凭据持有者。同 uid 意味着：
- 同 uid 进程可互相 ptrace（默认）；
- 组权限对双方同时生效（docker/input/adm 是给人类的，AI 一并获得）；
- 文件权限无法区分"人类读"与"AI 读"。

在 `lab` 内部收权的三条路径及其失效原因：
1. 删 NOPASSWD：docker 组仍 root 等价（已实测）。
2. 移出特权组：人类自己也要用这些组；且同 uid ptrace 与 `/proc/<pid>/mem` 仍在。
3. 设 ptrace_scope=3：input 组仍可键盘记录；且该值不可回退，代价是全机失去调试能力。

## 4. 候选方案

### 方案 A：三账户分离（推荐评估对象）
- 动作：新建 `abathur`（AI 工作账户，非 root、无 sudo、不进特权组）+ 沿用/新建 `abathur-keys`（凭据持有，人类 `sudo -u` 进入）；工作区移出 `/home/lab`（如 `/srv/workspace`，组 `dev` 共享）；OpenCode 配置与状态库迁入 `abathur` 家；人类以 `sudo -iu abathur` 启动 AI。
- 收益：边界由 uid 决定，机验判定简单；跨 uid ptrace 需 root，`ptrace_scope=1` 即足够（3 不必设，棘轮问题消失）；docker/input/adm 对 AI 天然不可用。
- 代价：一次性迁移 38G 工作区 + 8.2G 状态库 + 配置路径；启动方式改变（不改则一切无效）；AI 失去读人类家目录的能力（含可能被依赖的路径）。
- 失效模式：人类仍在 `lab` 里启动 opencode（迁移白做）；迁移后 AI 无法访问某些绝对路径导致工具链断裂；共享组写权限配置错误导致双方互相覆盖。

### 方案 B：`lab` 内收权（不新增账户）
- 动作：删 NOPASSWD；AI 退出 docker/lxd/input/adm（人类保留）；ptrace_scope=3；工作区改 750。
- 收益：迁移零成本；无需改启动方式。
- 代价与失效：不能既让人类用 docker 又让 AI 不用（同 uid）；同 uid ptrace 只能靠 3（不可回退）；文件权限无非区分人/AI；`/etc/shadow` 之外的大量秘密（浏览器配置、ssh-agent）仍可读。
- 结论性判断：无法成立为"隔离"，只能降低单点风险。

### 方案 C：混合（A + 窄 allowlist）
- 动作：同 A；额外给 `abathur` 账户一条窄 sudoers 规则，仅允许只读诊断命令（如 `journalctl`、`dmesg`、`nvidia-smi`、`ipmitool sensor list`）。
- 收益：保留 AI 的自诊断能力，减少人类被叫去跑命令的频率。
- 代价：多一条需要长期维护的授权面；只读命令也可能泄漏秘密（日志/传感器输出），需评估。
- 失效模式：allowlist 扩张失控（历史上 NOPASSWD 就是这样来的）。

## 5. 迁移风险清单（方案 A/C 共用）

| # | 风险 | 探针 | 缓解 | 回滚 |
|---|---|---|---|---|
| R1 | 人类仍在 lab 启动 AI，隔离无效 | `ps -o user= -p <pid>` 应显示 abathur | 启动包装器 + 人工检查 | 无（不迁移即原状） |
| R2 | AI 读不到迁移前路径（绝对路径假设） | 迁移后跑全量测试与 `npm test` | 阶段试点（先 AIHR 一仓） | 保留旧路径只读挂载 |
| R3 | 共享组写权限互相覆盖 | 两账户各建文件，`stat` 查属主/组/位 | `2775` + umask 002 + 定期核对 | 恢复 775 lab:lab |
| R4 | 状态库迁移损坏会话历史 | 迁移前 sha256 + 迁移后 SQLite `integrity_check` | 先复制后切换，保留原库 | 指向原库 |
| R5 | AI 失去 root 后无法完成既有运维 | 对照 sudo 用途分布，逐类确认出口 | 人类执行 + root 侧服务产出状态文件 | 临时授予窄 allowlist |
| R6 | 凭据仍在 lab（迁移不彻底） | 在 abathur 账户内跑 `npm whoami`/读 `~/.ssh` 应失败 | 凭据只放 abathur-keys | 无（这是目标态） |
| R7 | 人类读不到 AI 产出 | 人类以 lab 读工作区文件 | 共享组读位 | 临时 chmod |
| R8 | `sudo -iu abathur` 需人类密码，交互摩擦 | 人工试用一周 | 别名/包装脚本 | 无 |
| R9 | 迁移过程中断（38G/8.2G） | 迁移日志 + 逐项校验 | 同文件系统 rename（秒级）或 rsync --checksum | 回指旧路径 |
| R10 | 旧会话库仍 777 可被任意本地账户写 | `stat -c '%a'` | 迁移时一并收紧为 700 | 无 |

## 6. 评判标准（供辩论席使用）

1. 安全收益是否可机验（能否给出"AI 做不到 X"的失败回执，而非配置声明）。
2. 是否消灭病类而非压症状（同 uid 三合一是病根）。
3. 迁移代价与可回退性。
4. 对日常工作的摩擦（启动方式、root 需求、路径）。
5. 是否留下需要持续打补丁的授权面。

## 7. 待裁决问题

Q1 选 A、B 还是 C？
Q2 试点仓选 AIHR 是否合适（体量小、有测试套件、非生产）？
Q3 若选 C，allowlist 的初始封闭枚举是什么，谁有权扩展？

## 8. 禁项

- 不允许以"临时放宽"为由恢复 `lab` 免密 sudo。
- 不允许在迁移未验证前删除旧路径。
- 不允许把凭据放回 AI 可读的账户。
