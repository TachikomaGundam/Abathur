# 沙箱重建方案 v10（2026-10-30）

**依据**：v9 被 0A/3R 否决（13 条 must-fix，实质认可、缺产物）。本版补齐全部实测产物，并删除不可复现的 R15。

---

## 1. 被测 argv（唯一权威形态，插件 `buildArgv()` 单一来源）

```
bwrap --die-with-parent --new-session
      --unshare-user --unshare-pid
      --share-net                       # 档位 host；ABATHUR_SANDBOX_NET=none 时换 --unshare-net
      --tmpfs /home/lab --bind "$WS" "$WS" --tmpfs /tmp
      --ro-bind /usr /usr --ro-bind /etc /etc --ro-bind /opt /opt
      --ro-bind /run/systemd/resolve /run/systemd/resolve     # 仅 host 档
      --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 --symlink usr/sbin /sbin
      --dev /dev --proc /proc
      --clearenv --setenv HOME /home/lab
      --setenv PATH /usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
      --setenv TERM xterm-256color --setenv TZ Asia/Shanghai
      -- /bin/sh -c "$CMD"
```

## 2. 实测回执（全部当面执行，2026-10-30）

| 编号 | 探针 | 回执 |
|---|---|---|
| R1 | 沙箱内 `test -S /var/run/docker.sock` | `rc=1` |
| R2 | 沙箱内 `ls /dev/input` | `rc=2` |
| R3 | 沙箱内 `ls /var/log` | `rc=2` |
| R4a | 宿主 `ls ~/.ssh` / `ls ~/.npmrc` | `rc=0` / `rc=0`（均真实存在） |
| R4b | 沙箱内同命令 | `rc=2` / `rc=2`，`HOME=/home/lab` |
| R5 | 沙箱内 `ps -e --no-headers \| wc -l` | `4` |
| R6 | 沙箱内 `pkill -f opencode` | 无输出（无匹配） |
| R7 | 沙箱内 `pgrep -u lab -n opencode` | 空 |
| R8 | 沙箱内 `curl https://registry.npmjs.org/` | `rc=0` |
| R9 | 沙箱内 `curl 127.0.0.1:8010` / `:3000` | `rc=0` / `rc=0` |
| R10 | 沙箱内 `node --version` / `npm --version` | `v22.22.1` / `9.2.0` |
| R11 | 沙箱内写 `$WS/.sbx-write-probe` 并读回 | `ok`（宿主可见） |
| R12 | `cat /proc/sys/kernel/yama/ptrace_scope` | `1`；**持久来源** `/usr/lib/sysctl.d/55-ptrace.conf:22`（发行版配置，非本席设置） |
| R13 | `grep CONFIG_LEGACY_TIOCSTI /boot/config-$(uname -r)` | 无此配置项（内核不支持 TIOCSTI 注入） |
| R14 | 沙箱内 `curl 127.0.0.1:2375/version` | `rc=7`（无 docker TCP 监听） |
| R16 | 断网档 `net=none` 下 `curl https://example.com` | `rc=6`（无路由/DNS 失败） |
| R17 | 宿主起 canary 进程，沙箱内 `kill -0 <hostpid>` / `kill -TERM <hostpid>` | 均 `No such process`，`rc=1`；**canary 存活** |
| R18 | 沙箱内 `kill -TERM -1`（广播） | `rc=1`；命名空间内进程数 `4`；**canary 存活** |
| R19 | 沙箱内 `ls /run/user/1000` | `rc=2`（未挂载） |
| R20 | 沙箱内 `test -S /run/user/1000/bus` | `rc=1`（会话总线不可达） |
| R21 | 沙箱内 `ss -xa \| grep -c "@/tmp/.X11-unix"` | `28`（抽象套接字命名空间共享，见 R-7） |
| R22 | `node scripts/sandbox-blast-radius.mjs` | 三行 JSON + `PASS`，`exit 0`（见 §6.3 原文） |
| R23 | `bash scripts/check-sandbox-binding.sh` | 5 项全 `OK`，`RESULT=PASS`，`exit 0` |

**已删除 v9 的 R15**：宿主 PID 在子命名空间内不可得，`EACCES` 与 `ENOENT` 之争不可归因；environ 通道改由 R5/R7/R17/R18 共同证明（目标不可枚举 + 信号不可达）。

## 3. 通道矩阵

| 通道 | 机制 | 回执 | 等级 |
|---|---|---|---|
| docker → root | 不挂 `/var/run/docker.sock`；`/etc` 只读 | R1；R14 | 硬 |
| input 键盘 | `--dev` 只建基础节点；内核无 TIOCSTI | R2；R13 | 硬 |
| 日志 | 不挂 `/var/log` | R3 | 硬 |
| 秘密文件 | `--tmpfs /home/lab` + 显式 HOME | R4a/R4b 对照 | 硬 |
| 进程面 | `--unshare-pid` | R5/R6/R7/R17/R18 | 硬 |
| ptrace | 发行版 `yama=1` + PID 命名空间 | R12 | 硬（非瞬态） |
| 会话总线 | `/run/user` 未挂载 | R19/R20 | 硬 |
| 网络 | **不隔离**（显式非目标） | R8/R9 | 不覆盖 |

## 4. 非目标（显式，不得读作保证）

1. 网络不隔离：可出网、可达本机服务（R8/R9）。这是**工作流取舍**（断网会使本线 bash 无法 `npm install`/`git fetch`），不是技术上的二选一——断网档已实测可用（R16）。
2. 不防外泄：读工作区后经网络传出不在覆盖范围。
3. 不防工作区写入（业务需要）。

## 5. 残余风险（具名，边界已实测）

| 编号 | 风险 | 边界 |
|---|---|---|
| R-1 | 网络面未隔离 | R8/R9；与现状同权，沙箱未新增网络能力 |
| R-2 | 工作区写无审计 | 独立提案（根属主日志 hook），本版不做 |
| R-3 | 硬链接把家目录秘密引入工作区后仍可读 | 启动扫描 + 具名；不可根除 |
| R-4 | 断网档下 `git fetch`/`npm install` 不可用 | 非默认档 |
| R-5 | 本版无 cgroup 限额 | 若启用仅作防事故（父 slice 可写，实测可自挪） |
| R-6 | docker TCP 2375 若将来开启即成 root 通道 | R14 当前不存在；列入发布检查表 |
| R-7 | 抽象 Unix 套接字命名空间共享（X11 可见） | R21=`28`；需 `.Xauthority` 才能连接，而 HOME 已 tmpfs 遮蔽（R4b），故仅「可见不可用」 |
| R-8 | `/etc` 只读但可读（machine-id、服务配置、世界可读凭据文件） | 本版不遮蔽；若需，后续按文件清单 `--tmpfs` 叠加 |

## 6. 主体绑定与爆炸半径

1. 只由 `<repo>/.opencode/plugins/sandbox-bash.js` 施加；`shouldWrap(directory, repoRoot)` 用 realpath + **组件边界**前缀（`dir === root` 或 `dir.startsWith(root + "/")`）。
2. 禁止触碰 `~/.config/opencode/**` 与 `/usr/local/lib/abathur/xdg/**`；`scripts/check-sandbox-binding.sh` 对两处配置做只读断言（R23）。
3. 爆炸半径脚本 `scripts/sandbox-blast-radius.mjs` 实测输出（R22，逐字）：

```
{"check":"wrap_self","ok":true}
{"check":"wrap_peer","ok":true,"peers":[{"path":"/home/lab/workspace/harness/hr","wrapped":false},{"path":"/home/lab/workspace/harness/PCB-Agent","wrapped":false},{"path":"/home/lab/workspace/harness/VideoGen","wrapped":false},{"path":"/home/lab/workspace/harness/SimpleCut","wrapped":false}]}
{"check":"argv","ok":true,"exec_matches":true,"detail":"rc=0 lines=[\"/bin/sh\",\"-c\",\"tr '\\\\0' '\\\\n' < /proc/self/cmdline\"]"}
PASS
```

其中 `argv` 比对取自**沙箱内 `/proc/self/cmdline` 实读**，非插件自述；前缀边界另有纯函数断言四例（`/x/Abathur` vs `/x/Abathur-sibling`、`/x/Abathur2` 均 false）。

## 7. 验收

| 编号 | 判据 | 回执 |
|---|---|---|
| A1–A3 | 三通道关闭 | R1/R2/R3 |
| A4 | 秘密文件对照 | R4a=0 / R4b=2 |
| A5 | 进程面 | R5=4 / R6 空 / R7 空 / R17 / R18 |
| A6 | 工具链 | R10 |
| A7 | 写面 | R11 |
| A8 | 网络（非目标，仅记录） | R8 / R9 |
| A9 | 主体绑定 | R23=PASS |
| A10 | 爆炸半径 | R22=PASS（exit 0） |
| A11 | 断网档可用 | R16 |

## 8. 安装与回滚

- 装：仓内 `.opencode/plugins/sandbox-bash.js`（项目级，随仓提交）。
- 不装用户级、不装 root 快照、不改 `~/.config/opencode/opencode.jsonc`（R23 守护）。
- 回滚：删该文件，重启会话。逃生阀：`ABATHUR_SANDBOX=0`。

## 9. 与 P1 的分工

P1 只记录不拦截（是否被伪装、插件/工具集哈希、缺口），独立推进；本方案落地后 P1 转为漂移监测。
