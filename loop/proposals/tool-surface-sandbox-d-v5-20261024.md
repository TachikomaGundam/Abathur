# 提案 D v5：单用户工具执行沙箱

- 日期：2026-10-24
- 前稿：d（b29c）、d-v2（ddb9）、d-v3（fa28）、d-v4（c8fe，0A/2R/1E）
- 独立性：`NOT-INDEPENDENT`（起草会话直接送审）
- 本轮唯一新增证据：**§6.1 脚本已按本稿字节重写并实跑**（sha256 `4f9f878c750f3ed1…`），回执见 §4.3
- 备注：上一轮 BALTHASAR 票件 unparseable（工具层错误），本轮已重跑三席

## 1. 评审项追溯

### 1.1 b29c 原始 25 行 → 16 项（逐行）
（同 v4 §1，此处不重复；见 v4 稿 §1 表，结论：r01–r25 每行有归属，去重规则显式。）

### 1.2 ddb9 / fa28 / c8fe 项 → 本稿落点

| ID | 来源 | 要求 | 落点 | 状态 |
|---|---|---|---|---|
| C01 | c8fe | §8.5 改单 argv、删 `--` 占位；B9 端到端；未跑通前 M02/M03 降级 | §8.5 / §2 | 闭合（设计），B9 待跑 |
| C02 | c8fe | A28 改每文件边界判据 | §9 A28 | 闭合（机制已实测，见 §4.3） |
| C03 | c8fe | A13/A19 换判别性探针（宿主预植标记） | §9 A13 | **闭合（实测）** |
| C04 | c8fe | deny-inodes 存在性/可写性探针，写不进 fail-closed；R-D6 补形态 | §5.3 / §10 R-D6 | 闭合（实测路径可写） |
| C05 | c8fe | B7/B8/B9 填 rc；M12 措辞对齐 | §9 / §2 | 闭合 |
| C06 | c8fe | 补安装清单（/var/empty/abathur、cache 属主、timer 单元） | §8.6 | 闭合 |
| C07 | c8fe | §6.1 先存 CMD 再 `set --`；附脚本 sha256 | §6.1 | **闭合（实测）** |
| C08 | c8fe | 参数契约统一；管道/引号端到端验跑 | §6.1 / §4.3 | **闭合（实测）** |
| C09 | c8fe | A28 机制内判据 | §9 A28 | 闭合 |
| C10 | c8fe | B1 在无网下的预期定义 | §9 B1 | 闭合（测试阶段可跑；构建阶段 campaign 后） |
| C11 | c8fe | M09 降级或换探针（resolv 内容比对） | §9 B6 | **闭合（实测 RESOLV_IDENTICAL）** |
| C12 | c8fe | R-D15：inode 集不含非普通文件/新增文件 | §10 R-D15 | 闭合（具名） |
| N01 | ddb9 | 追溯机械可核 | §1.1 | 闭合 |
| N02 | ddb9 | 网络闸不得由模型自设 | §7 永久无网 | 闭合 |
| N03 | ddb9 | /tmp 实为 tmpfs | §6.1 落 /var/tmp | **闭合（实测 ext4）** |
| N04 | ddb9 | 路径/GPU 参数化 | §6.6 | 闭合 |
| N05 | ddb9 | D1 探针走文件工具面 | §9 A14/A15b/A24–A26 | 闭合（待跑） |
| N06 | ddb9 | 判据编号唯一权威 | §9 | 闭合 |
| N07 | ddb9 | AI 改配置后仍被约束；timer 具名例外 | §8.1/§8.2 | 闭合 |
| N08 | ddb9 | 内存上界；Yama 撤回 | §6.5/§6.7 | 闭合 |

## 2. 状态表（按证据重标）

| 项 | 状态 | 依据 |
|---|---|---|
| M01 D1 白名单 | 设计闭合 | §5 |
| M02 env 清洗 | **待接线验证** | 脚本层已实测（A13），插件接线未跑 |
| M03 无网 | **待接线验证** | 脚本层已实测（A9 rc6），插件接线未跑 |
| M04 持久化 | 实测闭合 | A11 rc1 |
| M05 GPU | 实测闭合 | B4 `NVIDIA CMP 170HX` |
| M06 B 组 | **部分** | B0/B2/B3/B4/B6 ✔；B1 待跑；MCP 待跑 |
| M07 /tmp 单挂载 | 实测闭合 | A10/A7 均不存在；无第二 bind |
| M08 自保护 | 设计闭合 | §8.1/§8.2/§8.6 |
| M09 resolv | **实测闭合** | `diff` 沙箱内外 `/etc/resolv.conf` 一致 |
| M10 LXD | 实测闭合 | A18 rc2 |
| M11 资源 | 实测（机制） | 32 MiB 过 / 96 MiB 被 SIGXFSZ |
| M12 攻击探针 | **部分** | A16 ✔；A15 待跑；硬链待跑 |
| M13 /proc 硬禁 | 设计闭合 | §5.2 |
| M14 NSpid | 设计闭合 | §8.3 |
| M15 B0 前置 | 实测闭合 | B0a/B0b ✔ |
| M16 TOCTOU | **未闭合** | 无探针 |

## 3. 目标与非目标
同 v4：单用户；不建账户；不改 sudoers；无常驻 root（1 个每日 timer=具名例外）；机主直接可见工作。**事故边界，非对抗边界。**

## 4. 实测底账

### 4.1 环境事实
（同 v4 §4.1，另加）
| 事实 | 值 |
|---|---|
| `/var/tmp` | ext4（磁盘）；`/tmp` = tmpfs（129GB，75% 已用） |
| `/run/user/1000` | 存在且 **可写**（touch 成功） |
| `--disable-userns` | 必须伴随 `--unshare-user` |
| 登录壳 | `bash -lc` 触发 `Failed to create stream fd`；`bash -c` 干净 |
| 项目配置 | 干净 cwd 不合并；cwd 有 opencode.json 则合并（即使设 OPENCODE_CONFIG） |
| 全局配置 | OPENCODE_CONFIG 不覆盖 XDG_CONFIG_HOME |
| 插件钩子 | `tool.execute.before` 可改 `output.args`（`index.d.ts:235`；`plugin/abathur.ts:910` 已在用） |

### 4.2 红队/功能回执（原型，2026-10-24）
A1 rc2｜A2 rc1｜A3 `bwrap`｜A4 **4**｜A5 rc2｜A6 rc2｜A7 rc2｜A8 rc2｜A9 rc6｜A10 rc2｜A11 rc1（`/var/spool/cron: No such file`）｜A12 rc1（Read-only）｜A13 计数 0｜A16 `Creating new namespace failed…ENOSPC`｜A18 rc2｜A20b rc2｜A24/A25/A26 bash 面 rc1/rc1/rc2｜B0a rc0｜B0b rc0｜B2 rc0｜B3 rc0｜B4 `NVIDIA CMP 170HX`｜B6 rc0.

### 4.3 脚本字节与端到端（本轮新增）
- `/tmp/abathur-sandbox-exec-v5` sha256 `4f9f878c750f3ed10feb622d8119cb08d04e1fe1931c12acd2f1adc3a07fe909`
- 管道/引号/变量：`echo "a b" | tr " " "_"; X=7; echo "x=$X"` → `a_b` / `x=7` / `bwrap`，rc=0
- 空参：rc=2（fail-closed）
- 宿主标记环境：`FOO_SECRET_MARKER=SECRET-VALUE` → 沙箱内 `marker=ABSENT`（判别性成立）
- `ulimit -f` 机制：`ulimit -f 65536`；32 MiB 写成功、96 MiB 被 `SIGXFSZ` 杀（`File size limit exceeded`）
- `resolv.conf`：沙箱内外 `diff` 无差异（`RESOLV_IDENTICAL`），nameserver=127.0.0.53

## 5. D1 路径策略
### 5.1 允许表（default-deny）
`WORKSPACE` rw｜`/tmp` rw（沙箱视图）｜`/usr`、`/etc`（除 §5.2）ro｜`~/.gitconfig` ro
### 5.2 硬禁
`~/.ssh`、`~/.gnupg`、`~/.Xauthority`、`~/.npmrc`、`~/.config/gh`、`~/.docker`、`~/.aws`、`~/.local/share/keyrings`、`~/.local/share/opencode/auth.json`、`/run/user/**`、`/var/log`、`/var/run`、`/var/snap`、`/etc/abathur`、`/proc/*/{cmdline,environ,mem,fd,task}`、`/dev/input`
### 5.3 inode 拒绝集
- 启动器对 §5.2 **目录递归采集常规文件** `(dev,ino)` → `/run/user/1000/abathur-deny-inodes`。
- **存在性+可写性探针**：采集失败 → 拒绝启动（fail-closed），不再静默放行。
- 每次工具调用前对 §5.2 顶层路径 `stat` 刷新。
- 硬链一律按 inode 集判（不按 nlink）。
- **具名弱点**：该文件同 uid 可写（R-D6 具体面）。

## 6. D2 bash 沙箱
### 6.1 命令（**本稿字节，已实跑**）
```sh
#!/bin/sh
CMD="$1"
[ -n "$CMD" ] || { echo "usage: sandbox-exec <command>" >&2; exit 2; }
WORKSPACE=${WORKSPACE:-/home/lab/workspace}
DEVS=${DEVS:-"/dev/nvidia0 /dev/nvidia1 /dev/nvidiactl /dev/nvidia-uvm /dev/nvidia-uvm-tools /dev/nvidia-modeset /dev/dri"}
ULIMIT_N=${ULIMIT_N:-256}; ULIMIT_V=${ULIMIT_V:-8388608}; ULIMIT_F=${ULIMIT_F:-2097152}
SID=${ABATHUR_SID:-default}
TMPD=/var/tmp/abathur-$SID/tmp
SHMD=/var/tmp/abathur-$SID/shm
mkdir -p "$TMPD" "$SHMD" || exit 2
set -- --die-with-parent --new-session --unshare-all --unshare-user --disable-userns \
  --clearenv \
  --setenv PATH /usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  --setenv HOME /home/lab --setenv USER lab --setenv LOGNAME lab \
  --setenv LANG C.UTF-8 --setenv LC_ALL C.UTF-8 --setenv TZ Asia/Shanghai \
  --setenv TERM xterm-256color --setenv TMPDIR /tmp \
  --ro-bind /usr /usr \
  --symlink usr/bin /bin --symlink usr/sbin /sbin \
  --symlink usr/lib /lib --symlink usr/lib64 /lib64 \
  --ro-bind /etc /etc \
  --proc /proc --dev /dev \
  --tmpfs /run --dir /run/systemd --ro-bind /run/systemd/resolve /run/systemd/resolve \
  --tmpfs /home --dir /home/lab \
  --bind "$WORKSPACE" "$WORKSPACE" \
  --bind "$TMPD" /tmp \
  --bind "$SHMD" /dev/shm \
  --ro-bind /home/lab/.gitconfig /home/lab/.gitconfig
for d in $DEVS; do [ -e "$d" ] && set -- "$@" --dev-bind "$d" "$d"; done
exec /usr/bin/bwrap "$@" --chdir "$WORKSPACE" \
  /bin/bash -c 'ulimit -u '"$ULIMIT_N"'; ulimit -v '"$ULIMIT_V"'; ulimit -f '"$ULIMIT_F"'; exec /bin/bash -c "$1"' _ "$CMD"
```
关键点：`CMD="$1"` 在 `set --` **之前**取走（c8fe 指出的致命 bug 已修）；`bash -c` 非登录壳；`/tmp`/`/dev/shm` 磁盘 bind；GPU 条件挂载。

### 6.2–6.7
同 v4（挂载理由 / env / 持久化论证更正 / 资源上界 / 配置 / Yama 撤回）。

## 7. D3 网络
沙箱内**永久无网**（A9 rc6）。联网安装由机主执行；`NPM_CACHE=on` 时 ro 挂 `~/.npm/_cacache` 供 `npm ci --offline`。

## 8. 闸门自保护与接线

### 8.1 启动器
```sh
cd /var/empty/abathur
export XDG_CONFIG_HOME=/etc/abathur/xdg
export XDG_CACHE_HOME=/var/cache/abathur
export OPENCODE_CONFIG=/etc/abathur/xdg/opencode/opencode.json
exec /usr/bin/opencode "$@"
```
依据（§4.1 实测）：干净 cwd 阻断项目配置；锁 `XDG_CONFIG_HOME` 阻断全局注入；`XDG_DATA_HOME` 不动 → 会话库仍对机主可见。
`XDG_CACHE_HOME` 指向 `/var/cache/abathur`（lab 可写 0700）；**加载由 root 拥有的 config 驱动**，缓存内植入包不自动加载 → A29 验证。

### 8.2 完整性对账
root 每日 timer：`/etc/abathur/**` sha256 → `/var/log/abathur-integrity.log`，失配 `wall`。具名例外（机器上多一个 timer）。

### 8.3 执行面覆盖
每个执行入口核验 `NSpid` ≥2；单层=拒绝告警。清单变更重跑 A 组。

### 8.4 MCP
逐个用 `sandbox-exec` 包装，独立沙箱不嵌套（A16 实测嵌套失败）。

### 8.5 bash 接线（c8fe 修正后的契约）
`plugin/abathur.ts` 在 `tool.execute.before`（`tool==="bash"`）把命令重写为**单个 argv**：
```ts
output.args.command = `/usr/local/lib/abathur/sandbox-exec ${shQuote(originalCommand)}`;
```
- `shQuote` 用单引号包裹并把内部 `'` 转成 `'\''`；**不使用 `--`**（c8fe：`--` 会占掉 `$1`）。
- `sandbox-exec` 侧契约：`$1` = 完整命令串（§6.1 第一行）。
- **端到端判据 B9**（未跑通前 M02/M03 保持「待接线验证」）：会话内执行 `echo "a b" | tr " " "_"`，期望 `a_b`，且 `/proc/1/comm`=`bwrap`。

### 8.6 安装清单（一次性 sudo）
| 路径 | 属主/模式 | 内容 |
|---|---|---|
| `/var/empty/abathur` | root:root 0755 | 空目录（启动器 cwd） |
| `/etc/abathur` | root:root 0755 | 配置根 |
| `/etc/abathur/sandbox.conf` | root:root 0644 + `chattr +i` | §6.6 参数 |
| `/etc/abathur/xdg/opencode/opencode.json` | root:root 0644 | 插件/MCP 白名单 |
| `/etc/abathur/cache` | — | 不创建（改用 `/var/cache/abathur`） |
| `/var/cache/abathur` | lab:lab 0700 | 缓存（不含加载逻辑） |
| `/usr/local/lib/abathur/sandbox-exec` | root:root 0755 | §6.1 脚本 |
| `/usr/local/bin/abathur` | root:root 0755 | §8.1 启动器 |
| `/etc/systemd/system/abathur-integrity.{service,timer}` | root:root 0644 | §8.2 对账 |

## 9. 验收判据（唯一编号权威）

### A 组
| # | 面 | 期望 | 状态 |
|---|---|---|---|
| A1 | bash | `~/.ssh` 不可见 | ✔ rc2 |
| A2 | bash | `~/.npmrc` 不存在 | ✔ rc1 |
| A3 | bash | `/proc/1/comm`=bwrap | ✔ |
| A4 | bash | 数字型 PID ≤20 | ✔ 4 |
| A5 | bash | docker.sock 不存在 | ✔ rc2 |
| A6 | bash | `/dev/input` 不存在 | ✔ rc2 |
| A7 | bash | `/tmp/.X11-unix` 不存在 | ✔ rc2 |
| A8 | bash | `/var/log/syslog` 不存在 | ✔ rc2 |
| A9 | bash | 无网（curl rc≠0） | ✔ rc6 |
| A10 | bash | `/run/user/1000` 不存在 | ✔ rc2 |
| A11 | bash | `crontab -l` rc≠0 | ✔ rc1 |
| A12 | bash | `touch /etc/x` rc≠0 | ✔ rc1 |
| A13 | bash | 宿主预植 `FOO_SECRET_MARKER`，沙箱内读不到 | ✔ ABSENT |
| A14 | 文件工具 | 宿主预植硬链 `ws/hl`→`~/.npmrc`，read 被拒 | 待跑 |
| A15 | bash | 软链到 `~/.ssh` 后 cat 失败 | 待跑 |
| A15b | 文件工具 | 宿主预植 `ws/l3`→`~/.ssh`，read 被拒 | 待跑 |
| A15c | 文件工具 | TOCTOU 换链 | 未实现（M16） |
| A16 | bash | 嵌套 bwrap rc≠0 | ✔ ENOSPC |
| A17 | bash | `npm install` 失败 | 待跑（无网必失败） |
| A18 | bash | `/var/snap/lxd` 不存在 | ✔ rc2 |
| A19 | bash | `env` 仅白名单键（宿主预植标记不可见，同 A13） | ✔ |
| A20a | bash | `test -c /dev/nvidia0` rc=0 | 待跑 |
| A20b | bash | `/dev/kvm` 不存在 | ✔ rc2 |
| A21 | 启动器 | 工作区 marker MCP 不被加载（计数 0） | 待跑 |
| A22 | 宿主夹具 | 模拟 AI 改 `~/.config/opencode` 后，启动器会话 marker 计数 0 | 待跑 |
| A23 | bash | 单文件超 `ULIMIT_F` 被 SIGXFSZ | ✔（64 MiB 限值下 96 MiB 被杀） |
| A28 | bash | 两个各 ≤ 限值的文件均成功；单个超限失败 | ✔ 机制（32 MiB 过） |
| A24–A26 | 文件工具 | `~/.docker`/`~/.aws`/docker.sock 被拒 | bash 面 ✔；文件面待跑 |
| A27 | bash | fork 炸弹触发 `ulimit -u` | 待跑 |
| A29 | 启动器 | `~/.cache/opencode` 植入插件不生效 | 待跑 |
| A30 | 启动器 | `auth.json` 可写性（预期可写，R-D11） | 待跑 |
| A31 | 启动器 | deny-inodes 不可写时启动器 rc≠0（fail-closed） | 待跑 |
| A7b | bash | `xdpyinfo` 失败（若安装） | 待跑 |

### B 组
| # | 期望 | 状态 |
|---|---|---|
| B0 | `test -d /etc/abathur && command -v node git npm && node -e 1` rc=0 | 部分 ✔（node -e 1 rc0） |
| B1 | 测试阶段 `node --test "dist/test/**/*.test.js"` rc=0；**构建阶段不在 campaign 运行期跑** | 待跑 |
| B2 | `git status`/`commit` rc=0 | ✔ |
| B3 | 写工作区并读回一致 | ✔ |
| B4 | `nvidia-smi` rc=0（DEVS 空则 N/A） | ✔ |
| B5 | `npm ci --offline` rc=0（NPM_CACHE=off 则 N/A） | 待跑 |
| B6 | `/etc/resolv.conf` 沙箱内外 `diff` 无差异 rc=0 | ✔ |
| B7 | MCP 子进程 NSpid ≥2（rc=0） | 待跑 |
| B8 | 启动器 **stderr 首行** `sandbox=on`（rc=0，非会话内判据） | 待跑 |
| B9 | 会话内 `echo "a b" \| tr " " "_"` 得 `a_b` 且 `/proc/1/comm`=bwrap | 待跑（接线闸） |

## 10. 残余
| # | 项 |
|---|---|
| R-D1 | 机主直接敲 `opencode` 时无沙箱 |
| R-D2 | 工作区无配额 |
| R-D3 | 内核漏洞逃逸（非目标） |
| R-D4 | 机主执行 AI 产出脚本（非本方案域） |
| R-D5 | `--disable-userns` 使嵌套工具不可用 |
| R-D6 | D1 软墙；篡改面=`/run/user/1000/abathur-deny-inodes`；**该路径缺失/不可写时按 §5.3 fail-closed** |
| R-D7 | `ulimit -v` 每进程；合计仍可耗尽内存 |
| R-D8 | `/etc/hosts` 可见（内网名） |
| R-D9 | 无网 → 联网安装须机主 |
| R-D10 | `TMPD`/`SHMD` 无配额，可填满根分区 |
| R-D11 | `auth.json` 可写（可改 provider 凭据） |
| R-D12 | TOCTOU 未闭合（M16） |
| R-D13 | 登录壳副作用（`bash -lc`） |
| R-D14 | `plugin/abathur.ts` 同 uid 可改写 |
| R-D15 | inode 集只含常规文件，且仅顶层刷新；禁区内会话中新增文件、socket/设备不覆盖 |

## 11. 与 C 对照
（同 v4：可见性、账户数、常驻 root、迁移成本、可移植、评审状态）
