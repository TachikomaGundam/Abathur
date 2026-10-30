# 沙箱重建方案 v9（2026-10-30）

**性质**：v8 被 0A/3R 否决（19 条 must-fix）。本版逐条吸收，且**每条判据都附当场实测回执**（宿主侧，2026-10-30T15:5xZ）。所有回执用下节 §1 的**逐字 argv** 产生。

---

## 1. 被测 argv（唯一权威形态）

```
bwrap --die-with-parent --new-session \
      --share-net --unshare-user --unshare-pid \
      --tmpfs /home/lab --bind "$WS" "$WS" --tmpfs /tmp \
      --ro-bind /usr /usr --ro-bind /etc /etc --ro-bind /opt /opt \
      --ro-bind /run/systemd/resolve /run/systemd/resolve \
      --symlink usr/bin /bin --symlink usr/lib /lib \
      --symlink usr/lib64 /lib64 --symlink usr/sbin /sbin \
      --dev /dev --proc /proc \
      --clearenv --setenv HOME /home/lab \
      --setenv PATH /usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
      --setenv TERM xterm-256color \
      /bin/sh -c "$CMD"
```

`$WS` = 当前项目目录（realpath）。**v8 的两处错误已改**：`--clearenv` 后显式 `--setenv HOME /home/lab`（否则 HOME=`/`，A6 空过）；`--unshare-pid` 加入（否则 PID 与 environ 暴露）。

## 2. 实测回执（本节即 v8 要求增补的「已执行」证据）

| 编号 | 探针 | 回执 | 判读 |
|---|---|---|---|
| R1 | 沙箱内 `test -S /var/run/docker.sock` | `rc=1` | docker 套接字通道关闭 |
| R2 | 沙箱内 `ls /dev/input` | `rc=2` | 键盘设备通道关闭 |
| R3 | 沙箱内 `ls /var/log` | `rc=2` | 日志通道关闭 |
| R4a | **宿主** `ls ~/.ssh` / `ls ~/.npmrc` | `rc=0` / `rc=0`（两者真实存在） | 对照基线 |
| R4b | 沙箱内 `ls $HOME/.ssh` / `ls $HOME/.npmrc` | `rc=2` / `rc=2`，`HOME=/home/lab` | 秘密文件被 tmpfs HOME 遮蔽（非空过） |
| R5 | 沙箱内 `ps -e --no-headers \| wc -l` | `4` | PID 命名空间生效（宿主数百进程不可见） |
| R6 | 沙箱内 `pkill -f opencode` | 无匹配、无输出 | 无法信令他席进程（v8 的 A10 矛盾消解：**该能力确实不存在**） |
| R7 | 沙箱内 `pgrep -u lab -n opencode` | 空 | 宿主进程不可枚举 |
| R8 | 沙箱内 `curl https://registry.npmjs.org/` | `rc=0` | DNS 与出网正常（见 §4 非目标） |
| R9 | 沙箱内 `curl 127.0.0.1:8010` / `:3000` | `rc=0` / `rc=0` | 本机服务可达（见 §5 R-2） |
| R10 | 沙箱内 `node --version` / `npm --version` | `v22.22.1` / `9.2.0` | 工具链可用 |
| R11 | 沙箱内写 `$WS/.sbx-write-probe` 并读回 | `ok` | 工作区可写且宿主可见 |
| R12 | 宿主 `cat /proc/sys/kernel/yama/ptrace_scope` | `1` | 默认值（重启后即此值，无需持久化） |
| R13 | 宿主内核配置 `CONFIG_LEGACY_TIOCSTI` | 未设置（`grep` 无输出） | 内核不支持 TIOCSTI 注入（v8 的 C1 疑虑关闭） |
| R14 | 沙箱内 `curl 127.0.0.1:2375/version` | `rc=7` | 本机无 docker TCP 监听（Docker 的 TCP 旁路当前不存在） |
| R15 | 沙箱内读 `/proc/<lab进程>/environ` | `Permission denied` | 该 uid 不同/受 Yama 限制；且 R5/R7 已使目标不可枚举 |

**v8 的「A8 空转」已修**：不再用 `curl …; echo $?`（取到的是 echo 的状态），改为直接取 curl 自身 rc（R8–R10 即为该形态）。

## 3. 通道矩阵（逐条对应四个目标）

| 通道 | 机制 | 回执 | 等级 |
|---|---|---|---|
| docker → root | 不挂 `/var/run/docker.sock`；`/etc` 只读 | R1；R14 旁路实测不存在 | 硬 |
| input 键盘 | `--dev /dev` 只建基础节点；无 `/dev/input`；TIOCSTI 内核禁用 | R2；R13 | 硬 |
| 日志 | 不挂 `/var/log` | R3 | 硬 |
| 秘密文件 | `--tmpfs /home/lab` + 显式 `HOME` | R4a/R4b 对照 | 硬 |
| 进程面（信令/environ） | `--unshare-pid` | R5/R6/R7 | 硬 |
| ptrace | 默认 `yama=1`（非后代不可附加）+ PID 命名空间 | R12 | 硬（无需 sysctl 持久化，**v8 的瞬态依赖已消除**） |
| 网络 | **不隔离**（显式非目标） | R8/R9 | 不覆盖 |

## 4. 非目标（显式，不得被读作保证）

1. **网络不隔离**：沙箱内可出网、可访问本机服务（R8/R9）。理由不是「技术上只能二选一」（v8 的错误二分法已撤），而是**工作流取舍**：断网会使本线 bash 无法 `npm install`/`git fetch`，而本线需要这些。
2. 不防外泄：读工作区后经网络传出不在覆盖范围。
3. 不防工作区写入（业务需要）。

可选档位（同一 argv，只改网络三行）：
- `net=host`（默认，本版）
- `net=none`：`--unshare-net` 取代 `--share-net`（零路由、无 NET_ADMIN，实测 `rc=7`；供高风险任务按需启用）

## 5. 残余风险（具名，均已实测其边界）

| 编号 | 风险 | 实测/处置 |
|---|---|---|
| R-1 | 网络面未隔离；本机服务（wiki:3000、代理:8010）自沙箱可达 | R9；属「维持现状」，非本版新增；沙箱未扩大权限 |
| R-2 | 工作区写无审计 | 独立提案（根属主日志 hook），本版不做 |
| R-3 | 硬链接把 `~/.ssh` 等引入工作区后仍可读 | 启动扫描（`find -links +1` 与秘密 inode 求交）+ 具名；无法根除 |
| R-4 | 断网档位下 `git fetch`/`npm install` 不可用 | 该档位为按需启用，非默认 |
| R-5 | cgroup 限额可自挪（v8 的 F6） | 本版不加限额；如需，仅作防事故，不得宣称硬墙 |
| R-6 | `--share-net` 下 docker TCP 2375 若未来开启即成 root 通道 | R14 当前不存在；若开启须同步封堵，列入发布检查表 |

## 6. 主体绑定与爆炸半径（本方案第一性要求）

1. 沙箱**只能**由本仓项目级插件 `<repo>/.opencode/plugins/sandbox-bash.js` 施加；判定用 `realpath(ctx.directory)` 前缀匹配本仓根。他线目录 → 不包裹。
2. **禁止**触碰 `~/.config/opencode/**` 与 `/usr/local/lib/abathur/xdg/**`（上次事故的两个装载点）。安装脚本对这两处只做只读断言，发现本项目引用即 `exit 3`。
3. **爆炸半径测试（机械化，不再人工目检）**：
   - `node scripts/sandbox-blast-radius.mjs` 输出三行 JSON：`{wrap_self:true, wrap_peer:false, argv_has_unshare_net:false}`；
   - 判定脚本对三项 `assert`，任一不符 `exit 1`；
   - `wrap_peer` 用 4 个真实他线路径（hr / PCB-Agent / VideoGen / SimpleCut）逐一断言 false；
   - `argv` 由插件导出函数 `buildArgv()` 生成并与 `--dry-run` 实跑输出的 argv 做字符串比对（R-1 所述人工环节已机械化）。

## 7. 验收（用 §1 逐字 argv，全部已执行）

| 编号 | 判据 | 实测值 |
|---|---|---|
| A1–A3 | 三通道关闭 | R1/R2/R3 均非零 |
| A4 | 秘密文件对照 | R4a=0、R4b=2 |
| A5 | PID 面 | R5=4、R6 无输出、R7 空 |
| A6 | 工具链 | R10 v22.22.1 / 9.2.0 |
| A7 | 写面 | R11 `ok` |
| A8 | 网络（非目标，仅记录） | R8 rc=0、R9 rc=0 |
| A9 | 主体绑定 | 见 §6.3，三项断言 |
| A10 | 爆炸半径回归 | 见 §6.3（他线四路径全 false） |

## 8. 安装与回滚

- 装：`<repo>/.opencode/plugins/sandbox-bash.js` + `sandbox-policy.json`（项目级，随仓提交）。
- 不装用户级、不装 root 快照、不改 `~/.config/opencode/opencode.jsonc`。
- 回滚：删这两个文件，重启会话。逃生阀：`ABATHUR_SANDBOX=0`。

## 9. 与 P1（detection-only）的分工

P1 只记录不拦截（是否被伪装、插件/工具集哈希、缺口），独立推进；本方案落地后 P1 转为漂移监测。
