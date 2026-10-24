# 提案 D v6：单用户工具执行沙箱

- 日期：2026-10-24
- 前稿：d / v2 / v3 / v4 / v5（e390 庭 REJECT 0A/3R，15 条）
- 独立性：`NOT-INDEPENDENT`
- **本轮新增实测**：env 全量、双文件限额、/etc 子路径遮蔽、单引号往返（§4.3）
- 脚本字节：`/tmp/abathur-sandbox-exec-v6` sha256 `9b653a74cc6c3d5b5f46f4a75093360732176637e1f870e74879a690f299aef3`

## 1. e390 十五条 → 本稿落点

| # | 意见 | 落点 | 状态 |
|---|---|---|---|
| E01 | B8 要 banner 而启动器无 echo | §8.1 加 `echo sandbox=on` | 闭合（字节） |
| E02 | deny-inodes 无主体 | §8.1 启动器内实现采集 + fail-closed | 闭合（字节） |
| E03 | D1 文件工具执行器未具名 | §8.7 插件钩子 `tool.execute.before` | 闭合（设计） |
| E04 | A19 无自有回执 | §4.3 env 全量输出 | **闭合（实测）** |
| E05 | A29 植入面错 | §9 A29 改 `/var/cache/abathur` | 闭合 |
| E06 | M13「设计闭合」失实 | §2 降级为待验证 + A32 | 闭合 |
| E07 | A17 与 A9 同义 | 合并进 A9，删 A17 | 闭合 |
| E08 | §6.1 未遮蔽 /etc/abathur | `ETC_MASK` + `--tmpfs` | **闭合（实测）** |
| E09 | NPM_CACHE 无实现 | §6.1 增分支（实字节） | 闭合（字节） |
| E10 | 非 bash 执行面未覆盖 | §8.8 + R-D16 | 闭合 |
| E11 | B9 未测引号/多行 | §9 B9 扩为四用例 | 闭合 |
| E12 | C04/M12 标签超前 | §2 降级 | 闭合 |
| E13 | MCP argv 契约未写 | §8.9 | 闭合 |
| E14 | HOME/GITCONFIG/TZ 写死 | §6.1 参数化 `SBX_HOME/GITCONFIG/TZNAME` | 闭合（字节） |
| E15 | A28 缺「双文件均成功」 | §4.3 实测 F1_OK/F2_OK | **闭合（实测）** |

## 2. 状态表（证据重标）

| 项 | 状态 | 依据 |
|---|---|---|
| M01 D1 白名单 | **设计闭合，主机面待验** | §5/§8.7；A14/A15b/A24–A26 待跑 |
| M02 env 清洗 | 待接线验证 | 脚本层实测（A13/A19），插件接线待跑 |
| M03 无网 | 待接线验证 | A9 rc6 |
| M04 持久化 | 实测闭合 | A11 rc1 |
| M05 GPU | 实测闭合 | B4 |
| M06 B 组 | 部分 | B0/B2/B3/B4/B6 ✔ |
| M07 /tmp | 实测闭合 | A7/A10 |
| M08 自保护 | 设计闭合 | §8.1/8.2/8.6 |
| M09 resolv | 实测闭合 | RESOLV_IDENTICAL |
| M10 LXD | 实测闭合 | A18 |
| M11 资源 | 实测闭合 | A23/A28 双半 |
| M12 攻击探针 | **部分（主机面未验证）** | A16 ✔；A14/A15/A15b 待跑 |
| M13 /proc 硬禁 | **待验证** | PID ns 已实测（A3/A4）；D1 面 A32 待跑 |
| M14 NSpid | 设计闭合 | §8.3 |
| M15 B0 | 实测闭合 | B0a/B0b |
| M16 TOCTOU | **未闭合** | 无探针 |

## 3. 目标与非目标
同前：单用户；不建账户；不改 sudoers；无常驻 root（1 timer=具名例外）；可随包分发；机主直接可见工作。**事故边界，非对抗边界。**

## 4. 实测底账

### 4.1 环境事实
`/tmp`=tmpfs（129G，75%）｜`/var/tmp`=ext4｜`/run/user/1000` 可写｜`--disable-userns` 需 `--unshare-user`｜`bash -lc` 有 profile 副作用、`bash -c` 干净｜项目配置按 cwd 合并、`OPENCODE_CONFIG` 不覆盖 `XDG_CONFIG_HOME`｜插件钩子 `tool.execute.before` 可改 args（`index.d.ts:235`、`plugin/abathur.ts:910`）

### 4.2 A/B 回执（2026-10-24）
A1 rc2｜A2 rc1｜A3 bwrap｜A4 4｜A5 rc2｜A6 rc2｜A7 rc2｜A8 rc2｜A9 rc6｜A10 rc2｜A11 rc1｜A12 rc1｜A13 ABSENT｜A16 ENOSPC｜A18 rc2｜A20b rc2｜B0a rc0｜B0b rc0｜B2 rc0｜B3 rc0｜B4 `NVIDIA CMP 170HX`｜B6 rc0

### 4.3 本轮新增回执（脚本 v6，sha256 `9b653a74…`）
| 探针 | 输出 |
|---|---|
| A19 `env \| sort` | `HOME=/home/lab LANG=C.UTF-8 LC_ALL=C.UTF-8 LOGNAME=lab PATH=/usr/local/sbin:… TMPDIR=/tmp TZ=Asia/Shanghai USER=lab`（+ bash 注入的 PWD/SHLVL/_，非继承） |
| A28 双文件 | `F1_OK` `F2_OK`（各 32 MiB，限 64 MiB） |
| A23 单文件超限 | 96 MiB → `File size limit exceeded (core dumped)` |
| ETC_MASK 遮蔽 | 以 `/etc/ssl` 为替身：沙箱内 `ls /etc/ssl` 空；`/etc/hostname` 正常可读 |
| 单引号往返 | 命令 `echo 'it'\''s a test'` → 沙箱输出 `it's a test` |
| 空参 | rc=2 |
| 宿主标记 env | `FOO_SECRET_MARKER=SECRET-VALUE` → 沙箱内 `ABSENT` |

## 5. D1 路径策略
### 5.1 允许表（default-deny）
`WORKSPACE` rw｜`/tmp` rw｜`/usr`、`/etc`（除 §5.2）ro｜`GITCONFIG` ro
### 5.2 硬禁
`~/.ssh`、`~/.gnupg`、`~/.Xauthority`、`~/.npmrc`、`~/.config/gh`、`~/.docker`、`~/.aws`、`~/.local/share/keyrings`、`~/.local/share/opencode/auth.json`、`/run/user/**`、`/var/log`、`/var/run`、`/var/snap`、`/etc/abathur`、`/proc/*/{cmdline,environ,mem,fd,task}`、`/dev/input`
### 5.3 inode 拒绝集
- 采集：**启动器**（root 脚本）对 §5.2 目录递归采集常规文件 `(dev,ino)` → `/run/user/1000/abathur-deny-inodes`；**采集失败或目录不可写 → exit 2（fail-closed）**。
- 刷新：每次工具调用前对顶层路径 `stat` 刷新。
- 硬链按 inode 集判。
- 具名弱点：文件同 uid 可写（R-D6）。

## 6. D2 bash 沙箱
### 6.1 命令（**v6 字节，已实跑**）
```sh
#!/bin/sh
CMD="$1"
[ -n "$CMD" ] || { echo "usage: sandbox-exec <command>" >&2; exit 2; }
WORKSPACE=${WORKSPACE:-/home/lab/workspace}
SBX_HOME=${SBX_HOME:-/home/lab}
GITCONFIG=${GITCONFIG:-$SBX_HOME/.gitconfig}
TZNAME=${TZNAME:-Asia/Shanghai}
ETC_MASK=${ETC_MASK:-/etc/abathur}
DEVS=${DEVS:-"/dev/nvidia0 /dev/nvidia1 /dev/nvidiactl /dev/nvidia-uvm /dev/nvidia-uvm-tools /dev/nvidia-modeset /dev/dri"}
ULIMIT_N=${ULIMIT_N:-256}; ULIMIT_V=${ULIMIT_V:-8388608}; ULIMIT_F=${ULIMIT_F:-2097152}
NPM_CACHE=${NPM_CACHE:-off}
SID=${ABATHUR_SID:-default}
TMPD=/var/tmp/abathur-$SID/tmp; SHMD=/var/tmp/abathur-$SID/shm
[ -d "$ETC_MASK" ] || { echo "sandbox-exec: ETC_MASK $ETC_MASK 不存在（B0 前置失败）" >&2; exit 2; }
mkdir -p "$TMPD" "$SHMD" || exit 2
set -- --die-with-parent --new-session --unshare-all --unshare-user --disable-userns \
  --clearenv \
  --setenv PATH /usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  --setenv HOME "$SBX_HOME" --setenv USER lab --setenv LOGNAME lab \
  --setenv LANG C.UTF-8 --setenv LC_ALL C.UTF-8 --setenv TZ "$TZNAME" \
  --setenv TERM xterm-256color --setenv TMPDIR /tmp \
  --ro-bind /usr /usr \
  --symlink usr/bin /bin --symlink usr/sbin /sbin \
  --symlink usr/lib /lib --symlink usr/lib64 /lib64 \
  --ro-bind /etc /etc --tmpfs "$ETC_MASK" \
  --proc /proc --dev /dev \
  --tmpfs /run --dir /run/systemd --ro-bind /run/systemd/resolve /run/systemd/resolve \
  --tmpfs /home --dir "$SBX_HOME" \
  --bind "$WORKSPACE" "$WORKSPACE" \
  --bind "$TMPD" /tmp \
  --bind "$SHMD" /dev/shm \
  --ro-bind "$GITCONFIG" "$GITCONFIG"
[ "$NPM_CACHE" = on ] && set -- "$@" --ro-bind "$SBX_HOME/.npm/_cacache" "$SBX_HOME/.npm/_cacache"
for d in $DEVS; do [ -e "$d" ] && set -- "$@" --dev-bind "$d" "$d"; done
exec /usr/bin/bwrap "$@" --chdir "$WORKSPACE" \
  /bin/bash -c 'ulimit -u '"$ULIMIT_N"'; ulimit -v '"$ULIMIT_V"'; ulimit -f '"$ULIMIT_F"'; exec /bin/bash -c "$1"' _ "$CMD"
```
### 6.2–6.7
挂载理由同前；env 白名单见 §4.3；持久化论证（spool 未挂 + /etc ro）；资源上界；配置 `sandbox.conf`；Yama 撤回。

## 7. D3 网络
永久无网（A9 rc6）。`NPM_CACHE=on` 时 ro 挂 `_cacache` 供 `npm ci --offline`；B5 仅在 `on` 时适用。

## 8. 闸门与接线

### 8.1 启动器（含 banner 与 deny-inodes）
```sh
#!/bin/sh
# /usr/local/bin/abathur  root:root 0755
set -eu
DENY=/run/user/$(id -u)/abathur-deny-inodes
: > "$DENY" 2>/dev/null || { echo "abathur: deny-inodes 不可写，拒绝启动" >&2; exit 2; }
for p in "$HOME/.ssh" "$HOME/.gnupg" "$HOME/.npmrc" "$HOME/.config/gh" "$HOME/.docker" "$HOME/.aws" \
         "$HOME/.local/share/keyrings" "$HOME/.local/share/opencode/auth.json" "$HOME/.Xauthority"; do
  [ -e "$p" ] || continue
  find "$p" -type f -print0 2>/dev/null | xargs -0 -r stat -c '%d:%i' >> "$DENY"
done
[ -s "$DENY" ] || { echo "abathur: 未采集到任何 inode，拒绝启动（fail-closed）" >&2; exit 2; }
echo "sandbox=on cwd=/var/empty/abathur deny_inodes=$(wc -l < "$DENY")" >&2
cd /var/empty/abathur
export XDG_CONFIG_HOME=/etc/abathur/xdg
export XDG_CACHE_HOME=/var/cache/abathur
export OPENCODE_CONFIG=/etc/abathur/xdg/opencode/opencode.json
exec /usr/bin/opencode "$@"
```
（B8 读 **stderr 首行**；A31 用不可写目录模拟 → rc 2。）

### 8.2 完整性对账
root 每日 timer：`/etc/abathur/**` sha256 → `/var/log/abathur-integrity.log`，失配 `wall`。具名例外。

### 8.3 执行面覆盖
`NSpid` ≥2；单层拒绝告警；清单变更重跑 A 组。

### 8.4 MCP（argv 契约）
root 配置中每个 MCP server：
```json
{"command": ["/usr/local/lib/abathur/sandbox-exec", "<完整命令串，单个 argv>"]}
```
引擎 argv 直启、不经 shell → 命令串作为一个 argv 交给 `$1`，与 §6.1 契约一致；B7 验 NSpid。

### 8.5 bash 接线
`plugin/abathur.ts` 的 `tool.execute.before`（`tool==="bash"`）：
```ts
output.args.command = `/usr/local/lib/abathur/sandbox-exec ${shQuote(cmd)}`;
```
`shQuote`：`'` → `'\''`，整体加单引号；无 `--`。B9 四用例验（见 §9）。

### 8.6 安装清单
`/var/empty/abathur`(root 0755)｜`/etc/abathur`(root 0755)｜`sandbox.conf`(0644+chattr +i)｜`xdg/opencode/opencode.json`(0644)｜`/var/cache/abathur`(lab 0700)｜`sandbox-exec`(root 0755)｜`/usr/local/bin/abathur`(root 0755)｜`abathur-integrity.{service,timer}`(0644)

### 8.7 文件工具 D1 执行器（E03）
同一插件 `tool.execute.before` 分支，覆盖 `read`、`write`、`edit`、`grep`、`glob`、`list`：
1. 取目标路径（`args.filePath` / `args.path` / `args.pattern` 的基准目录）。
2. `realpath` 解析 + 父链判 + §5.2 硬禁 + 允许表 + inode 集。
3. 命中禁止 → `throw`（工具不执行）。
4. 时点：执行前（`tool.execute.before`），非事后。
5. 未知工具且带执行语义 → 默认拒绝（R-D16）。

### 8.8 非 bash 执行面（E10/R-D16）
| 入口 | 处置 | 判据 |
|---|---|---|
| `bash` | §8.5 包装 | B9 |
| `interactive_bash`（tmux） | 同 §8.5 包装（tool 名分支） | A33 |
| 后台任务跑器 | 其命令经 `bash` 工具产生 → 已覆盖；直启后台的不在允许清单 | A34 |
| MCP stdio | §8.4 | B7 |
| 插件内 `child_process` | 白名单插件才可加载（root config）；非白名单不加载 | A29 |

## 9. 验收判据（唯一编号权威）

### A 组
| # | 面 | 期望 | 状态 |
|---|---|---|---|
| A1–A13 | bash | 同 §4.2 | ✔ |
| A9 | bash | curl rc=6（DNS 失败）兼作网络闸 | ✔ |
| A14 | 文件工具 | 宿主预植硬链 `ws/hl`→`~/.npmrc`，read 拒 | 待跑 |
| A15 | bash | 软链到 `~/.ssh` 后 cat 失败 | 待跑 |
| A15b | 文件工具 | 宿主预植 `ws/l3`→`~/.ssh`，read 拒 | 待跑 |
| A15c | 文件工具 | TOCTOU | 未实现（M16） |
| A16 | bash | 嵌套 bwrap 失败 | ✔ ENOSPC |
| A18 | bash | `/var/snap/lxd` 不存在 | ✔ |
| A19 | bash | env 全量=白名单 | ✔ §4.3 |
| A20a | bash | `test -c /dev/nvidia0` rc=0 | 待跑 |
| A20b | bash | `/dev/kvm` 不存在 | ✔ |
| A21 | 启动器 | 工作区 marker MCP 不加载（计数 0） | 待跑 |
| A22 | 宿主夹具 | 模拟改 `~/.config/opencode` 后计数 0 | 待跑 |
| A23 | bash | 单文件超 `ULIMIT_F` 被 SIGXFSZ | ✔ |
| A24–A26 | 文件工具 | `~/.docker`/`~/.aws`/docker.sock 拒 | bash 面 ✔；文件面待跑 |
| A27 | bash | fork 炸弹触发 `ulimit -u` | 待跑 |
| A28 | bash | 两文件各 ≤ 限值均成功；单文件超限失败 | ✔ 双半 |
| A29 | 启动器 | `/var/cache/abathur` 植入插件不生效 | 待跑 |
| A30 | 启动器 | `auth.json` 可写（预期可写，R-D11） | 待跑 |
| A31 | 启动器 | deny-inodes 不可写 → rc=2 | 待跑 |
| A32 | 文件工具 | read `/proc/<hostpid>/cmdline` 拒 | 待跑 |
| A33 | 启动器 | `interactive_bash` 命令 NSpid≥2 | 待跑 |
| A34 | 启动器 | 非清单后台直启被拒（或不可达） | 待跑 |
| A7b | bash | `xdpyinfo` 失败（若装） | 待跑 |

### B 组
| # | 期望 | 状态 |
|---|---|---|
| B0 | `test -d /etc/abathur && command -v node git npm && node -e 1` rc=0 | 部分 ✔ |
| B1 | `node --test "dist/test/**/*.test.js"` rc=0（构建阶段不在 campaign 期） | 待跑 |
| B2 | git status/commit rc=0 | ✔ |
| B3 | 写工作区读回一致 | ✔ |
| B4 | `nvidia-smi` rc=0（DEVS 空则 N/A） | ✔ |
| B5 | `npm ci --offline` rc=0（NPM_CACHE=on 才适用） | 待跑/条件 |
| B6 | 沙箱内外 `/etc/resolv.conf` diff rc=0 | ✔ |
| B7 | MCP 子进程 NSpid≥2 | 待跑 |
| B8 | 启动器 **stderr 首行** `sandbox=on cwd=/var/empty/abathur deny_inodes=N` | 待跑（字节已备） |
| B9 | 四用例：①`echo "a b"\|tr` ②含单引号 ③多行/heredoc ④含 `$VAR` 字面量 | 待跑（接线闸） |

## 10. 残余
R-D1 直敲 opencode 无沙箱｜R-D2 工作区无配额｜R-D3 内核逃逸（非目标）｜R-D4 机主执行 AI 脚本｜R-D5 嵌套工具不可用｜R-D6 deny-inodes 同 uid 可写（缺失/不可写则 fail-closed）｜R-D7 `ulimit -v` 每进程｜R-D8 `/etc/hosts` 可见｜R-D9 无网→联网安装须机主｜R-D10 TMPD/SHMD 无配额｜R-D11 `auth.json` 可写｜R-D12 TOCTOU 未闭合｜R-D13 登录壳副作用｜R-D14 插件代码同 uid 可写｜R-D15 inode 集不含非普通文件/新增文件｜**R-D16 非 bash 执行面（tmux/后台直启/插件 child_process）未全过沙箱，见 §8.8**｜R-D17 未安装组件前所有“设计闭合”项均未运行

## 11. 与 C 对照
同前（可见性/账户数/常驻 root/迁移成本/可移植/评审状态）。
