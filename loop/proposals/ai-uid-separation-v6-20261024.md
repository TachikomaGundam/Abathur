# 提案 v6：AI 工作账户与人类账户分离（三账户模型）

日期：2026-10-24
状态：待裁决（第六稿；v5 评审对 Q1 的路线意见 = **采用 C**，B 否决；余 12 条闸门细节）
前稿：v1 e5cb → v2 65a7 → v3 3ca0 → v4 c300 → v5 c41d

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
| sudo 密度 | 82,127 次 bash 中 1,333 次含 sudo（1.6%），107 会话 |
| 用途分布 | journalctl/dmesg 166、systemctl 142、root 跑脚本 129、rm/mv/cp 120、`sudo -n` 116、ipmitool 82、docker 77、chown 75、tee 64、nvidia/modprobe 38、apt 17、npm -g 12、防火墙 5、mount 2 |
| **非特权 uid 矩阵**（临时账户建→测→删） | journalctl FAIL、dmesg FAIL、ipmitool FAIL、docker FAIL、`/etc/shadow` FAIL、`/home/lab` FAIL、`/dev/input` FAIL；nvidia-smi OK、`systemctl status` OK |
| **/run/user/1000** | 目录 `drwx------ lab`；probe `ls` FAIL、`busctl --user` FAIL |
| **gpg-agent** | `/run/user/1000/gnupg/S.gpg-agent` 为 `srw------- lab` → 非 lab 不可连 |
| **X11 默认** | `/tmp/.X11-unix/X10` 套接字 `srwxrwxrwx`；`xhost` = access control enabled；probe `xdpyinfo` **FAIL** |
| **X11 cookie 位置实验** | 把 `.Xauthority` 复制到 `/tmp`（644）后 probe `xdpyinfo` **CONNECT-OK** → 边界取决于 cookie 存放位置（副本已删） |
| **/proc 跨 uid** | `cmdline` 可读；`environ` Permission denied |
| sudo env 策略 | `/etc/sudoers:9 Defaults env_reset`；`secure_path` 已设；`env_keep` 全部注释 → `LD_PRELOAD` 不随 sudo 传递 |
| ptrace 活值/来源 | 活值 3；来源=本席 2026-10-24 05:55Z 干跑误写（台账 `556d16387942`）；此后写 0 的 `EINVAL` 是**下调失败**的回执，不解释来源——两件事不矛盾，此前表述含混，此处更正 |
| ptrace 回退 | `/usr/lib/sysctl.d/55-ptrace.conf:22 kernel.yama.ptrace_scope = 1`；`/usr/lib/systemd/systemd-sysctl` 存在 → **重启回 1 目前是推断**，须 M13 重启后实测确认 |
| 日志敏感面 | 6 单元（含 docker）过滤 200 行：0 命中；加深 2000 行：0 命中（非证明） |
| 执行区 | 8 个非样例 hooks；`core.hooksPath` 无自定义；61 个脚本/Makefile |
| 作业面 | lab crontab 8；lab user units 27 running / 4 timer（发行版）；root crontab 0；系统服务 51 / timer 31；**AI 依赖具名 6 个**（dsv4-control、qwen38-control、llm-monitor、gpu-fan-control、vllm-stall-capture、docker） |
| 旧路径引用 | 系统单元中 **1 个**引用 `/home/lab/workspace`（`vllm-stall-capture.service`） |
| 磁盘 | `/` 余 173G；`/tmp` 已用 93G/124G |
| AIHR 基线闭包 | 采集 1658 = 1585 passed + 73 skipped + **0**（`test_bootstrap_properties.py` 采集期即报错，贡献 0 项）；耗时 132s |
| podman 前置 | `/etc/subuid` 无 abathur；`uidmap` 未安装 |

## 3. 根因

一个 uid 三顶帽子。同 uid → ptrace 默认可用、组权限共享、文件权限无法区分人/AI。三条内部收权路径均不成立（实测支撑）。

## 4. 方案

### A：三账户分离（无授权面）
- `abathur`（非 root、无 sudo、不进特权组）；`abathur-keys`（凭据持有，密码锁死）。
- 工作区 `/srv/workspace`（`root:dev 2775`）。
- 启动：`/usr/local/bin/abathur-shell`（M16，属主 root、父目录 abathur 不可写、内钉冻结入口与 `env -i`）。
- sudoers：`lab ALL=(abathur) NOPASSWD: /usr/local/bin/abathur-shell`；人类保留带密码 sudo（`/etc/sudoers:53 %sudo ALL=(ALL:ALL) ALL`）。
- 日志：root 定时器把 6 个 AI 单元的切片写入 `/var/log/abathur/journal-slice.log`（0640 root:abathur）。
- 残余（具名）：R17 复制粘贴、R18 GPU 666、R19/A 日志切片含密钥（与 C 同一暴露面，标准对称）、R21 cmdline、R22 脚本可写、R23 X cookie 位置。

### B：`lab` 内收权
- 删 NOPASSWD、退组、`ptrace_scope=3`、工作区 750。
- 失效：同 uid 无法拆分；同 uid ptrace 只能靠不可回退的 3；`/run/user/1000` 同 uid 可读。**不构成边界。否决。**

### C：A + 两个钉死 argv 的包装器（评审路线意见）
- **单一来源**：选 C 不部署 A 的 root 定时器；日志由包装器提供。
- 规则（空参数钉死）：
  ```
  abathur ALL=(root) NOPASSWD: /usr/local/sbin/abathur-journal-slice ""
  abathur ALL=(root) NOPASSWD: /usr/local/sbin/abathur-sensor-read ""
  ```
- 包装器：`env -i` 清洗环境；属主 keys `0750`；父目录 root；不读 `$@`；固定 `PATH`。
- `journal-slice` 固定 6 单元（含 docker.service）+ `-n 200`。
- `dmesg` 不授予（`-C` 清环=灭证）。
- 部署前后置门：`visudo -cf /etc/sudoers.d/abathur` rc=0 才落盘。

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
| M10 | 状态库 777→700（在 M11 后） | `stat` | 恢复 |
| M12 | 磁盘（38G 双份；余 173G） | `df` | 清副本 |
| M13 | 重启后实测 `sysctl -n kernel.yama.ptrace_scope`（当前"回 1"为推断） | 重启后回执入台账 | 无 |
| M14 | 引擎源码/dist 属主 root/keys；**lab 读取失败**（`head -c1 rc≠0`） | 读位测试 | 恢复位 |
| M15 | 包装器属主 keys `0750`；父目录 root；`visudo -cf` 前置；负测试=`sudo -n <wrapper> --help` **rc≠0 且为 sudo 拒绝**；另以 root 直接带参执行验证忽略 `$@`；`LD_PRELOAD` 负测试 | `sudo -l` 回显 + `stat` + 三负测试 | 恢复位 |
| M16 | `abathur-shell` 属主 root、父目录 abathur 不可写、内钉冻结入口与 `env -i` | `stat`；启动后 `ps -o user=` | 恢复位 |

## 7. 风险表

| # | 风险 | 探针/闸门 | 缓解 | 回滚 |
|---|---|---|---|---|
| R1 | 人类在 lab 起 AI | (a) lab 读源码/dist **失败**；(b) `run_registry` 记 uid；(c) 人类故意绕过（模型外） | (a)+(b) | 恢复位 |
| R2 | 路径断裂 | 全量测试 | AIHR 试点 | 旧路径只读 |
| R3 | 组写权互覆盖 | 两账户写矩阵 | 2775 + umask 002 | 恢复 775 |
| R4 | 状态库损坏 | integrity_check | 先复制 | 指回 |
| R5 | 无 root 运维受阻 | 用途分布逐类出口 | 人类执行 / root 定时器 | 临时授权（签字） |
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
| R19 | 日志切片含密钥（A/C 同面） | 200/2000 行抽样 0 命中（非证明） | 单元过滤 + 0640 | 停用 |
| R20 | 人类自觉性 | 台账审计 | 不以自觉为前提 | — |
| R21 | `/proc/*/cmdline` 可读 | 实测可读 | **具名残余**；约定 argv 不含密钥 | hidepid 待评估 |
| R22 | 61 脚本 AI 可写、人类可能执行 | 改动后 `git status` | 人类执行前确认 | — |
| R23 | **人类会话 `xhost +` 或 cookie 落入共享面即重开键盘通道**（实验：cookie 644 时 probe CONNECT-OK） | `xhost` 状态；cookie 位置 `stat` | **规定 cookie 只存 lab/keys 侧**；M 验收含 `xhost` 负探针 | 关闭 xhost |
| R24 | 迁移窗口旧路径静默失败 | M1b 逐任务 EACCES 探测 | 先处置再切换 | 恢复指向 |

## 8. 评判标准

1. 可机验。2. 消灭病类。3. 代价与回退。4. 摩擦。5. 不留需持续打补丁的授权面。

## 9. 待裁决

- Q1 A / B / C（评审路线意见：C，B 否决）。
- Q2 试点 AIHR：基线闭包 1658 = 1585+73+0；验收=与基线集合一致。
- Q3 若选 C：封闭枚举 2 个包装器；`dmesg` 不授予；扩展需签字。

## 10. 禁项

- 不恢复 lab 免密 sudo；不删旧路径于验证前；不放凭据回 AI 可读面；sudoers 不得出现裸 `dmesg`/`ipmitool`；不把 `.Xauthority` 放进共享面。

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

# ptrace
grep -n ptrace_scope /usr/lib/sysctl.d/55-ptrace.conf; ls /usr/lib/systemd/systemd-sysctl
sudo sysctl -w kernel.yama.ptrace_scope=0; echo rc=$?; sysctl -n kernel.yama.ptrace_scope

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

# AIHR 基线（闭包：1658=1585+73+0）
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
# /usr/local/bin/abathur-shell  (root:root 0755; 父目录 abathur 不可写)
set -eu
exec /usr/bin/sudo -u abathur -H env -i HOME=/home/abathur TERM="${TERM:-xterm}" \
  /usr/local/lib/abathur/current/bin/abathur-console
```

判据：
1. `sudo -n /usr/local/sbin/abathur-sensor-read --help` → rc≠0，输出为 sudo 拒绝（空参数钉死生效）。
2. root 直接执行 `abathur-sensor-read --help` → 与无参输出一致（忽略 `$@`）。
3. `LD_PRELOAD=/tmp/x.so` 经 sudo 调包装器 → 不生效（`env_reset` + `env -i` 双保险）。
4. `stat -c '%U:%G %a'` = `abathur-keys:abathur 750`；父目录 abathur 不可写。
5. `visudo -cf /etc/sudoers.d/abathur` = rc 0（落盘前置门）。
