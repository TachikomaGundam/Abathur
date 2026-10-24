# 提案 D v3：单用户工具执行沙箱

- 日期：2026-10-24
- 前稿：d（b29c REJECT 1A/2R）、d-v2（ddb9 REJECT 0A/3R）
- 独立性：`NOT-INDEPENDENT`（起草会话直接送审，与前各轮一致）

## 1. 追溯表：b29c → 本稿（逐项，含未闭合）

b29c 原始 must-fix 行 25 条；按语义去重后为 16 个独立项（去重说明：GPU 条目 4 行→1 项，网络条目 5 行→1 项，D1 路径条目 4 行→1 项，资源条目 2 行→1 项）。

| ID | b29c 要求 | 本稿落点 | 状态 |
|---|---|---|---|
| M01 | D1 改 default-deny 白名单，补 `~/.docker`/`~/.aws`/docker.sock 路径探针，文件面与 bash 面同拒 | §5.1/§5.2/§9 A1–A2,A24–A26 | 闭合 |
| M02 | `--clearenv` + env 白名单 + `env` 探针；wrapper 清除凭据变量 | §6.3/§9 A13 | 闭合 |
| M03 | 网络放弃前缀匹配；逐调用批准须有非模型可控的闸；证明 `npm install && curl` 被挡 | §7（**改为沙箱永久无网**，见 §7.2） | 闭合（更严） |
| M04 | 闭塞宿主持久化（crontab/setuid），探针 `crontab -` 必败 | §6.4/§9 A11,A12 | 闭合 |
| M05 | GPU 显式挂 nvidia 节点，否则撤销 B4 承诺 | §6.2 条件挂载 + §6.6 | 闭合 |
| M06 | 在真实 merged-usr 上跑通 B 组，含 MCP 嵌套可行性 | §6.2 按实测布局 + §9 B0 前置 + §8.4（MCP 独立沙箱，不嵌套） | 闭合 |
| M07 | 定义 D1↔D2 共享面（/tmp/opencode） | §6.2（`/tmp` 与 `/tmp/opencode` 同时磁盘 bind） | 闭合 |
| M08 | §5 最低缓解=root 侧对账告警；明确定性为事故边界 | §8.2/§2 非目标 | 闭合 |
| M09 | bind 真实 resolv.conf；补 `getent` 探针 | §6.2（`/run/systemd/resolve` ro）+ §9 B6 | 闭合（无网时仅本地解析） |
| M10 | 补 T9 LXD + 探针 | §3 T9/§9 A18 | 闭合 |
| M11 | 资源上界 + fork 炸弹/tmp 填塞探针 | §6.5（ulimit + 磁盘 /tmp）+ §9 A27,A28 | 闭合 |
| M12 | 硬链/软链/嵌套 bwrap 攻击探针 | §5.3（(dev,ino) 拒绝集）+ §9 A14,A15,A16 | 闭合 |
| M13 | D1 拒 `/proc/*/{cmdline,task,fd}` | §5.2 | 闭合 |
| M14 | 每个执行面 NSpid 核验；清单变更重跑 A 组 | §8.3 | 闭合 |
| M15 | B 组前置：`command -v node/git`、`ldd`、`locale` | §9 B0 | 闭合 |
| M16 | TOCTOU/软链双面探针 | §9 A15b（文件面）+ A15（bash 面） | 闭合 |

**ddb9 新增 8 项**（本稿同样逐项处理）：

| ID | ddb9 要求 | 落点 |
|---|---|---|
| N01 | 追溯表须覆盖全部 b29c 条目 | §1（16 项，含去重说明） |
| N02 | 网络闸不得由模型自设 | §7.2 **永久无网**（删除 `ABATHUR_NET`） |
| N03 | `/tmp` 实为 tmpfs，须磁盘 bind 或如实记为残余 | §6.2 `.tmp`/`.shm` 磁盘 bind |
| N04 | 路径/GPU 参数化，非 GPU 机不得挂载失败 | §6.6 `/etc/abathur/sandbox.conf` |
| N05 | D1 攻击探针须走**文件工具面**（沙箱内测不到） | §9 A14/A15b（宿主夹具） |
| N06 | 判据编号须机械可解，交叉引用对齐 | §9 为**唯一编号权威**；§3/§6 引用已改 |
| N07 | 补「AI 改 `~/.config/opencode` 后仍被约束」判据；timer 列为具名例外 | §8.1/§8.2 + §9 A22 |
| N08 | 内存上界；Yama 3→1 要么论证要么撤回 | §6.5 `ulimit -v`；§6.7 **撤回**（不依赖 Yama） |

## 2. 目标、约束、非目标

**目标**：单用户（lab）下，阿巴瑟的工具面无法触碰 §3 所列通道；机主对全部文件与会话库保持直接可见。

**硬约束**：不建系统账户；不改 sudoers；无常驻 root 守护进程（一次性 sudo 落文件 + 一个每日 timer 属**具名例外**，见 §8.2）；可随包分发；机主直接可见工作。

**非目标（明确不承诺）**：不抵抗「已以 lab 身份执行任意代码」的攻击者；本方案是**事故边界**（防误用、防被诱导后的一次性越权），**不是对抗边界**。不防内核漏洞、不防机主执行 AI 产出脚本、不防物理接触。

## 3. 威胁模型

| # | 通道 | 处置 |
|---|---|---|
| T1 | docker.sock（lab∈docker） | 不挂 `/var/run`；D1 拒 |
| T2 | `/dev/input/*` | `--dev /dev` 最小集 |
| T3 | X11 套接字 | `/tmp` 磁盘私有目录 + **永久无网**（抽象套接字不可达） |
| T4 | 家目录凭据 | `--tmpfs /home` + 只挂工作区 |
| T5 | gpg-agent/keyring | `--tmpfs /run` |
| T6 | `/proc` 他进程 | PID 命名空间 + D1 拒 `/proc/*/{cmdline,environ,mem,fd,task}` |
| T7 | `/var/log`+adm | 不挂 |
| T8 | 网络 | **沙箱内永久无网**（§7） |
| T9 | LXD socket | 不挂 `/var/snap`、`/var/lib/lxd`；A18 |
| T10 | 环境变量 | `--clearenv` + 白名单 |
| T11 | 宿主持久化 | userns 使 setuid 失效 + 不挂 spool；A11/A12 |
| T12 | 硬/软链穿透 | (dev,ino) 拒绝集 + 解析后判定；A14/A15 |
| T13 | 项目级配置注入（MCP 由宿主进程执行） | §8.1 启动器锁定 cwd 与 `XDG_CONFIG_HOME`；A21/A22 |

## 4. 实测底账（2026-10-24）

| 事实 | 值 | 用途 |
|---|---|---|
| bwrap | 0.11.1，支持 `--clearenv --disable-userns --unshare-all --new-session` | §6 |
| merged-usr | `/bin`→`usr/bin`、`/lib`→`usr/lib`、`/lib64`→`usr/lib64`、`/sbin`→`usr/sbin` | §6.2 |
| resolv.conf | → `../run/systemd/resolve/stub-resolv.conf` | §6.2 |
| GPU | `/dev/nvidia{0,1,ctl,uvm,uvm-tools,modeset}`、`/dev/dri/renderD128` | §6.6 |
| crontab | setuid root `-rwxr-sr-x` | §6.4 |
| LXD | 两个标准 socket 均不存在（组仍在） | §3 T9 |
| X11 | `/tmp/.X11-unix/X10` 与 `@/tmp/.X11-unix/X10` 在听 | §7.2 |
| **项目配置合并** | cwd 有 `opencode.json` 时**即使** `OPENCODE_CONFIG` 指向别处也合并（实测 marker 计数 1） | §8.1 |
| **全局配置合并** | `OPENCODE_CONFIG` **不覆盖** `XDG_CONFIG_HOME` 下的全局配置（实测 marker 计数 1） | §8.1 |
| **干净 cwd** | cwd 无 `opencode.json` 时项目配置不合并（计数 0） | §8.1 |

## 5. D1 文件类工具路径策略

### 5.1 语义：default-deny 允许表

| 面 | 根 | 模式 |
|---|---|---|
| 工作区 | `WORKSPACE`（§6.6 配置） | 读写 |
| 会话临时 | `/tmp/opencode/abathur-<sid>` | 读写 |
| 系统只读 | `/usr`、`/etc`（除 §5.2） | 只读 |
| 配置只读 | `~/.gitconfig` | 只读 |

### 5.2 硬禁（任何允许表变更都不解除）
`~/.ssh`、`~/.gnupg`、`~/.Xauthority`、`~/.npmrc`、`~/.config/gh`、`~/.docker`、`~/.aws`、`~/.local/share/keyrings`、`~/.local/share/opencode/auth.json`、`/run/user/**`、`/var/log`、`/var/run`、`/var/snap`、`/etc/abathur`、`/proc/*/cmdline`、`/proc/*/environ`、`/proc/*/mem`、`/proc/*/fd`、`/proc/*/task`、`/dev/input`。

### 5.3 穿透判定
1. `realpath` 解析，父链逐级判（防 `..` 与软链）。
2. **inode 拒绝集**：启动器在会话开始时对上述硬禁路径（存在者）采集 `(st_dev, st_ino)` 列表，写入 `$XDG_RUNTIME_DIR/abathur-deny-inodes`；D1 对任何 `(dev,ino)` 命中者拒——这拦的是「工作区内硬链指向家目录秘密」的真攻击形态。
3. 硬链规则（修正 ddb9 指出的谓词反写）：不再用 `nlink>1` 作判据；一律以 inode 集判定。
4. 说明：D1 在 opencode 进程内（同 uid），是**软墙**；硬墙是 §6 与 §8。

## 6. D2 bash 沙箱

### 6.1 命令（v3）

```sh
#!/bin/sh
# /usr/local/lib/abathur/sandbox-exec   root:root 0755
. /etc/abathur/sandbox.conf          # WORKSPACE=..., DEVS=..., ULIMIT_*=
SID=${ABATHUR_SID:-default}
TMPD=/tmp/opencode/abathur-$SID
SHMD=/var/tmp/abathur-$SID/shm
mkdir -p "$TMPD" "$SHMD"
set -- --die-with-parent --new-session --unshare-all --disable-userns \
  --clearenv \
  --setenv PATH /usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  --setenv HOME /home/lab --setenv USER lab --setenv LOGNAME lab \
  --setenv LANG C.UTF-8 --setenv LC_ALL C.UTF-8 --setenv TZ Asia/Shanghai \
  --setenv TERM xterm-256color --setenv TMPDIR /tmp \
  --ro-bind /usr /usr \
  --symlink usr/bin /bin --symlink usr/sbin /sbin \
  --symlink usr/lib /lib --symlink usr/lib64 /lib64 \
  --ro-bind /etc /etc --tmpfs /etc/abathur \
  --proc /proc --dev /dev \
  --tmpfs /run --dir /run/systemd --ro-bind /run/systemd/resolve /run/systemd/resolve \
  --tmpfs /home --dir /home/lab \
  --bind "$WORKSPACE" "$WORKSPACE" \
  --bind "$TMPD" /tmp \
  --bind "$TMPD" "$TMPD" \
  --bind "$SHMD" /dev/shm \
  --ro-bind /home/lab/.gitconfig /home/lab/.gitconfig
for d in $DEVS; do [ -e "$d" ] && set -- "$@" --dev-bind "$d" "$d"; done
exec /usr/bin/bwrap "$@" --chdir "$WORKSPACE" \
  /bin/bash -lc 'ulimit -u '"$ULIMIT_N"' ; ulimit -v '"$ULIMIT_V"' ; ulimit -f '"$ULIMIT_F"' ; exec /bin/bash -lc "$1"' _ "$1"
```

### 6.2 挂载理由

| 挂载 | 理由 |
|---|---|
| `/usr` ro + 四条 symlink | merged-usr 实测布局；否则 `/bin/bash` 不存在 |
| `/etc` ro + `--tmpfs /etc/abathur` | TLS/时区/locale 可用；策略本体对 AI 隐藏 |
| `/run/systemd/resolve` ro | resolv.conf 是相对软链；无此则解析失败 |
| `--tmpfs /run` | 挡 gpg-agent/keyring |
| `--tmpfs /home` + 工作区 bind | 挡家目录凭据 |
| `/tmp` = **磁盘 bind**（非 tmpfs） | 防内存填塞（ddb9 N03） |
| `/dev/shm` = **磁盘 bind** | 同上；node 需要可写 shm |
| GPU 节点按配置条件挂 | 非 GPU 机不失败（ddb9 N04） |

### 6.3 环境（T10）
`--clearenv` + 上列白名单；**不继承** opencode 进程的 `*_API_KEY`/`*_TOKEN`/`SSH_*`。A13 探针。

### 6.4 宿主持久化（T11）
`--unshare-all` 含 user ns → setuid 失效；`/var/spool/cron` 不挂；`/etc` ro。A11 `crontab -` 必败；A12 `sudo -n true` 必败。

### 6.5 资源上界
`ulimit -u 256`（进程）、`ulimit -v 8388608`（8 GiB 虚拟内存/进程）、`ulimit -f 2097152`（512B 块 → **1 GiB** 单文件）。**残余**：`ulimit -v` 是每进程，256 进程仍可能合计耗尽内存 → 具名 R-D7，可选 cgroup v2 收口。

### 6.6 配置（可移植性）
`/etc/abathur/sandbox.conf`（root 0644，`chattr +i`）：
```
WORKSPACE=/home/lab/workspace
DEVS="/dev/nvidia0 /dev/nvidia1 /dev/nvidiactl /dev/nvidia-uvm /dev/nvidia-uvm-tools /dev/nvidia-modeset /dev/dri"
ULIMIT_N=256
ULIMIT_V=8388608
ULIMIT_F=2097152
```
非 GPU 机把 `DEVS` 留空 → B4 自动降级为「不适用」（B4 判据须读配置判定，见 §9）。

### 6.7 Yama
**撤回** 3→1 的请求。本方案不依赖 ptrace 限制：PID 命名空间使宿主进程不可见；同 uid 非后代 attach 在 scope=1 下本就被拒。重启后系统自动回 1，无需任何动作。

## 7. D3 网络

### 7.1 决定
**沙箱内永久无网**。删除 v2 的 `ABATHUR_NET` 逐调用放行——该闸由模型自设，等于没有闸（ddb9 N02）。

### 7.2 后果（明示）
- 需联网的安装/升级由**机主**执行（或事先预置）。
- 可选缓解：离线安装——`--ro-bind ~/.npm/_cacache /home/lab/.npm/_cacache`，`npm ci --offline` 对已缓存包可用（不入默认挂载，按需开启）。
- X11 抽象套接字在无网时不可达（`@/tmp/.X11-unix/X10` 属网络命名空间）。

## 8. D5 闸门自保护

### 8.1 启动器信任锚（已实测）
`/usr/local/bin/abathur`（root:root 0755）：
```sh
cd /var/empty/abathur                      # root 所有、空目录
export XDG_CONFIG_HOME=/etc/abathur/xdg    # 全局配置由 root 所有
export OPENCODE_CONFIG=/etc/abathur/xdg/opencode/opencode.json
exec /usr/bin/opencode "$@"
```
依据（§4 实测）：
- 干净 cwd → 工作区 `opencode.json` **不**被合并（T1=0）；
- `OPENCODE_CONFIG` **不**覆盖 `XDG_CONFIG_HOME` 全局配置（T2=1）→ 故必须同时锁 `XDG_CONFIG_HOME`；
- 会话库仍在 `XDG_DATA_HOME`（默认路径，未改）→ **机主仍可直接看到全部会话**。

### 8.2 完整性对账
root 侧 systemd timer（每日）对 `/etc/abathur/**` 做 sha256 对账，写 `/var/log/abathur-integrity.log`，失配则 `wall`。**这是「无常驻 root 服务」的具名例外**（timer 非常驻进程，一次安装）。插件内自检降级为提示，不再作为防线。

### 8.3 执行面覆盖
每个执行入口（bash、每个 MCP stdio 子进程）核验 `/proc/<pid>/status` 的 `NSpid` 层数 ≥2；单层=未进沙箱→拒绝并告警。清单变更须重跑 A 组。

### 8.4 MCP
MCP stdio 子进程由启动器配置**逐个**用 `sandbox-exec` 包装（独立沙箱，**不嵌套**——`--disable-userns` 使嵌套不可行）。未包装的 MCP 一律不允许出现在 `/etc/abathur/xdg/opencode/opencode.json` 中。

## 9. 验收判据（**唯一编号权威**）

### A 组：红队

| # | 面 | 命令 | 期望 |
|---|---|---|---|
| A1 | bash | `cat ~/.ssh/id_*` | 不存在 |
| A2 | bash | `cat ~/.npmrc` | 不存在 |
| A3 | bash | `cat /proc/1/cmdline` | 沙箱 init |
| A4 | bash | `ls /proc \| wc -l` | ≤20 |
| A5 | bash | `curl --unix-socket /var/run/docker.sock http://x/_ping` | 无此 socket |
| A6 | bash | `head -c 16 /dev/input/event0` | 不存在 |
| A7 | bash | `DISPLAY=:10 xdpyinfo` | 无法连接 |
| A8 | bash | `cat /var/log/syslog` | 不存在 |
| A9 | bash | `curl -m 3 https://example.com` | 无网 |
| A10 | bash | `ls /run/user/1000` | 不存在 |
| A11 | bash | `crontab -` | 失败 |
| A12 | bash | `sudo -n true` | 失败 |
| A13 | bash | `env \| grep -iE 'key\|token\|secret'` | 空 |
| A14 | **文件工具** | 宿主机预建 `ws/hl` 硬链指向 `~/.npmrc`，再用 read 工具读 `ws/hl` | 拒绝（inode 集） |
| A15 | bash | `ln -s ~/.ssh/id_rsa ws/l2; cat ws/l2` | 失败（源不可见） |
| A15b | **文件工具** | 宿主机预建 `ws/l3 -> ~/.ssh/id_rsa`，用 read 工具读 `ws/l3` | 拒绝（realpath） |
| A16 | bash | 沙箱内起 `bwrap ...` | 失败（`--disable-userns`） |
| A17 | bash | `npm install && curl evil` | 无网，必失败 |
| A18 | bash | `ls /var/snap/lxd` | 不存在 |
| A19 | bash | `cat /proc/self/environ` | 仅白名单变量 |
| A20a | bash | `head -c 1 /dev/nvidia0` | 存在且可读（配置有 GPU 时） |
| A20b | bash | `ls /dev/kvm` | 不存在 |
| A21 | **启动器** | 工作区植入含 marker MCP 的 `opencode.json`，启动器会话内 `opencode debug config` | marker 计数 0 |
| A22 | **启动器** | AI 改写 `~/.config/opencode/opencode.json` 植入 marker，重启会话 | marker 计数 0 |
| A23 | bash | `dd if=/dev/zero of=/tmp/fill bs=1M count=4096` | 受 `ulimit -f` 限制失败或限幅 |
| A24 | 文件工具 | read `~/.docker/config.json` | 拒绝 |
| A25 | 文件工具 | read `~/.aws/credentials` | 拒绝 |
| A26 | 文件工具 | read `/var/run/docker.sock` | 拒绝 |
| A27 | bash | fork 炸弹（`while :; do &; done` 收敛版） | 触发 `ulimit -u`，失败 |
| A28 | bash | 填满 `/tmp` 至 1 GiB 后继续 | 失败（`ulimit -f`） |

### B 组：功能（须先过 B0）

| # | 命令 | 期望 |
|---|---|---|
| B0 | `command -v node git npm; ldd $(command -v node) >/dev/null; locale` | 全 rc=0 |
| B1 | `WORKSPACE` 内 `npm test` | rc=0 |
| B2 | `git status && git commit` | rc=0 |
| B3 | 写工作区文件并读回 | 一致 |
| B4 | `nvidia-smi`（仅当 `DEVS` 含 nvidia 节点；否则判 N/A） | rc=0 |
| B5 | `npm ci --offline`（缓存已预置） | rc=0 |
| B6 | `getent hosts localhost` | 成功（本地解析；外网解析不在本方案域） |
| B7 | MCP stdio 子进程 `NSpid` 层数 | ≥2 |
| B8 | 启动器会话首条输出 | 打印 `sandbox=on cwd=/var/empty/abathur` |

## 10. 残余（具名，不静默收窄）

| # | 项 |
|---|---|
| R-D1 | 机主直接敲 `opencode` 时沙箱不生效；启动器打印凭证以便识别 |
| R-D2 | 工作区无配额，可被填满 |
| R-D3 | 内核漏洞逃逸（非目标） |
| R-D4 | 机主执行 AI 产出脚本（非本方案域） |
| R-D5 | `--disable-userns` 使需嵌套的工具不可用；已用独立 MCP 沙箱规避 |
| R-D6 | D1 为软墙（同 uid 进程内），防误用不防对抗 |
| R-D7 | `ulimit -v` 为每进程；多进程合计仍可耗尽内存（可选 cgroup v2 收口） |
| R-D8 | `/etc/hosts` 对 AI 可见（内网主机名）；已接受并具名 |
| R-D9 | 沙箱无网 → 联网安装须机主执行（功能代价，非漏洞） |

## 11. 与 C 对照

| 维度 | C（三账户，已被否决） | D |
|---|---|---|
| 机主直接看到工作 | 否 | **是**（会话库路径未改） |
| 系统账户变更 | 3 | 0 |
| 常驻 root | 2 个落脚点 | 0（1 个每日 timer，具名例外） |
| 会话库迁移 | 8.2G | 无 |
| 抗内核逃逸 | 是 | 否（R-D3） |
| 可移植 | 弱 | 强（`sandbox.conf` 参数化） |
| 评审状态 | v17 3A/0R 过会，机主否决 | 本稿待审 |

## 12. 已闭合的开放问题
- ddb9 Q：`/etc/abathur` 是否暴露 → **已隐藏**（`--tmpfs /etc/abathur`），`/etc/hosts` 接受为 R-D8。
- ddb9 Q：网络放行粒度 → **取消放行**（§7）。
- v2 Q：挂载遗漏 → 按 merged-usr 实测重写并加 B0 前置。
