# 沙箱重建方案 v15（2026-10-30）

**依据**：v14 得 0A/3R，否决理由集中在「§1 的 argv 与 R43 回执不是同一份配置」——即规范文本漏写了验收时用到的那两条只读绑定。本版把 argv 补全为**实际验收的那一份**，并补齐调度面清单与同源证明。

---

## 1. 两档 argv（`buildArgv({net})`；默认 `none`）

```
默认：bwrap --die-with-parent --new-session --unshare-user --unshare-pid --unshare-net
      --tmpfs /home/lab --bind "$WS" "$WS" --tmpfs /tmp
      --ro-bind /usr /usr --ro-bind /etc /etc --ro-bind /opt /opt
      --ro-bind "$WS/.opencode" "$WS/.opencode"
      --ro-bind "$WS/loop/bank.py" "$WS/loop/bank.py"
      --ro-bind "$WS/scripts" "$WS/scripts"
      --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 --symlink usr/sbin /sbin
      --dev /dev --proc /proc --clearenv --setenv HOME /home/lab --setenv PATH … --setenv TERM … --setenv TZ …
      -- /bin/sh -c "$CMD"
出网：同上，--unshare-net → --share-net，并加 --ro-bind /run/systemd/resolve /run/systemd/resolve
```

## 2. 实测回执

| 编号 | 探针 | 回执 |
|---|---|---|
| R1 | 沙箱内 `test -S /var/run/docker.sock` | `rc=1` |
| R2 | `ls /dev/input` | `rc=2` |
| R3 | `ls /var/log` | `rc=2` |
| R4a/R4b | 宿主 `ls ~/.ssh` `~/.npmrc` / 沙箱内同命令 | `rc=0` `rc=0` / `rc=2` `rc=2`，`HOME=/home/lab` |
| R5 | `ps -e --no-headers \| wc -l` | `4` |
| R6/R7 | `pkill -f opencode` / `pgrep -u lab -n opencode` | `rc=1` / `rc=1` |
| R8/R9 | **host 档** `curl registry.npmjs.org` / `127.0.0.1:8010`、`:3000` | `rc=0` / `rc=0` `rc=0` |
| R10 | `node --version`、`npm --version` | `v22.22.1`、`9.2.0` |
| R11 | 沙箱内写 `$WS/.sbx-write-probe` | `ok` |
| R12 | `yama=1`；来源 `/usr/lib/sysctl.d/55-ptrace.conf:22` | 一致 |
| R13 | `uname -r`；`# CONFIG_LEGACY_TIOCSTI is not set` | `7.0.0-30-generic` |
| R14 | 沙箱内 `curl 127.0.0.1:2375/version` | `rc=7` |
| R16 | 默认档 `curl https://example.com` | `rc=6` |
| R17/R18 | 宿主 canary：`kill -0`/`kill -TERM`；`kill -TERM -1` | `No such process`；`rc=1`，canary 存活 |
| R19/R20 | `ls /run/user/1000` / `test -S /run/user/1000/bus` | `rc=2` / `rc=1` |
| R21 | **host 档** `ss -xa \| grep -c "@"` | `46` |
| R22 | **host 档** `xdpyinfo :0` / `:10` | `rc=1` / `rc=1` |
| R23 | 默认档 `node --version` + `git status --porcelain \| wc -l` | `v22.22.1` / `23` |
| R24 | PID ns inode 宿主 vs 沙箱 | `4026531836` vs `4026535264` |
| R25 | `scan-hardlinks.sh` | `CLEAN` `rc=0` |
| R26 | `ABATHUR_SANDBOX=0` | `NO_HOOKS` |
| R27 | `sandbox-blast-radius.mjs` | 5 行 JSON + `PASS` + `RC=0`；**外部** `EXTERNAL_RC=0` |
| R28 | `check-sandbox-binding.sh` | 5 项 `OK`，`RESULT=PASS` |
| R29 | `ss -tln` 全量 | **61 行 / 42 个唯一端口**；耐久路径 `.omo/evidence/sandbox/listen-tcp-20261030.txt`，sha256 `7b8ccf980cbb57a62f5c0e42b1f9680f7ed077ad3817066967c1e84ec8556a8f` |
| R30 | host 档抽象套接字连接：`\0/tmp/.X11-unix/X10`、`\0/var/run/dbus/system_bus_socket` | 均 `ConnectionRefusedError`（**抽样 2/46**） |
| R31 | 默认档同两项 | 均 `ConnectionRefusedError` |
| R32 | 默认档 `/dev/tcp` 8000/8010/3000/19937；`getent hosts` | 全 `closed`；`DNS fail` |
| R33 | 沙箱内写 `$WS/.opencode/plugins/sandbox-bash.js` | `Read-only file system` `rc=2` |
| R34 | 沙箱内写 `$WS/loop/bank.py` | `Read-only file system` `rc=2` |
| R35 | 沙箱内写 `$WS/.sbx2` | `rc=0` |
| R36 | 沙箱内 `[$ABATHUR_SANDBOX_NET][$ABATHUR_SANDBOX]` | `[][]` |
| R37 | 设 `ABATHUR_SANDBOX_NET=host`（本机有 EXEC 端口） | 日志 `REFUSE-host-tier … VERDICT BLOCKED`；命令仍含 `--unshare-net` |
| R38 | `port-exec-audit.sh` | `SUMMARY total=42 exec=4 partial=1 unknown=24`；`VERDICT BLOCKED`；退出码 `1`；耐久路径 `.omo/evidence/sandbox/port-exec-audit-20261030.txt`，sha256 `bf47d6c1b95ea26fbf0aba540995bd52f3f56c2dbb4ab64c9548754100b78648` |
| R39 | **只读绑定 vs 硬链绕过**：沙箱内先 `echo x >> .hl-target`（只读绑定），再 `ln .hl-target .hl-link` 后写 | 直写 `Read-only file system rc=2`；`ln` 报 **`Invalid cross-device link`**；宿主侧内容仍为 `SENTINEL` |
| R40 | 沙箱内嵌套 bwrap（**仅作参考**） | `bwrap` 存在但报 `No permissions to create a new namespace`；结论以 R44 的逐项 `unshare` 实测为准 |
| R41 | 只读绑定 `.omo/evidence` 后写台账 | `cannot create … INTENT-LEDGER.md: Read-only file system`，`rc=2`（证明 R-10 的取舍代价真实） |
| R42 | 工作区密钥面扫描（值不落纸）：匹配 `_authToken|api_key|ANTHROPIC|OPENAI|GITHUB_TOKEN` 的文件 | **49 个**：`.border/**` 44、`.omo/**` 5；`.omo/border.yaml` 仅字段名（`version/targets/rules/allow`） |
| R43 | 沙箱内写 `scripts/` 五项：`plugins/sandbox-bash.js`、`exam-queue.py`、`check-sandbox-binding.sh`、`sandbox-blast-radius.mjs`、`scan-hardlinks.sh` | **全部 `Read-only file system`，`rc=2`**（`scripts/` 整体只读） |
| R44 | 沙箱内 `unshare -m/-p/-n/-u/--pid --fork` | 全部 `rc=1`；`CapEff=0000000000000000` |
| R45 | 抽象套接字按 R21 的真实名重采（`@17f1d8ea…/bus/systemd/bus-system` 等 4 个） | 全部 `ConnectionRefusedError` |
| R46 | 作业队列校验：**从插件源码抽取** `GEN_RE`/`ITEM_RE` 两行并求值（非复制），再跑四例 | 抽取到 `const GEN_RE = /^G[0-9]+[A-Z]*$/`、`const ITEM_RE = /^SR4-[0-9]+$/`；四例结果 `ACCEPT` / `REJECT: stage 非法` / `REJECT: gen 非法` / `REJECT: item 非法` |
| R48 | 调度面清单：`crontab -l`（9 条有效行）、`systemctl --user list-timers`（3 个，均非本仓）、`/etc/cron.d`（`anacron`、`e2scrub_all`） | **发现 1 条本仓作业**：`*/5 * * * * /usr/bin/python3 …/Abathur/scripts/plain-watch.py`——在 `scripts/` 只读之前，这是活的「沙箱改脚本→宿主每 5 分钟执行」通道；R43 落地后该路径已封 |
| R49 | 沙箱内读 `loop/bank.py`（首 40 字节） | 可读（`#!/usr/bin/env python3 …`）——只读绑定语义是**防改写**而非防读 |
| R47 | 端口审计重标后 | `exec=4 partial=1 no=3 unknown=34`；sha256 `e8a838f9a592eaf5b5727f8545d033f1198cb6a1cccb06e077e93f2bdfb8bbe0` |

**回执来源标注**：R8/R9/R21/R22/R30 均为**宿主侧手工调用 §1 的 host 档 argv**（`bwrap … --share-net …`），不经插件——因为插件在本机恒降级为默认档（R37）。它们证明的是 argv 能力，不是「插件能开 host 档」。

## 3. 监听面（42 个唯一端口，完整无省略）

| 判定 | 端口 |
|---|---|
| **EXEC（4）** | 22（sshd）、3389（RDP）、5432、5433（postgres，`COPY … PROGRAM`） |
| **PARTIAL（1）** | 2019（Caddy admin：可改写配置，非直接 exec） |
| **NO（3，有取证）** | 3000（wiki 内容 API）、8000（vLLM）、8010（消毒代理） |
| **UNKNOWN（34）** | 53、80、389、443、631、636、666、3001、4330、5000、5201、7897、8002、8003、8004、8080、8085、8090、8554、8555、8888、9000、9090、9443、18001、25565、43989、44321、44322、44323、44661、45169、55437、55438 |

计数闭合：4+1+3+34 = 42；`ss -tln` 61 行是因为同一端口同时有 IPv4/IPv6/`*` 多条记录。原始清单与分类结果均在 `.omo/evidence/sandbox/`，带完整 sha256（R29/R38）。

**取证边界**：只有 3000/8000/8010 有我自己的调用证据，故只标 NO；其余 34 个一律 UNKNOWN（v13 把 10 个未取证端口误标 NO，本版已按本方案自己的规矩重标，R-13 关闭）。

## 4. 默认档受阻能力

| 类别 | 证据类型 |
|---|---|
| 所有 TCP 出站 | **实测** R16 `rc=6` |
| 本机回环 TCP（8000/8010/3000/19937） | **实测** R32 四端口 `closed` |
| DNS | **实测** R32 `DNS fail` |
| npm registry / `npm install` / `npm publish` | **推断**（由 TCP+DNS 两项阻断推出，未单独跑 npm） |
| 云端评分端点、Playwright 浏览器下载 | **推断**（同上） |
| Unix 抽象/文件套接字 | **实测** R30/R31（抽样 2/46） |

## 5. 非目标

1. host 档不隔离网络；**本机实际不可开启**（R37/R38），见 §6。
2. 不防外泄（host 档下）。
3. 不防工作区写入。
4. 默认档下联网作业不可用（§4 表，实测与推断已分列）。

## 6. host 档的真实状态（更正 v12 的过度表述）

- 本机 22/3389/5432/5433 常驻监听 → `port-exec-audit.sh` 恒返回 `BLOCKED` → 插件恒降级为默认档（R37）。
- 因此 **host 档在本机是死分支**：不是「人类可明确接受风险后开启」，而是机械不可达。这是有意的设计（风险派生的闸门），但必须如实标注，不能写成可选项。
- 若将来需要出网：要么人类在会话外关闭这些服务，要么为插件增加**人类签名的显式豁免**（当前未实现，列为 R-14）。

## 7. 残余风险

| 编号 | 风险 | 处置 |
|---|---|---|
| R-1 | 默认档无网络；host 档本机不可用 | 只有 R-14 的豁免机制能解开；当前如实标注为不可用 |
| R-2 | 工作区写入无审计 | 独立提案 |
| R-3 | 硬链引入秘密 | `scan-hardlinks.sh` 定期跑（R25 `CLEAN`）；不接线到每次 spawn（38G 目录逐次 find 不可接受） |
| R-4 | 无 cgroup 限额 | 防事故性限制，不强 |
| R-5 | docker TCP 2375 | R14 `rc=7`；发布检查表条目 |
| R-6 | 抽象套接字 | 语义更正：抽象套接字**随网络命名空间存在**；默认档是新建 netns，其中不可见（R31）；host 档与宿主共享命名空间（R21=46，抽样 R30 2/46） |
| R-7 | `/etc` 可读 | 本版不遮蔽 |
| R-8 | host 档可达全部监听端口 | R29 完整清单 |
| R-9 | 控制面逃逸（host 档） | 默认档机械关闭（R16/R31）；host 档被 §6 闸门恒禁 |
| R-10 | 沙箱内可写 `.omo/evidence/`（台账）与仓库其余文件 | **已实测代价**：若只读绑定该目录，台账写入失败（R41）；故保持可写，接受污染风险（哈希链可检出，不可防） |
| R-11 | `loop/` 下除 `bank.py` 外的考卷材料（宪章快照、提案、其他答案件）仍在可写绑定内 | 本版只保护 `bank.py`；不夸大「读不到答案」 |
| R-12 | 工作区内存在 49 个密钥样式命中文件（`.border/**` 44、`.omo/**` 5） | 未判真伪（值不落纸）；列为发布前人工复判项 |
| R-13 | ~~NO 端口未取证~~ **已关闭** | 只保留 3 个有取证端口为 NO，其余 34 个已重标 UNKNOWN（R47） |
| R-14 | 无出网豁免机制 | 若需要，须实现人类签名豁免并留回执；当前不做 |
| R-15 | 沙箱可写 `.omo/exam-queue/*.json`，宿主侧轮询会执行**合法形状**的作业 | 缓解=三重正则 + 固定脚本白名单（R46 实测：非法 stage/gen/item 全拒）；残余=可触发未排期的 seed/candidate/judge/harvest，成本受白名单约束。**接受为具名残余** |
| R-16 | ~~`scripts/` 其余部分可写~~ **已关闭** | 整目录只读（R43 五项全 EROFS）；R48 证明本仓确有一条每 5 分钟的宿主调度（`plain-watch.py`），该通道随之关闭。宿主（人类）仍可改脚本——这是设计内 |

## 8. 自指防护

| 面 | 措施 | 回执 |
|---|---|---|
| 执行器本体 | `--ro-bind $WS/.opencode` | R33；硬链绕过被证伪（R39 `EXDEV`） |
| 考卷答案 | `--ro-bind $WS/loop/bank.py`（防改，不防读） | R34 / R49 |
| 升档开关 | `--clearenv` + 父进程 env | R36 |
| 嵌套逃逸 | 沙箱内 `unshare` 四类全拒、`CapEff=0` | R44（R40 的「无法创建命名空间」由本条逐项实测取代） |
| 插件位置 | 仅 `<repo>/.opencode/plugins/` | R28 |

原句修正为：**无法改写已部署的执行器与其母本（R33/R43）、无法改写作业执行脚本（R43）、无法**改写** `bank.py`（但可读，R49 已实测；其余考卷材料可读可写，R-11）、无法开启网络档（R36/R37）、无法新建命名空间（R44）。**

**宿主侧消费面（评审新增）**：`.omo/exam-queue/*.json` 由宿主侧 `scripts/exam-queue.py` 轮询并执行固定作业，沙箱内命令可写该目录 → 可触发未排期的宿主执行。当前缓解=作业名与字段三重正则 + 固定脚本白名单；本版**不**只读绑定该目录（会破坏排队能力），列为 R-15。

## 9. 安装与回滚

- 装：仓内 `.opencode/plugins/sandbox-bash.js`（与 `scripts/plugins/` 同源）。
- 回滚：删该文件并重启；逃生阀 `ABATHUR_SANDBOX=0`（R26）。
- 自检：`sandbox-blast-radius.mjs` 必须 `EXTERNAL_RC=0`；`check-sandbox-binding.sh` 必须 `PASS`。两者都在只读的 `scripts/` 内（R43），沙箱内不可被改写 → 自检结果对沙箱内命令是防篡改的。

## 10. 与 P1 的分工

P1 只记录不拦截；本方案落地后 P1 转漂移监测。
