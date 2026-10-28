# 提案 v2：AI 工作账户与人类账户分离（三账户模型）

日期：2026-10-24
状态：待裁决（第二稿，吸收首轮评审 20 条必改项）
前稿：loop/proposals/ai-uid-separation-20261024.md（首轮 REJECT 1A/2R，票面 sibyl-20261024T081728Z-e5cb）

## 1. 一句话问题

人类与 AI 共用 Unix 账户 `lab`，任何"在 lab 内部收权"的措施都无法建立边界；是否应把 AI 迁移到独立非 root 账户。

## 2. 机器实测（全部可复算；命令见附录 A）

| 事实 | 输出 |
|---|---|
| 内核 | `7.0.0-30-generic` |
| AI 与人类同 uid | `uid=1000(lab) gid=1000(lab)`，组：sudo, docker, lxd, input, adm, video, render, plugdev |
| docker 组 = root 等价 | 直接 `head -1 /etc/shadow` → Permission denied；经容器 → `root hashlen=1` |
| docker 套接字 | `srw-rw---- root:docker /var/run/docker.sock` |
| input 组 = 键盘可读 | `/dev/input/event*` 为 `crw-rw---- root:input` |
| render 组 | `/dev/dri/renderD128` 为 `crw-rw---- root:render` |
| nvidia 设备 | `/dev/nvidia0` 为 `crw-rw-rw-`（无需组） |
| lxd | 无运行时目录（本机无用） |
| SSH agent | `SSH_AUTH_SOCK=/home/lab/.ssh/agent/s.*`（人类会话内） |
| 人类会话总线 | `/run/user/1000/` 含 bus、keyring、gcr、gnupg |
| 人类家目录 | `750 lab:lab`（唯一有效边界） |
| 工作区 | `/home/lab/workspace` `775 lab:lab`，38G |
| OpenCode 状态库 | `777`，8.2G |
| sudo 密度 | 82,127 次 bash 调用中 1,333 次含 sudo（1.6%），涉及 107 会话 |
| sudo 用途 | journalctl/dmesg 166、systemctl 142、root 跑脚本 129、rm/mv/cp 120、`sudo -n` 116、ipmitool 82、docker 77、chown 75、tee 写配置 64、nvidia/modprobe 38、apt 17、npm -g 12、防火墙 5、mount 2 |
| 免 sudo 实测（allowlist 候选） | journalctl OK、nvidia-smi OK、`systemctl status` OK；dmesg FAIL、ipmitool FAIL；podman 未安装 |
| ptrace 棘轮复现 | `sysctl -w kernel.yama.ptrace_scope=0` → `Invalid argument`；读回 `3`；恢复写 `3` 后仍 `3` |
| 人类会执行而 AI 可写 | `.git/hooks/pre-push` `775 lab`；`scripts/*.sh` `664-775 lab` |
| 共享服务 | 监听 3000（wiki）、8080、8000、8002、8010（消毒代理），本机任意用户可达 |
| AIHR 试点对象 | 2.0G；`pytest --collect-only` → 1658 tests collected，1 error（`tests/test_bootstrap_properties.py`），采集 4.48s；全量运行耗时未测 |

## 3. 根因

一个 uid 同时承载三种角色：人类操作者、AI 执行体、外写凭据持有者。同 uid 意味着同 uid 进程可互相 ptrace（Yama 1 的默认面）、组权限对双方同时生效、文件权限无法区分"人类读"与"AI 读"。

在 `lab` 内收权的三条路径均不成立：
1. 删 NOPASSWD：docker 组仍 root 等价（已实测）。
2. 移出特权组：人类自己要用；且同 uid ptrace 与 `/proc/<pid>/mem` 仍在。
3. `ptrace_scope=3`：input 组仍可键盘记录；该值不可回退（已复现），代价是全机失去调试能力。

## 4. 候选方案

### 方案 A：三账户分离
- 动作：新建 `abathur`（AI 工作账户：非 root、无 sudo、不进特权组）+ `abathur-keys`（凭据持有，人类以 `sudo -u` 进入）；工作区移出 `/home/lab`（`/srv/workspace`，组 `dev` 共享）；OpenCode 配置与状态库迁入 `abathur` 家；人类以 `sudo -iu abathur` 启动 AI。
- 收益：边界由 uid 决定；**跨 uid ptrace 由 uid 检查直接拒绝，与 `ptrace_scope` 取值无关**（当前值 3 是事故遗留，任何方案下都只能靠重启回退，重启列为迁移步骤）；docker/input/adm 对 AI 天然不可用。
- 代价：一次性迁移 38G + 8.2G + 配置；启动方式改变；AI 失去读人类家目录与 SSH agent 的能力；docker 需替代路径。
- 失效模式：人类仍在 `lab` 启动 AI（本稿给出机械闸门，见 R1）；迁移后绝对路径断裂；共享组写权限配置错误。

### 方案 B：`lab` 内收权
- 动作：删 NOPASSWD；AI 退出 docker/lxd/input/adm；`ptrace_scope=3`；工作区 750。
- 收益：迁移零成本。
- 失效：同 uid 无法同时满足"人类用 docker、AI 不用"；同 uid ptrace 只能靠 3（不可回退）；文件权限无法区分人/AI；浏览器配置、SSH agent、keyring 仍可读（`/run/user/1000` 与 `SSH_AUTH_SOCK` 均在人类会话内但同 uid 可达）。
- 判断：不构成边界，只降低单点风险。

### 方案 C：A + 只读诊断 allowlist
- 动作：同 A；另给 `abathur` 一条窄 sudoers 规则。
- 实测依据：允许清单只需覆盖 **dmesg 与 ipmitool** 两项——journalctl、nvidia-smi、`systemctl status` 在无 sudo 下已可用（本机实测）。166 次 journalctl/dmesg 调用中，journalctl 部分无需授权；142 次 systemctl 中只读部分也无需授权。
- 收益：保留 dmesg/风扇诊断能力，减少人类被叫去跑命令的频率。
- 代价：多一条长期授权面；dmesg 输出可能含敏感信息。
- 失效模式：allowlist 扩张失控（历史上 NOPASSWD 就是这样来的）→ 需封闭枚举 + 扩展需人类签字。

## 5. P0 前置：AI 现有能力的逐项处置（迁移前必须完成）

| 能力 | 来源 | 探针 | 处置 |
|---|---|---|---|
| root（免密 sudo） | sudo 组 + `/etc/sudoers.d/lab-nopasswd` | `sudo -n true` | drop |
| docker（root 等价） | docker 组 | `docker ps` | drop；替代：rootless podman（需一次 root 安装）或人类代跑 |
| 键盘读取 | input 组 | `cat /dev/input/event0` | drop |
| 全量日志 | adm 组 | `journalctl -n1` | drop（AI 失去 journalctl；如需读日志，由 root 侧定时导出到可读文件） |
| GPU render | render 组 | `ls -l /dev/dri/renderD128` | drop（AI 侧无实测需求；nvidia-smi 免组可用） |
| GPU 设备 | 设备位 666 | `nvidia-smi -L` | 无需组，保留 |
| lxd | lxd 组 | 无运行时目录 | drop |
| USB/串口 | plugdev | — | drop |
| SSH agent | `SSH_AUTH_SOCK` 在 `/home/lab` | 迁移后 `test -S` 应失败 | 天然隔离（家目录 750） |
| keyring/会话总线 | `/run/user/1000` | 迁移后 `busctl --user` 应失败 | 天然隔离（不同 uid） |
| 共享服务写权 | 3000/8000/8002/8010 | `curl -s -m2 localhost:<port>` | 逐服务裁决：读允许、写需 token；token 只在 `abathur-keys` |

## 6. 迁移清单（每项含探针与回滚）

| # | 项 | 探针 | 回滚 |
|---|---|---|---|
| M1 | 工作区 38G 移出 `/home/lab` | `stat -c '%U:%G %a'` + 全量测试 | 保留旧路径只读 |
| M2 | 状态库 8.2G 迁移 | 迁移前后 `sha256sum` + `PRAGMA integrity_check` | 指回原库 |
| M3 | `~/.config/opencode` 迁移 | `opencode --version` + 一次会话 | 复制回 |
| M4 | `~/.sibyl` 迁移 | 一次 consult | 复制回 |
| M5 | 启动方式 | `ps -o user= -p <pid>` 应为 abathur | 无（不迁即原状） |
| M6 | docker 替代 | rootless podman 或人类代跑，逐用例 | 临时加回 docker 组（记入台账） |
| M7 | 共享服务接线（opencode.jsonc baseURL、消毒代理、wiki token） | 迁移后逐端点连通性 + 写权限负探针 | 恢复原配置 |
| M8 | git 共享树与 `.git/hooks` | 属主/权限矩阵 | 恢复属主 |
| M9 | 人类读取 AI 产出 | 以 `lab` 读工作区 | 临时 chmod |
| M10 | 权限收紧（状态库 777→700） | `stat -c '%a'` | 恢复 |

## 7. 风险表（含机械闸门）

| # | 风险 | 探针 | 缓解 | 回滚 |
|---|---|---|---|---|
| R1 | 人类仍在 `lab` 启动 AI，迁移作废 | **机械**：`opencode` 二进制改为 `abathur` 属主 `750`，`lab` 无法执行；启动仅经 `sudo -u abathur`（窄规则）；台账记录每次会话属主 | 二选一实现 | 恢复可执行位 |
| R2 | 迁移后绝对路径断裂 | 全量测试 | 先 AIHR 试点 | 旧路径只读 |
| R3 | 共享组写权互相覆盖 | 两账户各建文件比对属主 | `2775` + umask 002 | 恢复 775 |
| R4 | 状态库迁移损坏 | `integrity_check` | 先复制后切换 | 指回原库 |
| R5 | AI 失去 root 后运维受阻 | 对照用途分布逐类出口 | 人类执行 / root 侧定时器产出状态文件 | 临时窄授权（签字） |
| R6 | 凭据仍在 AI 可达面 | AI 侧 `npm whoami` 失败、`SSH_AUTH_SOCK` 不存在、`/run/user/1000` 不可达、浏览器配置不可读 | 凭据只放 `abathur-keys`；agent 由 keyuser 自己启动 | 无（目标态） |
| R7 | 人类读不到 AI 产出 | `lab` 读工作区文件 | 共享组读位 | 临时 chmod |
| R8 | 启动摩擦 | 试用一周 | 窄 launcher 规则（**明确允许**：`lab ALL=(abathur) NOPASSWD: /usr/local/bin/abathur-shell`），不授予任何 root 命令 | 去掉规则 |
| R9 | 迁移中断 | 迁移日志 | 同 FS rename 或 rsync --checksum | 回指 |
| R10 | 旧库 777 可被任意本机账户写 | `stat -c '%a'` | 迁后 700 | 无 |
| R11 | **供应链污染**：AI 可写人类将执行的文件（`.git/hooks/pre-push` 775、`scripts/*.sh` 664） | 属主/权限矩阵 + 改动后 `git status` | 执行区（hooks、发布脚本、Makefile）归 `abathur-keys` 或人类只写，AI 只读 | 恢复属主 |
| R12 | 共享服务跨 uid 触达（3000/8000/8002/8010） | 迁移后以 `abathur` 逐端点探测 | 逐服务封闭枚举：读允许、写需 token | 关端口/改绑定 |
| R13 | 凭据交接设计缺失（agent socket、token 生命周期） | `ssh-add -l`、`npm whoami` 在 AI 侧必败、keyuser 侧必成 | agent 只在 keyuser 会话启动；token 不落 AI 可写面 | 无 |
| R14 | AI→人类反向写入（共享区 AI 写、人类跑） | 交叉写探针 | 写区/执行区分离 | 恢复属主 |
| R15 | 迁移后 AI 仍可能经数据库/wiki 内容触达人类 | 逐服务写权探针 | 写权归人类或 keyuser | 撤权 |

## 8. 评判标准

1. 安全收益可机验（给出"AI 做不到 X"的失败回执）。
2. 消灭病类而非压症状。
3. 迁移代价与可回退性。
4. 日常摩擦。
5. 是否留下需持续打补丁的授权面。

## 9. 待裁决问题

- Q1 选 A、B 还是 C？
- Q2 试点仓选 AIHR 是否合适：实测 2.0G、1658 个测试可采集、1 个采集错误（`test_bootstrap_properties.py`）；**全量耗时未测，属不可判定项**，试点前先测一次。
- Q3 若选 C，allowlist 初始封闭枚举 = `dmesg`、`ipmitool sensor list`；扩展需人类签字并入台账。

## 10. 禁项

- 不允许以"临时放宽"为由恢复 `lab` 免密 sudo（R8 的 launcher 规则只允许切换到 `abathur`，不允许 root 命令）。
- 不允许在迁移未验证前删除旧路径。
- 不允许把凭据放回 AI 可读账户。

## 附录 A：可复算命令

```bash
# sudo 密度与分布（只读）
sqlite3 'file:/home/lab/.local/share/opencode/opencode.db?mode=ro' "
select count(*) from part where json_extract(data,'\$.tool')='bash';
select count(*) from part where json_extract(data,'\$.tool')='bash'
  and json_extract(data,'\$.state.input.command') like '%sudo%';"

# 组与设备
id lab; ls -l /var/run/docker.sock /dev/input/event0 /dev/dri/renderD128 /dev/nvidia0
# docker root 等价
head -1 /etc/shadow
docker run --rm -v /etc/shadow:/h/shadow:ro --entrypoint awk <本地镜像> -F: 'NR==1{print $1, length($2)}' /h/shadow
# ptrace 棘轮
uname -r; sudo sysctl -w kernel.yama.ptrace_scope=0; sysctl -n kernel.yama.ptrace_scope
# allowlist 无 sudo 实测
journalctl -n 1 --no-pager; dmesg; nvidia-smi -L; systemctl status docker --no-pager; ipmitool sensor list
# 共享服务
ss -ltnp | grep -E ':(3000|8000|8002|8010|8080)'
# AIHR 试点探针
du -sh /home/lab/workspace/harness/hr
cd /home/lab/workspace/harness/hr && python3 -m pytest -q --collect-only
```
