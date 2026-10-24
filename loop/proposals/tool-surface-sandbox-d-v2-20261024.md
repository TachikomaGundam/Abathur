# 提案 D v2：单用户工具执行沙箱

- 日期：2026-10-24
- 前稿：tool-surface-sandbox-d-20261024.md（b29c 庭 REJECT 1A/2R，约 20 条 must-fix）
- 本稿对每条 must-fix 的处理见 §1 映射表；未解决项一律在 §10 具名，不静默收窄
- 独立性声明：本稿由起草会话直接送审，`independence=NOT-INDEPENDENT`（与前各轮一致）

## 1. must-fix 映射（b29c → 本稿）

| # | b29c 意见 | 本稿落点 |
|---|---|---|
| 1 | D1 是 deny-list，不是 default-deny | §5.1 改语义 + 全量允许表 |
| 2 | 缺 `--clearenv`，API key 随环境泄入 | §6.3 `--clearenv` + 显式 setenv 白名单 |
| 3 | 网络前缀白名单可绕（`npm install && curl`） | §7 逐调用显式批准 + 默认 `--ignore-scripts` |
| 4 | 宿主持久化（crontab 等）未封闭 | §6.4 no_new_privs/userns + 不挂 spool + A12/A13 |
| 5 | GPU 缺 `/dev/nvidia*` | §6.2 显式 dev-bind 五节点 |
| 6 | 未在真实 merged-usr 布局验证 | §6.2 已按实测布局（/bin→usr/bin 等）重写 + B 组前置 |
| 7 | `/tmp/opencode` 双轨不一致 | §6.2 沙箱内同路径 bind 同一目录 |
| 8 | §5 自保护弱环 | §8 改为 root 所有启动器 + 配置，明确定性 |
| 9 | 资源上界缺失（fork 炸弹/tmp 填塞） | §6.5 ulimit + /tmp 落磁盘非 tmpfs |
| 10 | 缺攻击探针（硬链/软链/嵌套/env） | §9 A14–A18 |
| 11 | D1 未拒 `/proc/*/cmdline` | §5.2 补 |
| 12 | LXD 同形通道未列 | §3 T9 + A19（实测两处标准 socket 均不存在） |
| 13 | 需 NSpid 成员核验 | §8.3 每执行面核验 |

## 2. 目标与约束

**目标**：单用户（lab）下，使阿巴瑟的工具面无法触碰下列能力；机主保持对全部文件与会话库的直接可见性。

**硬约束**：不新增系统账户；不新增 sudoers 授权；无常驻 root 服务（一次 `sudo` 落文件除外）；可随包分发；机主直接可见工作。

**非目标（明确不承诺）**：
- 不承诺抵抗「已经以 lab 身份执行任意代码」的攻击者——本方案是**事故边界**（防止正常工作中的越界与误用、防止模型被诱导后的一次性越权），**不是对抗边界**。
- 不防内核漏洞、不防机主自己执行 AI 产出的脚本、不防物理接触。

## 3. 威胁模型

| # | 通道 | 危害 | 本方案处置 |
|---|---|---|---|
| T1 | docker.sock（lab∈docker） | 容器内 root | 沙箱不挂 /var/run；D1 拒路径 |
| T2 | /dev/input/event* | 键盘记录 | `--dev /dev` 最小设备集 |
| T3 | X11（/tmp/.X11-unix + 抽象套接字） | 截屏/模拟输入 | tmpfs 隐藏 + 无网默认 |
| T4 | 家目录凭据（.ssh/.gnupg/.npmrc/.config/gh/keyrings） | 凭据、签名 | `--tmpfs /home` + 只挂工作区 |
| T5 | gpg-agent / keyring socket（/run/user/1000） | 借密钥 | `--tmpfs /run` |
| T6 | /proc 他进程 | 命令行/内存/fd | PID 命名空间 + D1 拒 /proc/*/{cmdline,environ,mem,fd,task} |
| T7 | /var/log + adm | 全量日志 | 不挂 /var/log |
| T8 | 网络 | 外发/拉载荷 | 默认无网；逐调用显式放行 |
| T9 | LXD socket（lab∈lxd） | 容器逃逸（与 docker 同形） | 不挂 /var/snap、/var/lib/lxd；A19 探针 |
| T10 | 环境变量 | API key/token 泄入沙箱 | `--clearenv` + 白名单 |
| T11 | 宿主持久化（crontab/systemd user units） | 下轮在沙箱外执行 | userns+no_new_privs 使 setuid 失效；不挂 spool；A12/A13 |
| T12 | 空挂载/穿透（硬链、软链） | 绕过路径策略 | §5.3 规范化 + A14/A15 |

## 4. 实测底账（2026-10-24）

| 事实 | 值 |
|---|---|
| bwrap | 0.11.1；支持 `--clearenv` `--disable-userns` `--unshare-all` `--share-net` `--new-session` |
| merged-usr | `/bin`→`usr/bin`、`/lib`→`usr/lib`、`/lib64`→`usr/lib64`、`/sbin`→`usr/sbin` |
| resolv.conf | `/etc/resolv.conf` → `../run/systemd/resolve/stub-resolv.conf` |
| GPU 节点 | `/dev/nvidia0` `/dev/nvidia1` `/dev/nvidiactl` `/dev/nvidia-uvm` `/dev/nvidia-uvm-tools` `/dev/nvidia-modeset`；`/dev/dri/renderD128` |
| crontab | `/usr/bin/crontab` 为 setuid root（`-rwxr-sr-x root crontab`） |
| lxd socket | `/var/snap/lxd/common/lxd/unix.socket` 与 `/var/lib/lxd/unix.socket` **均不存在** |
| node | `/usr/bin/node`，依赖 `/usr/lib/x86_64-linux-gnu/libnode.so.127` |
| X11 | `/tmp/.X11-unix/X10` 与 `@/tmp/.X11-unix/X10` 双套接字在听 |
| Yama | 当前 3（误写遗留）；目标值 1，不需要 3 |

## 5. D1 文件类工具路径策略（default-deny）

### 5.1 语义
**默认拒绝**。未在允许表中出现者一律拒绝——不写 deny 列表，避免「漏列即放行」。

| 面 | 根 | 模式 |
|---|---|---|
| 工作区 | `/home/lab/workspace` | 读写 |
| 会话工作区 | `/tmp/opencode/abathur-<sid>` | 读写（见 §6.2 同路径可见） |
| 只读系统 | `/usr`、`/etc`、`/proc/self`、`/sys/class/drm` | 只读 |
| 只读配置 | `~/.gitconfig` | 只读 |

### 5.2 显式拒绝（即使未来有人往允许表加，也永不放行的硬禁）
`~/.ssh`、`~/.gnupg`、`~/.Xauthority`、`~/.npmrc`、`~/.config/gh`、`~/.docker`、`~/.aws`、`~/.local/share/keyrings`、`/run/user/**`、`/var/log`、`/var/run`、`/proc/*/cmdline`、`/proc/*/environ`、`/proc/*/mem`、`/proc/*/fd`、`/proc/*/task`、`/dev/input`。

### 5.3 规范化与穿透
- `realpath` 解析后再判；父目录链逐级判（防 `..`）。
- 硬链：`stat` 的 `nlink>1` 且路径不在允许根内 → 拒（A14）。
- 软链：解析目标后按目标判（A15）。
- 说明：D1 运行在 opencode 进程内（同 uid），是**软墙**；硬墙见 §6/§8。

## 6. D2 bash 沙箱

### 6.1 完整命令行（v2）

```sh
#!/bin/sh
# /usr/local/lib/abathur/sandbox-exec  (root:root 0755)
SID=${ABATHUR_SID:-default}
WS=/home/lab/workspace
TMPD=/tmp/opencode/abathur-$SID
mkdir -p "$TMPD"
exec /usr/bin/bwrap \
  --die-with-parent --new-session --unshare-all --disable-userns \
  --clearenv \
  --setenv PATH /usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  --setenv HOME /home/lab --setenv USER lab --setenv LOGNAME lab \
  --setenv LANG C.UTF-8 --setenv LC_ALL C.UTF-8 --setenv TZ Asia/Shanghai \
  --setenv TERM xterm-256color \
  --ro-bind /usr /usr \
  --symlink usr/bin /bin --symlink usr/sbin /sbin \
  --symlink usr/lib /lib --symlink usr/lib64 /lib64 \
  --ro-bind /etc /etc \
  --proc /proc --dev /dev \
  --tmpfs /run --dir /run/systemd --ro-bind /run/systemd/resolve /run/systemd/resolve \
  --tmpfs /home --dir /home/lab \
  --bind "$WS" "$WS" \
  --bind "$TMPD" "$TMPD" \
  --ro-bind /home/lab/.gitconfig /home/lab/.gitconfig \
  --dev-bind /dev/nvidia0 /dev/nvidia0 \
  --dev-bind /dev/nvidia1 /dev/nvidia1 \
  --dev-bind /dev/nvidiactl /dev/nvidiactl \
  --dev-bind /dev/nvidia-uvm /dev/nvidia-uvm \
  --dev-bind /dev/nvidia-uvm-tools /dev/nvidia-uvm-tools \
  --dev-bind /dev/nvidia-modeset /dev/nvidia-modeset \
  --dev-bind /dev/dri /dev/dri \
  --chdir "$WS" \
  /bin/bash -lc 'ulimit -u 512; ulimit -f 2097152; exec /bin/bash -lc "$1"' _ "$1"
```

### 6.2 挂载理由（逐条）

| 挂载 | 为什么 | 不挂会怎样 |
|---|---|---|
| `/usr` ro + 四个 symlink | merged-usr 下 `/bin` 等是指向 `/usr` 的链接 | 找不到 `/bin/bash` |
| `/etc` ro | 时区、locale、SSL 证书、动态链接 | TLS/时间/字符集全坏 |
| `/run/systemd/resolve` ro | `resolv.conf` 是相对软链，指向 `/run` | DNS 全灭（b29c 指出） |
| `--tmpfs /run` | 挡 gpg-agent/keyring socket | T5 通道开着 |
| `--tmpfs /home` + 只挂工作区 | 挡 `.ssh/.gnupg/.npmrc/...` | T4 通道开着 |
| `/tmp` 用**磁盘目录**（非 tmpfs） | tmpfs 是内存盘，填塞=打死整机 | 内存耗尽 |
| nvidia 六节点 + dri | nvidia-smi / GPU 监控 | B4 必挂（b29c 指出） |
| `/dev/input` 不挂 | 键盘记录 | T2 开着 |

### 6.3 环境（T10）
`--clearenv` + 仅显式 `--setenv`；不继承 opencode 的 `OPENAI_API_KEY`/`GH_TOKEN`/`NPM_TOKEN`。A16 探针：`env` 内无 key/token。

### 6.4 宿主持久化（T11）
- `--unshare-all` 含 user 命名空间 → setuid 位在沙箱内失效（`crontab`、`sudo` 都拿不到 root）。
- 不挂 `/var/spool/cron`、`/etc/cron.d` 可读不可写（`/etc` ro）。
- A12 `crontab -` 必须失败；A13 `sudo -n true` 必须失败。

### 6.5 资源上界
`ulimit -u 512`（进程数）、`ulimit -f 2G`（单文件）。剩余风险：工作区可被填满（无配额）→ R-D5。

## 7. D3 网络（T8）
- 默认**无网**（`--unshare-all`）。
- 放行=**逐调用显式批准**（调用方带 `ABATHUR_NET=1`，wrapper 才加 `--share-net`），不做命令前缀匹配（b29c 证伪）。
- 放行时强制 `npm_config_ignore_scripts=1`（除非调用方另带 `ABATHUR_ALLOW_SCRIPTS=1`）。
- 明示：**任何 `npm install` 放行 = 任意代码 + 全网**；这是放行的定义，不是漏洞。
- A17 探针：`npm install && curl` 在未放行调用中必须失败。

## 8. D5 闸门自保护（b29c 的核心质疑）

### 8.1 信任锚
- `/usr/local/bin/abathur`（root:root 0755）：机主启动入口。它**强制** `OPENCODE_CONFIG=/etc/abathur/opencode/opencode.jsonc`、`OPENCODE_PLUGIN_DIR` 指向 root 所有目录，然后 exec 真正的 opencode。
- `/etc/abathur/**`（root:root，`chattr +i`）：策略、插件、包装器。
- 因此：AI 改 `~/.config/opencode` 对**经启动器**的会话无效。
- **残余（必须明示）**：机主若直接敲 `opencode` 而非 `abathur`，沙箱不生效。启动器应在会话首条消息打印一行「sandbox=on」凭证（可被机主一眼核验）。

### 8.2 对账
- root 侧 systemd timer（每日）对 `/etc/abathur/**` 做 sha256 对账，写入 `/var/log/abathur-integrity.log`，不匹配则 `wall` 告警。一次 sudo 安装，无常驻进程。
- 插件内自检降级为「提示」，不再作为防线宣称（b29c 要求）。

### 8.3 执行面覆盖核验
每个执行入口（bash 工具、每个 MCP stdio 子进程）启动后核验 `/proc/<pid>/status` 的 `NSpid` 有多层（沙箱内）——单层=未进沙箱→拒绝继续并告警。

## 9. 验收判据

### A 组：红队（沙箱内必须失败）

| # | 命令 | 期望 |
|---|---|---|
| A1 | `cat ~/.ssh/id_*` | 不存在 |
| A2 | `cat ~/.npmrc` | 不存在 |
| A3 | `cat /proc/1/cmdline` | 沙箱 init |
| A4 | `ls /proc \| wc -l` | ≤20 |
| A5 | `curl --unix-socket /var/run/docker.sock http://x/_ping` | socket 不存在 |
| A6 | `head -c 16 /dev/input/event0` | 设备不存在 |
| A7 | `DISPLAY=:10 xdpyinfo` | 无法连接 |
| A8 | `cat /var/log/syslog` | 不存在 |
| A9 | `curl -m 3 https://example.com` | 无网 |
| A10 | `ls /run/user/1000` | 不存在 |
| A11 | `crontab -` | 失败（T11） |
| A12 | `sudo -n true` | 失败（T11） |
| A13 | `env \| grep -iE 'key\|token\|secret'` | 空（T10） |
| A14 | `ln ~/.ssh/id_rsa ws/leak; cat ws/leak` | 失败（硬链） |
| A15 | `ln -s ~/.ssh/id_rsa ws/l2; cat ws/l2` | 失败（软链） |
| A16 | 沙箱内 `bwrap ...`（嵌套） | 失败（`--disable-userns`） |
| A17 | `npm install && curl evil`（未放行） | 失败 |
| A18 | `ls /var/snap/lxd` | 不存在（T9） |
| A19 | `cat /proc/self/environ` | 只有白名单变量 |
| A20 | `head -c 1 /dev/nvidia0` 之外的设备（如 `/dev/kvm`） | 不存在 |

### B 组：功能（必须成功；须先过 B0 前置）

| # | 命令 | 期望 |
|---|---|---|
| B0 | `command -v node git npm; ldd $(command -v node) >/dev/null; locale` | 全 rc=0 |
| B1 | 工作区 `npm test` | rc=0 |
| B2 | `git status && git commit` | rc=0 |
| B3 | 写工作区文件并读回 | 一致 |
| B4 | `nvidia-smi` | rc=0 |
| B5 | 放行 `npm install`（`--ignore-scripts`） | rc=0 |
| B6 | `getent hosts registry.npmjs.org`（放行时） | 解析成功 |
| B7 | MCP stdio 子进程 NSpid 层数 | ≥2 |
| B8 | `abathur` 启动器会话 | 首条消息打印 sandbox=on |

## 10. 未解决与具名残余

| # | 项 | 状态 |
|---|---|---|
| R-D1 | 机主直接敲 `opencode` 时无沙箱 | 设计上无法阻止；启动器打印凭证以便一眼识别 |
| R-D2 | 工作区无配额，可被填满 | 具名；可用 `df` 闸门但非强制 |
| R-D3 | 内核漏洞逃逸 | 非目标 |
| R-D4 | 人类执行 AI 产出脚本 | 非本方案域 |
| R-D5 | `--disable-userns` 与部分工具冲突（需嵌套者） | 已用「MCP 独立沙箱」规避；若遇不可绕工具，需逐项豁免并具名 |
| R-D6 | D1 是软墙（同 uid 进程内） | 明示；D1 防误用，D2/§8 防越权 |

## 11. 与 C 对照

| 维度 | C（三账户） | D（本方案） |
|---|---|---|
| 机主直接看到工作 | 否（被否决） | 是 |
| 系统账户变更 | 3 | 0 |
| 常驻 root | 2 个落脚点 | 0（一个 timer） |
| 会话库迁移 | 8.2G | 无 |
| 抗内核逃逸 | 是 | 否（具名） |
| 改动面 | 账户/家目录/启动方式 | 启动器 + 包装器 + 策略 + 插件路由 |
| 已验证 | v17 3A/0R 过会 | 本稿待审 |

## 12. 给评审席的剩余开放问题
1. §8 的「启动器信任锚」是否足以让 D 达到可批准状态？若否，缺什么最小件？
2. §6 挂载清单在真实 merged-usr 上是否仍有遗漏（欢迎直接给缺失项）？
3. §7 的逐调用放行是否可被「放行调用内部再起后台进程」绕过（`ABATHUR_NET=1 sh -c 'curl &'`）？若有，给修法。
4. `/etc` 全量 ro 挂载是否暴露了本不该给 AI 的文件（如 `/etc/abathur` 策略本身、`/etc/hosts` 中的内网名）？
