## 修订页 v10（对应 8cd3 庭 8 条 must-fix）

| must-fix | 落点 |
|---|---|
| 启动器两个哈希并存 | §8.1/§12 与本页统一为 `331f9bec5bb0b8a19419083cdec4a10e34f581942629b744ed9bb905569bc285`；旧值 `f7af89d1…` 已标废并注明取代关系 |
| §5.3 与字节双权威（16 项 vs 9 项） | §5.3 改为指回 §8.1 字节的 9 路径循环；另 7 项声明不采集并挂 R-D19 |
| §12 挪用 A14 编号 | 拆出独立编号 **A37** 并登记进 §9；A14（文件工具面）保持「待跑」 |
| `/var/tmp` 路径可预测 | §6.1 改 `mktemp -d /var/tmp/abathur.XXXXXXXX`，0700，退出即删；实测前后均 0 残留 |
| §5.4「无活进程引用」无判据 | 两条同时满足才清：mtime>7 天 且 /proc/*/fd|cwd|root 无持有；否则仅记录 |
| R7.3「启动器内无 trap」与字节冲突 | 改为「启动器对沙箱 TMPD 无清理 trap；自有 WORK 的 mktemp trap 保留」，指明非同一对象 |
| 沙箱字节随之更新 | §6.1 sha256 `0dc7bf512f6429d46b20e41201d5ec4feb4dbc394a5df5f27578438997136258`（v8）；A9/A19/A23 复跑回执见 §12 |

---

## 修订页 v8（对应 04ca 庭 10 条 must-fix；字节级闭合）

| must-fix | 落点 | 形态 |
|---|---|---|
| 启动器字节未随 R7.1/R7.9 改 | §8.1 已重写为 v8 字节，sha256 `331f9bec5bb0b8a19419083cdec4a10e34f581942629b744ed9bb905569bc285` | 字节+回执 |
| ~~`f7af89d1…`~~ | **已标废**：被 v10 的 `mktemp -d` 修订取代（R-D22 关闭）；旧值仅作历史，不得再引用 | — |
| sandbox-exec SID 与 R7.3 不符 | §6.1 已换为 v7 字节，`SID=${ABATHUR_SID:-$PPID-$$}`，sha256 `6c74b82d2c24858ce5840731fc7dc66f85cc37357ba6a900d99e123d274753b2` | 字节 |
| §5.3「root 脚本」与 R7.2 矛盾 | §5.3 已改写：身份=lab，补三条终态 | 条文 |
| §10 缺 R-D18/R-D19 | §10 已补登 R-D18..R-D21 | 条文 |
| R7.8 枚举无判据 | 枚举源=`docs/tools-enumeration-$(opencode --version).txt`（插件钩子导出，入册）；验收=覆盖集合 ⊇ 该文件 | 判据 |
| R7.1 路径闭集未对齐 §5.2 | **唯一权威=§8.1 启动器字节的 9 路径循环**；§5.3 指回该字节，不另抄一份 | 字节 |
| R7.3 trap 在 exec 后不存 | 清理责任归 sandbox-exec（bwrap 后 rm 再 exit，已实跑）；异常残留归 §5.4 | 条文 |
| R7.4 扫描未覆盖 TMPD | 启动闸不覆盖 TMPD（另一文件系统），已具名 R-D21，检测归 §5.4 | 条文 |
| webfetch 与「永久无网」冲突 | 已具名 R-D20：无网保证仅 bash 面 | 条文 |
| 设计态项未给排期 | §9 A 组保持「待跑」标签，不并入已验证 | 状态 |

**v8 回执（2026-10-24，`/tmp`）**：启动器 `sh -n` OK；正常态 `deny_inodes=21 absent=1 collected=8`；空白家 `deny_inodes=0 absent=9 collected=0`（空集合法）；工作区硬链 `2304:8388792` 命中 → 拒绝启动并列路径；DENY 不可写 → rc=2。

---


---

## 修订页 v7（对应 2598 庭 10 条 must-fix；v6 正文除下列条款外继续有效）

**R7.1 deny-inodes 采集语义（修 M1）**：启动器逐路径 `stat`，**不使用 `2>/dev/null`**，记录每条路径的 rc：
- 全部 rc=0 → 集合=实测 inode 集；
- 某路径 rc=1（不存在）→ 记 ABSENT，不阻断；
- 某路径 rc 既非 0 也非 1（权限/IO 错）→ **fail-closed 拒绝启动**并具名该路径。
不得把「采集失败」与「全部不存在」混为一谈。

**R7.2 启动器身份（修 M2）**：启动器以**用户 lab** 运行，不是 root；因此 §5.2 的采集面只含 lab 可读路径。对 `/home/lab/workspace` 之外的系统面**不做** inode 采集，并具名未覆盖 **R-D19**（理由：即便入集也无法在 bash 面强制，见 R7.4）。

**R7.3 沙箱临时目录（修 M3）**：`/var/tmp/abathur-$SID/{tmp,shm}`，SID 唯一（缺省 `$PPID-$$`，可由外层注入）；路径改为不可预测的 `mktemp -d /var/tmp/abathur.XXXXXXXX`（R-D22 关闭）；清理责任归 **sandbox-exec**：bwrap 返回后 `rm -rf "$BASE"` 再 `exit`（§6.1 字节末段）。**启动器对沙箱 TMPD 无清理 trap**；启动器自有 WORK 目录的 mktemp trap 保留——两者不是同一对象。异常崩溃残留由 §5.4 每日对账 timer 记录并清理（具名例外）。

**R7.4 bash 面硬链（修 M4）**：bwrap 按路径挂载，**无 inode 过滤**，故 bash 面无法强制 deny-inodes。终态二分：
- (a) 探针：`ln ~/.npmrc $TMPDIR/hl && sandbox-exec 'cat $TMPDIR/hl'` **必须成功**=漏洞可复现（本案已实锤：沙箱内读到 npm token 的 `_authToken` 键与前缀，值不入档）；
- (b) 机械缓解：启动器启动时执行 `find "$WORKSPACE" -xdev -type f -links +1`，与 deny-inodes 集求交；**非空则拒绝启动并列出路径**；该扫描 rc≠0 即 fail-closed。
- 剩余窗：会话运行期间新埋的硬链 → **R-D18 具名残余**，由 §5.4 每日同款扫描发现并告警。

**R7.5 §5.3 刷新语义（修 M5）**：改为「每次工具调用前重算 deny-inodes 集（递归遍历）；文件工具按重算集判定；bash 面只按启动时快照（R-D15 具名）」。不再写「刷新」而不定义。

**R7.6 sandbox-exec 参数面（修 M6）**：已拒多余 argv（实测 rc=2）。MCP 验收改为：夹具服务在 sandbox-exec 内运行，回显收到的 argv 数量与内容，**断言 argv 数 == 2**。

**R7.7 回执绑定出厂字节（修 M7）**：A23/A28 回执必须附 `sha256sum /usr/local/lib/abathur/sandbox-exec`，且与文稿内嵌脚本块 sha256 相同。

**R7.8 §8.7 工具清单（修 M8）**：改为封闭清单——bash, read, write, edit, grep, glob, list, task, webfetch, mcp_*, skill, todowrite，外加插件 `tool.execute.before` 实际覆盖的全部工具名（以 `opencode --version` 对应版本的枚举为准）。

**R7.9 空白新机（修 M9）**：deny-inodes 路径**全部 ABSENT** 时集合为空，启动器**正常启动**（空集≠失败）；A 组新增「空白家目录」用例（HOME 指向空目录跑 A1–A6）。

**R7.10 状态降级（修 M10）**：A14（硬链探针）与 A32（auth.json 探针）实跑前标「设计态」，不得列入「已验证」。

**R7.11 本版新事实**：`ulimit -f` 单位为 1024 字节块——65536=64 MiB（96 MiB 被 SIGXFSZ 杀）、出厂默认 2097152=2 GiB（1.1 GiB 写入成功）；文稿旧句「1 GiB」更正为 2 GiB。
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

### 4.3 回执（脚本 v6 字节，sha256 `9b653a74…`）——**v6 字节的旧回执，不为 v7 字节背书**；v7 字节复跑见 §12
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
- 采集：**唯一权威 = §8.1 启动器字节里的 9 路径循环**（逐路径 find+stat，采集常规文件 dev:ino → `/run/user/$(id -u)/abathur-deny-inodes`）。
- §5.2 清单另有 7 项属非家目录面（`/run/user/**`、`/var/log`、`/var/run`、`/var/snap`、`/etc/abathur`、`/proc/*/*`、`/dev/input`）：**不采集**，理由与残余见 R-D19（即使采集，bash 面也无法按 inode 强制）。本节不另列路径表。
- 三条终态：路径全部不存在 → 集合为空，**正常启动**；任一 `find`/`stat` 非零 → **exit 2（fail-closed）**；DENY 文件不可写 → exit 2。**不使用 `2>/dev/null`**（错误必须可见）。
- 刷新：每次工具调用前重算（递归），文件工具按重算集判定；bash 面只按启动时快照（R-D15 具名）。
- 工作区硬链闸：启动时 `find $WORKSPACE -xdev -links +1` 与 deny 集求交，非空即 exit 2（R7.4b）。
- 具名弱点：文件同 uid 可写（R-D6）。

### 5.4 每日对账（新增，R7.3/R7.4 的落点）
root 系统 timer 每日执行：①清 `/var/tmp/abathur.*` 残留——判定谓词（两条同时满足才清）：mtime 早于 7 天，且扫描 `/proc/*/fd`、`/proc/*/cwd`、`/proc/*/root` 未发现任何进程持有该目录下路径；不满足则仅记录；②对工作区重跑硬链扫描并告警（R-D18 的检测手段）；③记录 `deny_inodes` 数量变化；④对 `/var/tmp/abathur-*/{tmp,shm}` 重跑 nlink>1 扫描并告警（R-D21 的检测手段；存活会话窗口另行记录）。它是本设计中唯一的 root 组件，具名例外。

## 6. D2 bash 沙箱
### 6.1 命令（**v8 出厂字节，已实跑**；sha256 `0dc7bf512f6429d46b20e41201d5ec4feb4dbc394a5df5f27578438997136258`）
```sh
#!/bin/sh
# sandbox-exec v7（提案 D v7 同一字节）
[ $# -eq 1 ] || { echo "usage: sandbox-exec <single-command-string>" >&2; exit 2; }
CMD="$1"
[ -n "$CMD" ] || { echo "sandbox-exec: empty command" >&2; exit 2; }
WORKSPACE=${WORKSPACE:-/home/lab/workspace}
SBX_HOME=${SBX_HOME:-/home/lab}
GITCONFIG=${GITCONFIG:-$SBX_HOME/.gitconfig}
TZNAME=${TZNAME:-Asia/Shanghai}
ETC_MASK=${ETC_MASK:-/etc/abathur}
DEVS=${DEVS:-"/dev/nvidia0 /dev/nvidia1 /dev/nvidiactl /dev/nvidia-uvm /dev/nvidia-uvm-tools /dev/nvidia-modeset /dev/dri"}
ULIMIT_N=${ULIMIT_N:-256}; ULIMIT_V=${ULIMIT_V:-8388608}; ULIMIT_F=${ULIMIT_F:-2097152}
NPM_CACHE=${NPM_CACHE:-off}
BASE=$(mktemp -d /var/tmp/abathur.XXXXXXXX) || { echo "sandbox-exec: 无法创建临时基目录" >&2; exit 2; }
TMPD=$BASE/tmp; SHMD=$BASE/shm
[ -d "$ETC_MASK" ] || { echo "sandbox-exec: ETC_MASK $ETC_MASK 不存在" >&2; exit 2; }
mkdir -m 700 "$TMPD" "$SHMD" || { rm -rf "$BASE"; exit 2; }
trap 'rm -rf "$BASE"' EXIT INT TERM
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
/usr/bin/bwrap "$@" --chdir "$WORKSPACE" \
  /bin/bash -c 'ulimit -u '"$ULIMIT_N"'; ulimit -v '"$ULIMIT_V"'; ulimit -f '"$ULIMIT_F"'; exec /bin/bash -c "$1"' _ "$CMD"
RC=$?
rm -rf "$BASE"
exit $RC
```
### 6.2–6.7
挂载理由同前；env 白名单见 §4.3；持久化论证（spool 未挂 + /etc ro）；资源上界；配置 `sandbox.conf`；Yama 撤回。

## 7. D3 网络
**bash 面永久无网**（A9 rc6）。宿主内工具（webfetch 等）不在该保证内（R-D20）。`NPM_CACHE=on` 时 ro 挂 `_cacache` 供 `npm ci --offline`；B5 仅在 `on` 时适用。

## 8. 闸门与接线

### 8.1 启动器（含 banner、deny-inodes、硬链闸；**v8 出厂字节，已实跑**；sha256 `331f9bec5bb0b8a19419083cdec4a10e34f581942629b744ed9bb905569bc285`）
```sh
#!/bin/sh
# /usr/local/bin/abathur   root:root 0755  运行身份=调用者(lab)
set -u
DENY=${ABATHUR_DENY:-/run/user/$(id -u)/abathur-deny-inodes}
WORKSPACE=${WORKSPACE:-/home/lab/workspace}
OPENCODE=${ABATHUR_OPENCODE:-/usr/bin/opencode}
CWD=${ABATHUR_CWD:-/var/empty/abathur}
WORK=$(mktemp -d /tmp/.abathur-work.XXXXXX) || { echo "abathur: 无法创建临时工作区" >&2; exit 2; }
trap 'rm -rf "$WORK"' EXIT INT TERM
: > "$DENY" || { echo "abathur: deny-inodes 不可写，拒绝启动" >&2; exit 2; }
ABSENT=0; COLLECTED=0
for p in "$HOME/.ssh" "$HOME/.gnupg" "$HOME/.npmrc" "$HOME/.config/gh" "$HOME/.docker" "$HOME/.aws" \
         "$HOME/.local/share/keyrings" "$HOME/.local/share/opencode/auth.json" "$HOME/.Xauthority"; do
  if [ ! -e "$p" ]; then ABSENT=$((ABSENT+1)); continue; fi
  if ! find "$p" -type f -print0 > "$WORK/find" ; then
    echo "abathur: 采集失败 $p，拒绝启动" >&2; rm -f "$WORK/find"; exit 2
  fi
  if ! xargs -0 -r stat -c '%d:%i' < "$WORK/find" >> "$DENY"; then
    echo "abathur: stat 失败 $p，拒绝启动" >&2; rm -f "$WORK/find"; exit 2
  fi
  COLLECTED=$((COLLECTED+1))
done
if ! find "$WORKSPACE" -xdev -type f -links +1 -print0 > "$WORK/hl" ; then
  echo "abathur: 硬链扫描失败，拒绝启动" >&2; rm -f "$WORK/hl"; exit 2
fi
if [ -s "$WORK/hl" ]; then
  xargs -0 -r stat -c '%d:%i %n' < "$WORK/hl" > "$WORK/hl2"
  if awk 'NR==FNR{d[$0]=1;next} ($1 in d){print}' "$DENY" "$WORK/hl2" > "$WORK/hit" && [ -s "$WORK/hit" ]; then
    echo "abathur: 工作区存在指向禁面的硬链，拒绝启动：" >&2; cat "$WORK/hit" >&2
    rm -rf "$WORK"; exit 2
  fi
fi
rm -rf "$WORK"
echo "sandbox=on cwd=$CWD deny_inodes=$(wc -l < "$DENY") absent=$ABSENT collected=$COLLECTED" >&2
cd "$CWD" 2>/dev/null || { echo "abathur: 工作目录缺失" >&2; exit 2; }
export XDG_CONFIG_HOME=/etc/abathur/xdg
export XDG_CACHE_HOME=/var/cache/abathur
export OPENCODE_CONFIG=/etc/abathur/xdg/opencode/opencode.json
exec "$OPENCODE" "$@"
```
（B8 读 **stderr 首行**，`deny_inodes=0` 合法；A31 用不可写 DENY 路径模拟 → rc 2；A35 用工作区硬链模拟 → rc 2。）

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
| A31 | 启动器 | DENY 不可写 → rc=2 | **已实跑**（`/proc/deny` → rc=2） |
| A35 | 启动器 | 工作区硬链指向禁面 → 拒绝启动并列路径 | **已实跑**（`2304:8388792 /home/lab/workspace/.hl-test` → rc=2） |
| A36 | 启动器 | 空白家目录（9 路径全 ABSENT）正常启动 `deny_inodes=0` | **已实跑**（rc=0） |
| A37 | 沙箱 | 同文件系统硬链入工作区 → 沙箱内读到 token（R-D18 实证） | **已实跑**（读得 `_authToken` 键） |
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
| B8 | 启动器 **stderr 首行** 前缀匹配 `sandbox=on cwd=` 且含 `deny_inodes=N absent=N collected=N` | **已实跑**（正常态 21/1/8；空白态 0/9/0） |
| B9 | 四用例：①`echo "a b"\|tr` ②含单引号 ③多行/heredoc ④含 `$VAR` 字面量 | 待跑（接线闸） |

## 10. 残余
R-D1 直敲 opencode 无沙箱｜R-D2 工作区无配额｜R-D3 内核逃逸（非目标）｜R-D4 机主执行 AI 脚本｜R-D5 嵌套工具不可用｜R-D6 deny-inodes 同 uid 可写（缺失/不可写则 fail-closed）｜R-D7 `ulimit -v` 每进程｜R-D8 `/etc/hosts` 可见｜R-D9 无网→联网安装须机主｜R-D10 TMPD/SHMD 无配额｜R-D11 `auth.json` 可写｜R-D12 TOCTOU 未闭合｜R-D13 登录壳副作用｜R-D14 插件代码同 uid 可写｜R-D15 inode 集不含非普通文件/新增文件｜**R-D16 非 bash 执行面（tmux/后台直启/插件 child_process）未全过沙箱，见 §8.8**｜R-D17 未安装组件前所有“设计闭合”项均未运行｜**R-D18 会话运行期新埋硬链（启动闸只盖启动时刻；检测=§5.4 每日扫描）**｜**R-D19 工作区外系统面不做 inode 采集（即使采集，bash 面也无法强制）**｜**R-D20 webfetch 等宿主内工具走宿主网络（§7 的“永久无网”只覆盖 bash 面）**｜**R-D21 硬链若埋进 $TMPD/$SHMD（另一文件系统）可绕过启动扫描（§5.4 复盘）**

## 11. 与 C 对照
同前（可见性/账户数/常驻 root/迁移成本/可移植/评审状态）。


## 12. v7/v8 字节复跑回执（2026-10-24，`/tmp`；sha256 逐字对照）

| 项 | 命令产出 |
|---|---|
| sandbox-exec 磁盘文件 | `0dc7bf512f6429d46b20e41201d5ec4feb4dbc394a5df5f27578438997136258  /tmp/abathur-sandbox-exec-v8` |
| 文稿内嵌块重算 | 与上行逐字相同（python hashlib 复算） |
| 启动器磁盘文件 | `331f9bec5bb0b8a19419083cdec4a10e34f581942629b744ed9bb905569bc285  /tmp/abathur-launcher-v8` |
| 文稿内嵌块重算 | 与上行逐字相同 |
| A9 断网 | `curl -sS -m 3 https://example.com` → rc=6 |
| A19 env | `HOME LANG LC_ALL LOGNAME PATH PWD SHLVL TERM TMPDIR TZ USER _` 共 12 项，无 `FOO_SECRET_MARKER` |
| A23 超限 | 限 64 MiB：`dd count=96` → SIGXFSZ，`DD_RC=153`，文件长 67108864 |
| A28 双文件 | 各 32 MiB → `F1_OK` `F2_OK` |
| **A37**（R7.4a 探针，独立编号；A14 属文件工具面、仍待跑） | 同文件系统硬链入工作区后，沙箱内 `cat` 读到 token 键值 → **R-D18 为真** |
| B8 banner | `sandbox=on cwd=/tmp/fakecwd deny_inodes=21 absent=1 collected=8` |
| A31 | `ABATHUR_DENY=/proc/deny` → rc=2 |
| A36 | `HOME=/tmp/emptyhome` → `deny_inodes=0 absent=9 collected=0` rc=0 |
| 临时目录残留 | 启动器 `ls -d /tmp/.abathur-work.*` → 0；沙箱 `ls -d /var/tmp/abathur.*` 前后均 0（均改 mktemp，R-D22 关闭） |
| 沙箱 TMPD 权限 | 基目录 0700；沙箱内 /tmp 为独立 tmpfs |
