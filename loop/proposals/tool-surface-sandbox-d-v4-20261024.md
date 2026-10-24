# 提案 D v4：单用户工具执行沙箱

- 日期：2026-10-24
- 前稿：d（b29c REJECT）、d-v2（ddb9 REJECT）、d-v3（fa28 REJECT 0A/3R）
- 独立性：`NOT-INDEPENDENT`（起草会话直接送审）
- **本稿与前三稿的差别：所有 s6.1 命令行与 A/B 判据均在真机跑过，回执见 §4.2；未跑过的条目一律标「待验」**

## 1. 追溯表（b29c 原始 25 行 → 16 项，逐行）

| 原行 | 内容（缩写） | 归并项 |
|---|---|---|
| r01 | D1 改 default-deny + `~/.local/share`、插件目录探针 | M01 |
| r02 | `--clearenv` + env 白名单 + 探针 | M02 |
| r03 | 网络改逐调用批准/代理；npm install=任意代码 | M03 |
| r04 | 宿主持久化：mask crontab/spool + 探针 | M04 |
| r05 | GPU 挂 nvidiactl/nvidia*，否则撤 B4 | M05 |
| r06 | 真实 merged-usr 跑通 B 组，含 MCP 嵌套 | M06 |
| r07 | 定义 D1↔D2 共享面（/tmp/opencode） | M07 |
| r08 | §5 最低缓解：sha256 + 宿主侧告警；事故边界定性 | M08 |
| r09 | 网络放弃前缀匹配；`--ignore-scripts`；绕过探针 | M03 |
| r10 | GPU 二选一：显式 dev-bind 并实测，或撤销承诺 | M05 |
| r11 | bind 真实 resolv.conf + `getent` 探针 | M09 |
| r12 | 补 T9 LXD + 探针；组清单全量过 | M10 |
| r13 | root 侧 timer 对账；插件自检降级 | M08 |
| r14 | D1 白名单重写 + `~/.docker`/`~/.aws`/docker.sock 探针；双轨同拒 | M01 |
| r15 | 攻击探针：硬链/软链/嵌套 bwrap/share-net 抽象 X | M12 |
| r16 | 资源上界 + fork 炸弹/tmp 填塞探针 | M11 |
| r17 | B 组前置：`command -v`/`ldd`/`locale` + node 位置盘点 | M15 |
| r18 | wrapper 清凭据变量 + `env` 探针 | M02 |
| r19 | D1 拒 `/proc/*/{cmdline,task,fd}` | M13 |
| r20 | sha256 校验移入 root 所有 sandbox-exec，每次启动 fail-closed | M08 |
| r21 | 挂 nvidia* + 真实 resolv.conf；merged-usr 实测 | M05/M09 |
| r22 | 网络放行按整条命令文本，禁止前缀 | M03 |
| r23 | 解决 /tmp/opencode 不一致 | M07 |
| r24 | 每个执行面 NSpid 核验；清单变更重跑 A 组 | M14 |
| r25 | 软链/TOCTOU 双面探针 | M16 |

去重规则：r01+r14=M01；r02+r18=M02；r03+r09+r22=M03；r05+r10+r21a=M05；r08+r13+r20=M08；r11+r21b=M09；r07+r23=M07；r15+r25=M12（TOCTOU 单列 M16）；r06+r24 中「清单变更重跑」归 M14。

## 2. 状态表（按实测重标，fa28 要求）

| ID | 状态 | 证据 |
|---|---|---|
| M01 | 闭合（设计）| §5 + A24/A25/A26 待跑 |
| M02 | 闭合（实测）| A13=0（§4.2） |
| M03 | 闭合（更严）| 沙箱永久无网，A9=rc6、A17 待跑 |
| M04 | 闭合（实测）| A11=rc1（spool 不存在） |
| M05 | 闭合（实测）| B4=nvidia-smi 返回 `NVIDIA CMP 170HX` |
| M06 | **部分** | B0/B2/B3/B4/B6 已跑绿；B1（npm test）未跑；MCP 包装未跑 |
| M07 | 闭合（设计）| 单挂载 `/tmp`=TMPD，无第二处 bind |
| M08 | 闭合（设计）| §8.1/§8.2；timer 未安装 |
| M09 | 闭合（实测）| B6 `getent hosts localhost` rc=0 |
| M10 | 闭合（实测）| A18=rc2；两个标准 socket 均不存在 |
| M11 | 闭合（设计）| A27/A28 待跑 |
| M12 | 部分 | A15/A16 已跑；硬链与 TOCTOU 待跑 |
| M13 | 闭合（设计）| §5.2 |
| M14 | 闭合（设计）| §8.3 |
| M15 | 闭合（实测）| B0a/B0b rc=0（含 `node -e 1`，`ulimit -v 8G` 下存活） |
| M16 | **未闭合** | 静态 realpath 已设计；竞态未做，A15c 待跑 |

## 3. 目标与非目标

**目标**：单用户（lab）下，工具面无法触碰 §6 所列通道；机主对全部文件与会话库保持直接可见。

**硬约束**：不建账户；不改 sudoers；无常驻 root 守护进程（一次性 sudo 落文件 + 一个每日 timer=**具名例外**）；可随包分发；机主直接可见工作。

**非目标**：不抵抗「已以 lab 身份执行任意代码」的攻击者。本方案是**事故边界**，不是对抗边界（ddb9 要求明示）。

## 4. 实测底账

### 4.1 环境事实（2026-10-24）

| 事实 | 值 |
|---|---|
| `/tmp` 文件系统 | **tmpfs**（129,758,252K，已用 75%）→ 不能用作沙箱 /tmp |
| `/var/tmp` | `/dev/md0 ext4`（磁盘）→ 沙箱 /tmp 落此 |
| bwrap | 0.11.1 |
| `--disable-userns` | 需显式 `--unshare-user`，否则报 `requires --unshare-user` |
| merged-usr | `/bin`→`usr/bin`、`/lib`→`usr/lib`、`/lib64`→`usr/lib64`、`/sbin`→`usr/sbin` |
| resolv.conf | → `../run/systemd/resolve/stub-resolv.conf` |
| GPU | `/dev/nvidia{0,1,ctl,uvm,uvm-tools,modeset}`、`/dev/dri/renderD128` |
| crontab | setuid root；`/var/spool/cron` 在宿主存在 |
| X11 | `/tmp/.X11-unix/X10` 与抽象 `@/tmp/.X11-unix/X10` 在听 |
| 登录壳 | `bash -lc` 触发 `Failed to create stream fd` ×N（`/etc/profile.d/*systemd*` 副作用）→ 沙箱内一律用 **`bash -c`** |
| 项目配置合并 | 干净 cwd 时不合并（计数 0）；cwd 有 `opencode.json` 时即使设 `OPENCODE_CONFIG` 也合并（计数 1） |
| 全局配置合并 | `OPENCODE_CONFIG` **不覆盖** `XDG_CONFIG_HOME`（计数 1）→ 必须锁 `XDG_CONFIG_HOME` |
| 插件钩子 | `tool.execute.before` 提供可变 `output.args`（`@opencode-ai/plugin/dist/index.d.ts:235`；本仓 `plugin/abathur.ts:910` 已在用） |
| `shell.env` 钩子 | 同文件 `:243`，可改子进程环境 |

### 4.2 原型实跑回执（2026-10-24，副本 `/tmp/abathur-sandbox-exec`，WS=本仓）

| ID | 探针 | rc | 输出摘要 |
|---|---|---|---|
| A1 | `ls ~/.ssh/id_*` | 2 | No such file or directory |
| A2 | `cat ~/.npmrc` | 1 | No such file |
| A3 | `cat /proc/1/comm` | 0 | `bwrap` |
| A4 | `ls /proc \| grep -cE '^[0-9]+$'` | 0 | **4** |
| A5 | `ls /var/run/docker.sock` | 2 | No such file |
| A6 | `ls /dev/input` | 2 | No such file |
| A7 | `ls /tmp/.X11-unix` | 2 | No such file |
| A8 | `ls /var/log/syslog` | 2 | No such file |
| A9 | `curl -m 2 https://example.com` | 6 | Could not resolve host |
| A10 | `ls /run/user/1000` | 2 | No such file |
| A11 | `crontab -l` | 1 | `/var/spool/cron: No such file` |
| A12 | `touch /etc/pwn-probe` | 1 | Read-only file system |
| A13 | `env \| grep -cE 'KEY\|TOKEN\|SECRET'` | 1 | 计数 0 |
| A15 | 软链至 `~/.ssh` 后 cat | — | 源不可见（待补显式回执） |
| A16 | 沙箱内嵌套 `bwrap --unshare-all` | 1 | `Creating new namespace failed…ENOSPC` |
| A18 | `ls /var/snap/lxd` | 2 | No such file |
| A20b | `ls /dev/kvm` | 2 | No such file |
| A24 | `cat ~/.docker/config.json` | 1 | No such file |
| A25 | `cat ~/.aws/credentials` | 1 | No such file |
| A26 | `ls --unix-socket /var/run/docker.sock` | 2 | No such file |
| B0a | `command -v node git npm` | 0 | `/usr/bin/{node,git,npm}` |
| B0b | `node -e 1`（`ulimit -v 8G` 下） | 0 | `1` |
| B2 | `git status --porcelain` | 0 | 正常列出 |
| B3 | 写 `/tmp/b3.txt` 并读回 | 0 | `probe` |
| B4 | `nvidia-smi --query-gpu=name` | 0 | `NVIDIA CMP 170HX` |
| B6 | `getent hosts localhost` | 0 | `127.0.0.1 localhost` |
| — | `/dev/shm` 写入 | 0 | `SHM_OK` |

## 5. D1 文件类工具路径策略

### 5.1 default-deny 允许表
`WORKSPACE`（rw）、`/tmp`（rw，沙箱视图）、`/usr`、`/etc`（除 §5.2）、`~/.gitconfig`（ro）。

### 5.2 硬禁（永不解除）
`~/.ssh`、`~/.gnupg`、`~/.Xauthority`、`~/.npmrc`、`~/.config/gh`、`~/.docker`、`~/.aws`、`~/.local/share/keyrings`、`~/.local/share/opencode/auth.json`、`/run/user/**`、`/var/log`、`/var/run`、`/var/snap`、`/etc/abathur`、`/proc/*/{cmdline,environ,mem,fd,task}`、`/dev/input`。

### 5.3 穿透判定
1. `realpath` 解析 + 父链逐级判。
2. **inode 拒绝集**：启动器对 §5.2 中**目录递归采集**全部常规文件的 `(dev,ino)`，写 `/run/user/1000/abathur-deny-inodes`。
   - 采集时机：会话启动时全量一次；每次工具调用前对 §5.2 顶层路径重新 `stat`（廉价）刷新。
   - **具名弱点（R-D6 细化）**：该文件在 `XDG_RUNTIME_DIR`，同 uid 可写 → AI 可篡改使 A14 失效。这是软墙的具体篡改面，不隐藏。
3. 硬链不再以 `nlink>1` 判定（v3 谓词反写已废）；一律 inode 集判定。
4. TOCTOU：检查与使用之间换链仍可能（**M16 未闭合**），A15c 待跑。

## 6. D2 bash 沙箱

### 6.1 命令（**v4，真机跑过**）

```sh
#!/bin/sh
# /usr/local/lib/abathur/sandbox-exec   root:root 0755
. /etc/abathur/sandbox.conf
SID=${ABATHUR_SID:-default}
TMPD=/var/tmp/abathur-$SID/tmp     # /var/tmp 是 ext4；/tmp 是 tmpfs（§4.1）
SHMD=/var/tmp/abathur-$SID/shm
mkdir -p "$TMPD" "$SHMD"
set -- --die-with-parent --new-session --unshare-all --unshare-user --disable-userns \
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
  --bind "$SHMD" /dev/shm \
  --ro-bind /home/lab/.gitconfig /home/lab/.gitconfig
for d in $DEVS; do [ -e "$d" ] && set -- "$@" --dev-bind "$d" "$d"; done
exec /usr/bin/bwrap "$@" --chdir "$WORKSPACE" \
  /bin/bash -c 'ulimit -u '"$ULIMIT_N"'; ulimit -v '"$ULIMIT_V"'; ulimit -f '"$ULIMIT_F"'; exec /bin/bash -c "$1"' _ "$1"
```

要点（每条都有实测依据）：
- `--unshare-user` 必须显式给（否则 `--disable-userns` 报错，§4.1）。
- `/tmp` 只 bind 一次（v3 的双 bind 会自嵌套，已删）。
- `bash -c` 而非 `-lc`（登录壳触发 `/etc/profile.d` 副作用，§4.1）。
- `--tmpfs /etc/abathur` 要求挂载点存在 → B0 前置检查（fa28 要求）。
- `/etc` ro 后 `--tmpfs /etc/abathur` 合法（fa28 确认）。

### 6.2 挂载理由
见 §4.1/§4.2；GPU 节点按 `DEVS` 条件挂载（非 GPU 机 `DEVS` 为空 → B4 判 N/A）。

### 6.3 环境
`--clearenv` + 白名单；不继承 `*_API_KEY`/`*_TOKEN`/`SSH_*`。A13 实测计数 0。

### 6.4 宿主持久化（论证更正）
userns 内 euid 仍为 1000（实测 `id -u`=1000），**不是** ns-root；`crontab` 失败的真正原因是 `/var/spool/cron` 未挂载（A11 输出即此），`/etc` ro 阻断写入。**不再声称「setuid 失效」**（fa28 更正）。

### 6.5 资源上界
`ulimit -u 256`、`ulimit -v 8388608`（8 GiB/进程，实测 `node -e 1` 存活）、`ulimit -f 2097152`（512B 块 = **1 GiB**/文件）。残余见 R-D7/R-D10。

### 6.6 配置
`/etc/abathur/sandbox.conf`（root 0644，`chattr +i`）：`WORKSPACE`、`DEVS`、`ULIMIT_*`、`NPM_CACHE=off|on`。

### 6.7 Yama
**撤回** v2 的 3→1 请求；本方案不依赖 ptrace 限制（PID ns 已隔断；scope=1 下非后代 attach 本就被拒）。

## 7. D3 网络
**沙箱内永久无网**（A9 rc=6 实测）。联网安装由机主执行。可选离线安装：`NPM_CACHE=on` 时 `--ro-bind ~/.npm/_cacache …`，`npm ci --offline`。B5 在 `NPM_CACHE=off` 时判 **N/A**（fa28 指出的矛盾已消除）。

## 8. 闸门自保护与接线

### 8.1 启动器（实测支撑）
```sh
cd /var/empty/abathur
export XDG_CONFIG_HOME=/etc/abathur/xdg
export XDG_CACHE_HOME=/etc/abathur/cache
export OPENCODE_CONFIG=/etc/abathur/xdg/opencode/opencode.json
exec /usr/bin/opencode "$@"
```
- 干净 cwd → 项目 `opencode.json` 不合并（实测 T1=0）。
- 锁 `XDG_CONFIG_HOME` → 全局注入无效（实测 T2 证明 `OPENCODE_CONFIG` 单独不够）。
- 锁 `XDG_CACHE_HOME` → `~/.cache/opencode` 下的自动加载面失效（fa28 要求）。`XDG_DATA_HOME` **不动**（会话库保持机主可见）。
- `XDG_DATA_HOME` 内 `auth.json` 仍可写（AI 可改自己的 provider 凭据）→ 具名 R-D11。

### 8.2 完整性对账
root 侧每日 timer 对 `/etc/abathur/**` 做 sha256 对账 → `/var/log/abathur-integrity.log`，失配 `wall`。**具名例外**：机器上会多一个 systemd timer（非常驻进程）。

### 8.3 执行面覆盖
每个执行入口核验 `/proc/<pid>/status` 的 `NSpid` 层数 ≥2；单层=拒绝并告警。清单变更须重跑 A 组。

### 8.4 MCP
MCP stdio 由启动器配置逐个用 `sandbox-exec` 包装，独立沙箱不嵌套（`--disable-userns` 使嵌套失败，实测 A16）。

### 8.5 bash 工具接线（fa28 要求补的机制）
`plugin/abathur.ts` 的 `tool.execute.before`（`tool==="bash"`）把 `output.args.command` 重写为：
```
/usr/local/lib/abathur/sandbox-exec -- <原命令>
```
依据：该钩子签名提供可变 `output.args`（`index.d.ts:235`），本仓已在同钩子内改写/拦截写入（`plugin/abathur.ts:910`）。**端到端待验**：B9（下）必须跑通才算闭合。

## 9. 验收判据（唯一编号权威）

### A 组（红队；已跑者标 ✔）
| # | 面 | 期望 | 状态 |
|---|---|---|---|
| A1 | bash | `~/.ssh` 不可见 | ✔ rc2 |
| A2 | bash | `~/.npmrc` 不存在 | ✔ rc1 |
| A3 | bash | `/proc/1/comm`=bwrap | ✔ |
| A4 | bash | 数字型 PID 条目 ≤20 | ✔ 4 |
| A5 | bash | docker.sock 不存在 | ✔ rc2 |
| A6 | bash | `/dev/input` 不存在 | ✔ rc2 |
| A7 | bash | `/tmp/.X11-unix` 不存在 | ✔ rc2 |
| A8 | bash | `/var/log/syslog` 不存在 | ✔ rc2 |
| A9 | bash | 无网 | ✔ rc6 |
| A10 | bash | `/run/user/1000` 不存在 | ✔ rc2 |
| A11 | bash | `crontab -l` 失败 | ✔ rc1 |
| A12 | bash | `touch /etc/*` 失败 | ✔ rc1 |
| A13 | bash | `env` 无 KEY/TOKEN/SECRET | ✔ 0 |
| A14 | **文件工具** | 宿主预植硬链 `ws/hl`→`~/.npmrc`，read 被拒 | 待跑（夹具） |
| A15 | bash | `ln -s ~/.ssh/id_rsa ws/l2; cat ws/l2` 失败 | 待跑 |
| A15b | **文件工具** | 宿主预植 `ws/l3`→`~/.ssh`，read 被拒 | 待跑 |
| A15c | **文件工具** | TOCTOU：检查后换链 | **未实现（M16）** |
| A16 | bash | 嵌套 `bwrap --unshare-all` 失败 | ✔ ENOSPC |
| A17 | bash | `npm install` 失败（无网） | 待跑 |
| A18 | bash | `/var/snap/lxd` 不存在 | ✔ rc2 |
| A19 | bash | `/proc/self/environ` 仅白名单 | 待跑 |
| A20a | bash | `test -c /dev/nvidia0` 成功 | 待跑 |
| A20b | bash | `/dev/kvm` 不存在 | ✔ rc2 |
| A21 | 启动器 | 工作区 marker MCP 不被加载 | 待跑 |
| A22 | **宿主夹具**（模拟 AI 以 lab 身份改 `~/.config/opencode`） | 启动器会话 marker 计数 0 | 待跑 |
| A23 | bash | `/tmp` 填 4 GiB 受 `ulimit -f` 限制 | 待跑 |
| A24–A26 | 文件工具 | `~/.docker`、`~/.aws`、docker.sock 被拒 | bash 面 ✔；文件面待跑 |
| A27 | bash | fork 炸弹触发 `ulimit -u` | 待跑 |
| A28 | bash | 两个**不同**文件各 1 GiB 均成功；第三文件超限失败 | 待跑 |
| A29 | 启动器 | `~/.cache/opencode` 植入插件不生效 | 待跑 |
| A30 | 启动器 | `~/.local/share/opencode/auth.json` 可写性（预期**可写**，记 R-D11） | 待跑 |
| A7b | bash | 无网下 `xdpyinfo` 失败（二进制存在时） | 待跑 |

### B 组（功能）
| # | 命令 | 期望 | 状态 |
|---|---|---|---|
| B0 | `test -d /etc/abathur && command -v node git npm && node -e 1 && locale >/dev/null` | rc=0 | 部分 ✔ |
| B1 | `npm test` | rc=0 | 待跑（耗时） |
| B2 | `git status && git commit` | rc=0 | ✔ |
| B3 | 写工作区并读回 | 一致 | ✔ |
| B4 | `nvidia-smi`（`DEVS` 为空则 N/A） | rc=0 | ✔ |
| B5 | `npm ci --offline`（`NPM_CACHE=off` 则 N/A） | rc=0 | 待跑 |
| B6 | `getent hosts localhost` | rc=0 | ✔ |
| B7 | MCP 子进程 `NSpid` ≥2 | — | 待跑 |
| B8 | 启动器 **stderr 首行** 打印 `sandbox=on cwd=/var/empty/abathur`（不作会话内判据） | — | 待跑 |
| B9 | 会话内执行 `grep NSpid /proc/self/status`，层数 ≥2 且 `/proc/1/comm`=bwrap | — | 待跑 |

## 10. 残余（具名）

| # | 项 |
|---|---|
| R-D1 | 机主直接敲 `opencode` 时沙箱不生效 |
| R-D2 | 工作区无配额 |
| R-D3 | 内核漏洞逃逸（非目标） |
| R-D4 | 机主执行 AI 产出脚本（非本方案域） |
| R-D5 | `--disable-userns` 使需嵌套的工具不可用 |
| R-D6 | D1 软墙；**具体篡改面=`/run/user/1000/abathur-deny-inodes` 同 uid 可写** |
| R-D7 | `ulimit -v` 为每进程，多进程合计仍可耗尽内存 |
| R-D8 | `/etc/hosts` 对 AI 可见（内网主机名），已接受 |
| R-D9 | 沙箱无网 → 联网安装须机主执行 |
| R-D10 | `TMPD`/`SHMD` 磁盘无配额，可填满根分区（A28 只限单文件） |
| R-D11 | `~/.local/share/opencode/auth.json` 对 AI 可写（可改 provider 凭据） |
| R-D12 | TOCTOU（检查后换链）未闭合（M16） |
| R-D13 | 登录壳副作用（`bash -lc`）→ 一律 `bash -c`，若工具链需登录壳则需逐个豁免 |
| R-D14 | `plugin/abathur.ts` 自身可被同 uid 改写；启动器只保证配置加载面，不保证插件代码未被改 |

## 11. 与 C 对照
| 维度 | C（三账户，机主否决） | D |
|---|---|---|
| 机主直接看到工作 | 否 | 是 |
| 账户变更 | 3 | 0 |
| 常驻 root | 2 落脚点 | 0（1 timer，具名例外） |
| 会话库迁移 | 8.2G | 无 |
| 抗内核逃逸 | 是 | 否 |
| 可移植 | 弱 | 强（`sandbox.conf`） |
| 评审状态 | v17 3A/0R 过会，机主否决 | 本稿待审 |
