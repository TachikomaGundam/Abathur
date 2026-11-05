# HANDOFF — AsylumWarden 独立项目

日期：2026-11-05
状态：架构交接，**不写代码**；第三次西比拉审议 **APPROVE（2A/1R）**，5 条 must-fix 已在本版收敛，待下一次审议确认
来源：Abathur 席
审查：第一次 `sibyl-20261105T055441Z-e7ef`（**REJECT 1A/2R**，实质建议 **C**）；第二次 `sibyl-20261105T060400Z-1996`（**REJECT 1A/2R**，10 条 must-fix）；第三次 `sibyl-20261105T060826Z-2e07`（**APPROVE 2A/1R**，5 条 must-fix，已落入 §8.1/§8.4/§10.1）
独立度：三次均 **NOT-INDEPENDENT**（送审稿由本席起草）
实质建议：**C 形态**——核心库/CLI + 薄适配器；纯插件、纯库、内化复制、常驻服务均不选。

## 0. 机主已定事项（2026-11-05）

1. **License：MIT。** 发布前把 `UNLICENSED/private` 改为 MIT/公开。
2. **GitHub 源仓：`TachikomaGundam/AsylumWarden`。** 大小写固定；不使用 `github.com/asylumwarden`（休眠账号占用）。
3. **试点：PCB 系列 Agent 的 workspace。** 先做只读/影子试点，具体约束见 §10.1；不得替换 PCB 自己的 `pcb_dispatch` 控制面。
4. **本文件需再过一次西比拉审议。** 审议通过前不建仓、不写代码、不发布。

### 0.1 第二次审议 must-fix 收敛（2026-11-05）

第二次审议判 REJECT，10 条 must-fix。本 handoff 的处理：

1. PCB 零板级写入：改为**前后基线快照**（`git status --porcelain --ignored=matching` + `HEAD` + 索引哈希 + `reports/state/dispatches` 内容哈希）写入影子台账，diff 非空即 FAIL（§10.1）。
2. PCB 派工证据面：用**绝对路径** `forbidden_absolute` 覆盖 `reports/recovery/dispatches/**`、`dispatches/**`、`*.consumed`、`state/plan-approvals/**`、`state/pending-plans/**`，并加 `done` 拒绝测试（§10.1）。
3. 影子回执：必须带 `mode:"shadow"`、`shadow_of`、wave 前缀 `shadow-`；`verify` 拒绝其作为 PCB 审批证据（§8.6/§10.1）。
4. 注册表唯一权威：全机单文件 `~/.config/asylumwarden/registry.json`；项目文件只做选择与哈希引用，不复制 roots（§8.1）。
5. 扩展 kind：配置内 `kinds` 表登记；未登记即 `UNKNOWN-KIND`（§8.2）。
6. 试点线根：`pcb.roots` 只登记 PCB 席批准的**试点目录**，禁止以 PCB 仓根为线根配黑名单（§8.1/§10.1）。
7. 试点期不安装 opencode 适配器，只走 CLI，由 PCB 席执行（§10.1）。
8. 删除 `/tmp` 选项：影子根固定在 `/home/lab/.local/state/asylumwarden-shadow-pcb`，影子注册表 `shadow-registry.json`，不属于正式线根命名空间（§10.1）。
9. 租约 `max_hold`：超过上限不可再 renew，允许他人 `--steal` 并记审计事件（§8.5）。
10. 外部锚运行规格：创世锚、触发频率、锚端不可达时 `ANCHOR-STALE` 降级，不冒充审计闭合（§8.4）；M5 前实测 npm provenance/org linkage（§12/§13）。

### 0.2 第三次审议 must-fix 收敛（2026-11-05）

第三次审议 APPROVE，但列 5 条 must-fix；本版处理：

1. 跨线禁触面改为 `forbidden_absolute` 绝对路径，不再依赖相对线根；校验器硬拒 shadow root 等于/包含真实 PCB 仓根（§8.1/§10.1）。
2. 影子注册表定名为 `shadow_home/shadow-registry.json`，影子台账 `shadow_home/ledger.jsonl`，永不并入正式链；路径统一为 `/home/lab/.local/state/asylumwarden-shadow-pcb`（§8.1/§10.1）。
3. 试点启动责任归 PCB 席：获批后创建 workspace，写 `pilot.bootstrap`；根缺失 fail-closed，不自动创建（§10.1 规则 0）。
4. 基线盲区：增加 `--ignored=matching` 与 `reports/state/dispatches` 内容哈希，覆盖 `.consumed` 和 ignored 文件（§10.1 规则 5）。
5. 外部锚类型：同机同 uid 的 `file` 不计入发布门；只认 `command`/`remote`/`human-checkpoint`（§8.4）。

---

## 1. 一句话结论

AsylumWarden 是**独立项目**，不是 Abathur 的插件，也不是复制进六个项目的源码片段。

它以一个零依赖核心包存在：核心负责注册表、清单、租约、回执、哈希链台账；CLI 是语言中立的入口；opencode 只是薄适配器之一。各项目通过固定版本的包或 CLI 使用它，不 vendor 源码。

---

## 2. 为什么不是纯插件

纯插件（A）把宿主语义写进产品：

- 只有 opencode 会话能直接用，VideoGen 的 Python 流程、纯 shell、Codex/Claude 都要另写一套；
- 换宿主时唯一消费路径要重写；
- 工具名、参数形状、事件映射会和核心生命周期混在一起，核心无法独立测试。

插件体验可以保留，但只能作为**适配器**，不能作为产品本体。

## 3. 为什么不是纯库

纯库（B）失去会话内工具体验：

- 每个项目都要自己写接线；
- opencode 用户拿不到原生 `warden_*` 工具；
- 但 CLI 仍然必须存在，否则 Python 项目无法低成本使用。

所以库/CLI 是本体，插件是可选外壳。

## 4. 为什么禁止内化复制

内化（D）意味着六条线六份源码：

- 台账格式、租约语义、安全修复逐仓漂移；
- 审计无法给单一结论；
- 一个仓库的 bug 修复不会到达其他仓库；
- 版本、哈希、行为矩阵无法对账。

**允许 vendor 的唯一条件**（必须机械可判）：

1. 目标环境完全离线，不能从 npm 安装；
2. 只服务一个消费方；
3. vendor 快照登记版本号 + sha256 + 上游 commit；
4. 有书面的上游同步策略和到期复核日期；
5. 不允许本地改核心；改动必须回上游；
6. 台账里登记 vendor 条目。

不满足任一条，一律用依赖，不复制。

## 5. 为什么不是常驻服务

服务/守护进程（E）引入端口、权限、启动顺序、数据库迁移、备份和监控面，违背“零守护进程、零数据库、零用户配置”的产品承诺。当前需求不需要跨机强一致；跨机是未来独立议题，不是 v1 默认。

---

## 6. 目标与非目标

### 目标

- 同一台机器、同一 uid、多条产线之间的派单控制面。
- 波次依赖、原子认领、TTL 租约、回执校验、追加式哈希链台账。
- 跨线默认只读；写必须落在自己的产线根；禁触面单源、缺失 fail-closed。
- 多语言可用：Node 项目用库，Python/其他项目用 CLI。
- 零运行时依赖、零守护进程、零数据库。

### 非目标

- 不是沙箱。不创建容器、不改挂载、不隔离 uid。
- 不是模型网关。不调用模型、不保存密钥。
- 不是任务数据库。状态是普通文件。
- 不是 Abathur 内核。Abathur 可以调用它，但它不依赖 Abathur。
- v1 不做跨机强一致、不做 Web UI、不做多租户。

---

## 7. 架构（C 形态）

```text
人类终端（持钥匙的人）
        |
        v
AsylumWarden core
  config      产线、根、禁触面、状态目录
  manifest    波次、格子、依赖、角色快照
  planner     校验、规范化、落盘
  leases      原子认领、TTL、epoch、心跳、崩溃回收
  receipts    命令、产物、读取、退出码、sha256、realpath
  ledger      追加式哈希链、外部锚
  views       ready / status / verify
        |
        +-------------------+-------------------+
        |                   |                   |
   opencode adapter    Codex/Claude adapter   CLI (JSON)
        |                   |                   |
        +-------------------+-------------------+
                            |
                  Python/shell/其他项目
```

**依赖方向**：

```text
adapters ──▶ core
CLI      ──▶ core
core     ──▶ Node 标准库
core     ✗▶ opencode / Codex / Claude / Python
```

核心禁止 import 宿主 SDK。用构建门机械检查：`src/` 出现 `@opencode-ai`、宿主包名或适配器路径，门失败。

---

## 8. 稳定契约（必须版本化）

以下字段是公开契约，改动走 semver；适配器私有字段不得写进契约。

### 8.1 配置 `asylumwarden.json`

**唯一权威注册表**：`~/.config/asylumwarden/registry.json`（全机单文件）。项目内 `asylumwarden.json` 只是选择与引用，不复制 `roots`：

```json
{
  "version": 1,
  "registry": "~/.config/asylumwarden/registry.json",
  "registry_sha256": "<64hex>",
  "self": "abathur",
  "state_home": "~/.local/state/asylumwarden",
  "mode": "normal",
  "kinds": {
    "verify": { "description": "独立复核，只读" }
  }
}
```

注册表：

```json
{
  "version": 1,
  "lines": {
    "abathur": {
      "roots": ["/home/lab/workspace/harness/Abathur"],
      "forbidden_surfaces": [".omo/evidence/INTENT-LEDGER.md"]
    }
  }
}
```

规则：

- 每条线必须有 `roots` 和 `forbidden_surfaces` 键；缺失即失败，不按空处理。
- 唯一权威路径固定为 `~/.config/asylumwarden/registry.json`；禁止每项目复制一份。项目文件只带 `registry_sha256`，claim/done 时比对，漂移即 `CONFIG-DRIFT`。
- `roots` 必须存在、目录、互不重叠。
- 禁触面相对路径按该线第一个根解析；**跨线保护面必须用 `forbidden_absolute`**（绝对路径或绝对 glob，逐字展开，不按线根解析），即使目标在线根之外也要拒绝。相对 `forbidden_surfaces` 只用于本线内部。
- 扩展 kind 只能来自项目配置的 `kinds` 表；未登记即 `UNKNOWN-KIND`。
- **shadow 模式**：`mode:"shadow"` 时另给 `shadow_of`（正式注册表 sha256）与 `shadow_home`；影子注册表是 §8.1 单源规则的**具名例外**，文件固定在 `shadow_home/shadow-registry.json`，影子台账固定在 `shadow_home/ledger.jsonl`，永不并入正式 `~/.local/state/asylumwarden/ledger.jsonl`。
- 校验器必须拒绝：任何 line root 等于/包含另一线根；shadow 模式下任何 root 等于/包含真实 PCB 仓根（`/home/lab/workspace/harness/PCB-Agent`）；任何 allowed/read root 逃出本线 roots 的写入尝试。
- 同 uid 可改配置文件；这是残余风险，必须用外部锚或人类签署补强。

### 8.2 清单 `wave.json`

字段：`wave`、`cells[]`。

每个 cell：

- `id`：唯一，安全字符集。
- `kind`：`gen|verify|doc|build`，或项目配置 `kinds` 表登记的扩展；未登记即 `UNKNOWN-KIND`，不按默认放行。
- `line`：产线名，必须在配置中存在。
- `cwd`：必须存在，是 `allowed_roots` 中某个根的子孙。
- `allowed_roots`：可写根，非空，必须在该线根内；不得等于/位于禁触面内。
- `read_roots`：只读根，可选；不得与可写根重叠。
- `deps`：依赖 id；必须存在、无环、无重复。
- `role` / `role_file` / `session_started_at`：角色快照；角色文件 mtime 晚于会话启动即 `RESTART-REQUIRED`。
- `brief` / `acceptance`：任务说明与验收；可选但推荐。

### 8.3 状态布局

```text
<state_home>/
  config.json                 快照/哈希
  ledger.jsonl                追加式哈希链
  waves/<wave>/
    meta.json                 config sha256、创建时间、角色快照
    cells/<id>.json           cell 状态
    leases/<id>/owner.json    actor、pid、host、epoch、TTL、心跳
  receipts/<wave>/<id>.json   回执
```

### 8.4 台账条目

字段：`seq`、`ts`、`type`、`wave`、`cell`、`actor`、`payload`、`prev`、`hash`。

- `prev` 指向前一条 `hash`；首条锚定创世哈希。
- 追加必须单写者锁或原子追加；必须测撕裂写恢复。
- 台账只能 EOF 追加；重写/删除即断链。
- **外部锚是发布门必要条件**：至少一个同 uid 不可重写的链外记录（远端、人类签署的 checkpoint、第二存储）。没有外部锚，只能声称“检测意外损坏”，不能声称审计闭合。
- 外部锚运行规格：
  - 创世：`init` 时写 `GENESIS` 条目（首条 hash + 注册表 sha256 + 时间）到锚目标；失败则 `init` 失败，不静默降级。
  - 触发：每次 CLI 调用时检查距上次锚是否超过 10 分钟；每 50 条事件也触发。不是后台定时器，符合零常驻进程承诺；`done`/`fail` 后若距上次锚超过阈值，再尝试一次。
  - 锚目标：配置 `anchor: {type, target, signer}`；发布门只认 **`command`（人类/外部签署命令）**、**`remote`（不同主机/服务）**、**`human-checkpoint`（人类签署记录）**。同机同 uid 的 `file` 只能作本地检查点，**不计入外部锚**，不能单独满足发布门。
  - 不可达：`claim`/`done` 可继续，但台账记 `ANCHOR-DEGRADED`；`verify` 返回 `ANCHOR-STALE`，审计闭合声明为假，`release`/publish 被门拒绝。
  - 不许把“最后一次成功锚之前”的链窗口说成已闭合；同 uid 可整段重写该窗口，这是已知残余风险。

### 8.5 租约语义

- `epoch` 单调递增；每次重新认领换新 epoch。
- 租约含 `actor`、`pid`、`host`、`acquired_at`、`heartbeat_at`、`expires_at`。
- `renew` 只允许同 actor 同 epoch；过期即 `LEASE-EXPIRED`。
- 租约含 `max_hold`（默认 `max(2*ttl, 30m)`）；超过 `max_hold` 后同一 owner 再 renew 即 `LEASE-MAX-HOLD`。
- 超过 `max_hold` 允许其他 actor `claim --steal`，记录 `lease.steal`（前 owner、epoch、max_hold、证据）；同 actor 不能靠无限 renew 永久占格。
- 崩溃或过期可被后来者接管；恶意认领者最多延迟 `max_hold`，不能永久阻塞格子。
- 必须有并发认领、过期接管、活进程持锁、死进程回收、max_hold 抢占的对抗测试。

### 8.6 回执

字段：`cell`、`actor`、`epoch`、`status`、`summary`、`commands[{cmd,exit}]`、`artifacts[{path,sha256}]`、`reads[]`。

影子试点额外字段：`mode:"shadow"`、`shadow_of`、wave 前缀 `shadow-`。

规则：

- `done` 时所有命令 exit=0。
- 每个 artifact 必须存在、是普通文件、realpath 在 `allowed_roots` 内、不在禁触面内；写入后取 realpath 和 sha256，拒绝符号链接交换。
- `reads` 必须在 `allowed_roots` 或 `read_roots` 内。
- 回执证明“路径与内容哈希”，不证明内容善意；同 uid 可在自己的允许根内写任意字节。文档必须这样写。
- 回执校验失败不得改变格子状态。
- `mode:"shadow"` 的回执永远不是 PCB 审批证据；`verify` 必须拒绝把它当 `state/plan-approvals/**` 的替代。

### 8.7 CLI JSON 输出

稳定字段：`ok`、`code`、`message`、`wave`、`cell`、`actor`、`epoch`、`state`、`expires_at`、`receipt`、`violations`。

退出码：

- `0`：成功。
- `1`：用法错误或业务拒绝（可重试）。
- `2`：无法回答/配置缺失/契约失败（fail-closed）。

适配器私有：工具名、参数形状、宿主事件映射、显示文案。

---

## 9. 安全模型（按西比拉 must-fix 收敛）

必须写进 `SECURITY.md` 的硬话：

1. 本工具是**声明 + 回执校验**，不是沙箱。
2. 同 uid 的进程可以改状态、伪造回执、绕过清单；工具不能阻止，只能留下可核对记录。
3. 路径校验是字符串/前缀声明加 realpath 复核，存在 TOCTOU 窗口；真正的写拒绝在挂载层、独立 uid 或 VM。
4. 台账哈希链防意外损坏和事后改单，不防同 uid 一致重写；必须有外部锚才算审计闭合。
5. 回执里的产物哈希证明“这个文件当时是这个内容”，不证明内容安全。
6. 跨线只读是声明；真实拒绝属于沙箱/挂载层，是机主键。

必须实现的机械检查：

- 核心 import 门：`src/` 不得出现宿主 SDK。
- 写入后 realpath + sha256；符号链接交换失败。
- 配置/清单/回执 JSON schema 校验；null-prototype；大小上限；畸形输入 fail-closed。
- 台账单写者锁或原子追加；撕裂写恢复测试。
- 并发认领、过期接管、死进程回收测试。
- 禁触面缺失、宽根包含禁触面、跨线可写根拒绝测试。
- 发布门：license、private、provenance、契约测试、适配器测试。

---

## 10. 与 Abathur 的关系

AsylumWarden 是独立项目，不依赖 Abathur。Abathur 可以把它当外部 CLI/库调用。

**重复建设处置**：

- Abathur `tools/wave_engine/` 是参考实现，不是运行时；AsylumWarden 不复制它的代码，只借鉴清单校验、cwd/允许根、回执污染、饱和度等方法论。
- 产线根只能有一个权威源。迁移顺序：
  1. 冻结 `wave_engine`，不再加功能；
  2. 用 AsylumWarden 的 `asylumwarden.json` 做目标配置；
  3. 选一个真实波次双跑，逐项比较 ready/blocked/拒绝原因；
  4. 证明等价后，`line_roots.json` 转为只读归档；
  5. 文档只指向一个源。
- 在双跑通过前，不得删除 `wave_engine`，也不得让两套配置同时写。
- `orchestrate.py` 这类宿主特定适配留在原项目，不进 AsylumWarden 核心。

### 10.1 PCB 试点约束（2026-11-05 机主指定，机械版）

试点在 `/home/lab/workspace/harness/PCB-Agent` 的会话上下文里运行，但**不写 PCB 仓**。该仓有自己的硬控制面，试点必须服从，不得替换：

- `agents/pcb-orchestrator.md` 是唯一对外入口；内部与板级角色只能经 `pcb_dispatch` / `pcb_dispatch_batch` / `pcb_dispatch_write` / task91r 启动。
- 该文件明确 `task: false`；直接 `opencode run`、`task()`、手工编辑派工证据一律 `PCB_CONTROL_PLANE_DENIED`。
- 计划门 + 用户字面 `APPROVE` + capability 链是 PCB 的既有法律；AsylumWarden 不是第二套法律。
- 板级子会话只能读；写入层按政策；派工回执在 `reports/recovery/dispatches/`，请求文件消费为 `.consumed`。

**试点模式：shadow，只读影子，不接板级派工。**

固定配置（影子注册表文件：`/home/lab/.local/state/asylumwarden-shadow-pcb/shadow-registry.json`，是 §8.1 的具名例外）：

```json
{
  "version": 1,
  "mode": "shadow",
  "shadow_of": "<正式 registry sha256>",
  "shadow_home": "/home/lab/.local/state/asylumwarden-shadow-pcb",
  "lines": {
    "pcb": {
      "roots": ["/home/lab/.local/state/asylumwarden-shadow-pcb/workspace"],
      "forbidden_surfaces": [],
      "forbidden_absolute": [
        "/home/lab/workspace/harness/PCB-Agent/reports/recovery/dispatches/**",
        "/home/lab/workspace/harness/PCB-Agent/dispatches/**",
        "/home/lab/workspace/harness/PCB-Agent/state/plan-approvals/**",
        "/home/lab/workspace/harness/PCB-Agent/state/pending-plans/**",
        "/home/lab/workspace/harness/PCB-Agent/**/*.consumed"
      ],
      "read_roots": [
        "/home/lab/workspace/harness/PCB-Agent/reports/recovery/dispatches",
        "/home/lab/workspace/harness/PCB-Agent/state/plan-approvals",
        "/home/lab/workspace/harness/PCB-Agent/state/pending-plans"
      ]
    }
  }
}
```

机械规则：

0. **试点启动责任**：PCB 席在获批后创建 `/home/lab/.local/state/asylumwarden-shadow-pcb/workspace`（`install -d -m 0700`），把 `pilot.bootstrap`（actor、时间、目录、批准行）写入影子台账；根不存在时 `plan` fail-closed，**不自动创建**。Abathur 席不跨线创建。
1. `pcb.roots` **只能**是上述试点目录；禁止把 PCB 仓根登记为线根再用黑名单排除。校验器必须硬拒任何等于/包含 `/home/lab/workspace/harness/PCB-Agent` 的 root。
2. 跨线保护面用 `forbidden_absolute` 绝对路径；`forbidden_surfaces` 留空，避免相对路径错锚。`done` 必须拒绝这些绝对面内的产物，并让 `*.consumed` 也命中。
3. 试点期**不安装 opencode 适配器**：不把 `.opencode/plugins/AsylumWarden.js` 放进 PCB；`warden_*` 工具不得在 PCB 会话出现。只从独立 checkout 调 CLI，由 PCB 席执行。
4. 不直接启动任何 PCB 内部 agent；不写板、原理图、BOM、scenario、genome、grader。
5. **零板级写入机械验收**：试点前后各取一次 PCB 仓基线，四条都写入影子台账 `baseline.before` / `baseline.after`：
   - `git status --porcelain --ignored=matching`
   - `git rev-parse HEAD`
   - `git ls-files -s | sha256sum`
   - `for d in reports state dispatches; do if [ -d "$d" ]; then find "$d" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum; else printf '%s ABSENT\n' "$d"; fi; done`（不吞错误；缺目录逐项记 `ABSENT`）
   第 1 条覆盖 ignored/untracked 状态，第 4 条覆盖 `.consumed` 与派工证据内容；任一不一致即试点 FAIL，不靠口头声明。
6. 影子回执必须带 `mode:"shadow"`、`shadow_of`、wave 前缀 `shadow-`；`verify` 拒绝把影子回执当 `state/plan-approvals/**` 的替代。影子台账固定在 `shadow_home/ledger.jsonl`，**永不并入**正式 `~/.local/state/asylumwarden/ledger.jsonl`。
7. 成功判据：plan/ready/claim/done 链路可复算；ready/blocked 与 PCB 控制面的只读结论逐项一致；零板级写入；零直接 agent 启动。
8. 失败判据：任何绕过 `pcb_dispatch` 的启动；任何板级文件写入；任何把影子回执当 PCB 审批证据的行为；基线 diff 非空。

试点只证明“派单账本可移植”，不证明“可以替代 PCB 控制面”。要替代，必须另走 PCB 自己的政策变更门。

### 10.2 仓库清单（回答“还有哪里需要建仓库”）

只建一个源仓：

- GitHub：`TachikomaGundam/AsylumWarden`（唯一源仓）。
- 本地 checkout：`/home/lab/workspace/harness/AsylumWarden`（独立目录，不放进 Abathur）。
- npm 包：`asylumwarden`（无 scope，全小写），从同一个源仓发布，不另建仓。
- PyPI：v1 不发；未来若发，仍从同一源仓构建，不另建仓。
- 适配器包（`asylumwarden-opencode` / `asylumwarden-codex`）：先留在同一仓的 `adapters/`，等真有独立发布节奏再拆仓；现在不建。
- GitHub Actions、release、provenance：用同一个源仓，不建基础设施仓。
- 不建 Docker Hub、不建独立文档站、不建第二个镜像仓。

结论：**一个 GitHub 源仓 + 一个 npm 包名；没有第二个必须现在建立的仓库。**

---

## 11. 仓库结构（独立仓）

```text
AsylumWarden/
  package.json                 asylumwarden
  src/
    config/
    manifest/
    store/
    lease/
    receipt/
    ledger/
    views/
    cli/
  schemas/
    config.schema.json
    manifest.schema.json
    receipt.schema.json
    ledger.schema.json
  adapters/
    opencode/
  test/
    unit/
    contract/
    adversarial/
  docs/
    ARCHITECTURE.md
    CONTRACT.md
    SECURITY.md
    MIGRATION.md
    RELEASING.md
  README.md
  LICENSE
```

单独适配器包（可选，后续）：

- `asylumwarden-opencode`（未占名，后续确认）
- `asylumwarden-codex`（未占名，后续确认）
- Python 不建库，先用 CLI JSON；真有性能/类型需求再评估。

---

## 12. 里程碑与验收

### M0 架构（本 handoff 完成）

- 产物：本文件。
- 验收：决策、边界、契约、安全模型、迁移顺序齐全；不含代码。

### M1 契约与 schema

- 产物：四个 JSON Schema、契约测试骨架、错误码表。
- 验收：合法/畸形样例逐条通过；未知字段策略明确；无宿主 import；schema 明确 `shadow-registry.json` 路径、`forbidden_absolute` 解析、`kinds` 表、`max_hold`、shadow 回执字段；明确 `read_roots` 可否位于线根外、可否与 `forbidden_absolute` 重叠（读允许、写仍拒绝）。

### M2 核心与 CLI

- 产物：config/manifest/state/lease/receipt/ledger/views/CLI。
- 验收：单元测试 + 对抗测试；同 uid 边界文档与实现一致；台账撕裂写恢复；shadow 回执冒充 `state/plan-approvals/**` 必须被拒绝；`forbidden_absolute` 命中必须被 `done` 拒绝。

### M3 opencode 适配器

- 产物：薄适配器，只做参数映射和工具注册。
- 验收：核心不 import 宿主；适配器契约测试；插件不可用时 CLI 仍可用。

### M4 双跑与迁移

- 产物：一个真实波次的双跑报告；差异清单；迁移决定。
- 验收：ready/blocked/拒绝原因逐项一致；不一致有具名裁决；`wave_engine` 冻结。

### M5 发布（人类门）

- 产物：license、private=false、版本、provenance、release notes、npm 发布。
- 验收：发布门全绿；安装验证；供应链检查；GitHub 仓库名与 npm scope 一致。
- **发布前预检**：在 GitHub Actions 里实测无 scope 包 `asylumwarden` 在 `TachikomaGundam` **用户账号**仓库上的 npm provenance 校验（大小写匹配规则当场验证）；失败则改包名或 repo 命名并同步 §13，不靠猜测。

---

## 13. 发布、许可与名称

- 当前原型 `private: true`、`UNLICENSED`；**发布前必须改**。
- 新仓 `asylumwarden@0.0.0` 是**占名包**：已发布，`private: false`；功能版本从 `0.1.0` 开始。
- license：**MIT**（2026-11-05 机主已定）。不再二选一。
- npm 包名：`asylumwarden`（无 scope，全小写；npm 新包不允许大写）。
- 显示名/仓库名：`AsylumWarden`（大小写固定）。
- GitHub 仓库：`TachikomaGundam/AsylumWarden`（2026-11-05 机主已定；**用户账号**，不是组织）；`github.com/asylumwarden` 被休眠账号占用，不使用该路径；README 写明非隶属声明。
- GitHub 仓库当前为 **private**（2026-11-05 建仓）；M5 发布前由机主转 public，npm 才有公开源可链接。
- npm 包不带 scope；不假设存在 GitHub org-linkage；发布前在 Actions 实测 provenance 大小写匹配，失败则改包名或 repo 命名，不靠猜测。
- PyPI：v1 不发 Python 库；CLI 语言中立。未来发 `asylumwarden` 前重新查名。
- 发布必须带 provenance；npm token 不落盘；发布是机主键。

---

## 14. 风险与未决

### 已接受风险

- 同 uid 可改状态/伪造回执；工具只能记录，不能阻止。
- 路径校验存在 TOCTOU 窗口；真实拒绝在挂载层。
- 台账无外部锚时只能检测意外损坏。
- 共享状态目录一处损坏影响多线；需要备份与恢复流程。
- 宽允许根包含禁触面只能警告，不能硬拒（否则整仓根任务全灭）。
- PCB 基线快照覆盖 `reports/state/dispatches` 内容与 ignored 状态，但同 uid 可同时改工作树和台账；基线只能证明“两次探测之间无差异”，不能证明“没人动过”。

### 未决（需机主裁决）

1. GitHub 发布键由谁持有；是否启用 branch protection / required review。
2. 首轮双跑窗口多长；用哪个真实波次；PCB 席何时批准创建影子 workspace。
3. 外部锚采用远端、人类签署 checkpoint，还是第二存储。
4. `github.com/asylumwarden` 休眠账号是否需要在 README 中写非隶属声明（建议写，避免混淆）。

---

## 15. 当前原型处置

当前工作树里有未提交原型：

`/home/lab/workspace/harness/Abathur/plugins/AsylumWarden/`

状态：

- 12 个 Node 测试通过；
- 核心与 opencode 适配器已分开；
- **未提交、未发布、不可作为独立项目基线**；
- **2026-11-05 机主令“架构好后 handoff，不要开始写代码”后冻结，不再改。**

交接要求：

- 不把原型提交进 Abathur；
- 不把原型源码直接复制进新仓；
- 新项目按本 handoff 的契约重写，原型只作行为参考；
- 原型评审后可删除或归档，删除前先记录测试与文件清单。

---

## 16. 下一席开工顺序

1. 读本 handoff，确认 C 形态与独立项目边界。
2. 建独立仓（不要从 Abathur 复制源码）。
3. 先写 `ARCHITECTURE.md`、`CONTRACT.md`、`SECURITY.md`、四个 schema。
4. 写对抗测试清单，再写核心。
5. 适配器最后写，核心不得 import 宿主。
6. 双跑通过前不删 `wave_engine`，不发布。
7. 发布前把 license、private、provenance、契约测试、外部锚全部闭合。

---

## 17. 回执索引

- 西比拉审查文档：`/home/lab/workspace/harness/Abathur/.omo/evidence/sibyl-asylumwarden-distribution.md`
- 西比拉运行记录：`sibyl-20261105T055441Z-e7ef`
- 原型目录：`/home/lab/workspace/harness/Abathur/plugins/AsylumWarden/`
- 原型 README：`/home/lab/workspace/harness/Abathur/plugins/AsylumWarden/README.md`
- Abathur 派单条令：`/home/lab/workspace/harness/Abathur/docs/parallel-dispatch-doctrine.md`
- 跨线写入简报：`/home/lab/workspace/harness/Abathur/docs/cross-line-write-brief.md`

---

**交接状态：架构完成，代码冻结。**
