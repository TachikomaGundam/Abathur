# 提案 v5：AI 工作账户与人类账户分离（三账户模型）

日期：2026-10-24
状态：待裁决（第五稿；v4 评审判为"缺陷全在闸门细节，一轮可吸收，不动架构"，路线意见 C > A > B否决）
前稿：v1 e5cb(1A/2R) → v2 65a7(0A/3R) → v3 3ca0(1A/2R) → v4 c300(0A/3R)

## 0. 威胁模型

- 威胁主体 = AI（以 `abathur` 身份运行）。目标 = 阻止 AI **自主或隐蔽地**取得人类权限、凭据、键盘输入、进程内存。
- 人类**有意**在 `lab` 手动执行命令，不属防御目标（持钥方）；此类路径只记残余。
- 机械闸门只需保证「AI 不能自行解除限制」。

## 1. 问题

人类与 AI 共用 `lab`，任何"在 lab 内收权"都无法建立边界；是否应把 AI 迁到独立非 root 账户。

## 2. 机器实测（命令见附录 A）

| 事实 | 输出 |
|---|---|
| 内核 | `7.0.0-30-generic`；`CONFIG_SECURITY_YAMA=y` |
| 同 uid | `uid=1000(lab)`；组：sudo, docker, lxd, input, adm, video, render, plugdev |
| docker = root 等价 | `/etc/shadow` 直读失败；经容器 → `root hashlen=1` |
| input | `/dev/input/event*` = `crw-rw---- root:input` |
| render | `/dev/dri/renderD128` = `crw-rw---- root:render` |
| nvidia | `/dev/nvidia0` = `crw-rw-rw-` |
| 家目录 750 | 对账户间有效，**对同 uid 无效** |
| 工作区 | `775 lab:lab`，38G |
| 状态库 | `777`，8.2G |
| sudo 密度 | 82,127 次 bash 中 1,333 次含 sudo（1.6%），107 会话 |
| 用途分布 | journalctl/dmesg 166、systemctl 142、root 跑脚本 129、rm/mv/cp 120、`sudo -n` 116、ipmitool 82、docker 77、chown 75、tee 写配置 64、nvidia/modprobe 38、apt 17、npm -g 12、防火墙 5、mount 2 |
| **非特权 uid 矩阵**（临时账户建→测→删） | journalctl FAIL、dmesg FAIL、ipmitool FAIL、docker FAIL、`/etc/shadow` FAIL、`/home/lab` FAIL、`/dev/input` FAIL；nvidia-smi OK、`systemctl status` OK |
| **X11 面** | `/tmp/.X11-unix/X10` 为 `srwxrwxrwx`（套接字可连）；`xhost` = `access control enabled`；非特权 uid `xdpyinfo` **FAIL** → 键盘通道被授权机制挡住 |
| **/proc 跨 uid** | `cmdline` **可读**（实测 pro译 读 lab 进程 `sleep 240` 成功）；`environ` **不可读**（Permission denied） |
| ptrace | 写 0 → `Invalid argument`；读回 3；恢复写 3 后仍 3 |
| ptrace 来源/回退 | 来源=本席 2026-10-24 05:55Z 干跑误写（台账 `556d16387942`）；`/usr/lib/sysctl.d/55-ptrace.conf:22` = `kernel.yama.ptrace_scope = 1`（完整键名）；`/usr/lib/systemd/systemd-sysctl` 存在 → 开机加载 → **重启回 1** |
| 日志敏感面 | 单元过滤 5 单元 200 行：0 命中；加深至 2000 行：0 命中（`ghp_`/`github_pat_`/`npm_`/`AKIA`/`sk-`/`password=`/`token=`/`Bearer `） |
| 执行区 | 8 个非样例 `.git/hooks`；`core.hooksPath` 无自定义；61 个 Makefile/脚本 |
| lab 定时任务 | crontab 8 条 |
| **root 侧作业面** | root crontab **0 条**；系统级 running 服务 **51** 个；系统级 timer **31** 个；其中 AI 依赖具名 6 个（dsv4-control、qwen38-control、llm-monitor、gpu-fan-control、vllm-stall-capture、docker） |
| lab user units | 27 running、4 timer（timer 全为发行版组件：firmware-updater、launchpadlib、ubuntu-insights ×2） |
| 磁盘 | `/` 余 173G；`/tmp` 已用 93G/124G |
| AIHR 基线 | 2.0G；采集 1658 项、1 个既有错误（`test_bootstrap_properties.py`）；排除后 **1585 passed / 73 skipped / 132s** |
| rootless podman 前置 | `/etc/subuid` 仅 `lab`，**无 abathur**；`uidmap` 未安装 |

## 3. 根因

一个 uid 三顶帽子。同 uid → ptrace 默认可用、组权限共享、文件权限无法区分人/AI。三条内部收权路径均不成立（删 NOPASSWD 后 docker 仍 root 等价；退组则人类不能用且同 uid ptrace 仍在；`ptrace_scope=3` 挡不住 input 且不可回退）。

## 4. 方案

### A：三账户分离（无授权面）
- 账户：`abathur`（非 root、无 sudo、不进特权组）；`abathur-keys`（凭据持有，密码锁死）。
- 工作区目的地：`/srv/workspace`（`root:dev 2775`，`lab`/`abathur` 均在 `dev`）。
- 启动：`/usr/local/bin/abathur-shell`（M16）；sudoers 仅 `lab ALL=(abathur) NOPASSWD: /usr/local/bin/abathur-shell`；人类保留带密码 sudo（`/etc/sudoers:53 %sudo ALL=(ALL:ALL) ALL`，已实测）。
- 进入 keys：人类 `sudo -u abathur-keys -i`（用人类密码 sudo，无额外规则）。
- 日志：root 侧定时器把 **5 个 AI 单元**的切片写入 `/var/log/abathur/journal-slice.log`（0640 root:abathur）。
- 收益：边界由 uid 决定；跨 uid ptrace 由 uid 检查拒绝，与 `ptrace_scope` 取值无关（重启回 1）。
- 残余缺口（具名）：R17 复制粘贴、R18 GPU 666 显存残留、R21 `/proc/*/cmdline` 可读（argv 内联密钥）、R22 脚本 AI 可写。

### B：`lab` 内收权
- 删 NOPASSWD、退组、`ptrace_scope=3`、工作区 750。
- 失效：同 uid 无法"人类用 docker、AI 不用"；同 uid ptrace 只能靠不可回退的 3；`/run/user/1000`、agent、浏览器配置同 uid 可读。**不构成边界。**

### C：A + 两个钉死 argv 的包装器
- **单一来源声明**：选 C 则不部署 A 的 root 定时器切片；日志能力由 `abathur-journal-slice` 提供（二选一，不并存）。
- 规则（空参数钉死）：
  ```
  abathur ALL=(root) NOPASSWD: /usr/local/sbin/abathur-journal-slice ""
  abathur ALL=(root) NOPASSWD: /usr/local/sbin/abathur-sensor-read ""
  ```
- 包装器：属主 `abathur-keys`、`0750`、父目录 root 拥有且 abathur 不可写（M15）；不读 `$@`；固定 `PATH`；`journal-slice` 固定 5 单元 + `-n 200`。
- `dmesg` 不授予（`-C` 清环=灭证）。
- 残余：单元日志仍可能含密钥 → R19（抽样 200/2000 行 0 命中，非证明）。

## 5. P0：能力逐项处置

| 能力 | 探针 | 处置 |
|---|---|---|
| root | `sudo -n true` | drop（最后执行，M0 后） |
| docker | `docker ps` | drop；替代：rootless podman（需 subuid/subgid + uidmap，M6）或人类代跑 |
| 键盘 | `head -c 8 /dev/input/event0` | drop；X11 由授权挡住（实测） |
| 全量日志 | `journalctl -n1` | drop；替代=5 单元切片 |
| GPU render | `ls -l /dev/dri/renderD128` | 暂 drop、按需恢复 |
| GPU 设备 | `nvidia-smi -L` | 保留（R18） |
| lxd / plugdev | 无运行时目录 | 暂 drop、按需恢复 |
| SSH agent / keyring | `test -S`、`busctl --user` | 天然隔离 |
| 共享服务 | `curl -s -m2` | 逐服务裁决；读按 L-ENV-SEGREGATION |

## 6. 迁移清单（顺序即依赖）

| # | 项 | 探针 | 回滚 |
|---|---|---|---|
| M0 | 人类终端实测 `sudo -k; sudo true` + 带外恢复 | 人类回执 | 不执行收权 |
| M1 | 工作区 → `/srv/workspace`（`root:dev 2775`） | `stat`；两账户写入矩阵 | 旧路径只读 |
| M2 | 状态库：`run_registry.py status`=FREE → `integrity_check` → 复制 | sha256 + integrity_check | 指回 |
| M3 | `~/.config/opencode` | 一次会话 | 复制回 |
| M4 | `~/.sibyl` | 一次 consult | 复制回 |
| M5 | 启动方式 | `ps -o user=` = abathur | 原状 |
| M6 | docker 替代：rootless podman，前置 `/etc/subuid`、`/etc/subgid` 加 abathur + 安装 `uidmap` | `podman info`；`podman run` 冒烟 | 人类代跑 |
| M7 | 共享服务接线 | 逐端点连通 + 写权负探针 | 恢复配置 |
| M8 | hooks 属主 | 权限矩阵 | 恢复属主 |
| M8b | `.git/config` 改 keys 所有、AI 只读（堵 `core.hooksPath`） | `git config --show-origin core.hooksPath` + `stat` | 恢复属主 |
| M9 | 人类读产出 | `lab` 读工作区 | chmod |
| M11 | **作业面全量清点**：lab crontab 8 + lab user units 27/4 timer + **root crontab 0 + 系统服务 51/timer 31**，逐条处置（迁/改/废止+签字）；`grep -c opencode.db` 查 DB 触碰 | `crontab -l`；`systemctl list-units/list-timers` 计数入表 | 恢复 |
| M10 | 状态库 777→700（**在 M11 之后**） | `stat` | 恢复 |
| M12 | 磁盘（38G 双份；余 173G） | `df` | 清副本 |
| M13 | 重启回 `ptrace_scope=1` | `grep -n ptrace_scope /usr/lib/sysctl.d/55-ptrace.conf` + 重启后 `sysctl -n` | 无 |
| M14 | 引擎二进制属主 root/keys `750` 组 abathur；父目录 abathur 不可写 | `stat`；**lab 读 dist 失败**（`head -c1 rc≠0`） | 恢复位 |
| M15 | 两个包装器属主 keys `0750`、父目录 root；**负测试=被拒**：`sudo -n <wrapper> --help` → rc≠0 且无包装器输出；另以 root/keys 直接执行包装器带参，验证忽略 `$@` | `sudo -l` 回显 + `stat` | 恢复位 |
| M16 | `/usr/local/bin/abathur-shell` 属主 root、父目录 abathur 不可写 | `stat`；`lab` 经它启动得 `ps -o user=`=abathur | 恢复位 |

## 7. 风险表

| # | 风险 | 探针/闸门 | 缓解 | 回滚 |
|---|---|---|---|---|
| R1 | 人类在 lab 起 AI | (a) 机械：引擎源码/dist 属主 root/keys，**lab 读取失败**（读位测试，非执行位）；(b) 审计：`run_registry` 记 uid；(c) 残余：人类故意绕过（模型外，具名） | (a)+(b) | 恢复位 |
| R2 | 路径断裂 | 全量测试 | AIHR 试点 | 旧路径只读 |
| R3 | 组写权互覆盖 | 两账户写入矩阵 | `2775` + umask 002 | 恢复 775 |
| R4 | 状态库损坏 | `integrity_check` | 先复制 | 指回 |
| R5 | 失去 root 后运维受阻 | 用途分布逐类出口 | 人类执行 / root 定时器 | 临时授权（签字） |
| R6 | 凭据仍可达 | AI 侧 `npm whoami`/`test -S`/`busctl --user` 全失败 | 凭据只在 keys | 无 |
| R7 | 人类读不到产出 | lab 读工作区 | 组读位 | chmod |
| R8 | 启动摩擦 | 试用一周 | 窄 launcher | 去规则 |
| R9 | 迁移中断 | 日志 + df | rename/rsync | 回指 |
| R10 | 旧库 777 | `stat` | 700 | 无 |
| R11 | 供应链：AI 写、人类执行 | 执行区**收窄定义** = `.git/hooks` + `.git/config`（M8/M8b 覆盖）；其余 61 脚本=AI 可写、**R22 具名残余** + 人类执行前确认改动 | 收窄 + 确认 | 恢复属主 |
| R12 | 共享服务跨 uid | 逐端点 | 封闭枚举；写需 token | 关端口 |
| R13 | 凭据交接 | keys 成功 / AI 失败 | agent 仅在 keys 会话 | 无 |
| R14 | AI→人类反向写 | 交叉写探针 | 写区/执行区分离 | 恢复属主 |
| R15 | 经 DB/wiki 内容触达 | 逐服务写权 | 写权归人类/keys | 撤权 |
| R16 | AI 依赖组件以旧身份续跑 | M11 全量清点（含 root 侧） | 迁移/废止+签字 | 恢复 |
| R17 | 复制粘贴通道 | 无机械闸门 | **具名缺口** | — |
| R18 | `/dev/nvidia0` 666 显存残留 | `ls -l` | 保留（必要）；**具名残余** | — |
| R19 | 单元日志含密钥 | 200/2000 行抽样 0 命中（非证明） | 单元过滤 + 0640 | 停用 |
| R20 | 人类自觉性依赖 | 台账审计 | 不以自觉为前提 | — |
| R21 | `/proc/*/cmdline` 跨 uid 可读（argv 内联密钥） | 实测可读 | **具名残余**；建议约定 argv 不含密钥 | hidepid 需评估 |
| R22 | 61 个脚本 AI 可写、人类可能执行 | 改动后 `git status` | 人类执行前确认 | — |

## 8. 评判标准

1. 可机验。2. 消灭病类。3. 代价与回退。4. 摩擦。5. 不留需持续打补丁的授权面。

## 9. 待裁决

- Q1 A / B / C？（v4 评审路线意见：C > A，B 否决）
- Q2 试点 AIHR：基线 1585/73/132s；验收=与基线 pass/fail 集合一致。
- Q3 若选 C：封闭枚举=2 个包装器；`dmesg` 不授予；扩展需签字。

## 10. 禁项

- 不恢复 lab 免密 sudo。不删旧路径于验证前。不放凭据回 AI 可读面。
- sudoers 中不得出现裸 `dmesg` / 裸 `ipmitool`。

## 附录 A：复算命令

```bash
# 非特权 uid 矩阵
sudo useradd -M -N -s /usr/sbin/nologin probe-nonpriv
for c in "journalctl -n 1" "dmesg" "nvidia-smi -L" "systemctl status docker --no-pager" \
         "ipmitool sensor list" "docker ps -q" "head -1 /etc/shadow" "ls /home/lab" \
         "head -c 8 /dev/input/event0"; do
  printf '%-42s ' "$c"; sudo -u probe-nonpriv -H bash -c "$c" >/dev/null 2>&1 && echo OK || echo FAIL; done
sudo -u probe-nonpriv -H python3 -c "import socket;s=socket.socket(socket.AF_UNIX);s.connect('/tmp/.X11-unix/X10');print('CONNECT-OK')"
sudo -u probe-nonpriv -H env DISPLAY=:10 xdpyinfo >/dev/null 2>&1 && echo X-OK || echo X-FAIL
sudo userdel probe-nonpriv && id probe-nonpriv

# /proc 跨 uid
setsid sleep 240 >/dev/null 2>&1 </dev/null & SP=$!
sudo -u probe-nonpriv -H head -c 60 /proc/$SP/cmdline; sudo -u probe-nonpriv -H head -c 1 /proc/$SP/environ
kill $SP

# sudo 密度/分布
sqlite3 'file:/home/lab/.local/share/opencode/opencode.db?mode=ro' "
select count(*) from part where json_extract(data,'\$.tool')='bash';
select count(*) from part where json_extract(data,'\$.tool')='bash'
  and json_extract(data,'\$.state.input.command') like '%sudo%';"

# ptrace
grep -n ptrace_scope /usr/lib/sysctl.d/55-ptrace.conf; ls /usr/lib/systemd/systemd-sysctl
uname -r; sudo sysctl -w kernel.yama.ptrace_scope=0; echo rc=$?; sysctl -n kernel.yama.ptrace_scope

# 作业面
crontab -l | grep -vc '^#'
systemctl list-units --type=service --state=running --no-legend | wc -l
systemctl list-timers --all --no-legend | wc -l
systemctl --user list-units --type=service --state=running --no-legend | wc -l
systemctl --user list-timers --all --no-legend | wc -l
sudo crontab -l | grep -vc '^#'
grep -c 'opencode.db' <(crontab -l)

# 日志切片敏感面（与包装器同参数）
sudo journalctl --no-pager -n 200 -o short-iso -u dsv4-control -u qwen38-control -u llm-monitor \
  -u gpu-fan-control -u vllm-stall-capture | grep -cE 'ghp_|github_pat_|npm_|AKIA|sk-[A-Za-z0-9]{20}|password=|token=|Bearer '

# 执行区与磁盘
find /home/lab/workspace -path '*/.git/hooks/*' -type f ! -name '*.sample'
find /home/lab/workspace -maxdepth 4 \( -name Makefile -o -path '*/scripts/*.sh' \) | wc -l
ss -ltnp | grep -E ':(3000|8000|8002|8010|8080)'; df -h /tmp /home

# rootless podman 前置
grep -c '^abathur:' /etc/subuid /etc/subgid; dpkg -l uidmap | tail -1

# AIHR 基线
du -sh /home/lab/workspace/harness/hr
cd /home/lab/workspace/harness/hr && python3 -m pytest -q --collect-only
cd /home/lab/workspace/harness/hr && /usr/bin/time -f 'WALL=%es' python3 -m pytest -q --ignore=tests/test_bootstrap_properties.py
```

## 附录 B：包装器源码与闸门判据

```bash
#!/bin/sh
# /usr/local/sbin/abathur-journal-slice  (abathur-keys:abathur 0750)
set -eu
PATH=/usr/bin:/bin
exec /usr/bin/journalctl --no-pager -n 200 -o short-iso \
  -u dsv4-control -u qwen38-control -u llm-monitor -u gpu-fan-control -u vllm-stall-capture
```

```bash
#!/bin/sh
# /usr/local/sbin/abathur-sensor-read  (abathur-keys:abathur 0750)
set -eu
PATH=/usr/bin:/bin:/usr/sbin:/sbin
exec /usr/sbin/ipmitool sensor list
```

判据：
1. `sudo -n /usr/local/sbin/abathur-sensor-read --help` → **rc≠0，且输出为 sudo 拒绝信息**（证明空参数钉死生效）。
2. 以 root 直接执行 `abathur-sensor-read --help` → 输出与无参执行一致（证明包装器忽略 `$@`）。
3. `stat -c '%U:%G %a'` = `abathur-keys:abathur 750`；父目录 abathur 不可写。
