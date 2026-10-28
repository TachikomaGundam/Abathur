# 提案 v3：AI 工作账户与人类账户分离（三账户模型）

日期：2026-10-24
状态：待裁决（第三稿，吸收两轮评审共 40 条必改项）
前稿：v1（REJECT 1A/2R，sibyl-20261024T081728Z-e5cb）、v2（REJECT 0A/3R，sibyl-20261024T082157Z-65a7）

## 0. 威胁模型（先定边界，否则"闸门"无从谈起）

- 威胁主体 = AI（以 `abathur` 身份运行）。目标 = 阻止 AI **自主或隐蔽地**取得人类权限、凭据、键盘输入、进程内存。
- 人类**有意**在 `lab` 里手动执行任何命令，不属本模型的防御目标（人类是持钥方）。因此凡"人类故意绕过"的路径只记为残余，不声称关闭。
- 推论：机械闸门只需保证「AI 不能自行解除限制」；「人类可以主动解除」是设计内。

## 1. 一句话问题

人类与 AI 共用 Unix 账户 `lab`，任何"在 lab 内部收权"的措施都无法建立边界；是否应把 AI 迁移到独立非 root 账户。

## 2. 机器实测（命令见附录 A）

| 事实 | 输出 |
|---|---|
| 内核 | `7.0.0-30-generic` |
| AI 与人类同 uid | `uid=1000(lab)`；组：sudo, docker, lxd, input, adm, video, render, plugdev |
| docker 组 = root 等价 | 直接读 `/etc/shadow` → Permission denied；经容器 → `root hashlen=1` |
| input 组 | `/dev/input/event*` = `crw-rw---- root:input` |
| render 组 | `/dev/dri/renderD128` = `crw-rw---- root:render` |
| nvidia 设备 | `/dev/nvidia0` = `crw-rw-rw-`（无需组） |
| lxd | 无运行时目录 |
| SSH agent | `SSH_AUTH_SOCK=/home/lab/.ssh/agent/s.*`；`/run/user/1000` 含 bus/keyring/gcr/gnupg |
| 人类家目录 | `750`（唯一有效边界） |
| 工作区 | `775`，38G |
| 状态库 | `777`，8.2G |
| sudo 密度 | 82,127 次 bash 调用中 1,333 次含 sudo（1.6%），107 会话 |
| 用途分布 | journalctl/dmesg 166、systemctl 142、root 跑脚本 129、rm/mv/cp 120、`sudo -n` 116、ipmitool 82、docker 77、chown 75、tee 写配置 64、nvidia/modprobe 38、apt 17、npm -g 12、防火墙 5、mount 2（单命令可落多类，故合计大于 1,333） |
| **非特权 uid 实测**（临时账户 `probe-nonpriv`，建→测→删） | journalctl **FAIL**、dmesg FAIL、ipmitool FAIL、docker FAIL、`/etc/shadow` FAIL、`/home/lab` FAIL、`/dev/input` FAIL；nvidia-smi **OK**、`systemctl status` **OK** |
| ptrace 棘轮复现 | 写 0 → `Invalid argument`；读回 3；恢复写 3 后仍 3 |
| 人类会执行而 AI 可写 | 8 个非样例 `.git/hooks`（Abathur/Sibyl/border/VideoGen/opencode-historian）；`core.hooksPath` 无自定义；61 个 Makefile/脚本 |
| lab 定时任务（AI 依赖组件以人类身份运行） | 消毒代理看门狗（5 分钟）、vLLM freeze capture、border drift watch、锚链校验、plain-watch、historian 清理、AIHR step6-watch 等 8 条 |
| 磁盘 | `/` 余 173G；`/tmp` 124G 中已用 93G |
| AIHR 试点 | 2.0G；`pytest --collect-only` = 1658 tests，1 error（`tests/test_bootstrap_properties.py`），采集 4.48s；全量耗时未测 |

## 3. 根因

一个 uid 同时承载三种角色：人类、AI、外写凭据持有者。同 uid → 同 uid ptrace 默认可用、组权限对双方同时生效、文件权限无法区分人/AI。

在 `lab` 内收权三条路径均不成立：①删 NOPASSWD 后 docker 组仍 root 等价（实测）；②移出特权组则人类自己不能用，且同 uid ptrace 仍在；③`ptrace_scope=3` 挡不住 input 组键盘读取，且不可回退（已复现）。

## 4. 候选方案

### 方案 A：三账户分离（无 allowlist）
- 动作：新建 `abathur`（非 root、无 sudo、不进特权组）+ `abathur-keys`（凭据持有）；工作区移出 `/home/lab`；配置/状态库迁入 `abathur` 家；人类以 `sudo -iu abathur` 启动 AI；root 侧定时器导出日志切片供 AI 只读。
- 收益：边界由 uid 决定；**跨 uid ptrace 由 uid 检查拒绝，与 `ptrace_scope` 取值无关**（当前 3 是事故遗留，任何方案下都只能重启回退，重启列为迁移步骤）。
- 代价：38G+8.2G 迁移；启动方式改变；AI 失去人类家目录、agent、keyring、docker、journal、input、BMC 能力。
- 失效模式：人类仍在 lab 起 AI（见 R1 分级）；路径断裂；共享组写权错配。

### 方案 B：`lab` 内收权
- 动作：删 NOPASSWD、退组、`ptrace_scope=3`、工作区 750。
- 收益：零迁移。
- 失效：同 uid 无法"人类用 docker、AI 不用"；同 uid ptrace 只能靠 3（不可回退）；`/run/user/1000`、`SSH_AUTH_SOCK`、浏览器配置同 uid 可读。
- 判断：不构成边界。

### 方案 C：A + 两条钉死 argv 的包装器
- 依据（非特权 uid 实测）：迁移后 `journalctl`/`dmesg`/`ipmitool` 全部失败，`nvidia-smi`/`systemctl status` 免授权可用。
- 动作：在 A 基础上，由 `abathur-keys` 拥有两个包装脚本，sudoers 只允许这两个**绝对路径**：
  - `abathur-journal-slice`：`journalctl --no-pager -n 200 -o short-iso`（无参数透传）
  - `abathur-sensor-read`：`ipmitool sensor list`（无参数透传）
  - `dmesg` **不授予**（`sudo dmesg -C` 可清空环形缓冲=毁灭证据），改由 root 侧定时器导出快照到 AI 可读文件。
- 收益：保留诊断能力，不暴露裸命令的破坏性参数。
- 代价：两条长期授权面 + 两个包装器维护。
- 失效模式：包装器被改（属主 keys、AI 只读，可机验）；包装器内部参数扩张（需签字）。

## 5. P0：AI 现有能力逐项处置

| 能力 | 来源 | 探针 | 处置 |
|---|---|---|---|
| root | sudo 组 + NOPASSWD 文件 | `sudo -n true` | drop（**排在全部迁移项验证之后**，见 M0） |
| docker | docker 组 | `docker ps` | drop；替代：rootless podman（需一次 root 安装）或人类代跑 |
| 键盘读取 | input 组 | `head -c 8 /dev/input/event0` | drop |
| 全量日志 | adm 组 | `journalctl -n1` | drop；替代：root 定时器导出日志切片 |
| GPU render | render 组 | `ls -l /dev/dri/renderD128` | **暂 drop、按需恢复**（恢复：`gpasswd -a abathur render` + 重测；"无实测需求"不等于无需求） |
| GPU 设备 | 设备位 666 | `nvidia-smi -L` | 保留（无需组） |
| lxd | lxd 组 | 无运行时目录 | 暂 drop、按需恢复 |
| USB/串口 | plugdev | — | 暂 drop、按需恢复 |
| SSH agent | `/home/lab` 内 socket | 迁移后 `test -S` 失败 | 天然隔离 |
| keyring/会话总线 | `/run/user/1000` | 迁移后 `busctl --user` 失败 | 天然隔离 |
| 共享服务 | 3000/8000/8002/8010 | `curl -s -m2 localhost:<port>` | 逐服务裁决，见 R12（读权限按 L-ENV-SEGREGATION：wiki `_sandbox` 不得作证据、`_meta`/`_evidence` 限制读） |

## 6. 迁移清单

| # | 项 | 探针 | 回滚 |
|---|---|---|---|
| M0 | **人类密码 sudo 可用性 + 控制台恢复预案**（收权前必须由人类在终端实测 `sudo -k; sudo true`，并确认物理/带外登录可用） | 人类回执 | 不执行收权 |
| M1 | 工作区 38G 移出 `/home/lab` | `stat` + 全量测试 | 旧路径只读 |
| M2 | 状态库迁移（**先 quiesce**：`run_registry.py status` 须 FREE，且 `PRAGMA integrity_check`） | sha256 + integrity_check | 指回原库 |
| M3 | `~/.config/opencode` 迁移 | 一次会话 | 复制回 |
| M4 | `~/.sibyl` 迁移 | 一次 consult | 复制回 |
| M5 | 启动方式 | `ps -o user= -p <pid>` = abathur | 不迁即原状 |
| M6 | docker 替代 | 逐用例 | 临时加回组（台账） |
| M7 | 共享服务接线（baseURL/消毒代理/wiki token） | 逐端点连通 + 写权负探针 | 恢复配置 |
| M8 | git hooks 与共享树属主 | 权限矩阵 | 恢复属主 |
| M9 | 人类读取 AI 产出 | `lab` 读工作区 | 临时 chmod |
| M10 | 状态库权限 777→700 | `stat` | 恢复 |
| M11 | **lab 的 8 条定时任务逐条处置**（迁到 abathur 的 crontab、或改 root 服务、或废止） | `crontab -l` 逐条比对 | 恢复 crontab |
| M12 | 磁盘余量（38G 双份 + 8.2G） | `df`（当前余 173G，够） | 清副本 |
| M13 | 重启恢复 `ptrace_scope`（若需要回到 1） | `sysctl -n` | 无 |
| M14 | 引擎二进制属主（root 或 keys，`750`，组 abathur；父目录 abathur 不可写） | `stat` + 以 lab 执行应失败 | 恢复位 |

## 7. 风险表

| # | 风险 | 探针/闸门 | 缓解 | 回滚 |
|---|---|---|---|---|
| R1 | 人类在 `lab` 启动 AI | **分级**：(a) 机械段=引擎二进制与 dist 属主 root/keys、`750`、组 abathur——AI 可执行不可改；lab 执行失败（附 rc）；(b) 审计段=`run_registry` 记录 uid（每条 run 一行，可用 `ps -o user=` 复核）；(c) 残余=lab 可读源码并自行 `node dist/cli.js`（**人类故意绕过，威胁模型外，明文记入缺口**） | 二段合取 | 恢复可执行位 |
| R2 | 路径断裂 | 全量测试 | AIHR 试点先行 | 旧路径只读 |
| R3 | 共享组写权互相覆盖 | 两账户各建文件比对 | `2775` + umask 002 | 恢复 775 |
| R4 | 状态库迁移损坏 | `integrity_check` | 先复制后切换 | 指回原库 |
| R5 | 失去 root 后运维受阻 | 对照用途分布逐类出口 | 人类执行 / root 定时器产出状态文件 | 临时授权（签字） |
| R6 | 凭据仍在 AI 可达面 | AI 侧 `npm whoami` 失败、`test -S $SSH_AUTH_SOCK` 失败、`busctl --user` 失败 | 凭据只在 keys | 无（目标态） |
| R7 | 人类读不到 AI 产出 | `lab` 读工作区 | 共享组读位 | 临时 chmod |
| R8 | 启动摩擦 | 试用一周 | 窄 launcher 规则（`lab ALL=(abathur) NOPASSWD: /usr/local/bin/abathur-shell`，不含任何 root 命令） | 去规则 |
| R9 | 迁移中断 | 日志 + `df` | 同 FS rename 或 rsync --checksum | 回指 |
| R10 | 旧库 777 | `stat` | 迁后 700 | 无 |
| R11 | **供应链污染**：AI 可写人类将执行的文件 | 机器清单：8 个 `.git/hooks`、`core.hooksPath`（无自定义）、61 个脚本/Makefile；改动后 `git status` | 执行区（hooks、发布脚本）归 keys/人类只写，AI 只读 | 恢复属主 |
| R12 | 共享服务跨 uid 触达 | 迁移后逐端点 `curl` | 逐服务封闭枚举：读按 L-ENV-SEGREGATION；写需 token | 关端口/改绑定 |
| R13 | 凭据交接缺失 | keyuser 侧 `ssh-add -l`/`npm whoami` 成功、AI 侧失败 | agent 只在 keyuser 会话启动 | 无 |
| R14 | AI→人类反向写入 | 交叉写探针（AI 写、lab 读执行） | 写区/执行区分离 | 恢复属主 |
| R15 | 经数据库/wiki 内容触达 | 逐服务写权探针 | 写权归人类/keys | 撤权 |
| R16 | **AI 依赖组件以人类身份续跑**（lab crontab 8 条） | M11 逐条比对 | 迁移或废止，逐条签字 | 恢复 crontab |
| R17 | 人类复制粘贴通道 | 无机械闸门 | **明文缺口**：不做声称 | — |

## 8. 评判标准

1. 安全收益可机验（失败回执）。
2. 消灭病类而非压症状。
3. 迁移代价与可回退性。
4. 日常摩擦。
5. 不留下需持续打补丁的授权面。

## 9. 待裁决问题

- Q1 选 A、B、C？
- Q2 试点仓 AIHR：实测 2.0G、1658 测试可采集、1 个**既有**采集错误（`test_bootstrap_properties.py`）；全量耗时未测。**验收判据 = 与迁移前基线 pass/fail 集合一致**（不是"全绿"，既有错误不因迁移而消失）。
- Q3 若选 C：初始封闭枚举 = 两个包装器（journal 切片、sensor list 只读）；`dmesg` 不授予；扩展需人类签字入台账。

## 10. 禁项

- 不得恢复 `lab` 免密 sudo（R8 的 launcher 规则只允许切换到 abathur）。
- 不得在迁移验证前删除旧路径。
- 不得把凭据放回 AI 可读账户。
- 不得在 sudoers 中出现裸 `dmesg` / 裸 `ipmitool` 规则。

## 附录 A：可复算命令

```bash
# 非特权 uid 实测（迁移后真实身份；临时账户建→测→删）
sudo useradd -M -N -s /usr/sbin/nologin probe-nonpriv
for c in "journalctl -n 1" "dmesg" "nvidia-smi -L" "systemctl status docker --no-pager" \
         "ipmitool sensor list" "docker ps -q" "head -1 /etc/shadow" "ls /home/lab" \
         "head -c 8 /dev/input/event0"; do
  printf '%-42s ' "$c"; sudo -u probe-nonpriv -H bash -c "$c" >/dev/null 2>&1 && echo OK || echo FAIL; done
sudo userdel probe-nonpriv && id probe-nonpriv   # 期望 "no such user"

# sudo 密度与分布（只读）
sqlite3 'file:/home/lab/.local/share/opencode/opencode.db?mode=ro' "
select count(*) from part where json_extract(data,'\$.tool')='bash';
select count(*) from part where json_extract(data,'\$.tool')='bash'
  and json_extract(data,'\$.state.input.command') like '%sudo%';"
# 分布：同一谓词 + 逐类 LIKE（template）
sqlite3 'file:/home/lab/.local/share/opencode/opencode.db?mode=ro' "
with c as (select json_extract(data,'\$.state.input.command') cmd from part
           where json_extract(data,'\$.tool')='bash' and json_extract(data,'\$.state.input.command') like '%sudo%')
select 'journalctl/dmesg',count(*) from c where cmd like '%sudo journalctl%' or cmd like '%sudo dmesg%'
union all select 'systemctl',count(*) from c where cmd like '%sudo systemctl%';"

# 组与设备
id lab; ls -l /var/run/docker.sock /dev/input/event0 /dev/dri/renderD128 /dev/nvidia0
# docker root 等价
head -1 /etc/shadow
docker run --rm -v /etc/shadow:/h/shadow:ro --entrypoint awk <本地镜像> -F: 'NR==1{print $1, length($2)}' /h/shadow
# ptrace 棘轮
uname -r; sudo sysctl -w kernel.yama.ptrace_scope=0; sysctl -n kernel.yama.ptrace_scope
# 文件面与定时任务
find /home/lab/workspace -path '*/.git/hooks/*' -type f ! -name '*.sample'
find /home/lab/workspace -maxdepth 4 \( -name Makefile -o -path '*/scripts/*.sh' \) | wc -l
crontab -l; systemctl --user list-units --type=service --state=running
# 共享服务与磁盘
ss -ltnp | grep -E ':(3000|8000|8002|8010|8080)'; df -h /tmp /home
# AIHR 试点
du -sh /home/lab/workspace/harness/hr; cd /home/lab/workspace/harness/hr && python3 -m pytest -q --collect-only
```
