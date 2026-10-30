# 沙箱重建方案 v6（吸收 e978 庭 15 条；补「具名残余」并为验收加正向对照）

## 0. 目标口径（先定，避免再被问「你到底承诺什么」）

**hard 形态的承诺 = 隔离执行 + 可检测，不是机密性边界。**

- 能挡：事故、误操作、跨 line 波及、明文秘密读取、外部网络自由出站
- 不能挡（具名残余，§9）：同 uid 写工作区后由宿主执行的洗白、经已授权端点的隐写出站、内核漏洞、检测盲区

写进安装输出与文档首页，不再用「墙」这种含糊词。

## 1. 挂载（白名单，逐条可测）

| 路径 | 模式 |
|---|---|
| `/usr`、`/etc` | ro |
| 已登记项目根 | **rw** |
| `/home/lab/workspace/harness` 其他子路径 | **逐个 tmpfs 遮蔽**（不是整树 ro，避免与 V6 冲突） |
| `~/.config/opencode` | ro |
| `~/.local/share/opencode/{storage,project,log}` | rw（仅三个子路径） |
| `~/.local/share/opencode` 其余、`~/.cache/opencode` | ro |
| `/run/abathur`（转发 socket） | ro，root:lab 0660 |
| 家目录其余、`/run/user/UID`、`~/.ssh`、`~/.gnupg`、`~/.npmrc`、`~/.config/gh`、`~/.aws`、`~/.netrc`、`~/.git-credentials` | **不挂** |
| `/tmp`、`/dev/shm` | 新 tmpfs |
| `/proc` | 新挂载（`hidepid=2` 或等价），宿主进程不可见 |

## 2. 命名空间与能力

- `--unshare-all --unshare-user`；会话内 `id -u` 非 0
- `--cap-drop ALL`；父进程 exec 前清空能力、关闭宿主 fd
- cgroup：`systemd-run --slice=abathur.slice --scope -p MemoryMax -p TasksMax`

安装探针（任一失败 → `HARD-UNAVAILABLE`，不静默降级）：
`id -u != 0`、`capsh` 无 CAP_SYS_ADMIN、`/proc/1/ns/{pid,mnt,net}` 与宿主不同、`hidepid` 生效、`mount` 可用、`nsenter` 存在。

## 3. 网络（含数据路径）

- 默认 `--unshare-net`
- netns 内由启动器起一个 **中继**，监听 `127.0.0.1:8010`（仅为已授权目的地）；中继连 `/run/abathur/fwd.sock`（root:lab 0660）
- 授权 = `grants.json` 目的地钉死；每次连接查 expires（执行点判定）
- 未授权目的地：拒绝 + 审计行（含目的地、pid、ts）

## 4. 受控写入

`abathur-config-apply`（root）：只接受**显式 allowlist + 每文件 sha256**，且**拒绝自动加载面**：`opencode.jsonc`、`plugins/**`、`skills/**` 一律 rc≠0。

## 5. 验收（一条命令 + 具体 errno/输出 + 前置断言）

前置断言（缺工具即 FAIL，不得因 ENOENT 假绿）：`command -v nsenter crontab mount capsh` 全在；`/sys/fs/cgroup` 已挂。

| # | 命令 | 期望 |
|---|---|---|
| V1 | 宿主 `curl -m 3 https://example.com` | rc=0（正向对照） |
| V2 | hard 内同命令 | rc=7 + `Network is unreachable` |
| V3 | hard 内 `touch ~/.config/opencode/x` | rc≠0 + `Read-only file system` |
| V4 | hard 内 python 拼路径写同一目录 | rc≠0 + `Read-only file system` |
| V5 | hard 内 `mkdir -p ~/.config/opencode_evil` | rc≠0 + `No such file or directory`（家未挂） |
| V6 | hard 内 `cat` 六枚金丝雀（`~/canary-home`、`~/.aws/credentials`、`~/.netrc`、`~/.git-credentials`、`/run/user/1000/bus`、`OTHER/canary`） | 六条全 rc≠0（ENOENT） |
| V7 | hard 内 `systemctl --user is-system-running`、`crontab -l` | rc≠0 + 非「命令不存在」（前置已断言） |
| V8 | 宿主 `assert-user-scope-clean.sh` | rc=0；放入任意 `*.js` → rc=1 |
| V9 | hard 内 `ls -l /run/abathur/fwd.sock` | rc=0，root:lab 0660 |
| V10 | hard 内 `curl -m 5 127.0.0.1:8010` | rc=0（授权） |
| V11 | hard 内 `curl -m 5 127.0.0.1:3000` | rc≠0 + 审计行（含 3000） |
| V12 | 宿主侧停掉中继后再跑 V10 | rc≠0（证明失败可归因，不是恒通） |
| V13 | grant 3000 后 hard 内 curl 3000 | rc=0；同会话过期后 rc≠0 + `grant-expired` |
| V14 | hard 内 `id -u` / `capsh --print` | 非 0 / 无 CAP_SYS_ADMIN |
| V15 | hard 内 `mount -t tmpfs none ~/.config/opencode` | rc≠0 + EPERM；对照 `mount -t tmpfs none /tmp/x` rc=0 |
| V16 | hard 内 `echo $$ > /sys/fs/cgroup/abathur.slice/x/cgroup.procs` | rc≠0 + 权限错误 |
| V17 | hard 内 `cat pids.max`；fork 炸弹 | ==TasksMax；fork 返回 EAGAIN |
| V18 | hard 内 `pgrep -x systemd` / `cat /proc/1/cmdline` | 仅见沙箱内进程 |
| V19 | hard 内 `stat -c '%U %a' /etc/abathur/grants.json` | root 0644 |
| V20 | 宿主 opencode 启动后加载面扫描（见 §6） | 无哨兵命中 |
| V21 | 普通 opencode 内读日志 | `tier=advisory` |

## 6. 启动前扫描（治「下一次宿主启动执行仓内代码」）

宿主侧启动包装（root 的启动器或 systemd user 前置）检查：
- `.git/hooks/*` 与 `AGENTS.md` 引用的可执行路径的 sha256 基线
- `~/.config/opencode/plugins/**`、`skills/**`、`~/.local/share/opencode/**` 中新增可执行文件
- 命中 → 拒绝启动并列名（不是静默继续）

## 7. 分期

P1：哨兵 + 启动前扫描 + 队列（**detection-only**，明确写「写入未被阻止」）
P2：启动器 hard + 安装探针 + 登记册
P3：中继 + grants + config-apply + V 全套入 CI

## 8. 吸收对照（e978 → v6）

| must-fix | 落点 |
|---|---|
| config-apply 可写自动加载面 | §4 显式拒绝 |
| §1 自相矛盾 / V6 | §1 逐路径遮蔽 + V6 |
| V5 期望错 | 改 ENOENT |
| grants.json 属主 | V19 |
| 无具名残余 | §9 |
| 金丝雀数目不一致 | 六枚，I4/V6 同数 |
| V14 空洞 | 删除，改 V15/V18 正向对照 |
| /proc 可见性 | §1 hidepid + V18 |
| 缓存/会话库跨会话 | §1 仅三子路径 rw + §6 扫描 + §9 残余 |
| 工作区洗白 | §6 扫描 + §9 残余 |
| fwd.sock 未挂 / 数据路径 | §1 + §3 中继 + V9 |
| V7/V14/V15/V16 假绿 | 前置断言 + errno 具体化 |
| 正向对照缺失 | V1/V12/V15 对照 |
| P1 洗白检测 | §6 列为 P1 |

## 9. 具名残余（不谎称闭合）

| # | 残余 | 检测手段 |
|---|---|---|
| R1 | 同 uid：文件完整性=检测非边界 | §6 扫描 + 队列 |
| R2 | 工作区写入→宿主执行（hooks/脚本） | §6 基线比对 |
| R3 | 会话库/缓存跨会话注入 | §6 + 仅三子路径 rw |
| R4 | 已授权端点的隐写出站（内容不可判） | 中继审计（只记目的地与字节数） |
| R5 | 内核漏洞逃逸 | 无（超出本层） |
| R6 | 同 uid 组员可冲刷拒绝队列 | 队列封顶 + 升级态 |
