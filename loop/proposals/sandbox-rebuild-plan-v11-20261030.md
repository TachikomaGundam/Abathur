# 沙箱重建方案 v11（2026-10-30）

**依据**：v10 得 1A/2R。本版吸收 13 条 must-fix，其中最重要的一条是「共享网络即控制面逃逸：沙箱能访问本机监听端口，若其中有可执行能力的服务，等于绕过沙箱」→ **默认档改为断网**，出网成为人类显式开启的档位。全部判据附当场回执。

---

## 1. 两档 argv（插件 `buildArgv({net})` 单一来源；默认 `none`）

**默认档 net=none（断网）**
```
bwrap --die-with-parent --new-session --unshare-user --unshare-pid --unshare-net
      --tmpfs /home/lab --bind "$WS" "$WS" --tmpfs /tmp
      --ro-bind /usr /usr --ro-bind /etc /etc --ro-bind /opt /opt
      --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 --symlink usr/sbin /sbin
      --dev /dev --proc /proc
      --clearenv --setenv HOME /home/lab
      --setenv PATH /usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
      --setenv TERM xterm-256color --setenv TZ Asia/Shanghai
      -- /bin/sh -c "$CMD"
```

**出网档 net=host（人类启动前 `ABATHUR_SANDBOX_NET=host`）**：同上，`--unshare-net` 换成 `--share-net`，并加 `--ro-bind /run/systemd/resolve /run/systemd/resolve`（否则 DNS 必失，曾实测 `rc=6`）。

## 2. 实测回执

| 编号 | 探针 | 回执 |
|---|---|---|
| R1 | 沙箱内 `test -S /var/run/docker.sock` | `rc=1` |
| R2 | 沙箱内 `ls /dev/input` | `rc=2` |
| R3 | 沙箱内 `ls /var/log` | `rc=2` |
| R4a | 宿主 `ls ~/.ssh` / `ls ~/.npmrc` | `rc=0` / `rc=0` |
| R4b | 沙箱内同命令 | `rc=2` / `rc=2`，`HOME=/home/lab` |
| R5 | 沙箱内 `ps -e --no-headers \| wc -l` | `4` |
| R6 | 沙箱内 `pkill -f opencode` | 无匹配（`rc=1`，无输出） |
| R7 | 沙箱内 `pgrep -u lab -n opencode` | 空（`rc=1`） |
| R8 | **host 档** `curl https://registry.npmjs.org/` | `rc=0` |
| R9 | **host 档** `curl 127.0.0.1:8010` / `:3000` | `rc=0` / `rc=0` |
| R10 | 沙箱内 `node --version` / `npm --version` | `v22.22.1` / `9.2.0` |
| R11 | 沙箱内写 `$WS/.sbx-write-probe` 并读回 | `ok` |
| R12 | `cat /proc/sys/kernel/yama/ptrace_scope` | `1`；来源 `/usr/lib/sysctl.d/55-ptrace.conf:22` |
| R13 | `uname -r` = `7.0.0-30-generic`；`grep CONFIG_(LEGACY_)?TIOCSTI /boot/config-*` | `# CONFIG_LEGACY_TIOCSTI is not set` |
| R14 | 沙箱内 `curl 127.0.0.1:2375/version` | `rc=7` |
| R16 | **默认档** `curl https://example.com` | `rc=6`（无路由） |
| R17 | 宿主 canary，沙箱内 `kill -0` / `kill -TERM <hostpid>` | 均 `No such process`（`rc=1`）；canary 存活 |
| R18 | 沙箱内 `kill -TERM -1` | `rc=1`；ns 内进程 `4`；canary 存活 |
| R19 | 沙箱内 `ls /run/user/1000` | `rc=2` |
| R20 | 沙箱内 `test -S /run/user/1000/bus` | `rc=1` |
| R21 | **host 档** `ss -xa \| grep -c "@"` | `46`；X11 抽象套接字 `@/tmp/.X11-unix/X10` 可见 |
| R22 | `xdpyinfo -display :0` / `:10`（沙箱内） | `rc=1` / `rc=1`（可见但不可连） |
| R23 | 默认档内 `node --version` + `git status --porcelain \| wc -l` | `v22.22.1` / `23`（断网档可做离线作业） |
| R24 | PID 命名空间 inode：宿主 vs 沙箱 | `4026531836` vs `4026535264`（不同 = 包裹确实发生） |
| R25 | `scripts/scan-hardlinks.sh` | `CLEAN`，`rc=0` |
| R26 | `ABATHUR_SANDBOX=0 node … SandboxBash()` | `NO_HOOKS(逃生阀生效)` |
| R27 | `node scripts/sandbox-blast-radius.mjs` | 5 行 JSON + `PASS` + `RC=0`，`exit 0`（见 §6.3） |
| R28 | `bash scripts/check-sandbox-binding.sh` | 5 项 `OK`，`RESULT=PASS`，`exit 0` |
| R29 | 宿主监听面 `ss -tln \| awk '{print $4}'`（host 档可达） | 22/3000/3001/389/5000/636/666/8003/8080/8085/8554/8555…（见 R-9） |

## 3. 通道矩阵

| 通道 | 机制 | 回执 | 等级 |
|---|---|---|---|
| docker → root | 不挂 socket；`/etc` 只读 | R1/R14 | 硬 |
| input 键盘 | 无 `/dev/input`；内核无 TIOCSTI | R2/R13 | 硬 |
| 日志 | 不挂 `/var/log` | R3 | 硬 |
| 秘密文件 | tmpfs HOME + 显式 HOME | R4a/R4b | 硬 |
| 进程面 | `--unshare-pid` | R5/R6/R7/R17/R18/R24 | 硬 |
| ptrace | 发行版 `yama=1` + pidns | R12/R24 | 硬 |
| 会话总线 | `/run/user` 未挂载 | R19/R20 | 硬 |
| 网络（默认档） | `--unshare-net` | R16/R23 | 硬（无路由） |
| 网络（host 档） | 不隔离 | R8/R9/R29 | **不覆盖**（人类显式开启） |

## 4. 非目标

1. **host 档**不隔离网络：可出网、可访问宿主全部监听端口（R9/R29），此即 §5 R-9 控制面风险。默认档不开启。
2. 不防外泄（host 档下读工作区后传出）。
3. 不防工作区写入（业务需要）。
4. 默认档下 `git fetch`/`npm install`/`npm publish` 不可用——这是刻意的，出网须人类显式设 `ABATHUR_SANDBOX_NET=host`。

## 5. 残余风险

| 编号 | 风险 | 边界与处置 |
|---|---|---|
| R-1 | 默认档无网络 | R23 证明离线作业可用；需网络时由人类开 host 档 |
| R-2 | 工作区写无审计 | 独立提案；本版不做 |
| R-3 | 硬链接把秘密引入工作区 | **已实现** `scripts/scan-hardlinks.sh`（R25 `CLEAN`）；只覆盖已知秘密路径，非全量 |
| R-4 | 无 cgroup 限额 | 若启用仅作防事故（父 slice 可写，实测可自挪） |
| R-5 | docker TCP 2375 若开启即成 root 通道 | R14 当前不存在；列入发布检查表 |
| R-6 | 抽象 Unix 套接字命名空间在 host 档共享 | R21=`46`；X11 实测连不上（R22），但抽象名可枚举 |
| R-7 | `/etc` 只读但可读（machine-id、服务配置） | 本版不遮蔽；需时按清单 `--tmpfs` 叠加 |
| R-8 | host 档可达本机全部监听端口 | R29 列出；含 wiki(3000)、vLLM(8000)、OTM serve(19937 若在听) 等 |
| R-9 | **控制面逃逸（host 档）** | 若某个监听端口提供「执行命令/开新会话」能力，沙箱内 bash 可直接调用它 = 绕过沙箱。**处置：默认断网；host 档仅由人类在可信任务中开启，并须先跑 R29 清单确认无执行型控制面** |

## 6. 主体绑定与爆炸半径

1. 只由 `<repo>/.opencode/plugins/sandbox-bash.js` 施加；`shouldWrap` = realpath + 组件边界前缀。
2. 禁止触碰 `~/.config/opencode/**` 与 `/usr/local/lib/abathur/xdg/**`；`check-sandbox-binding.sh` 断言（R28）。
3. 爆炸半径脚本实测输出（R27 逐字）：

```
{"check":"wrap_self","ok":true}
{"check":"wrap_peer","ok":true,"peers":[{"path":"/home/lab/workspace/harness/hr","wrapped":false},{"path":"/home/lab/workspace/harness/PCB-Agent","wrapped":false},{"path":"/home/lab/workspace/harness/VideoGen","wrapped":false},{"path":"/home/lab/workspace/harness/SimpleCut","wrapped":false}]}
{"check":"prefix_boundary","ok":true,"cases":[{"root":"/x/Abathur","dir":"/x/Abathur","want":true,"got":true},{"root":"/x/Abathur","dir":"/x/Abathur/sub","want":true,"got":true},{"root":"/x/Abathur","dir":"/x/Abathur-sibling","want":false,"got":false},{"root":"/x/Abathur","dir":"/x/Abathur2","want":false,"got":false}]}
{"check":"argv","ok":true,"exec_matches":true,"detail":"rc=0 ns_in=NS=pid:[4026535264] ns_host=NS=pid:[4026531836] lines=[\"/bin/sh\",\"-c\",...]"}
PASS
RC=0
```

`argv` 一栏同时证明两件事：命令行与 `buildArgv` 一致，且 PID 命名空间 inode 与宿主不同（R24）——包裹真的发生，而不是「没包也一致」。

## 7. 验收

| 编号 | 判据 | 回执 |
|---|---|---|
| A1–A3 | 三通道关闭 | R1/R2/R3 |
| A4 | 秘密文件对照 | R4a=0 / R4b=2 |
| A5 | 进程面 | R5/R6/R7/R17/R18/R24 |
| A6 | 工具链 | R10 |
| A7 | 写面 | R11 |
| A8 | 默认档无网络 | R16/R23 |
| A9 | 主体绑定 | R28 |
| A10 | 爆炸半径 | R27（exit 0） |
| A11 | 逃生阀 | R26 |
| A12 | 硬链扫描 | R25 |

## 8. 安装与回滚

- 装：仓内 `.opencode/plugins/sandbox-bash.js`（项目级，随仓提交）。
- 回滚：删该文件，重启会话；逃生阀 `ABATHUR_SANDBOX=0`（R26 已验）。

## 9. 与 P1 的分工

P1 只记录不拦截，独立推进；本方案落地后 P1 转漂移监测。
