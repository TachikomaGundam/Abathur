# 提案 v8：AI 工作账户与人类账户分离（三账户模型）

日期：2026-10-24
状态：待裁决（第八稿；v5–v7 评审路线意见 = **采用 C**，B 否决；v7 余 12 条已吸收）
前稿：v1 e5cb → v2 65a7 → v3 3ca0 → v4 c300 → v5 c41d → v6 f67f → v7 4063

## 0. 威胁模型

- 威胁主体 = AI（以 `abathur` 身份运行）。目标 = 阻止 AI 自主或隐蔽取得人类权限、凭据、键盘输入、进程内存。
- 人类**有意**在 `lab` 手动执行，不属防御目标（持钥方），只记残余。
- 机械闸门只需保证「AI 不能自行解除限制」。

## 1. 问题

人类与 AI 共用 `lab`；是否应把 AI 迁到独立非 root 账户。

## 2. 机器实测

| 事实 | 输出 |
|---|---|
| 内核 | `7.0.0-30-generic`；`CONFIG_SECURITY_YAMA=y` |
| 同 uid | `uid=1000(lab)`；组 sudo/docker/lxd/input/adm/video/render/plugdev |
| docker = root 等价 | `/etc/shadow` 直读失败；经容器 `root hashlen=1` |
| input / render / nvidia | `event*` 660 root:input；`renderD128` 660 root:render；`nvidia0` 666 |
| 家目录 750 | 对账户间有效，对同 uid 无效 |
| 工作区 / 状态库 | `775` 38G；`777` 8.2G |
| sudo 密度 | 82,150 次 bash 中 1,348 次含 sudo（1.64%），107 会话。**覆盖边界**：只统计 opencode.db 的 bash 工具调用；工具外执行与他机不计 |
| 用途分布（全量分组，v8 重算） | logs 214、docker 201、systemctl 177、gpu 131、etc-write 85、ipmitool 59、own 47、apt 41、npm 23、mount 3、fw 3、**OTHER（脚本化 root 操作/探针）362**；分组和 1,346，余 2 条 NULL 未分类 |
| **非特权 uid 矩阵**（临时账户建→测→删） | journalctl FAIL、dmesg FAIL、ipmitool FAIL、docker FAIL、`/etc/shadow` FAIL、`/home/lab` FAIL、`/dev/input` FAIL；nvidia-smi OK、`systemctl status` OK |
| **/run/user/1000** | 目录 `drwx------ lab`；probe `ls` FAIL、`busctl --user` FAIL |
| **gpg-agent** | `/run/user/1000/gnupg/S.gpg-agent` 为 `srw------- lab` → 非 lab 不可连 |
| **X11 默认** | `/tmp/.X11-unix/X10` 套接字 `srwxrwxrwx`；`xhost` = access control enabled；probe `xdpyinfo` **FAIL** |
| **X11 cookie 位置实验** | 把 `.Xauthority` 复制到 `/tmp`（644）后 probe `xdpyinfo` **CONNECT-OK** → 边界取决于 cookie 存放位置（副本已删） |
| **/proc 跨 uid** | `cmdline` 可读；`environ` Permission denied |
| sudo env 策略 | `/etc/sudoers:9 Defaults env_reset`；`secure_path` 已设；`env_keep` 全部注释 → `LD_PRELOAD` 不随 sudo 传递 |
| ptrace 活值/来源 | 活值 3；来源=本席 2026-10-24 05:55Z 干跑误写，根因=`install-isolation.sh` v3 的 ptrace 段未受 `--apply` 控制（修复在提交 fe540ce）。**下调回执**：写 0 → `EINVAL`（sysctl 文档：3 为单向棘轮，任何写入均 EINVAL）；台账 `556d16387942`。两条可复算：`sysctl -n` + 台账条目 |
| ptrace 回退 | `/usr/lib/sysctl.d/55-ptrace.conf:22 kernel.yama.ptrace_scope = 1`；`/usr/lib/systemd/systemd-sysctl` 存在 → **重启回 1 目前是推断**，须 M13 重启后实测确认 |
| **Yama 语义（实测+文档）** | scope=1：仅祖先可 attach 后代；**非后代同 uid attach 被拒**。scope=3：**连 root（CAP_SYS_PTRACE）也被拒**——本机实测 `sudo strace -p <pid>` → `PTRACE_SEIZE: Operation not permitted`（2026-10-24） |
| 日志敏感面 | 6 单元（含 docker）过滤 200 行：0 命中；加深 2000 行：0 命中（非证明） |
| 执行区 | 8 个非样例 hooks；`core.hooksPath` 无自定义；61 个脚本/Makefile |
| 作业面 | lab crontab 8；lab user units 27 running / 4 timer（发行版）；root crontab 0；系统服务 51 / timer 31；**AI 依赖具名 6 个**（dsv4-control、qwen38-control、llm-monitor、gpu-fan-control、vllm-stall-capture、docker） |
| 旧路径引用 | 系统单元中 **1 个**引用 `/home/lab/workspace`（`vllm-stall-capture.service`） |
| **现存活体 root 后门（G2）** | `vllm-stall-capture.service`：`User=root`、`Restart=always`、`RestartSec=10`、`ExecStart=/home/lab/workspace/debug/vllm-stall-capture.sh`；该脚本 **`-rwxrwxr-x lab lab`** → 任何 lab 进程改写它后 ≤10 秒由 root 执行。**账户分离对此无效**，必须独立修复 |
| 磁盘 | `/` 余 173G；`/tmp` 已用 93G/124G |
| AIHR 基线闭包 | 采集 1658 = 1585 passed + 73 skipped + **0**（`test_bootstrap_properties.py` 采集期报 `ModuleNotFoundError: No module named 'hypothesis'`，贡献 0 项）；耗时 132s。**该文件的用例当前不在任何验收守卫内=具名缺口 G1**；试点前在隔离 venv 装 `hypothesis` 后重采集，基线须重算并写回 Q2 |
| podman 前置 | `/etc/subuid` 无 abathur；`uidmap` 未安装 |

## 3. 根因

一个 uid 三顶帽子（人 / AI / 凭据持有者）。同 uid → ptrace 默认允许、组权限共享、文件权限无法区分人/AI。

被否决的三条「内部收权」路径（逐条给失效理由，供独立审计复核）：

| # | 路径 | 失效理由（实测/机理） |
|---|---|---|
| P1 | 在同一 uid 内用文件权限 / ACL 分离人机 | 同 uid 的属主位对属主无效：`chmod 600` 挡不住同 uid 进程；`/proc/<pid>/cmdline` 实测跨 uid 可读，同 uid 必可读；X11 cookie 与 agent socket 同 uid 可复用 |
| P2 | 退特权组 + 删 NOPASSWD + `ptrace_scope=3` | 跨 uid attach 由 uid 检查拒绝（与 yama 取值无关）；**同 uid 非后代在 scope=1 已被拒**，故 ptrace 不是同 uid 的主要通道；主要通道是 `/proc` cmdline、X11 cookie、agent socket、组能力——这些与 yama 无关。scope=3 不可回退，且本机实测连 root 的 attach 也被拒（`sudo strace -p` EPERM）；input/docker 可退，但同 uid 仍可互相触达 |
| P3 | AppArmor / 沙箱约束 opencode 进程 | 本机 apparmor 未启用（`aa-status` 空）；沙箱只能约束被约束进程树，人类会话仍在同一 uid 下运行，且 workspace 共享写面使策略须逐路径维护——回到「补丁流」 |

## 4. 方案

### A：三账户分离（无授权面）
- `abathur`（非 root、无 sudo、不进特权组）；`abathur-keys`（凭据持有，密码锁死）。
- 工作区 `/srv/workspace`（`root:dev 2775`）。
- 启动：`lab` 单跳 `sudo -u abathur /usr/local/bin/abathur-shell`；脚本**内部不再调用 sudo**（它已以 abathur 身份运行），只做 `env -i` + 固定入口 exec。属主 root、`/usr/local/lib/abathur` 及其 `current` 符号链接均 root 所有、abathur 不可写（M16 双 stat）。
- sudoers：`lab ALL=(abathur) NOPASSWD: /usr/local/bin/abathur-shell`；人类保留带密码 sudo（`/etc/sudoers:53 %sudo ALL=(ALL:ALL) ALL`）。
- **空参钉死不是唯一防线**：两个包装器本身忽略 `$@`（不读参数），因此即使 `""` 形态在本机 sudo 版本下语义不符，授权面仍是「固定 argv 入口」。部署时以正/负两测判 `""` 是否保留：正=零参调用 rc=0 且输出正确；负=带参调用被 sudo 拒绝。两者都要回执入台账。
- 日志：root 定时器把 6 个 AI 单元的切片写入 `/var/log/abathur/journal-slice.log`（0640 root:abathur）。
- 残余（具名）：R17 复制粘贴、R18 GPU 666、R19/A 日志切片含密钥（与 C **内容类别相同、持久性不同**：A 落盘、C 易失）、R21 cmdline、R22 脚本可写、R23 X cookie 位置。

### B：`lab` 内收权
- 删 NOPASSWD、退组、`ptrace_scope=3`、工作区 750。
- 失效（v8 按实测语义重写）：
  1. **同 uid 的读取面不依赖 ptrace**：`/proc/<pid>/cmdline` 跨 uid 已可读 → 同 uid 必可读；`/run/user/1000` 为同 uid 可读；X11 cookie 同 uid 可复用（cookie 位置实验：644 即 CONNECT-OK）；agent socket 同 uid 可连。
  2. **ptrace 只是补充**：scope=1 下非后代 attach 已被拒（祖先/后代仍允许）；scope=3 才全禁且不可回退（本机实测连 root 都被拒）。因此「靠 3 挡住同 uid」是唯一手段，且代价是永久失去调试。
  3. **组能力与文件权限不可分割**：docker=root 等价（容器内读到 `/etc/shadow` 行）；input 可读键盘；adm 可读全量日志；`chmod 600` 对同 uid 属主无效。
- 结论：**不构成边界。否决。**

### C：A + 两个钉死 argv 的包装器（评审路线意见）
- **单一来源**：选 C 不部署 A 的 root 定时器；日志由包装器提供。
- 规则（空参数钉死，`""` 可选加固）：
  ```
  abathur ALL=(root) NOPASSWD: /usr/local/sbin/abathur-journal-slice ""
  abathur ALL=(root) NOPASSWD: /usr/local/sbin/abathur-sensor-read ""
  ```
- **`""` 语义须部署实测**：man 页未给出可引原文，故不以此形态为设计前提。两个包装器都不读 `$@`，去掉 `""` 后授权面不变；部署门以正/负两测决定是否保留该形态。
- 包装器：`env -i` 清洗环境；属主 keys `0750`；父目录 root；不读 `$@`；固定 `PATH`。
- `journal-slice` 固定 6 单元（含 docker.service）+ `-n 200`。
- `dmesg` 不授予（`-C` 清环=灭证）。
- 部署前后置门：`visudo -cf /etc/sudoers.d/abathur` rc=0 才落盘。
- **双轨禁用闸（M15b）**：部署后必须证明旧写入面不存在——`systemctl list-timers --all | grep -c abathur` = 0 且 `test ! -e /var/log/abathur/journal-slice.log`，两项回执入台账。
- C 独有失效模式（不继承 A 表的部分）：两个永久 root 落脚点。缓解=固定 argv + `env -i` + 属主 root + 忽略参数 + 三负测试；残余=`journalctl`/`ipmitool` 以 root 解析输入（读 HOME/配置）的面未穷尽，R19 的前提见下。

## 5. P0：能力逐项处置

| 能力 | 探针 | 处置 |
|---|---|---|
| root | `sudo -n true` | drop（M0 后执行） |
| docker | `docker ps` | drop；替代 rootless podman（M6）或人类代跑 |
| 键盘 | `/dev/input` + X11 | drop；X11 依赖 cookie 位置（R23） |
| 全量日志 | `journalctl -n1` | drop；替代=6 单元切片 |
| GPU render | `ls -l renderD128` | 暂 drop、按需恢复 |
| GPU 设备 | `nvidia-smi -L` | 保留（R18） |
| lxd / plugdev | 无运行时目录 | 暂 drop、按需恢复 |
| SSH agent / keyring / gpg-agent | `test -S`、`busctl --user`、socket 权限 | 天然隔离（**已实测**：700 目录、0600 socket、busctl FAIL） |
| 共享服务 | `curl -s -m2` | 逐服务；读按 L-ENV-SEGREGATION |

## 6. 迁移清单

| # | 项 | 探针 | 回滚 |
|---|---|---|---|
| **M0a** | **建立三账户本体**：`abathur`（无 sudo、不进特权组）、`abathur-keys`（shell 保留、密码锁死 `passwd -l`、记 `/etc/shadow` 首字符 `!`） | `id`；`getent shadow`；`sudo -l -U abathur` 回显「无 sudo 规则」 | `userdel -r` |
| M0 | 人类终端 `sudo -k; sudo true` + 带外恢复 | 人类回执 | 不收权 |
| M1 | 工作区 → `/srv/workspace`（`root:dev 2775`） | `stat`；两账户写矩阵 | 旧路径只读 |
| **M1b** | **迁移窗口旧路径写入探测**：1 个引用旧路径的系统单元 + 8 crontab + 27 user units 逐条检查 EACCES 并处置 | 各任务日志/退出码 | 恢复指向 |
| M2 | 状态库：registry FREE → `integrity_check` → 复制 → **新副本 `abathur:abathur 0600`，记录 lab 读取矩阵（sudo 才可读）** | sha256 + integrity_check + stat | 指回 |
| M3 | `~/.config/opencode` | 一次会话 | 复制回 |
| M4 | `~/.sibyl` | 一次 consult | 复制回 |
| M5 | 启动方式 | `ps -o user=` = abathur | 原状 |
| M6 | rootless podman：`/etc/subuid`+`/etc/subgid` 加 abathur、装 `uidmap`（当前均缺） | `podman info`；`podman run` 冒烟 | 人类代跑 |
| M7 | 共享服务接线 | 逐端点 + 写权负探针 | 恢复配置 |
| M8 | hooks 属主 | 权限矩阵 | 恢复属主 |
| M8b | `.git/config` 改 keys 所有、AI 只读 | `git config --show-origin` + `stat` | 恢复属主 |
| M9 | 人类读产出 | lab 读工作区 | chmod |
| M11 | 作业面全量清点（8 crontab + 27 user unit + 4 timer + root 0 + 系统 51/31），逐条处置并签字 | `crontab -l`；`systemctl list-*` 计数入表；`grep -c opencode.db` | 恢复 |
| **M11b** | **自动执行链审计（v7 评审新发现，最高优先）**：对 6 个 AI 依赖单元逐条登记 `User=`、`ExecStart`、全部读入路径，机械证明「root 或 lab 自动运行的单元零 AI 可写输入」；**已发现反例**：`vllm-stall-capture`（root + 775 lab 脚本 + Restart=always）；不满足者把该脚本/配置迁入 keys 所有、AI 只读区，或改为人类触发 | `systemctl cat` 逐单元原文；`systemd-analyze security <unit>`；运行时 `strace -f -e trace=openat` 采样；写权负探针 | 恢复原路径 |
| M10 | 状态库 777→700（在 M11 后） | `stat` | 恢复 |
| M12 | 磁盘（38G 双份；余 173G） | `df` | 清副本 |
| M13 | 重启后实测 `sysctl -n kernel.yama.ptrace_scope`（当前"回 1"为推断）；**预期矩阵**：scope=1 下 (a) 父壳 attach 自身子进程=允许，(b) 兄弟进程 attach=拒绝，(c) 跨 uid attach=拒绝；逐项回执 | 重启后四行回执入台账 | 无 |
| M14 | 引擎源码/dist 属主 root/keys；**lab 读取失败**（`head -c1 rc≠0`） | 读位测试 | 恢复位 |
| M15 | 包装器属主 keys `0750`；父目录 root；`visudo -cf` 前置；**正向**=`sudo -n /usr/local/sbin/abathur-journal-slice` rc=0 且输出含 6 单元切片（无参）；**负向**=带参调用 rc≠0 且为 sudo 拒绝；另以 root 直接带参执行验证忽略 `$@`；`LD_PRELOAD` 负测试；**sensor-read 正向**=`sudo -n /usr/local/sbin/abathur-sensor-read` rc=0 且输出非空（`env -i` 无 HOME 下可用）；**越界负测**=`sudo -n /usr/local/sbin/abathur-journal-slice -u sshd` 被 sudo 拒绝且未取到额外内容 | `sudo -l` 回显 + `stat` + 两正四负 | 恢复位 |
| M15b | **双轨禁用**：不部署 A 的 root 定时器；`systemctl list-timers --all \| grep -c abathur`=0 且 `test ! -e /var/log/abathur/journal-slice.log` | 两条回执入台账 | 停用定时器 |
| M16 | `abathur-shell` 属主 root `0755`；`/usr/local/lib/abathur/` 与 `current` 符号链接 **root 所有、abathur 不可写**；脚本内无 sudo；**正向启动测试**=`sudo -n -u abathur /usr/local/bin/abathur-shell` 后 console 进程 `ps -o user=`=abathur | 双 `stat` + 正向启动 + 参数拒绝 | 恢复位 |

## 7. 风险表

| # | 风险 | 探针/闸门 | 缓解 | 回滚 |
|---|---|---|---|---|
| R1 | 人类在 lab 起 AI | (a) lab 读源码/dist **失败**；(b) `run_registry` 记 uid；(c) 人类故意绕过（模型外） | (a)+(b) | 恢复位 |
| R2 | 路径断裂 | 全量测试 | AIHR 试点 | 旧路径只读 |
| R3 | 组写权互覆盖 | 两账户写矩阵 | 2775 + umask 002 | 恢复 775 |
| R4 | 状态库损坏 | integrity_check | 先复制 | 指回 |
| R5 | 无 root 运维受阻 | 1,348 次逐类出口：logs 214→C 包装器；docker 201→podman 或人类；systemctl 177→`systemctl status` 免 sudo + 人类执行变更；gpu 131→nvidia-smi 免 sudo；etc-write 85→人类；ipmitool 59→sensor-read；own 47→人类；apt 41→人类；npm 23→用户级前缀；mount 3/fw 3→人类；OTHER 362（脚本化 root 操作/探针）→人类或 keys | 人类执行 / 包装器 | 临时授权（签字） |
| R6 | 凭据可达 | AI 侧 `npm whoami`/`test -S`/`busctl` 全失败 | 凭据只在 keys | 无 |
| R7 | 人类读不到产出 | lab 读工作区 | 组读位 | chmod |
| R8 | 启动摩擦 | 试用一周 | 窄 launcher | 去规则 |
| R9 | 迁移中断 | 日志 + df | rename/rsync | 回指 |
| R10 | 旧库 777 | stat | 700 | 无 |
| R11 | 供应链 | 执行区收窄=`hooks`+`.git/config`；61 脚本=AI 可写 → R22 | 收窄 + 人类执行前确认 | 恢复属主 |
| R12 | 共享服务跨 uid | 逐端点 | 封闭枚举；写需 token | 关端口 |
| R13 | 凭据交接 | keys 成功 / AI 失败 | agent 仅在 keys | 无 |
| R14 | AI→人类反向写 | 交叉写探针 | 写区/执行区分离 | 恢复属主 |
| R15 | 经 DB/wiki 触达 | 逐服务写权 | 写权归人类/keys | 撤权 |
| R16 | 旧身份续跑 | M11 全量清点 | 迁移/废止+签字 | 恢复 |
| R17 | 复制粘贴 | 无机械闸门 | **具名缺口** | — |
| R18 | nvidia0 666 | `ls -l` | **具名残余** | — |
| R19 | 日志切片含密钥（**A/C 不对称**：A 持久写 `/var/log/abathur/journal-slice.log`，C 只有按需 tail-200 的易失窗口） | 200/2000 行抽样 0 命中（非证明）；前提=6 单元保持默认日志级别 | 单元过滤 + `env -i`；级别变更即重开暴露面；M 验收含 **6 单元** `systemctl show -p LogLevel` 回执，部署后**周期复探差分**，漂移即降级送裁 | 停用 |
| R20 | 人类自觉性 | 台账审计 | 不以自觉为前提 | — |
| R21 | `/proc/*/cmdline` 可读 | 实测可读 | **具名残余**；约定 argv 不含密钥 | hidepid 待评估 |
| R22 | 61 脚本 AI 可写、人类可能执行 | 改动后 `git status` | 人类执行前确认 | — |
| R25 | `/dev/log` 任何本地用户可写（实测 `SYSLOG-WRITE-OK`）→ AI 可注入伪造日志 | 部署时注入样例条目，登记 journald 归属字段（`SYSLOG_IDENTIFIER`/`_PID`/`_CMDLINE`）；判据=切片内出现无合法单元归属的条目即告警并送裁 | 归属校验 + M 验收 | journald 配置收紧待评估 |
| R26 | `/var/crash` 为 `drwxrwsrwt root:whoopsie`（全局可写+sticky），apport 以 root 解析其中文件 | `stat /var/crash` | **具名残余**；崩溃文件本身 640 属主:whoopsie 不可读 | 待评估 apport 配置 |
| **R27** | **root 自动执行 AI 可写脚本**（G2，现存活体）：`vllm-stall-capture.service` root + `Restart=always` + ExecStart 指向 `lab:lab 775` 脚本 | `systemctl cat` + `stat` 脚本 + 写入→10s 内重启的执行回执 | 立即修复：脚本移 `/opt`（root 所有 0755）或改 `User=lab`；M11b 逐单元闭环 | 改回原路径 |
| R23 | **人类会话 `xhost +` 或 cookie 落入共享面即重开键盘通道**（实验：cookie 644 时 probe CONNECT-OK） | `xhost` 状态；cookie 位置 `stat` | **规定 cookie 只存 lab/keys 侧**；M 验收含 `xhost` 负探针 | 关闭 xhost |
| R24 | 迁移窗口旧路径静默失败 | M1b 逐任务 EACCES 探测 | 先处置再切换 | 恢复指向 |

## 8. 评判标准

1. 可机验。2. 消灭病类。3. 代价与回退。4. 摩擦。5. 不留需持续打补丁的授权面。

## 9. 待裁决

- Q1 A / B / C（评审路线意见：C，B 否决）。
- Q2 试点 AIHR：基线闭包 1658 = 1585+73+0；**具名缺口 G1**=`tests/test_bootstrap_properties.py` 因缺 `hypothesis` 未采集、不在验收守卫内。试点第一步在隔离 venv 装 `hypothesis` 后重采集，基线重算并写回本节；验收=与重算后的基线集合一致。
- Q3 若选 C：封闭枚举 2 个包装器；`dmesg` 不授予；扩展需签字。

## 10. 禁项

- 不恢复 lab 免密 sudo；不删旧路径于验证前；不放凭据回 AI 可读面；sudoers 不得出现裸 `dmesg`/`ipmitool`；不把 `.Xauthority` 放进共享面。
- **在 R27 修复前不得宣称账户分离完成**：root 自动执行 AI 可写脚本会绕过全部账户边界。

## 附录 A：复算命令

```bash
# 非特权矩阵
sudo useradd -M -N -s /usr/sbin/nologin probe-nonpriv
for c in "journalctl -n 1" "dmesg" "nvidia-smi -L" "systemctl status docker --no-pager" \
         "ipmitool sensor list" "docker ps -q" "head -1 /etc/shadow" "ls /home/lab" \
         "head -c 8 /dev/input/event0" "ls /run/user/1000"; do
  printf '%-42s ' "$c"; sudo -u probe-nonpriv -H bash -c "$c" >/dev/null 2>&1 && echo OK || echo FAIL; done
sudo -u probe-nonpriv -H env XDG_RUNTIME_DIR=/run/user/1000 busctl --user list >/dev/null 2>&1 && echo BUS-OK || echo BUS-FAIL
sudo -u probe-nonpriv -H env DISPLAY=:10 xdpyinfo >/dev/null 2>&1 && echo X-OK || echo X-FAIL
cp /home/lab/.Xauthority /tmp/xauth-probe && chmod 644 /tmp/xauth-probe   # 仅实验，立即删
sudo -u probe-nonpriv -H env DISPLAY=:10 XAUTHORITY=/tmp/xauth-probe xdpyinfo >/dev/null 2>&1 && echo X-COOKIE-LEAK || echo X-COOKIE-SAFE
rm -f /tmp/xauth-probe
sudo userdel probe-nonpriv && id probe-nonpriv

# /proc
setsid sleep 240 >/dev/null 2>&1 </dev/null & SP=$!
sudo -u probe-nonpriv -H head -c 60 /proc/$SP/cmdline; sudo -u probe-nonpriv -H head -c 1 /proc/$SP/environ; kill $SP

# sudo 密度与 env 策略
sqlite3 'file:/home/lab/.local/share/opencode/opencode.db?mode=ro' "
select count(*) from part where json_extract(data,'\$.tool')='bash';
select count(*) from part where json_extract(data,'\$.tool')='bash'
  and json_extract(data,'\$.state.input.command') like '%sudo%';"
sudo grep -n 'env_reset\|env_keep\|secure_path' /etc/sudoers /etc/sudoers.d/*

# ptrace（只读；不写——复算脚本不得含"换时点执行即降防护"的步骤）
sysctl -n kernel.yama.ptrace_scope
grep -n ptrace_scope /usr/lib/sysctl.d/55-ptrace.conf; ls /usr/lib/systemd/systemd-sysctl
# 下调验证引用台账既有回执 556d16387942（写 0 得 EINVAL），不重复执行
# 同 uid attach 语义：kernel Yama 文档 = 跨 uid 由 uid 检查拒绝，与取值无关；本机活值 3 无法实测，
# 标记为推断，M13 重启后（回 1）补测：lab 内 `gdb -p $$` 应成功，probe 用户对 lab 进程应失败

# 作业面与旧路径引用
crontab -l | grep -vc '^#'
systemctl list-units --type=service --state=running --no-legend | wc -l
systemctl list-timers --all --no-legend | wc -l
systemctl --user list-units --type=service --state=running --no-legend | wc -l
systemctl --user list-timers --all --no-legend | wc -l
sudo crontab -l | grep -vc '^#'
sudo grep -l '/home/lab/workspace' /etc/systemd/system/*.service

# 日志切片（与包装器同参数，6 单元）
sudo journalctl --no-pager -n 2000 -o short-iso -u dsv4-control -u qwen38-control -u llm-monitor \
  -u gpu-fan-control -u vllm-stall-capture -u docker \
  | grep -cE 'ghp_|github_pat_|npm_|AKIA|sk-[A-Za-z0-9]{20}|password=|token=|Bearer '

# 执行区/磁盘/前置
find /home/lab/workspace -path '*/.git/hooks/*' -type f ! -name '*.sample'
find /home/lab/workspace -maxdepth 4 \( -name Makefile -o -path '*/scripts/*.sh' \) | wc -l
df -h /tmp /home; grep -c '^abathur:' /etc/subuid /etc/subgid; dpkg -l uidmap | tail -1

# 本地写/读通道（v7 新增）
ls -l /dev/log
sudo -u probe-nonpriv -H python3 -c "import socket;s=socket.socket(socket.AF_UNIX,socket.SOCK_DGRAM);s.sendto(b'probe','/dev/log');print('SYSLOG-WRITE-OK')"
stat -c '%A %U:%G %n' /var/crash; ls -l /var/crash | head -2

# 单元日志级别（R19 前提）
for u in dsv4-control qwen38-control llm-monitor gpu-fan-control vllm-stall-capture docker; do printf '%-24s ' $u; systemctl show -p LogLevel --value $u.service; done

# AIHR 基线（闭包：1658=1585+73+0；G1=test_bootstrap_properties.py 因缺 hypothesis 未入守卫）
cd /home/lab/workspace/harness/hr && python3 -m pytest -q --collect-only
cd /home/lab/workspace/harness/hr && /usr/bin/time -f 'WALL=%es' python3 -m pytest -q --ignore=tests/test_bootstrap_properties.py
```

## 附录 B：包装器源码与闸门判据

```bash
#!/bin/sh
# /usr/local/sbin/abathur-journal-slice  (abathur-keys:abathur 0750)
set -eu
exec /usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/journalctl --no-pager -n 200 -o short-iso \
  -u dsv4-control -u qwen38-control -u llm-monitor -u gpu-fan-control -u vllm-stall-capture -u docker
```

```bash
#!/bin/sh
# /usr/local/sbin/abathur-sensor-read  (abathur-keys:abathur 0750)
set -eu
exec /usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin /usr/sbin/ipmitool sensor list
```

```bash
#!/bin/sh
# /usr/local/bin/abathur-shell  (root:root 0755; 由 lab 经 sudo -u abathur 调用)
# 调用者已是 abathur：内部不再 sudo（v6 的双层 sudo 是死链）
set -eu
exec /usr/bin/env -i HOME=/home/abathur TERM="${TERM:-xterm}" \
  PATH=/usr/local/bin:/usr/bin:/bin \
  /usr/local/lib/abathur/current/bin/abathur-console
```

判据：
0. **正向**：`sudo -n /usr/local/sbin/abathur-journal-slice` → rc=0 且输出含 6 单元切片（无参调用可用）。
1. `sudo -n /usr/local/sbin/abathur-sensor-read --help` → rc≠0，输出为 sudo 拒绝（带参调用被拒）。
2. root 直接执行 `abathur-sensor-read --help` → 与无参输出一致（忽略 `$@`）。
3. `LD_PRELOAD=/tmp/x.so` 经 sudo 调包装器 → 不生效（`env_reset` + `env -i` 双保险）。
4. `stat -c '%U:%G %a'` = `abathur-keys:abathur 750`；父目录 abathur 不可写。
5. `visudo -cf /etc/sudoers.d/abathur` = rc 0（落盘前置门）。
6. `/usr/local/bin/abathur-shell` 无参启动后，console 进程 `ps -o user=` = `abathur`（启动链正向）。
7. `stat -c '%U %a' /usr/local/lib/abathur /usr/local/lib/abathur/current` = root，且 abathur 写入被拒。
8. 去掉规则里的 `""` 后重跑 0/1：若 1 变为"允许但包装器忽略参数"，仍满足「固定 argv 入口」；是否保留 `""` 以 0/1 两测结果决定并记台账。
