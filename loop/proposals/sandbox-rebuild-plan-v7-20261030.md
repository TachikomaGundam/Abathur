# 沙箱重建方案 v7（吸收 aaae 庭；修两处硬矛盾）

## 0. 两处硬矛盾的解法（本轮核心）

### 矛盾一：cap-drop ALL 与「能 mount」不能同时为真

**解法：明示保留能力集，按能力位分开承诺。**

| 能力 | 保留？ | 理由 |
|---|---|---|
| CAP_NET_ADMIN | 保留（**仅 netns 内**） | 配 nft 做重定向，否则网络审计不可实现 |
| CAP_SYS_ADMIN / PTRACE | **丢弃** | 不能挂载宿主路径、不能盯宿主进程 |
| 其余 | 丢弃 | — |

V15 随之改写：不再测「mount /tmp 成功」（与丢 cap 矛盾），改为测「mount 配置目录 → EPERM」+「写受控目录 → EROFS」。写保护由 V3/V4 承担。

### 矛盾二：8010 单监听无法拦截 3000

**解法：netns 内 nft 全量重定向。**

```
nft add rule ip nat OUTPUT ip daddr 127.0.0.1 tcp dport != 53 redirect to :15001
```

- 所有回环 TCP 落到中继 `:15001`，中继用 `SO_ORIGINAL_DST` 取原目的地，查 grants
- 授权 → 经 `/run/abathur/fwd.sock`（root 属主 daemon）转发
- 未授权 → 拒绝 + 审计行（含原目的地）
- 这样 V11（3000 未授权）与 V13（grant 后 3000 可用）才有同一个机制

**curl 的判据改成内容判据**（rc=0 对 4xx/5xx 也成立，不能证明转发）：用夹具 HTTP 服务返回固定体 `fixture-ok`，断言 `curl -sS -m5 -w '%{http_code}'` == 200 ∧ body == fixture-ok。

## 1. 可工作性（治「装好了但没法干活」）

hard 会话内提供**可写 HOME（tmpfs）**：

| 变量/文件 | 值 |
|---|---|
| `HOME` | 会话内 tmpfs |
| `XDG_CACHE_HOME` | `$HOME/.cache` |
| `npm_config_cache` | `$HOME/.npm` |
| `PIP_CACHE_DIR` | `$HOME/.cache/pip` |
| `GIT_CONFIG_GLOBAL` | `$HOME/.gitconfig`（由登记册里的 name/email 生成） |
| 项目 `node_modules` | ro 绑定（宿主预装） |
| `npm install` | **hard 内不支持**（依赖变更走 advisory 或 root 侧 helper）；文档写明 |

正向工作行（必测）：`npm test`（离线，node_modules 已就位）、`git commit`（repo-local 身份）均 rc=0。

## 2. 挂载（默认拒 + 逐条放行）

- `/home/lab/workspace/harness` **先 tmpfs 遮蔽**，再把**已登记项目根** bind 进来 → 新增同级目录默认 ENOENT（不再靠枚举）
- `~/.config/opencode` ro；`~/.local/share/opencode/{storage,project,log}` rw
- `/run/abathur` ro（socket 0660 root:lab）
- 家目录其余与 `/run/user/UID` 不挂
- `/proc` 新挂载 hidepid=2

## 3. 审计与队列（治 R6「可冲刷」，改为机制闭合）

- 中继 daemon 以 **root** 运行，写 `/var/lib/abathur/{audit,deny-queue}.jsonl`
- 目录 root:root 0755，文件 `chattr +a`（只追加，同 uid 无法截断/删除）
- 队列去重 `(what,why)`、计数、窗口封顶 20 条、超限转升级态

## 4. 启动前与运行期扫描（治 R2 高估）

- 基线库 root:root 0600（座席不可写）
- 扫描点：①每次启动 ②systemd path unit 持续监视 `.git/hooks`、`plugins/**`、`skills/**`
- R2 措辞更正：**启动时+持续监视可发现，但「会话写入→宿主执行」之间仍有窗口**，作为具名残余，不再宣称闭合

## 5. 验收（一条命令 + 具体期望）

前置：`command -v nsenter crontab capsh`、`/sys/fs/cgroup` 已挂；缺一即 FAIL。

| # | 命令 | 期望 |
|---|---|---|
| V1 | 宿主 `curl -m3 https://example.com` | rc=0 |
| V2 | hard 内同命令 | rc=7 + `Network is unreachable` |
| V3 | hard 内 `touch ~/.config/opencode/x` | EROFS |
| V4 | hard 内 python 拼路径写配置目录 | EROFS |
| V5 | hard 内 `touch ~/.config/opencode_evil/x`（无 -p） | ENOENT |
| V6 | hard 内 `cat` 六枚金丝雀 | 六条 ENOENT |
| V7 | hard 内 `systemctl --user …` / `crontab -l` | rc≠0 且非「命令不存在」 |
| V8 | 宿主 `assert-user-scope-clean.sh` | rc=0；放 `*.js` → rc=1 |
| V9 | hard 内 `ls -l /run/abathur/fwd.sock` | 存在、root:lab 0660 |
| V10 | hard 内 `curl -sS -m5 -w '%{http_code}' http://127.0.0.1:8010/health` | 200 ∧ body=`fixture-ok` |
| V11 | hard 内 curl 到 3000（未授权） | 拒绝 + 审计行含 3000 |
| V12 | 停掉 root 中继后跑 V10 | 非 200（证明可归因） |
| V13 | grant 3000 → hard 内同 URL | 200 ∧ body=`fixture-ok`；过期后拒绝 |
| V14 | hard 内 `capsh --print` | 无 CAP_SYS_ADMIN/PTRACE；有 CAP_NET_ADMIN |
| V15 | hard 内 `mount -t tmpfs none ~/.config/opencode` | EPERM |
| V16 | hard 内写 `cgroup.procs` | 权限错误 |
| V17 | hard 内 `pids.max` + fork 炸弹 | ==TasksMax；EAGAIN |
| V18 | hard 内 `cat /proc/1/cmdline`、`pgrep -x systemd` | 仅沙箱内进程 |
| V19 | hard 内 `stat -c '%U %a' /etc/abathur/grants.json` | root 0644 |
| V20 | 宿主破坏一个 hook 哈希后跑扫描 | rc≠0 并点名该文件（正向对照） |
| V21 | hard 内 `npm test && git commit` | rc=0 |
| V22 | 新建同级目录 `harness/NEWDIR/canary` 后 hard 内 `cat` | ENOENT |
| V23 | hard 内直连 `/run/abathur/fwd.sock`（绕过中继） | 被 root daemon 拒 + 审计行 |
| V24 | 普通 opencode 内读日志 | `tier=advisory` |

## 6. 分期

P1：哨兵 + 启动前扫描 + 队列（detection-only，写明「写入未被阻止」）
P2：启动器 hard + 探针 + 登记册 + tmpfs HOME
P3：nft 重定向 + root 中继 + grants + V 全套 CI

## 7. 吸收对照（aaae → v7）

| must-fix | 落点 |
|---|---|
| V14/V15 矛盾 | §0 保留能力集 + V15 改写 |
| 网络数据路径不成立 | §0 nft 重定向 + 内容判据 |
| 无 writable HOME | §1 tmpfs HOME + V21 |
| V5 语义 | 改无 -p |
| R6 可闭合 | §3 chattr +a + V23 |
| §6 仅启动时 | §4 path unit + R2 措辞更正 |
| 兄弟路径枚举 | §2 默认拒 + V22 |
| 基线库属主 | §4 root 0600 |
| V20 可空过 | 正向对照 |
| 正向工作缺失 | V21 |

## 8. 具名残余

| # | 残余 | 检测 |
|---|---|---|
| R1 | 同 uid：文件完整性=检测非边界 | 扫描+队列 |
| R2 | 会话写入→宿主执行的窗口 | 启动扫描+持续监视可发现，**间隙不闭合** |
| R3 | 会话库/缓存跨会话注入 | 仅三子路径 rw + 扫描 |
| R4 | 已授权端点隐写出站（内容不可判） | 中继只记目的地与字节数 |
| R5 | 内核漏洞 | 无（超出本层） |
| R6' | 依赖变更需走 advisory/root helper | 文档具名（不是残余，是设计约束） |
