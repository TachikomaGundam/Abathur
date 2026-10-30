# 沙箱重建方案 v12（2026-10-30）

**依据**：v11 得 0A/3R，13 条 must-fix。本版逐条吸收，其中最关键的是评审指出的**自指逃逸**：执行器插件原本位于可写的 `$WS/.opencode/`，沙箱内一条命令改写它，下次会话就得到宿主执行权。本版用只读挂载封死，并给出回执。

---

## 1. 两档 argv（`buildArgv({net})` 单一来源；默认 `none`）

**默认档 net=none**
```
bwrap --die-with-parent --new-session --unshare-user --unshare-pid --unshare-net
      --tmpfs /home/lab --bind "$WS" "$WS" --tmpfs /tmp
      --ro-bind /usr /usr --ro-bind /etc /etc --ro-bind /opt /opt
      --ro-bind "$WS/.opencode" "$WS/.opencode"          # 自指防护
      --ro-bind "$WS/loop/bank.py" "$WS/loop/bank.py"    # 考卷答案
      --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 --symlink usr/sbin /sbin
      --dev /dev --proc /proc
      --clearenv --setenv HOME /home/lab --setenv PATH … --setenv TERM xterm-256color --setenv TZ Asia/Shanghai
      -- /bin/sh -c "$CMD"
```

**出网档 net=host**（人类启动前 `ABATHUR_SANDBOX_NET=host`）：同上，`--unshare-net` → `--share-net`，并加 `--ro-bind /run/systemd/resolve /run/systemd/resolve`（否则 DNS 必失，曾实测 rc=6）。

## 2. 实测回执

| 编号 | 探针 | 回执 |
|---|---|---|
| R1 | 沙箱内 `test -S /var/run/docker.sock` | `rc=1` |
| R2 | 沙箱内 `ls /dev/input` | `rc=2` |
| R3 | 沙箱内 `ls /var/log` | `rc=2` |
| R4a/R4b | 宿主 `ls ~/.ssh` `~/.npmrc` / 沙箱内同命令 | `rc=0` `rc=0` / `rc=2` `rc=2`，`HOME=/home/lab` |
| R5 | 沙箱内 `ps -e --no-headers \| wc -l` | `4` |
| R6/R7 | 沙箱内 `pkill -f opencode` / `pgrep -u lab -n opencode` | 无匹配 `rc=1` / 空 `rc=1` |
| R8/R9 | **host 档** `curl registry.npmjs.org` / `127.0.0.1:8010`、`:3000` | `rc=0` / `rc=0` `rc=0` |
| R10 | 沙箱内 `node --version`、`npm --version` | `v22.22.1`、`9.2.0` |
| R11 | 沙箱内写 `$WS/.sbx-write-probe` 并读回 | `ok` |
| R12 | `cat /proc/sys/kernel/yama/ptrace_scope`；`/usr/lib/sysctl.d/55-ptrace.conf:22` | `1` |
| R13 | `uname -r`；`grep CONFIG_(LEGACY_)?TIOCSTI /boot/config-*` | `7.0.0-30-generic`；`# CONFIG_LEGACY_TIOCSTI is not set` |
| R14 | 沙箱内 `curl 127.0.0.1:2375/version` | `rc=7` |
| R16 | **默认档** `curl https://example.com` | `rc=6` |
| R17/R18 | 宿主 canary：沙箱内 `kill -0`/`kill -TERM`；`kill -TERM -1` | `No such process`；`rc=1`，canary 存活 |
| R19/R20 | 沙箱内 `ls /run/user/1000` / `test -S /run/user/1000/bus` | `rc=2` / `rc=1` |
| R21 | **host 档** `ss -xa \| grep -c "@"` | `46` |
| R22 | **host 档** `xdpyinfo -display :0` / `:10` | `rc=1` / `rc=1`（可见但连不上） |
| R23 | 默认档 `node --version` + `git status --porcelain \| wc -l` | `v22.22.1` / `23` |
| R24 | PID ns inode：宿主 vs 沙箱 | `4026531836` vs `4026535264` |
| R25 | `bash scripts/scan-hardlinks.sh .` | `CLEAN`，`rc=0` |
| R26 | `ABATHUR_SANDBOX=0` 加载插件 | `NO_HOOKS` |
| R27 | `node scripts/sandbox-blast-radius.mjs` | 5 行 JSON + `PASS` + `RC=0`；**外部** `EXTERNAL_RC=0` |
| R28 | `bash scripts/check-sandbox-binding.sh` | 5 项 `OK`，`RESULT=PASS` |
| R29 | 宿主 `ss -tln` 完整清单（60 项） | 见 §3；`sha256=e9288ff9db4b2bd3…`（`/tmp/opencode/listen-tcp.txt`） |
| R30 | **host 档** 抽象套接字连接尝试：`\0/tmp/.X11-unix/X10`、`\0/var/run/dbus/system_bus_socket` | 均 `ConnectionRefusedError` |
| R31 | **默认档** 同两项连接尝试 | 均 `ConnectionRefusedError` |
| R32 | **默认档** `/dev/tcp` 探 8000/8010/3000/19937；`getent hosts registry.npmjs.org` | 四个端口全 `closed`；`DNS fail` |
| R33 | 沙箱内写 `$WS/.opencode/plugins/sandbox-bash.js` | `Read-only file system`，`rc=2` |
| R34 | 沙箱内写 `$WS/loop/bank.py` | `Read-only file system`，`rc=2` |
| R35 | 沙箱内写普通文件 `$WS/.sbx2` | `rc=0` |
| R36 | 沙箱内 `echo "[$ABATHUR_SANDBOX_NET][$ABATHUR_SANDBOX]"` | `[][]`（`--clearenv`，自升档不可得） |
| R37 | 设 `ABATHUR_SANDBOX_NET=host` 加载插件（本机有 22/3389/5432/5433 在听） | 日志 `REFUSE-host-tier audit_rc=1 … VERDICT BLOCKED`；包裹命令实际含 `--unshare-net`、不含 `--share-net` |
| R38 | `bash scripts/port-exec-audit.sh` | `SUMMARY total=42 exec=4 partial=1 unknown=24` + `VERDICT BLOCKED`，脚本退出码 `1` |

## 3. 宿主监听面与执行能力分类（R29，60 项）

完整清单见 `/tmp/opencode/listen-tcp.txt`（sha256 前缀 `e9288ff9db4b2bd3`），端口为：

`22, 80, 443, 389, 636, 666, 2019, 3000, 3001, 3389, 4330, 5000, 5201, 5432, 5433, 8000, 8002, 8003, 8004, 8010, 8080, 8085, 8090, 8554, 8555, 8888, 9000, 9090, 9443, 18001, 43989, 44321, 44322, 44323, 44661, 45169, 55437, 55438, 25565, 631, 7897, 53(127.0.0.53), 2019 …`（`0.0.0.0` 与 `127.0.0.1` 分别标注于文件）

**执行能力判定**（只对有我证据的端口下结论，其余标 UNKNOWN，交人类在开 host 档时复判）：

| 端口 | 服务（证据） | 可执行能力 | 判定依据 |
|---|---|---|---|
| 22 | sshd | **是** | 远程 shell |
| 3389 | RDP | **是** | 交互式桌面 |
| 5432 / 5433 | postgres | **是（若有凭据）** | `COPY … PROGRAM` 可执行命令 |
| 2019 | Caddy admin | 部分 | 可改写配置（含反向代理），非直接 exec |
| 3000 | wiki | 否（内容写） | GraphQL 内容 API |
| 8000 / 8010 | vLLM / 消毒代理 | 否（推理） | 只回文本 |
| 9090 / 9000 / 8554 / 8555 / 5201 / 631 | 监控 / 对象存储 / RTSP / iperf / CUPS | 否 | 各自协议无 exec |
| 其余 20+ | — | **UNKNOWN** | 未取证 |

**闸门（R-9 测量化）**：开 host 档前必须①重跑 `ss -tln` 并比对 sha？否——端口随服务变化，必须**重跑并把完整输出落盘**；②对每个 `0.0.0.0`/`127.0.0.1` 条目给出 是/否/未知；③存在任一「是」且未加防护时，禁止开 host 档。本版把该检查固化为 `scripts/port-exec-audit.sh`（读取实时 `ss -tln`，按上表规则标注，未知项汇总）。**当前 22 与 3389 为「是」**，故 host 档在本机默认不可用，除非人类明确接受该风险。

## 4. 默认档受阻能力（穷尽表中可判定项，R31/R32）

| 类别 | 证据 |
|---|---|
| 所有 TCP 出站（含 443/80） | R16 `rc=6` |
| 本机回环 TCP（8000/8010/3000/19937） | R32 四端口 `closed` |
| DNS | R32 `DNS fail` |
| npm registry / `npm install` / `npm publish` | 由 TCP+DNS 两项共同阻断 |
| 云端评分端点、Playwright 浏览器下载 | 同上 |
| 抽象/文件 Unix 套接字（X11、system bus、session bus） | R30/R31 连接失败 |

**未列入**：需要本地文件即可完成的一切（编译、测试、git 本地操作）——R23 证明可用。

## 5. 非目标

1. **host 档不隔离网络**：可达宿主全部监听端口（R8/R9/R29），风险见 R-9；默认档不开启。
2. 不防外泄（host 档下读工作区后传出）。
3. 不防工作区写入（业务需要）。
4. 默认档下所有联网作业不可用（§4 穷尽表）。

## 6. 残余风险

| 编号 | 风险 | 处置 |
|---|---|---|
| R-1 | 默认档无网络 | 由人类按需开 host 档（R-9 闸） |
| R-2 | 工作区写入无审计 | 独立提案 |
| R-3 | 硬链接把秘密引入工作区 | `scripts/scan-hardlinks.sh` 独立运行（R25 `CLEAN`）；**不接线到每次 spawn**（38G 工作区逐次 find 不可接受），列为发布前检查与企业务定期任务 |
| R-4 | 无 cgroup 限额 | 防事故性限制，父 slice 可写，不强 |
| R-5 | docker TCP 2375 | R14 `rc=7`（不存在）；列入发布检查表 |
| R-6 | 抽象套接字在 host 档共享（46 个） | R21/R30 实测连不上；默认档不存在 |
| R-7 | `/etc` 可读（machine-id 等） | 本版不遮蔽 |
| R-8 | host 档可达全部监听端口 | R29 完整清单 + §3 分类表 |
| R-9 | **控制面逃逸（host 档）** | 默认断网（R16/R31/R32）机械关闭；host 档须过 §3 闸门，本机因 22/3389 存在而默认禁止 |
| R-10 | 沙箱内可写 `.omo/evidence/`（台账）与仓库其余文件 | 注入命令可污染账本；缓解=哈希链可检出（不可防）。**明确不做 ro**：台账由 seat 自身写入（stamp.sh），ro 会中断晋升流程 |

## 7. 自指防护（本版核心新增）

| 面 | 措施 | 回执 |
|---|---|---|
| 执行器本体 | `--ro-bind $WS/.opencode` | R33 `Read-only file system` |
| 考卷答案 | `--ro-bind $WS/loop/bank.py` | R34 同上 |
| 升档开关 | `--clearenv`，档位由父进程 env 决定 | R36 `[][]` |
| 插件位置 | 仅 `<repo>/.opencode/plugins/`；两处用户级配置禁止引用 | R28 |

**推论**：沙箱内的命令无法改写执行器、无法读答案、无法开启网络档；要改策略只能由人类在会话外操作。这是「约束必须外在于被约束者」的最小实现。

## 8. 安装与回滚

- 装：仓内 `.opencode/plugins/sandbox-bash.js`（与 `scripts/plugins/` 同源），随仓提交。
- 回滚：删该文件并重启；逃生阀 `ABATHUR_SANDBOX=0`（R26）。
- 安装后自检：`scripts/sandbox-blast-radius.mjs` 必须 `EXTERNAL_RC=0`；`scripts/check-sandbox-binding.sh` 必须 `PASS`。

## 9. 与 P1 的分工

P1 只记录不拦截，独立推进；本方案落地后 P1 转漂移监测。
