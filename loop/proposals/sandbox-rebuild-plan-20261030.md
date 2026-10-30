# 沙箱重建方案（v1，待西比拉审议）

## 0. 主语原则（先定，后写代码）

按四庭：A 工作实例（运行中的座席）只是观察者；被进化的对象是 B（仓）与 C（一次性实例）。因此：

- 本机制的作用对象 = **本线项目内的 A/B/C**；
- 他线项目 = 不在登记册 → **机制不得生效，也不得安装**；
- 任何「用户级」安装一律禁止（这是 2026-10-30 事故的成因）。

## 1. 作用域（硬约束）

| 项 | 规则 |
|---|---|
| 插件位置 | 仅 `<repo>/.opencode/plugins/`（项目级） |
| 策略位置 | 仅 `<repo>/.abathur/sandbox.json` |
| 用户级目录 | 禁止出现任何约束类插件；由哨兵机械断言 |

哨兵：`scripts/assert-no-user-scope-plugins.sh`
- 检查 `~/.config/opencode/plugins/**` 与 `OPENCODE_CONFIG` 指向的文件，命中约束类关键词（bwrap/sandbox/exec-before）即 exit 1
- 安装时跑一次；另加每日 systemd user timer
- 测试：把 `sandbox-bash.js` 拷进用户目录 → 哨兵 exit 1；移除 → exit 0

## 2. 外部登记册（fail-closed 的锚）

`/etc/abathur/sandbox-registry.json`（root:root 0644）：

```json
{ "projects": [ { "root": "/home/lab/workspace/harness/Abathur", "policy_sha256": "…", "plugin_sha256": "…" } ] }
```

加载规则：
- 项目在登记册 ∧ 策略/插件哈希匹配 → 启用
- 项目在登记册 ∧ 缺失或不匹配 → **拒绝执行该项目的 bash**（不是跳过）
- 项目不在登记册 → 不启用（也不报错）

测试：
- 删除策略文件 → 下一次 bash 非零退出 + 日志 `SANDBOX-DENY reason=policy-missing`
- 篡改策略一字节 → 同样拒绝；恢复 → 通过
- 未登记项目 → 正常执行且日志无 tier 行

## 3. 权限按需 + 棘轮

策略字段：`network`（none|allow）、`mounts`、`devices`、`limits`、`mask`。

每条放宽必须带：
```json
{ "what": "network", "entry": "127.0.0.1:8010", "why": "本机推理代理", "expires": "2026-11-30", "receipt": "<锚链条目哈希>" }
```

加载时拒绝：缺 `expires`、已过期、缺 `receipt`、receipt 在锚链查不到。

测试：三种坏条目各造一个 fixture → 加载失败并具名原因。

## 4. 资源隔离（不是 ulimit）

- 每个项目的沙箱运行在独立 cgroup v2 scope：`systemd-run --user --scope -p MemoryMax=… -p PIDsMax=…`
- 私有 `/tmp`（现有 tmpfs）保持不变
- 测试：A 里跑 fork 炸弹 → 被 PIDsMax 拒；同时 B 里延迟探针与宿主进程数正常

## 5. 覆盖完整

可 spawn 进程的入口全部经过沙箱：
- `bash` 工具（现有钩子）
- 任何 MCP/插件侧 shell 类调用（枚举后逐个包裹）
- 测试：枚举 spawn 能力入口，逐个调用，断言每个都产出 `tier=` 日志行；有任何一个没有 → 测试失败

## 6. 爆炸半径测试（发布前必跑）

`scripts/blast-radius-test.sh`：
1. 占用闸：`loop/run_registry.py status` 有活体 或 存在 `abathur run` 进程 → 中止（不打扰他席）
2. 建两个一次性 fixture 项目（`/tmp/br-A` 登记、`/tmp/br-B` 未登记），各自独立 `OPENCODE_CONFIG`
3. 断言：A 内网络断/docker 不可达；B 内网络通/docker 可达；两边日志 tier 行不同
4. 断言：跑完后用户配置目录哈希不变、他席哨兵进程仍存活
5. trap 清理，零残留
6. 任一断言失败 → exit 1（阻断发布）

## 7. 迁移与回滚

1. 写登记册与锚链条目（root 安装时）
2. 在各项目仓放插件+策略
3. 跑爆炸半径测试并留回执
4. 回滚：从登记册删除该项目 → 立即回到「不启用」；用户级零残留

## 8. 验收表

| # | 判据 | 机器观测 |
|---|---|---|
| V1 | 未登记项目不受影响 | B 项目 curl 通、docker 达 |
| V2 | 登记项目被约束 | A 项目 curl 失败、docker 不达 |
| V3 | 策略缺失/篡改 = 拒绝 | 非零退出 + SANDBOX-DENY |
| V4 | 用户级零约束插件 | 哨兵 exit 0/1 |
| V5 | 放宽条目过期即失效 | 过期 fixture 加载失败 |
| V6 | 资源隔离 | fork 炸弹被拒、邻项目指标正常 |
| V7 | 覆盖完整 | 每个 spawn 入口都有 tier 行 |
| V8 | 无残留 | 测试后 /tmp 与用户配置哈希不变 |

## 9. 明确不做

- 不建 Unix 账户（机主已否决）
- 不改 sudoers
- 不装用户级插件
- 不在他项目目录写任何文件
