# 沙箱重建方案 v5（吸收 0ffc 庭 18 条）

## 0. 不变量（先立，再谈实现）

| # | 不变量 | 机械判据 |
|---|---|---|
| I1 | hard 会话内无 CAP_SYS_ADMIN/CAP_SYS_PTRACE | `capsh --print` 不含；`id -u` 非 0 |
| I2 | 不能回到宿主命名空间 | `nsenter -t 1 -m -- touch …` rc≠0 且宿主侧文件不存在 |
| I3 | cgroup 不受会话控制 | 会话内写 `cgroup.procs` rc≠0 |
| I4 | 挂载白名单 | 五枚金丝雀文件在会话内全部 ENOENT |
| I5 | 写墙按挂载而非 argv | 运行时拼路径写配置目录 → EROFS |
| I6 | 放行端点由转发器钉死 | 未授权目的地连接被拒并留审计行 |
| I7 | 启动器字节可验 | 登记册 sha256 == 实算；PATH 投毒 shim 不生效 |
| I8 | advisory 形态如实标注 | 日志 `tier=advisory`，文档不宣称防对抗 |

安装时跑一次 `probe`：I1–I3 任一不成立 → 该 host 禁用 hard 形态（具名 `HARD-UNAVAILABLE`），不静默降级。

## 1. 命名空间与挂载

启动器（root）→ `systemd-run --slice=abathur.slice --scope` → `bwrap`：

- `--unshare-all --unshare-user`，会话内 uid 必须非 0（`--uid/--gid` 或等价原语；安装探针断言 `id -u != 0`）
- `--cap-drop ALL`
- 父进程在 exec 前 `capset` 清空能力并关闭宿主 fd
- 挂载（**白名单，非黑名单**）：
  - `/usr`、`/etc` 只读
  - 已登记项目根 **rw**；`/home/lab/workspace/harness` 其余部分 **ro**；其他 line 的仓不可见
  - `~/.config/opencode` **ro**；`~/.local/share/opencode`、`~/.cache/opencode` **rw**（opencode 运行态）
  - 家目录其余**不挂**（`~/.ssh`、`~/.gnupg`、`~/.npmrc`、`~/.config/gh`、`~/.aws`、`~/.netrc`、`~/.git-credentials`、浏览器配置 → 全部 ENOENT）
  - `/run/user/UID` **不挂**（断掉 user systemd/D-Bus 桥）
  - 新 `/tmp`、`/dev/shm` tmpfs

## 2. 资源（cgroup 在 root slice）

`systemd-run --slice=abathur.slice --scope -p MemoryMax=… -p TasksMax=… --uid=lab bwrap …`

- 会话内不能把自己挪出 scope（I3）
- fork 炸弹 → EAGAIN（`TasksMax` 生效的直接证据）

## 3. 网络与转发器

- 默认 `--unshare-net`
- 转发器 `/usr/local/lib/abathur/fwd`（root:root 0755，socket `/run/abathur/fwd.sock`，root 属主目录）
- 授权来自 `grants.json`：**目的地钉死**（不是通用代理）；未授权目的地拒绝 + 审计行
- nonce 经 fd 传递；措辞=防滥用，非边界
- **过期在执行点判定**（每次连接查 grants + expires），不只在启动时

## 4. 受控写入（否则 hard 形态不可用）

- `abathur-config-apply`（root 属主）：唯一能改 `~/.config/opencode/**` 的通道，原子写 + 审计行 + 仅限声明清单
- 直接写同一目录 → EROFS
- 验收：`abathur-config-apply AGENTS.md <file>` rc=0；`touch ~/.config/opencode/x` rc≠0

## 5. 完整性、恢复、队列

| 项 | 做法 |
|---|---|
| 启动器完整性 | 登记册存 sha256；启动写 start-marker（root 日志）；PATH 投毒不生效 |
| 恢复 | `docs/sandbox-recovery.md` → `sudo /usr/local/lib/abathur/recover`（包内绝对路径，sha256 对照 manifest） |
| 拒绝队列 | root 属主 append-only（setgid helper 写）；去重 `(what,why)` + 计数 + 窗口封顶 20 条；条目含完整 argv（无省略号） |
| P1 自标 | **detection-only**：写入不被阻止，只被哨兵发现 |

## 6. 验收（V13 起每行一条命令）

| # | 命令 | 期望 |
|---|---|---|
| V1 | 宿主 `curl -m 3 https://example.com` | rc=0 |
| V2 | hard 会话内同命令 | rc=7 且 stderr 含 `Network is unreachable` |
| V3 | hard 内 `touch ~/.config/opencode/x` | rc≠0，EROFS |
| V4 | hard 内 `python3 -c "open('/home/lab/.config/opencode'+'/y','w')"` | rc≠0，EROFS |
| V5 | 宿主先 `mkdir -p ~/.config/opencode_evil`；hard 内 `touch ~/.config/opencode_evil/z` | rc=0 |
| V6 | hard 内 `cat ~/canary-home ~/.aws/credentials ~/.netrc ~/.git-credentials /run/user/1000/bus /home/lab/workspace/harness/OTHER/canary` | 每条 rc≠0（ENOENT） |
| V7 | hard 内 `systemctl --user is-system-running` / `crontab -l` | 均 rc≠0 |
| V8 | 宿主 `assert-user-scope-clean.sh` | rc=0；放入任意 `*.js` → rc=1 |
| V9 | hard 内 `curl -m 5 127.0.0.1:8010`（已授权） | rc=0 |
| V10 | hard 内 `curl -m 5 127.0.0.1:3000`（未授权） | rc≠0 + 审计行 |
| V11 | hard 内 `curl -m 5 127.0.0.1:3000`（grant 后） | rc=0 |
| V12 | 同一会话中 grant 过期后（`expires` 设 60s，不重启） | rc≠0 且 `reason=grant-expired` |
| V13 | hard 内 `id -u` / `capsh --print` / `mount -t tmpfs none ~/.config/opencode` | 非 0 / 无 CAP_SYS_ADMIN / rc≠0 |
| V14 | hard 内 `nsenter -t 1 -m -- touch ~/.config/opencode/ESCAPE` | rc≠0；宿主侧文件不存在 |
| V15 | hard 内 `echo $$ > /sys/fs/cgroup/abathur.slice/x/cgroup.procs` | rc≠0 |
| V16 | hard 内 `cat /sys/fs/cgroup/.../pids.max` 后 fork 炸弹 | 值==TasksMax；fork 返回 EAGAIN |
| V17 | hard 内 `abathur-ai opencode run --print ok`（已登记项目） | rc=0 且会话库有写入 |
| V18 | 宿主用 PATH 投毒 shim 跑 `/usr/local/bin/abathur-ai` | 日志含 root 启动 marker，shim 未被调用 |
| V19 | 触发拒绝 → 取队列条目：`bash -n` + argv 逐字比对 | rc=0 / 相同 |
| V20 | 普通 opencode 内读日志 | `tier=advisory` |

## 7. 分期

- P1：哨兵 + 队列骨架 + 文档（detection-only，明确标注）
- P2：启动器 hard 形态 + 安装探针 + 登记册
- P3：转发器 + grants + 受控写入 + V 全套入 CI

## 8. 吸收对照（0ffc → v5）

| must-fix | 落点 |
|---|---|
| cap/ptrace/嵌套 userns | I1 + V13 |
| cgroup 移出 root slice | §2 + V15/V16 |
| V2 无产生者 | 改 curl rc=7 + errno 文本 |
| V5 可满足性失败 | 夹具先建目录 |
| V11 过期语义 | §3 执行点判定 + V12 同会话 |
| opencode 运行态缺失 | §1 挂载表 + V17 |
| 恢复命令无来源 | §5 绝对路径 + manifest |
| V12 空队列可蒙混 | 队列条目非空 + argv 比对 |
| 密钥黑名单 | §1 改白名单 + 六枚金丝雀 |
| /run/user 桥 | §1 不挂 + V7 |
| 转发器协议 | §3 目的地钉死 |
| /tmp 共享 | §1 新 tmpfs |
| 工作区 rw 范围 | §1 仅登记项目 rw |
| 无受控写路径 | §4 + V3/V4 对照 |
| 启动器可被 shim 冒充 | §5 + V18 |
| V1/V9/V10/V13 弱 | V1/V9/V10 改正反对照；V19 加 argv 比对 |
| 过期检查点 | §3 |
