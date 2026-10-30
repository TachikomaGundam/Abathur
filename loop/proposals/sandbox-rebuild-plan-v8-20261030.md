# 沙箱重建方案 v8（2026-10-30）

**依据**：v1–v7 七轮西比拉评审全部否决；第 8 版改为「先测后写」——下列每条判据后附本席在解绑后宿主侧实测的回执（2026-10-30T14:5xZ，全部当场执行）。

---

## 0. 设计前提（实测确立，取代 v1–v7 的推断）

| # | 事实 | 回执 |
|---|---|---|
| F1 | `bwrap --unshare-net` 内 `lo` 已 `UP` 且含 `127.0.0.1`，路由表 0 条 | `lo=1: lo: <LOOPBACK,UP,LOWER_UP>`；`routes4=0`；`routes6=0` |
| F2 | 该 netns 内**无 NET_ADMIN**：`ip link set lo down` 与 `nft add table` 均 EPERM | `RTNETLINK answers: Operation not permitted`（rc=2）；`nft_add_rc=1` |
| F3 | ⇒ **nft 方案在本架构内不可实现**（需要 CAP_NET_ADMIN），v7 的「nft 重定向 + 保留 NET_ADMIN」整支作废 | 同上 |
| F4 | ⇒ **lo-down DoS 不可达**（无 NET_ADMIN，且 lo 出厂即 UP） | 同上 |
| F5 | `bwrap --unshare-user` 下 `id -u` = 1000（无论是否给 `--uid`），沙箱内无 root | `1000` / `1000` |
| F6 | `systemd-run --user --scope -p TasksMax/MemoryMax` 限额**实装**，但父 slice 可写 → 进程可自挪出 scope | `pids.max=64`、`mem.max=1073741824`、`parent_writable=YES（可自挪=限额可逃）` |
| F7 | 默认会话 cgroup 无任何限额 | `pids.max=max`、`mem.max=max` |

**由 F3/F4 得出的结论**：既然没有 NET_ADMIN，就没有「网内防火墙/重定向」这条腿；剩下能做的只有两种网络态——**断网**（`--unshare-all`）或**共享宿主网络**（`--share-net`）。

## 1. 关键决策变更（相对 v7）

v7 假定「netns 内可用 nft 做重定向 + 保留 NET_ADMIN 做租约」，F2/F3 证明不可行。v8 改为：

> **默认 `--share-net`（网络共享），并把「网络隔离」从本版目标中显式剔除。**

理由（三条）：
1. 事故的四个目标通道（docker 套接字、input 设备、日志、秘密文件）**全部是文件面**，没有一个是网络面；
2. `--unshare-all` 正是上次全机故障的直接原因，且逼出「nft 重定向」这条走不通的路；
3. 断网会让受管制的 bash 无法 `git fetch`/`npm install`/访问模型代理，必然重演「他席不可用」。

**显式具名非目标**：本版**不阻断沙箱内进程的网络外连**。数据外泄面（读工作区后传出）不在本版覆盖范围，留给 Tier2（root 启动器 + 独立 netns + 宿主侧代理）。

## 2. 沙箱形态（默认 Tier1，无 root 要求）

```
bwrap --die-with-parent --new-session \
  --share-net \
  --tmpfs /home/lab \
  --bind "$WORKSPACE" "$WORKSPACE" \
  --tmpfs /tmp \
  --ro-bind /usr /usr  --ro-bind /etc /etc  --ro-bind /opt /opt \
  --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 --symlink usr/sbin /sbin \
  --dev /dev            # 仅 null/zero/random/urandom/tty，不含 input
  --proc /proc
  --clearenv
  /bin/bash -c "$CMD"
```

**判定式隔离（逐条对应四个目标通道）**：

| 通道 | 机制 | 判据（可机械复验） |
|---|---|---|
| docker→root | 不挂 `/var/run/docker.sock`（`/var/run` 不在挂载表；`/etc` 只读） | 沙箱内 `test -S /var/run/docker.sock` → 非零 |
| input 键盘 | `--dev /dev` 只建基础设备节点，不含 `/dev/input` | 沙箱内 `ls /dev/input` → 非零 |
| 日志 | 不挂 `/var/log`，`/etc` 只读 | `ls /var/log` → 非零 |
| 秘密文件 | `--tmpfs /home/lab` 造空 HOME；`.ssh`/`.npmrc`/`.gnupg` 不存在 | `ls ~/.ssh ~/.npmrc` → 非零 |
| ptrace | 宿主 `kernel.yama.ptrace_scope=3`（已就位，重启后为 1，见 §5） | `cat /proc/sys/kernel/yama/ptrace_scope` |

**写面**：工作区可写（业务需要）；HOME 每次调用新建（配置/凭据一次性，符合秘密隔离）；`/tmp` 每次新建。

## 3. 「硬墙」的真实含义（对齐 v1–v7 的诘问）

| 声称 | 实测/结论 | 归类 |
|---|---|---|
| 「进沙箱后无法出沙箱」 | 成立：无需逃逸，工具调用本身就在 bwrap 内 | 硬 |
| 「会话无法自行关闭沙箱」 | 成立：插件在宿主进程内决定是否包裹；沙箱内的命令改不了宿主插件 | 硬 |
| 「限额不可逃」 | **不成立**：F6 证明可自挪 cgroup | 软（防事故，不防蓄意） |
| 「工作区写操作可审计」 | 不成立：工作区无写拦截 | 软（推荐根属主日志 hook，独立提案） |
| 「网络面受控」 | **本版不做**（§1 非目标） | 不覆盖 |

## 4. 主体绑定（防他线误伤，本方案的第一性要求）

- 沙箱**只能**由本仓项目级插件 `.opencode/plugins/sandbox-bash.js` 施加，插件用 `ctx.directory` 判定是否为本仓（realpath 前缀比对）。
- **禁止**写任何用户级配置（`~/.config/opencode/**`）与 root 快照（`/usr/local/lib/abathur/xdg/**`）。安装脚本对此两处只做**只读断言**：若发现本项目字样出现在用户级引用里，退出码 3 并要求人工移除。
- **爆炸半径测试**（每次改动必跑）：在 `/tmp` 造一个假「他席会话目录」，用插件导出的纯函数 `shouldWrap(dir)` 断言返回 false；再用 `ABATHUR_SANDBOX_DRYRUN=1` 打印实际会执行的 argv，人工核对不含 `--unshare-net`/`--unshare-all`。

## 5. 验收（A 组，全部可在宿主侧自动跑）

| 编号 | 判据 | 期望 |
|---|---|---|
| A1 | `shouldWrap("/home/lab/workspace/harness/hr")` | false |
| A2 | `shouldWrap(本仓路径)` | true |
| A3 | 沙箱内 `test -S /var/run/docker.sock` | rc≠0 |
| A4 | 沙箱内 `ls /dev/input` | rc≠0 |
| A5 | 沙箱内 `ls /var/log` | rc≠0 |
| A6 | 沙箱内 `ls ~/.ssh ~/.npmrc` | rc≠0 |
| A7 | 沙箱内 `curl -sS -m 5 https://example.com -o /dev/null` | rc=0（网络共享，§1 非目标） |
| A8 | 沙箱内 `curl -sS -m 3 http://127.0.0.1:8010 -o /dev/null; echo $?` | rc≠7（连不上才是 7；服务活着时为 0/52/56 均算通过） |
| A9 | 沙箱内写工作区 | 成功且宿主可见 |
| A10 | 沙箱内 `pkill -f opencode` | 不影响宿主（`--unshare-pid` 不在本版；见 §6 R-1） |

## 6. 残余风险（具名）

| 编号 | 风险 | 现状 |
|---|---|---|
| R-1 | 未隔离 PID：沙箱内可见宿主进程，可 `kill` 他席进程 | 本版不做（需 `--unshare-pid`，与 `--dev` 组合需实测；v9 候选） |
| R-2 | 未隔离网络：可外连、可做 DNS/HTTP 外泄 | §1 非目标 |
| R-3 | 硬链接把家目录秘密带入工作区后仍可读 | 启动扫描 + 具名；无法根除 |
| R-4 | 工作区写无审计 | 独立提案（根属主日志 hook） |
| R-5 | cgroup 限额可逃（F6） | 只作防事故 |
| R-6 | 沙箱内无 git/npm 凭据 → `git push`/`npm publish` 必须走 root 启动器 | 设计后果，非缺陷 |

## 7. 安装与回滚

- 只装两处：`<repo>/.opencode/plugins/sandbox-bash.js`（项目级）+ `<repo>/.opencode/plugins/sandbox-policy.json`。
- 不装用户级、不装 root 快照、不改 `~/.config/opencode/opencode.jsonc`。
- 回滚 = 删除这两个文件（无需重启宿主以外的任何东西；重启会话即恢复）。
- 逃生阀：`ABATHUR_SANDBOX=0`（人类在启动 opencode 前设置）。

## 8. 与 P1（detection-only）的关系

P1 独立推进，不依赖本方案：只做记录（是否伪装、插件/工具集哈希、缺口检测），不做拦截。本方案（P2 拦截）落地后，P1 降为漂移监测。
