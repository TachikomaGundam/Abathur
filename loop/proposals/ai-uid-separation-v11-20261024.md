# 提案 v11：AI 工作账户与人类账户分离（三账户模型）

日期：2026-10-24
状态：待裁决（第十一稿；v5–v10 评审路线意见 = **采用 C**，B 否决；v10 余 13 条已吸收，逐条对照见附录 D）
前稿：v1 e5cb → v2 65a7 → v3 3ca0 → v4 c300 → v5 c41d → v6 f67f → v7 4063 → v8 60b7 → v9 8902 → v10 1d3f

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
| sudo 密度 | 窗口 2026-05-15 → 2026-10-24（162 天）：82,150 次 bash 中 1,348 次含 sudo（1.64%），107 会话；折合 **507 次 bash/天、8.3 次 sudo/天**。**覆盖边界**：只统计 opencode.db 的 bash 工具调用；工具外执行与他机不计 |
| 用途分布（全量分组，v8 重算） | logs 214、docker 201、systemctl 177、gpu 131、etc-write 85、ipmitool 59、own 47、apt 41、npm 23、mount 3、fw 3、**OTHER（脚本化 root 操作/探针）362**；分组和 1,346，余 2 条 NULL 未分类 |
| **非特权 uid 矩阵**（临时账户建→测→删） | journalctl FAIL、dmesg FAIL、ipmitool FAIL、docker FAIL、`/etc/shadow` FAIL、`/home/lab` FAIL、`/dev/input` FAIL；nvidia-smi OK、`systemctl status` OK |
| **/run/user/1000** | 目录 `drwx------ lab`；probe `ls` FAIL、`busctl --user` FAIL |
| **gpg-agent** | `/run/user/1000/gnupg/S.gpg-agent` 为 `srw------- lab` → 非 lab 不可连 |
| **X11 默认** | `/tmp/.X11-unix/X10` 套接字 `srwxrwxrwx`；`xhost` = access control enabled；probe `xdpyinfo` **FAIL** |
| **X11 cookie 位置实验** | 2026-10-24 **一次性**执行：`.Xauthority` 复制到 `/tmp`（644）后 probe `xdpyinfo` **CONNECT-OK**（副本当场删除）。**不得重跑**（在产机上把活 cookie 置为全局可读=自开键盘通道）。日常可复算的安全探针=`sudo -u probe test -r /home/lab/.Xauthority` 必须 FAIL |
| **/proc 跨 uid** | `cmdline` 可读；`environ` Permission denied |
| sudo env 策略 | `/etc/sudoers:9 Defaults env_reset`；`secure_path` 已设；`env_keep` 全部注释 → `LD_PRELOAD` 不随 sudo 传递 |
| ptrace 活值/来源 | 活值 3；来源=本席 2026-10-24 05:55Z 干跑误写，根因=`install-isolation.sh` v3 的 ptrace 段未受 `--apply` 控制（修复在提交 fe540ce）。**下调回执**：写 0 → `EINVAL`（sysctl 文档：3 为单向棘轮，任何写入均 EINVAL）；台账 `556d16387942`。两条可复算：`sysctl -n` + 台账条目 |
| ptrace 回退 | `/usr/lib/sysctl.d/55-ptrace.conf:22 kernel.yama.ptrace_scope = 1`；`/usr/lib/systemd/systemd-sysctl` 存在 → **重启回 1 目前是推断**，须 M13 重启后实测确认 |
| **Yama 语义（拆分实测/推断）** | **实测**：scope=3 下连 root 的 attach 被拒（`sudo strace -p <pid>` → `PTRACE_SEIZE: EPERM`，2026-10-24）。**推断（内核文档，本机活值 3 无法实测，锚 M13）**：scope=1 仅允许祖先 attach 后代，非后代同 uid 拒绝 |
| 日志敏感面 | 6 单元初测过滤 200 行：0 命中；加深 2000 行：0 命中（非证明）。**切片限定 4–5 单元**（docker 排除；vllm-stall-capture 待 M11c 后入表） |
| 执行区 | 8 个非样例 hooks；`core.hooksPath` 无自定义；61 个脚本/Makefile |
| 作业面 | lab crontab 8；lab user units 27 running / 4 timer（发行版）；root crontab 0；系统服务 51 / timer 31；**AI 依赖具名 6 个**（dsv4-control、qwen38-control、llm-monitor、gpu-fan-control、vllm-stall-capture、docker）；**日志切片只含前 5 个**，docker 排除理由见 §4C |
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
- **空参钉死不是唯一防线（仅 C 有包装器）**：C 的两个包装器本身忽略 `$@`，即使 `""` 形态在本机 sudo 语义不符，授权面仍是「固定 argv 入口」。**A 只有 `abathur-shell` 一个入口、日志走 root 定时器，不存在带参包装器**；A 的验收只测零参启动。
- 日志：root 定时器把 **5 个 AI 单元**的切片写入 `/var/log/abathur/journal-slice.log`（0640 root:abathur）；**docker 排除**（人类活动面）。
- **注**：A 的 sudoers 只有启动规则、无 `""` 形态；对 A 的测试只测「包装器忽略参数」，不存在「sudo 拒绝带参」这一预期（v9 表述有误，已更正）。
- 残余（具名）：R17 复制粘贴、R18 GPU 666、R19/A 日志切片含密钥与人类活动（与 C **内容类别相同、持久性不同**：A 落盘、C 易失）、R21 cmdline、R22 脚本可写、R23 X cookie 位置。

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
- **`""` 的确定性判据（v9）**：先按 `cmd ""` 形态部署并跑正向零参测试；**若零参调用被拒**（rc≠0），则删除 `""`、仅保留『包装器忽略 `$@`』这条不变量，并重跑负测确认带参仍被忽略/拒绝。两条路径都满足「固定 argv 入口」，不得把『正负两测同时通过』写成预期结果。
- 包装器：`env -i` 清洗环境；属主 keys `0750`；父目录 root；不读 `$@`；固定 `PATH`。
- `journal-slice` 的单元表**由部署时形态决定**：基线 **4 单元**（dsv4-control、qwen38-control、llm-monitor、gpu-fan-control）；**M11c（R27）回执到位后**追加 vllm-stall-capture 成 5 单元。单元表写在包装器顶部 `UNITS=(...)` 一行，验收时逐字比对（防部署期就地改脚本）。**docker.service 明确排除**：其日志含人类容器名/镜像/挂载路径=人类活动面，root 切片会把它泄给 AI（R19 活动泄漏类）。
- `dmesg` 不授予（`-C` 清环=灭证）。
- 部署前后置门：`visudo -cf /etc/sudoers.d/abathur` rc=0 才落盘。
- **双轨禁用闸（M15b）**：部署后必须证明 A 的两条旧写入面不存在——按**具名单元**精确匹配（排除 R19 自己的 `abathur-loglevel-diff.timer`）：
  `systemctl list-timers --all --no-legend | awk '{print $NF}' | grep -E '^abathur-(journal-slice|sensor-read)\.timer$' | wc -l` = 0（`set -e` 下用 `|| true` 包裹，`grep` 无命中 rc=1 不算失败）；且 `test ! -e /var/log/abathur/journal-slice.log`。两项回执入台账。
- C 独有失效模式（不继承 A 表的部分）：两个永久 root 落脚点。缓解=固定 argv + `env -i` + 属主 root + 忽略参数 + 三负测试；残余=`journalctl`/`ipmitool` 以 root 解析输入（读 HOME/配置）的面未穷尽，R19 的前提见下。

## 5. P0：能力逐项处置

| 能力 | 探针 | 处置 |
|---|---|---|
| root | `sudo -n true` | drop（M0 后执行） |
| docker | `docker ps` | drop；替代 rootless podman（M6）或人类代跑 |
| 键盘 | `/dev/input` + X11 | drop；X11 依赖 cookie 位置（R23） |
| 全量日志 | `journalctl -n1` | drop；替代=单元切片（4–5 单元） |
| GPU render | `ls -l renderD128` | 暂 drop、按需恢复 |
| GPU 设备 | `nvidia-smi -L` | 保留（R18） |
| lxd / plugdev | 无运行时目录 | 暂 drop、按需恢复 |
| SSH agent / keyring / gpg-agent | `test -S`、`busctl --user`、socket 权限 | 天然隔离（**已实测**：700 目录、0600 socket、busctl FAIL） |
| 共享服务 | `curl -s -m2` | 逐服务；读按 L-ENV-SEGREGATION |

## 6. 迁移清单

| # | 项 | 探针 | 回滚 |
|---|---|---|---|
| **M0a** | **建立三账户本体**：`abathur`（无 sudo、不进特权组）、`abathur-keys`（shell 保留、密码锁死 `passwd -l`、记 `/etc/shadow` 首字符 `!`） | `id`；`getent shadow`；`sudo -l -U abathur` 回显「无 sudo 规则」；**人类至 keys 通路回执**=`sudo -iu abathur-keys -- id -un` 输出 abathur-keys（走既有 `%sudo ALL` 规则，不另开授权面） | `userdel -r` |
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
| **M11c（R27 修复，前置）** | 修复 `vllm-stall-capture.service` 的 root 执行链：脚本迁 `/opt/vllm-stall-capture/`（root 0755）或改 `User=lab`；**必须早于 M5 启动切换** | `systemctl cat`；脚本 `stat` 非 lab 可写；注入写测试 `sudo -u abathur test -w` FAIL | 恢复原路径 |
| **M11b** | **自动执行链审计（v7 评审新发现，最高优先）**：对 6 个 AI 依赖单元逐条登记 `User=`、`ExecStart`、全部读入路径，机械证明「root 或 lab 自动运行的单元零 AI 可写输入」；**已发现反例**：`vllm-stall-capture`（root + 775 lab 脚本 + Restart=always）；不满足者把该脚本/配置迁入 keys 所有、AI 只读区，或改为人类触发 | `systemctl cat` 逐单元原文；`systemd-analyze security <unit>`；写权负探针；运行时采样 `strace -f -e trace=openat` **仅在 M13 重启后（scope≤2）可用**，之前以静态读入路径枚举替代（本机 scope=3 连 root 的 strace 也被拒，已实测） | 恢复原路径 |
| M10 | 状态库 777→700（在 M11 后） | `stat` | 恢复 |
| M12 | 磁盘（38G 双份；余 173G） | `df` | 清副本 |
| M13 | 重启后实测 `sysctl -n kernel.yama.ptrace_scope`（当前"回 1"为推断）；**预期矩阵**：scope=1 下 (a) 父进程 attach 自己启动的子进程=允许（探针 `strace -f true`），(b) 兄弟/无关进程 attach=拒绝（`gdb -p` 一个 `setsid sleep`），(c) 跨 uid attach=拒绝；逐项回执。**注意**：shell 内 `gdb -p $$` 是子附父=非后代方向，预期应为**拒绝** | 重启后四行回执入台账 | 无 |
| M14 | 引擎源码/dist 属主 root/keys；**lab 读取失败**（`head -c1 rc≠0`） | 读位测试 | 恢复位 |
| M15 | **按附录 B 的条件矩阵验收，不得按单一形态写死**：先跑 A1（零参）判形态 → 进入 B 列或 C 列，逐格执行 9 条判据；属主 keys `0750`、父目录 root、`visudo -cf` 前置；`LD_PRELOAD` 负测；`sensor-read` 正向=rc=0 且输出非空（`env -i` 无 HOME）；**时序门：C 件（包装器+sudoers）部署前必须有 M11c 回执**（R27 已修）；无回执时按 4 单元版验收 | A1 回执 + 9 格回执 + `stat` + M11c 回执指针 | 恢复位 |
| M15b | **双轨禁用（只针对 A 的旧面）**：不部署 A 的 root 定时器；`systemctl list-timers --all --no-legend \| awk '{print $NF}' \| grep -E '^abathur-(journal-slice\|sensor-read)\\.timer$' \| wc -l`=0（`\|\| true` 包裹，无命中 rc=1 不判失败）；且 `test ! -e /var/log/abathur/journal-slice.log`。**R19 的 `abathur-loglevel-diff.timer` 不在此闸范围**（两闸可同真） | 两条回执入台账 | 停用定时器 |
| M16 | `abathur-shell` 属主 root `0755`；`/usr/local/lib/abathur/` 与 `current` 符号链接 **root 所有、abathur 不可写**；脚本内无 sudo；**正向启动测试**=`sudo -n -u abathur /usr/local/bin/abathur-shell` 后 console 进程 `ps -o user=`=abathur | 双 `stat` + 正向启动（参数行为按附录 B 矩阵，不写死『参数拒绝』） | 恢复位 |

## 7. 风险表

| # | 风险 | 探针/闸门 | 缓解 | 回滚 |
|---|---|---|---|---|
| R1 | 人类在 lab 起 AI | (a) lab 读源码/dist **失败**；(b) `run_registry` 记 uid；(c) 人类故意绕过（模型外） | (a)+(b) | 恢复位 |
| R2 | 路径断裂 | 全量测试 | AIHR 试点 | 旧路径只读 |
| R3 | 组写权互覆盖 | 两账户写矩阵 | 2775 + umask 002 | 恢复 775 |
| R4 | 状态库损坏 | integrity_check | 先复制 | 指回 |
| R5 | 无 root 运维受阻 | 1,348 次逐类出口：logs 214→C 包装器；docker 201→podman 或人类；systemctl 177→`systemctl status` 免 sudo + 人类执行变更；gpu 131→nvidia-smi 免 sudo；etc-write 85→人类；ipmitool 59→sensor-read；own 47→人类；apt 41→人类；npm 23→用户级前缀；mount 3/fw 3→人类；OTHER 362（脚本化 root 操作/探针）→人类或 keys | 人类执行 / 包装器 | 临时授权（签字） |
| R6 | 凭据可达 | AI 侧 `npm whoami`/`test -S`/`busctl` 全失败 | **发布类凭据只在 keys**；**AI 自身运行时凭据（云端推理端点 key）必须在 abathur 可读面=具名缺口 G4**，与发布键分账：只读推理 key 泄露≠外写权，但须限额/可吊销/登记（探针：AI 侧调用成功 + `npm whoami`/`gh auth status` 仍失败） | 轮换 |
| R7 | 人类读不到产出 | lab 读工作区 | 组读位 | chmod |
| R8 | 启动摩擦 | 试用一周 | 窄 launcher | 去规则 |
| R9 | 迁移中断 | 日志 + df | rename/rsync | 回指 |
| R10 | 旧库 777 | stat | 700 | 无 |
| R11 | 供应链 | 执行区收窄=`hooks`+`.git/config`；61 脚本=AI 可写 → **G3** | 收窄；脚本执行侧无机械签名闸（见 G3） | 恢复属主 |
| R12 | 共享服务跨 uid | 逐端点 | 封闭枚举；写需 token | 关端口 |
| R13 | 凭据交接 | keys 成功 / AI 失败 | agent 仅在 keys | 无 |
| R14 | AI→人类反向写 | 交叉写探针 | 写区/执行区分离 | 恢复属主 |
| R15 | 经 DB/wiki 触达 | 逐服务写权 | 写权归人类/keys | 撤权 |
| R16 | 旧身份续跑 | M11 全量清点 | 迁移/废止+签字 | 恢复 |
| R17 | 复制粘贴 | 无机械闸门 | **具名缺口** | — |
| R18 | nvidia0 666 | `ls -l` | **具名残余** | — |
| R19 | 日志切片含密钥与人类活动（**A/C 不对称**：A 持久写文件，C 只有按需 tail-200 易失窗口） | 200/2000 行抽样 0 命中（非证明）；前提=**单元表内各单元**保持默认日志级别；docker 已排除（活动面） | 单元过滤 + `env -i` + 排除 docker；**vllm-stall-capture 入切片的前提=R27 已修**（否则 AI 可写脚本→root 执行→root 输出回读=内容洗白通道），未修前该单元暂除（切片 4 单元）；**漂移闸=具名定时件** `abathur-loglevel-diff.timer`（每日 04:00，`/usr/local/sbin/abathur-loglevel-diff`，读 **`systemctl show -p LogLevelMax --value <unit>`**，期望全为 `-1`；实测 `LogLevel` 属性对单元为空、不可用——v9 的闸门是空转闸，已更正。差异非空即写 `loglevel-drift.flag` 并送裁） | 停用定时器 |
| R20 | 人类自觉性 | 台账审计 | **账户边界不以自觉为前提**；但 `R11/R22` 的『人类执行前确认』恰是自觉 → **具名缺口 G3**（与 R17 同级），不当成机械闸门 | — |
| R21 | `/proc/*/cmdline` 可读 | 实测可读 | **具名残余**；约定 argv 不含密钥 | hidepid 待评估 |
| R22 | 61 脚本 AI 可写、人类可能执行 | 改动后 `git status` | 人类执行前确认 | — |
| R25 | `/dev/log` 任何本地用户可写（实测 `SYSLOG-WRITE-OK`）→ AI 可注入伪造日志 | **具名残余（无在册闸门）**：`-o short-iso` 输出不含归属字段，`-u` 过滤又滤掉注入条目，故「无归属即告警」在该输出形态下不可判定；可选强化=`journalctl -o json` 旁路 `_TRANSPORT=syslog` 归属探测（未纳入本提案） | 无机械闸门，靠日志时间线与单元计数交叉核对 | journald 配置收紧待评估 |
| R26 | `/var/crash` 为 `drwxrwsrwt root:whoopsie`（全局可写+sticky），apport 以 root 解析其中文件 | `stat /var/crash` | **具名残余**；崩溃文件本身 640 属主:whoopsie 不可读 | 待评估 apport 配置 |
| **R27** | **root 自动执行 AI 可写脚本**（G2，现存活体）：`vllm-stall-capture.service` root + `Restart=always` + ExecStart 指向 `lab:lab 775` 脚本 | `systemctl cat` + `stat` 脚本 + 写入→10s 内重启的执行回执 | 立即修复：脚本移 `/opt`（root 所有 0755）或改 `User=lab`；M11b 逐单元闭环 | 改回原路径 |
| R23 | **人类会话 `xhost +` 或 cookie 落入共享面即重开键盘通道**（实验：cookie 644 时 probe CONNECT-OK） | `xhost` 状态；cookie 位置 `stat` | **规定 cookie 只存 lab/keys 侧**；M 验收含 `xhost` 负探针 | 关闭 xhost |
| R24 | 迁移窗口旧路径静默失败 | M1b 逐任务 EACCES 探测 | 先处置再切换 | 恢复指向 |

## 8. 评判标准

1. 可机验。2. 消灭病类。3. 代价与回退。4. 摩擦。5. 不留需持续打补丁的授权面。

## 9. 待裁决

- Q1 A / B / C（评审路线意见：C，B 否决）。
- Q2 试点 AIHR：**弃治阈值**=人类 sudo 承接量 > 25 次/日（基线 8.3/日 ×3）连续 5 个工作日，或构建/测试阻断 > 2 次/周 → 触发重裁（回 A 或回 B）。基线闭包 1658 = 1585+73+0；**具名缺口 G1**=`tests/test_bootstrap_properties.py` 因缺 `hypothesis` 未采集、不在验收守卫内。试点第一步在隔离 venv 装 `hypothesis` 后重采集，基线重算并写回本节；验收=与重算后的基线集合一致。
- Q3 若选 C：封闭枚举 2 个包装器；`dmesg` 不授予；扩展需签字。
- Q4（v10 新增）：R8 试验周摩擦阈值同 Q2（25 次/日）；超阈即重裁。

## 10. 禁项

- 不恢复 lab 免密 sudo；不删旧路径于验证前；不放凭据回 AI 可读面；sudoers 不得出现裸 `dmesg`/`ipmitool`；不把 `.Xauthority` 放进共享面。
- **G3 具名**：AI 可写的 61 个脚本/Makefile 若被人类执行即恢复 AI 权限，当前无机械签名闸；不得宣称已闭合。
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
# 不要重跑 644 cookie 实验（在产机上等于自开键盘通道）；日常安全探针：
sudo -u probe-nonpriv -H test -r /home/lab/.Xauthority && echo COOKIE-READABLE || echo COOKIE-UNREADABLE
# 一次性实验回执见台账（2026-10-24）；如需重放，用独立 Xvfb 会话，勿触碰活 cookie
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
# 标记为推断，M13 重启后（回 1）补测：lab 内 `gdb -p $$`（子附父=非后代方向）应**失败**；父附子用 `strace -f true` 应成功；probe 用户对 lab 进程应失败

# 作业面与旧路径引用
crontab -l | grep -vc '^#'
systemctl list-units --type=service --state=running --no-legend | wc -l
systemctl list-timers --all --no-legend | wc -l
systemctl --user list-units --type=service --state=running --no-legend | wc -l
systemctl --user list-timers --all --no-legend | wc -l
sudo crontab -l | grep -vc '^#'
sudo grep -l '/home/lab/workspace' /etc/systemd/system/*.service

# 日志切片（与包装器同参数，单元表 4–5 个；docker 排除）
sudo journalctl --no-pager -n 2000 -o short-iso -u dsv4-control -u qwen38-control -u llm-monitor \
  -u gpu-fan-control -u vllm-stall-capture \
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
for u in dsv4-control qwen38-control llm-monitor gpu-fan-control vllm-stall-capture; do
  printf '%-24s ' "$u"
  systemctl show -p LoadState -p LogLevelMax --value "$u.service" | paste -sd' '
done
# 期望：每行 'loaded -1'。注意：对不存在的单元，LogLevelMax 同样返回 -1 且 rc=0，
# 所以必须同时校验 LoadState=loaded，否则闸门对『单元被改名/删除』是空的。

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
  -u dsv4-control -u qwen38-control -u llm-monitor -u gpu-fan-control -u vllm-stall-capture
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

判据（两形态条件矩阵；部署时先跑 A1，再按回执进入 B 或 C 列）：

**A1 形态判定**：`sudo -n /usr/local/sbin/abathur-journal-slice`（零参）
- rc=0 且输出行数=单元表长度 → 保留 `""`，按 **B 列** 预期验收；
- rc≠0（sudo 拒绝）→ **删除 `""`**、重装 sudoers、复跑 A1；通过后按 **C 列** 验收。

| # | 判据 | B 列（有 `""`） | C 列（无 `""`） |
|---|---|---|---|
| 1 | 零参调用 | rc=0，输出行数=单元表长度（4 或 5） | 同左 |
| 2 | 带参调用 `--help` | **sudo 拒绝**（rc≠0，stderr 含 not allowed） | **rc=0 且输出与零参逐字节相同**（包装器忽略 `$@`） |
| 3 | 越界注入 `-u sshd` | sudo 拒绝 | rc=0 但输出中**不得出现 sshd 单元行** |
| 4 | root 直接带参执行 | 与无参一致（忽略 `$@`） | 同左 |
| 5 | `LD_PRELOAD=/tmp/x.so` 经 sudo 调包装器 | 不生效（env_reset + env -i） | 同左 |
| 6 | `stat -c '%U:%G %a'` 包装器 | `abathur-keys:abathur 750`；父目录 root | 同左 |
| 7 | `visudo -cf /etc/sudoers.d/abathur` | rc=0（落盘前置） | 同左 |
| 8 | `/usr/local/bin/abathur-shell` 零参启动 | console `ps -o user=`=abathur | 同左 |
| 9 | `stat /usr/local/lib/abathur` 与 `current` | root 所有，abathur 写入被拒 | 同左 |

硬不变量（两列共同）：带参调用**永不返回**单元表之外的内容；root 落脚点仅两个——`abathur-journal-slice` 与 `abathur-sensor-read`（`dmesg` 不授予；`ipmitool` 经 sensor-read 间接可达）。任一格不符即以 `exit 1` 终止部署并回滚 sudoers 片段。

## 附录 D：v10 十三条 must-fix → 修复位置对照（可独立复核）

| # | v10 庭 must-fix（摘引） | 本稿修复位置 |
|---|---|---|
| 1 | Yama scope=1 预期矩阵与附录 A 互斥（`gdb -p $$` 一处说成功一处说拒绝） | M13 行 + 附录 A 注释，两处统一为**拒绝**（子附父=非后代方向） |
| 2 | M15 负向写死「带参 rc≠0 且为 sudo 拒绝」 | M15 行改为引用附录 B 条件矩阵；矩阵 B/C 两列分列预期 |
| 3 | M15b 的 `grep -c abathur` 与 R19 漂移闸互斥 | M15b 改**具名单元精确匹配**并显式排除 loglevel-diff；`|| true` 处理 rc |
| 4 | 未为「R27 未修」分支提供 4 单元变体或时序门 | 附录 B 单元表基线=4，M11c 回执后追加至 5；M15 行写入时序门 |
| 5 | 附录 B 缺 `abathur-loglevel-diff` 源码 | 新增附录 E（脚本 + timer/service 单元全文） |
| 6 | 硬不变量写「dmesg/ipmitool 之外无 root 落脚点」失实 | 改为「仅 journal-slice 与 sensor-read 两个落脚点；dmesg 不授予」 |
| 7 | §4A 混入 C 专属「两个包装器」表述 | §4A 改为「仅 C 有包装器；A 只有 abathur-shell」 |
| 8 | 缺 v9/v10 must-fix 逐条对照 | 本附录 D |
| 9 | `LogLevelMax` 期望值无当场实测 | 附录 F：六单元实测回执（含不存在单元的对照，证明必须同时验 LoadState） |
| 10 | 附录 A 复算循环仍用空的 `LogLevel` | 已改 `LogLevelMax` + `LoadState` 双字段 |
| 11 | M15b `grep -c` 在 0 命中时 rc=1，`set -e` 下误报 | 已改 `wc -l` + `|| true` |
| 12 | 附录 B 包装器硬编码 5 单元，违反 R19 前提 | 改为 `UNITS=(...)` 一行、部署期 4/5 二选一、验收逐字比对 |
| 13 | M15/M16「参数拒绝」写死，C 列下会把正确部署判失败 | 两行均改为引用 A1→B/C 矩阵 |

## 附录 E：`abathur-loglevel-diff` 源码（部署件，root 所有）

```bash
#!/bin/sh
# /usr/local/sbin/abathur-loglevel-diff  (0755 root:root)
# 读每单元的 LoadState + LogLevelMax；漂移即写 flag。不改任何系统状态。
set -eu
OUT=/var/log/abathur/loglevel-diff.log
FLAG=/var/log/abathur/loglevel-drift.flag
UNITS="dsv4-control qwen38-control llm-monitor gpu-fan-control vllm-stall-capture"
mkdir -p /var/log/abathur
: > "$OUT"
drift=0
for u in $UNITS; do
  # 两字段同取：LoadState 必须 loaded（否则单元被改名/删除也照样返回 -1，闸门会空转）
  vals=$(systemctl show -p LoadState -p LogLevelMax --value "$u.service" | paste -sd' ')
  printf '%s %s\n' "$u" "$vals" >> "$OUT"
  [ "$vals" = "loaded -1" ] || drift=$((drift+1))
done
if [ "$drift" -gt 0 ]; then
  printf 'drift=%s at %s\n' "$drift" "$(date -Is)" > "$FLAG"
  exit 1
fi
rm -f "$FLAG"
exit 0
```

```ini
# /etc/systemd/system/abathur-loglevel-diff.service
[Unit]
Description=Detect per-unit log-level drift (no state change)

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/abathur-loglevel-diff
```

```ini
# /etc/systemd/system/abathur-loglevel-diff.timer
[Unit]
Description=Daily log-level drift check

[Timer]
OnCalendar=*-*-* 04:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

## 附录 F：`LogLevelMax` 当场实测（2026-10-24）

```
$ for u in dsv4-control qwen38-control llm-monitor gpu-fan-control vllm-stall-capture docker; do
    printf '%-24s %s\n' "$u" "$(systemctl show -p LogLevelMax --value "$u.service")"; done
dsv4-control             -1
qwen38-control           -1
llm-monitor              -1
gpu-fan-control          -1
vllm-stall-capture       -1
docker                   -1

$ systemctl show -p LogLevelMax --value nonexistent.service
-1
$ echo $?
0
```

**结论**：期望值 `-1` 成立；**但对不存在的单元同样返回 `-1`**，所以单独看 `LogLevelMax` 是空转闸——必须与 `LoadState=loaded` 联判（附录 E 已如此实现）。
