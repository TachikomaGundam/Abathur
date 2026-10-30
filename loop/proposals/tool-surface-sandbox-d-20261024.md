# 提案 D：单用户工具执行沙箱（对照组 = C 三账户分离）

- 日期：2026-10-24
- 谱系：C（三账户）经 12 轮评审 3A/0R 过会后被机主否决，两条理由：**①多账户对插件包太重；②客户端/服务端分离导致机主无法直接看到工作**。本稿换目标：不改身份，只改工具执行面。
- 状态：待蜂群评审（本稿为评审输入，不是结论）

## 1. 目标与约束

**目标**：在**单用户（lab）**前提下，使阿巴瑟的工具调用无法触碰下列能力；同时机主保持对全部文件与会话库的直接可见性。

**硬约束**：
- 不新增系统账户、不新增 sudoers 授权、不要求常驻 root 进程
- 会话库、工作区、配置保持机主可见可读
- 可随插件包分发（安装面 ≤ 一次 sudo 落文件）

**非目标（明确不承诺）**：防内核漏洞逃逸；防机主自己执行 AI 产出的恶意脚本；防物理接触。

## 2. 威胁模型

| # | 通道 | 危害 | 现状证据 |
|---|---|---|---|
| T1 | `/var/run/docker.sock`（lab ∈ docker） | 容器内 root → 读宿主全部文件 | 实测：容器内读到 `/etc/shadow` 的 root 行 |
| T2 | `/dev/input/event*`（lab ∈ input，660） | 键盘记录（口令、token） | 组权限实测 |
| T3 | X11（`/tmp/.X11-unix`，cookie 600 lab） | 截屏、模拟键鼠 | cookie 复制到 644 处即 `xdpyinfo` CONNECT-OK（一次性实验，已清理） |
| T4 | `~/.ssh`(700) `~/.gnupg`(700) `~/.npmrc`(600) `~/.config/gh` `~/.local/share/keyrings` | 凭据与签名能力 | 同 uid 属主，直接可读 |
| T5 | `/run/user/1000/gnupg/S.gpg-agent`、keyring socket | 借人类密钥签名/解密 | 同 uid 可连 |
| T6 | `/proc/<pid>`（他进程） | 读命令行、内存、fd | `cmdline` 实测跨 uid 可读（同 uid 必然可读）；内存受 Yama 约束 |
| T7 | `/var/log/**` + `adm` 组 | 全量系统日志（可能含回显密钥） | lab ∈ adm |
| T8 | 网络 | 外发数据、拉取任意载荷 | 当前无限制 |

**不在此列**：模型推理本身、opencode 进程内的插件/MCP 代码（见 §5 残余）。

## 3. 现状实测（2026-10-24）

| 事实 | 值 |
|---|---|
| 沙箱工具 | `bubblewrap 0.11.1`（已装，无需 root） |
| 当前组 | lab ∈ adm cdrom sudo dip video plugdev users lpadmin lxd docker render input |
| Yama | `ptrace_scope=3`（本席 05:55Z 误写；重启回 1） |
| 敏感文件权限 | `.ssh` 700 / `.gnupg` 700 / `.Xauthority` 600 / `.npmrc` 600 / `.config/gh` 771 / keyrings 700 / `gpg-agent` 700 |
| 设备 | `/dev/input/event*` 660 root:input；`/dev/nvidia0` 666；`/dev/dri/renderD128` 660 root:render |
| 常用 root 面调用量（162 天） | logs 214、docker 201、systemctl 177、gpu 131、etc-write 85、ipmitool 59（合计 1348/82150 = 1.64%） |

## 4. 设计

### D1 文件类工具路径策略
所有 `read` / `write` / `edit` / `grep` / `glob` 类工具在插件层过同一策略：
- **允许**：工作区根（读写）、`/tmp/opencode`（读写）
- **只读**：`/usr`、`/etc`（不含 `/etc/shadow` 类不可读项）、`~/.gitconfig`
- **拒绝**：`~/.ssh`、`~/.gnupg`、`~/.Xauthority`、`~/.npmrc`、`~/.config/gh`、`~/.local/share/keyrings`、`/var/log`、`/run/user/1000/**`、`/proc/*/mem`、`/proc/*/environ`
- 判据：路径规范化（`realpath`）后匹配，禁止 `..`、symlink 逃逸（解析后判定）

### D2 bash 沙箱（bubblewrap）

```sh
exec /usr/bin/bwrap \
  --die-with-parent --new-session \
  --unshare-all \
  --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /sbin /sbin \
  --ro-bind /lib /lib --ro-bind /lib64 /lib64 \
  --ro-bind /etc /etc \
  --proc /proc --dev /dev --tmpfs /tmp --tmpfs /run \
  --tmpfs /home --dir /home/lab \
  --bind /home/lab/workspace /home/lab/workspace \
  --ro-bind /home/lab/.gitconfig /home/lab/.gitconfig \
  --ro-bind /dev/dri /dev/dri \
  --chdir /home/lab/workspace \
  /bin/bash -lc "$CMD"
```

要点：
- `--unshare-all` 含 **PID / 网络 / 挂载 / IPC / UTS** 命名空间 → `/proc` 只见沙箱内进程（T6 关闭），无网络（T8 默认关闭）
- `/home` 先 `--tmpfs` 再只挂工作区 → 家目录其余部分**不可见**（T4/T5 关闭），且绝对路径不变，脚本不用改
- `--dev /dev` 只给最小设备集 → `/dev/input` 不存在（T2 关闭）；`/dev/dri` 显式只读挂（GPU 监控需要）
- 不挂 `/var/run` 与 `/var/log` → T1、T7 关闭
- `--tmpfs /tmp` → X11 socket 不存在（T3 关闭）
- 网络放行需显式 `--share-net`（仅 `npm install`/`pip` 类命令允许，由策略按命令前缀判定）

### D3 进程可见性
- PID 命名空间已消除跨进程可见性；**Yama 保持 1 即可**（本来也是内核默认），不设 3、不重启。
- 不依赖 ptrace 限制作为主防线。

### D4 执行面闭合（必须，否则 D1/D2 可绕）
1. **MCP stdio 服务**：启动命令同样经 D2 包装（配置文件里写包装后的绝对路径）。
2. **插件清单**：只允许清单内插件；插件目录与配置文件本身纳入 §5 的自保护范围。
3. **skill/子代理**：不引入新的执行面（都经 bash 工具）。

## 5. 关键难题：闸门自保护（同 uid 可改自己的闸）

**问题**：单用户下，策略文件与包装脚本都在 AI 可写面。AI 可以改策略、改包装脚本、让下一次调用无沙箱。

**方案（本稿主张）**：
- 包装器与策略放在 **root 所有**路径：`/usr/local/lib/abathur/sandbox-exec`（0755 root:root）、`/etc/abathur/sandbox-policy.conf`（0644 root:root，`chattr +i`）
- 插件只持有**调用权**（路径写死在插件配置），无写权
- 安装=一次 `sudo` 落文件（不建账户、不改 sudoers、不留 root 常驻）
- 残余：插件本体仍在 `~/.config/opencode`（同 uid 可改）→ 见下

**残余与缓解**：
- R-D1：AI 改写插件 → 下次会话沙箱失效。缓解：插件加载时校验自身与策略的 sha256，不匹配则拒绝执行 bash 并告警（**弱**：校验代码本身可被改）。**这是本方案最弱的一环，须评审席给定性**。
- R-D2：已通过 bash 启动的常驻进程在沙箱外？不可能——所有 bash 都经包装器，除非存在未包装路径（见 D4）。
- R-D3：AI 用 `write` 工具写一个脚本，诱导机主在宿主机执行 → 回到全权（人类执行面，非本方案可控）。

## 6. 验收判据（机器可判）

**红队探针（在沙箱内必须全部失败）**：

| # | 命令 | 期望 |
|---|---|---|
| A1 | `cat ~/.ssh/id_*` | 不存在（No such file） |
| A2 | `cat ~/.npmrc` | 不存在 |
| A3 | `cat /proc/1/cmdline` | 沙箱 init，非宿主 systemd |
| A4 | `ls /proc \| wc -l` | ≤ 20（仅沙箱进程） |
| A5 | `curl --unix-socket /var/run/docker.sock http://x/_ping` | socket 不存在 |
| A6 | `head -c 16 /dev/input/event0` | 设备不存在 |
| A7 | `DISPLAY=:10 xdpyinfo` | 无法连接 |
| A8 | `cat /var/log/syslog` | 不存在 |
| A9 | `curl -m 3 https://example.com` | 无网络（除非显式放行） |
| A10 | `ls /run/user/1000` | 不存在 |

**功能探针（必须成功）**：
| # | 命令 | 期望 |
|---|---|---|
| B1 | 工作区内 `npm test` | rc=0 |
| B2 | `git status` / `git commit` | rc=0（读 `~/.gitconfig` 只读挂载） |
| B3 | 写工作区内文件 | 持久化生效 |
| B4 | `nvidia-smi` | rc=0（`/dev/dri` + 驱动面） |
| B5 | 显式放行的 `npm install`（带 `--share-net`） | rc=0 |

## 7. 失效模式与残余

| # | 失效 | 后果 | 处置 |
|---|---|---|---|
| F1 | 未包装的执行面（新插件/MCP） | 完全绕过 | D4 + 清单审计；每次变更重跑红队 |
| F2 | 内核逃逸 | 回到 lab 全权 | 非目标；靠内核更新 |
| F3 | 策略过严致工具不可用 | 产能下降 | 逐条给只读出口；先跑 B 组探针 |
| F4 | AI 改插件/策略 | 下轮失效 | §5 自保护；**弱环已具名** |
| F5 | 人类执行 AI 产出脚本 | 全权 | 人类面，非本方案域 |

## 8. 与 C（三账户）对照

| 维度 | C | D |
|---|---|---|
| 机主直接看到工作 | 否 | **是** |
| 系统账户变更 | 3 个 | 0 |
| sudoers/常驻 root | 1 条 + 2 个 root 落脚点 | 0 条 + 0 个常驻 |
| 会话库迁移 | 8.2G | 无 |
| 可移植（随包分发） | 弱 | **强** |
| 抗内核逃逸 | 是 | 否 |
| 改动面 | 账户/家目录/启动方式 | 一个包装脚本 + 策略文件 + 插件路由 |

## 9. 给评审席的开放问题

1. §5 的自保护弱环（插件可被同 uid 改写）是否足以否决整个方案？若否，接受的最低缓解是什么？
2. D2 的挂载清单是否遗漏必需项（尤其 `git`、`node`、`bwrap` 自身、动态链接器、locale）？
3. 路径策略（D1）与沙箱（D2）双轨是否有不一致窗口（工具层允许、沙箱拒绝或反之）？
4. 网络放行的粒度用「命令前缀白名单」是否可被绕过（如 `npm install && curl evil`）？
5. 与现有 `toolkit-exec.sh` 的关系：合并为一个包装器，还是保留两个（评审席给理由）？
