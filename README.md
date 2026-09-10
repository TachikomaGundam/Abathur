# abathur

An evolution harness for OpenCode agents: observe failures, mutate, re-bench,
select — with promotion held by a human gate. Offline lineage bundles let one
instance learn from another's evidence; nothing in v1 talks to a network.

一个面向 OpenCode 智能体的进化工装：观察失败、变异、重测、筛选——晋升决定始终由人把关。
离线血缘包（bundle）让一个实例基于另一个实例的证据学习；v1 不含任何联网传输。

## English

### What it is

- **genome** — a JSONC contract for one thing that can evolve: which bench
  units measure it (train/val split), how (commands, adapter type, timeout,
  statistics gates), what its evolution budget is, and which files are
  kernel-immutable. Identity is the sha256 content fingerprint of the parsed
  spec, never its label or filename.
- **bench** — an adapter that turns one genome tree into per-unit scores.
  v1 ships two types: `toy` (pure-node fixtures, zero model calls) and
  `opencode-fixture-scenarios` (real agent sessions against a live fixture
  service, scored by script-first graders). Every candidate is re-benched
  against the incumbent; todo-7 statistics gates decide.
- **bundle** — an offline lineage export (`.bundle.tgz`): generation trees,
  patch, ledger summaries, redacted train-only evidence, and a v1 manifest
  that `bundle inspect` re-verifies from the contained bytes. See
  [docs/federation.md](docs/federation.md).
- **graft** — importing a peer's bundle: four byte-exact gates, then a local
  re-bench at local reps and thresholds. The bundle's scores are recorded as
  `peerClaim` metadata and never feed nomination math.
- **run loop** — incumbent → brief (failure observations) → mutator session →
  candidate diffs → seal → re-bench → verdicts. Nominated generations sit in
  the quarantine queue until a human runs `promote`; `tombstone` buries them.
  Both are append-only ledger decisions; nothing is ever deleted.

### Install

```bash
npm i -g @tachikomagundam/abathur  # from the npm registry
npm pack                          # in a checkout; prepack runs the build
npm i -g ./abathur-0.1.0.tgz
abathur --help
```

Requires Node >= 22 and `git` on `PATH`. Only `zod` is a runtime dependency.
Real benches additionally need the `opencode` CLI (path via `opencodeBin` in
config or `PATH` lookup) and whatever a genome's `requires[]` probes name.

Config resolution is fail-closed: `$ABATHUR_CONFIG` (must exist when set) >
`~/.config/abathur/config.jsonc` > `<package>/config/abathur.jsonc`, with a
gitignored sibling `*.local.jsonc` deep-merged on top. Unknown keys are exit 2.
All writable state lives under the config dir — genome registry
`<configDir>/genomes/<fp16>.jsonc`, kernel manifests `<configDir>/kernels/`,
friction queue `<configDir>/friction.jsonl`, pending-graft queue
`<configDir>/graft-queue/` — never inside the package; each genome's ledger
rides its own repo at `<repoPath>/.state/abathur/ledger.jsonl` (gitignored).

Two setups need more than the tarball:

- **abathur-self** (self-evolution): `export ABATHUR_SELF_REPO=<path>` pointing
  at a **git checkout** of this harness with its `node_modules` installed
  (`npm ci`). The seed spec `genomes/abathur-self.jsonc` is registered from
  that checkout — the self-bench builds candidate trees with the checkout's
  pinned toolchain, so this genome does not run from the npm package alone.
- **historian**: the operator workflow is its own section below.

### Quick start: the zero-model toy loop

No models, no network: the `toy-smoke` genome ships inside the package
(`dist/genomes/toy-smoke/`) and carries a seeded bug — `add()` subtracts.

```bash
mkdir -p ~/abathur-demo && cd ~/abathur-demo
export ABATHUR_PKG="$(npm root -g)/abathur"

# 1. materialize an independent toy genome repo (git init + repoPath rewritten)
node "$ABATHUR_PKG/dist/genomes/toy-smoke/init.mjs" ./genome
abathur genome add ./genome/genome.jsonc

# 2. a mutator is a command template, not a flag you can skip: `run` exits 2
#    without --mutator. Write the smallest legal one — it must print
#    {"candidates":[{"id","rationale","diffs":[unified-diff]}]} to stdout.
cat > toy-stub.mjs <<'EOF'
// toy-stub.mjs — minimal mutator driver: reads the scripted-patch table
// shipped inside the abathur package and emits it as candidate JSON; the
// harness applies and benches every candidate itself.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (n) => args[args.indexOf(n) + 1];
const { scriptedPatches } = await import(pathToFileURL(opt("--lib")).href);

const candidates = [];
for (const patch of scriptedPatches()) {
  const lines = readFileSync(`${opt("--dir")}/${patch.file}`, "utf8").split("\n");
  const i = lines.findIndex((line) => line.includes(patch.from));
  if (i < 0) continue; // anchor already consumed — nothing to propose here
  candidates.push({
    id: patch.id,
    rationale: patch.description,
    diffs: [
      `--- a/${patch.file}\n+++ b/${patch.file}\n@@ -${i + 1},1 +${i + 1},1 @@\n` +
      `-${lines[i]}\n+${lines[i].replace(patch.from, patch.to)}\n`,
    ],
  });
}
process.stdout.write(`${JSON.stringify({ candidates })}\n`);
EOF

# 3. evolve: {worktree} and {brief} are rendered by the harness; the template
#    is spawned as argv, never through a shell.
abathur run --genome toy-smoke \
  --mutator "node $PWD/toy-stub.mjs --lib $ABATHUR_PKG/dist/core/evolve/stub-mutators.mjs --dir {worktree} --brief {brief}"
```

Typical output (toy budgets make this take seconds):

```
incumbent baseline: 4 units x 2 reps
candidate fix-add [tree cbc27a991cf9]: nominated (gain 0.5000, reps 2)
candidate break-mul [tree 52b89d61da91]: culled (gain -0.3333, reps 2)
  gate: gain -0.3333 < minEffect 0.5000
...
budget spent: candidates=4 tokens=4338 wallS=7.542 (caps candidates=4 tokens=100000 wallS=300)
```

Then read, decide, and hand the winner around:

```bash
abathur status toy-smoke                     # read-only ledger view
abathur promote toy-smoke g-...              # human gate — the ONLY path to a new incumbent
abathur bundle export toy-smoke --gen g-... --out ./bundles   # offline lineage
abathur bundle inspect ./bundles/*.bundle.tgz
abathur graft ./bundles/*.bundle.tgz --genome toy-smoke       # local re-bench of a peer bundle
abathur run --genome toy-smoke --dry-run     # plan + requires[] probes, zero spawns
```

### The historian genome and the operator workflow

`historian` is the first real genome: OpenCode agents work wiki scenarios
against a live Wiki.js fixture; script-first graders score dimensions A–J with
a hard G gate. `config/genomes/historian.example.jsonc` is a **template** —
every machine-specific value is a `${VAR}` placeholder, because repo-tracked
files carry zero machine literals. Only `repoPath` has built-in env resolution
(`effectiveRepoPath`, `src/core/spec.ts`); `requires[]` probes and every
command string are spawned as argv, never through a shell, so `${VAR}` inside
them does **not** expand. The operator resolves the template:

1. Keep a historian bench repo checkout (`scenarios/`, `rubric.md`,
   `seed_sandbox.sh`, `baseline/**`), a running wiki, and the wiki-ops CLI.
2. Copy the example to a private `*.local.jsonc` file (the gitignore pattern
   covers it anywhere in the tree) and substitute every placeholder with the
   real absolute paths / URLs; then `abathur genome add` **that** file.
   The printed fingerprint is deterministic per resolved path set (on the
   orchestrator's machine: `2b2456be6cddcb91` — yours will differ with your
   paths, and stay stable for them).
3. Live-run environment the operator must keep: `~/.wikijs-api-key` in the
   **parent** HOME (the `requires[]` probe child inherits the parent env and
   reads it directly), and `ABATHUR_WIKI_KEY_FILE` — the sandbox-side scripts
   reinstall the key into each mirrored sandbox home, because `resetCommand`
   wipes the sandbox HOME mirror before every unit (hook order: reset runs
   before the mirror, so anything hooks need must be re-installed per unit).
4. `export ABATHUR_JUDGE_MODEL=...` is mandatory even when empty: the
   grader-side `opencode` invocations error out on an unset variable, not on
   an empty one.
5. Prove setup without model spend: `abathur run --genome historian --dry-run`
   runs every `requires[]` probe and prints the plan; zero engines spawn.

Real runs launch `opencode` headless and cost tokens. Budgets
(`budget.maxCandidates/maxModelCalls/maxTokens/maxWallS`) are hard stops —
crossing one truncates to `inconclusive` (exit 2), never to a fake pass.

### D7 decoupling guarantees

- The genome registry and every writable artifact live **out-of-tree** under
  the config dir; the npm package directory is read-only at runtime.
- Repo-tracked files contain **zero** machine or product literals. The CI
  gate: `grep -rnE '/home/lab|historian' src/` yields nothing outside
  `src/test/**` fixtures. Config templates spell out placeholders instead.
- Machine paths enter only through config and env: a `${VAR}`-literal
  `repoPath` fingerprints over the **unresolved** bytes, so spec identity is
  machine-independent (abathur-self: `1913fcec…` everywhere) and resolves
  only at filesystem seams; unset env exits 2 naming the variable.
- Identity is always the content fingerprint, never a label: two byte-equal
  specs are the same genome on any machine; labels are free and may repeat.
- Adapters are a closed `bench.type` registry; a genome without a known
  adapter type is exit 2, never a guess.

### Kernel seal and self-evolution

Every registered genome's `kernel.immutableGlobs` are hashed into a sealed
manifest under `<configDir>/kernels/`; benches and self-eval refuse to run on
a drifted tree, mutator candidates touching sealed paths are rejected at the
path stage, and only human `promote` reseals — from the promoted tree.
`abathur kernel audit <label>` verifies the seal against the working tree.
The full contract (what `abathur-self` may and may not touch, the
snapshot-overlay bench, why v1 self-evolution cannot change dependencies or
build configuration) is [docs/immutable-kernel.md](docs/immutable-kernel.md).

### Federation: bundles now, transport later

v1 ships the **format and the local tools**, not a network. A bundle is a
file you carry by any means you like; `bundle export` is deterministic —
re-exporting an unchanged ledger produces byte-identical tarballs, and the
byte-equality rule extends to every graft gate. Graft admits a peer lineage
only when genome fingerprint, benchDigest, scoring provenance, and
`requires[]` probes all recompute byte-equal **locally**; anything else
quarantines, queues as pending-bench, or refuses, with the decision booked to
the ledger. No noise-tolerance band, no `--force`, no bypass. Discovery,
transport, auto-merge, and auto-promotion are explicitly **out of scope**.
The schema field-for-field, the inspect gate order, and the graft decision
table are [docs/federation.md](docs/federation.md).

### Operator duties

- **Single-flight contract**: at most one live bench per genome fingerprint
  per shared fixture service. The genome lock `run`/`graft` take is a
  **machine-local** file lock (it serializes worktrees, sandboxes, and the
  ledger on one box). Historian benches share a wiki through `resetCommand`,
  which purges the entire `_sandbox/*` namespace — two machines benching the
  same historian genome against one wiki will clobber each other mid-run.
  Cross-machine serialization of historian benches is the operator's
  responsibility (schedule, lockbox, one-wiki-one-bench rule — your call).
- Promotion and burial are yours alone: `promote`/`tombstone` carry no
  `--confirm` because the CLI invocation **is** the gate; there is no
  `--force` anywhere in the binary. Review `abathur status` quarantine depth
  and the `graft decisions` rows before promoting.
- Stale pending-bench queue entries (`<configDir>/graft-queue/`) mean a
  bundle waits on setup — register the genome or repair a probe, then re-run
  `graft`; terminal decisions retire the entry automatically.
- Keep `~/.wikijs-api-key` valid and `ABATHUR_JUDGE_MODEL` exported for
  historian work; budget caps are per-run hard stops, so raise them
  deliberately in the spec, never by re-running off-book.

### Exit codes

The contract, every command, no exceptions:

- `0` — ok / pass / nominated.
- `1` — blocked: a recorded **decision** (culled, indeterminate, quarantined,
  promote refusal, pending unregistered genome).
- `2` — cannot-answer: config error, malformed input, missing engine, probe
  pending, budget-truncated (inconclusive). Never a silent skip.

### License

MIT, see [LICENSE](LICENSE).

## 中文

### 它是什么

- **genome（基因组）**——一份 JSONC 契约，描述一个可进化的对象：用哪些 bench
  单元（train/val 划分）度量它、怎么度量（命令、适配器类型、超时、统计闸门）、
  进化预算是多少、哪些文件属于内核不可变区。身份是解析后规格内容指纹（sha256），
  绝不是标签或文件名。
- **bench（基准）**——把一棵基因组树变成逐单元分数的适配器。v1 内置两种类型：
  `toy`（纯 node 夹具，零模型调用）与 `opencode-fixture-scenarios`（真实智能体
  会话对着在线夹具服务运行，由 script-first 评分器打分）。每个候选都与在位者
  （incumbent）重测对比；统计闸门出裁决。
- **bundle（血缘包）**——离线血缘导出（`.bundle.tgz`）：各代树内容、补丁、台账
  摘要、经脱敏的仅 train 证据，以及一份 v1 manifest；`bundle inspect` 会从包内
  字节重新验证一切。详见 [docs/federation.md](docs/federation.md)。
- **graft（嫁接）**——导入对端的血缘包：四道字节级闸门，然后按本地 reps 与本地
  阈值做本地重测。包里的分数只作为 `peerClaim` 元数据记录，永远不参与提名数学。
- **run 循环**——在位者 → brief（失败观察）→ 变异会话 → 候选 diff → 封印 →
  重测 → 裁决。被提名的一代会停留在隔离队列里，直到人类执行 `promote`；
  `tombstone` 则埋葬它。两者都是只追加的台账决定；任何数据都不删除。

### 安装

```bash
npm i -g @tachikomagundam/abathur  # 从 npm registry 安装
npm pack                          # 在 checkout 里执行；prepack 会先构建
npm i -g ./abathur-0.1.0.tgz
abathur --help
```

需要 Node >= 22 与 `PATH` 上的 `git`。运行时依赖只有 `zod`。真实基准还需要
`opencode` CLI（通过配置里的 `opencodeBin` 或 `PATH` 解析），以及基因组
`requires[]` 探针点名的那些工具。

配置解析是 fail-closed：`$ABATHUR_CONFIG`（设置就必须存在）>
`~/.config/abathur/config.jsonc` > `<package>/config/abathur.jsonc`，同级
gitignored 的 `*.local.jsonc` 会深合并覆盖其上。未知键直接 exit 2。
所有可写状态都在配置目录下——基因组注册表 `<configDir>/genomes/<fp16>.jsonc`、
内核清单 `<configDir>/kernels/`、摩擦队列 `<configDir>/friction.jsonl`、
待嫁接队列 `<configDir>/graft-queue/`——绝不写进包目录；每个基因组的台账跟随
其自身仓库位于 `<repoPath>/.state/abathur/ledger.jsonl`（gitignored）。

两种场景不是装个 tarball 就够：

- **abathur-self**（自我演化）：`export ABATHUR_SELF_REPO=<路径>` 指向本工装
  的一个 **git checkout**，且其中 `node_modules` 已安装（`npm ci`）。种子规格
  `genomes/abathur-self.jsonc` 从那个 checkout 注册——self-bench 用该 checkout
  钉住的工具链构建候选树，所以这个基因组不能只靠 npm 包运行。
- **historian**：操作员工作流见下文独立小节。

### 快速上手：零模型玩具环

不调模型、不联网：`toy-smoke` 基因组就随包发布（`dist/genomes/toy-smoke/`），
且预埋了一个 bug——`add()` 做的是减法。

```bash
mkdir -p ~/abathur-demo && cd ~/abathur-demo
export ABATHUR_PKG="$(npm root -g)/abathur"

# 1. 物化一个独立的玩具基因组仓库（git init + 重写 repoPath）
node "$ABATHUR_PKG/dist/genomes/toy-smoke/init.mjs" ./genome
abathur genome add ./genome/genome.jsonc

# 2. 变异器是一条命令模板，不是可跳过的可选项：没有 --mutator，run 直接 exit 2。
#    写一个最小合法实现——它必须向 stdout 打印
#    {"candidates":[{"id","rationale","diffs":[unified-diff]}]}。
cat > toy-stub.mjs <<'EOF'
// toy-stub.mjs — minimal mutator driver: reads the scripted-patch table
// shipped inside the abathur package and emits it as candidate JSON; the
// harness applies and benches every candidate itself.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (n) => args[args.indexOf(n) + 1];
const { scriptedPatches } = await import(pathToFileURL(opt("--lib")).href);

const candidates = [];
for (const patch of scriptedPatches()) {
  const lines = readFileSync(`${opt("--dir")}/${patch.file}`, "utf8").split("\n");
  const i = lines.findIndex((line) => line.includes(patch.from));
  if (i < 0) continue; // anchor already consumed — nothing to propose here
  candidates.push({
    id: patch.id,
    rationale: patch.description,
    diffs: [
      `--- a/${patch.file}\n+++ b/${patch.file}\n@@ -${i + 1},1 +${i + 1},1 @@\n` +
      `-${lines[i]}\n+${lines[i].replace(patch.from, patch.to)}\n`,
    ],
  });
}
process.stdout.write(`${JSON.stringify({ candidates })}\n`);
EOF

# 3. 进化：{worktree} 和 {brief} 由工装渲染；模板按 argv 直接 spawn，绝不经过 shell。
abathur run --genome toy-smoke \
  --mutator "node $PWD/toy-stub.mjs --lib $ABATHUR_PKG/dist/core/evolve/stub-mutators.mjs --dir {worktree} --brief {brief}"
```

典型输出（玩具预算下几秒跑完）：

```
incumbent baseline: 4 units x 2 reps
candidate fix-add [tree cbc27a991cf9]: nominated (gain 0.5000, reps 2)
candidate break-mul [tree 52b89d61da91]: culled (gain -0.3333, reps 2)
  gate: gain -0.3333 < minEffect 0.5000
...
budget spent: candidates=4 tokens=4338 wallS=7.542 (caps candidates=4 tokens=100000 wallS=300)
```

随后查看、拍板、把优胜者传出去：

```bash
abathur status toy-smoke                     # 只读台账视图
abathur promote toy-smoke g-...              # 人类闸门——通往新在位者的唯一路径
abathur bundle export toy-smoke --gen g-... --out ./bundles   # 离线血缘
abathur bundle inspect ./bundles/*.bundle.tgz
abathur graft ./bundles/*.bundle.tgz --genome toy-smoke       # 对端血缘包的本地重测
abathur run --genome toy-smoke --dry-run     # 计划 + requires[] 探针，零 spawn
```

### 历史学家基因组与操作员工作流

`historian` 是第一个真实基因组：OpenCode 智能体对着在线 Wiki.js 夹具完成 wiki
场景；script-first 评分器按 A–J 维度打分并有硬性 G 闸门。
`config/genomes/historian.example.jsonc` 是一份**模板**——每个机器相关值都是
`${VAR}` 占位符，因为仓库跟踪的文件里机器字面量为零。只有 `repoPath` 有内置的
环境变量解析（`effectiveRepoPath`，`src/core/spec.ts`）；`requires[]` 探针与所有
命令字符串都是 argv 直接 spawn、绝不经过 shell，所以其中的 `${VAR}` **不会**展开。
操作员需要解析模板：

1. 备好 historian 基准仓库的 checkout（`scenarios/`、`rubric.md`、
   `seed_sandbox.sh`、`baseline/**`）、一个运行中的 wiki，以及 wiki-ops CLI。
2. 把模板复制成私有的 `*.local.jsonc` 文件（gitignore 规则在树的任何位置都覆盖
   它），把每个占位符替换为真实的绝对路径 / URL；然后对**那份文件**执行
   `abathur genome add`。打印出的指纹对每组解析后的路径是确定性的（编排者机器上
   是 `2b2456be6cddcb91`——你的路径会得到不同的值，但对那些路径保持稳定）。
3. 操作员必须维护的实跑环境：**父级** HOME 里的 `~/.wikijs-api-key`（`requires[]`
   探针子进程继承父环境并直接读取它），以及 `ABATHUR_WIKI_KEY_FILE`——沙箱侧脚本
   会把密钥重装进每个镜像沙箱 HOME，因为 `resetCommand` 在每个单元运行前会清空
   沙箱 HOME 镜像（钩子顺序：reset 先于 mirror 执行，钩子需要的东西必须逐单元重装）。
4. `export ABATHUR_JUDGE_MODEL=...` 是强制的，即使为空：评分侧的 `opencode` 调用
   遇到**未设置**的变量会报错，遇到空值不会。
5. 不花模型费用验证环境：`abathur run --genome historian --dry-run` 会跑完所有
   `requires[]` 探针并打印计划；零引擎 spawn。

真实 run 会启动 `opencode` headless 并消耗 token。预算
（`budget.maxCandidates/maxModelCalls/maxTokens/maxWallS`）是硬停——越线截断为
`inconclusive`（exit 2），绝不会伪装成通过。

### D7 解耦保证

- 基因组注册表与一切可写产物都在**树外**、配置目录下；运行时 npm 包目录只读。
- 仓库跟踪的文件里**零**机器 / 产品字面量。CI 闸门：`grep -rnE '/home/lab|historian' src/`
  在 `src/test/**` 夹具之外一无所获。配置模板用占位符表达。
- 机器路径只从配置与环境变量进入：`${VAR}` 字面量形式的 `repoPath` 按**未解析**
  字节参与指纹计算，因此规格身份与机器无关（abathur-self 在任何机器都是
  `1913fcec…`），只在文件系统接缝处解析；变量未设置就 exit 2 并点名该变量。
- 身份永远是内容指纹、不是标签：两份字节相同的规格在任何机器上都是同一个基因组；
  标签自由、可重复。
- 适配器是封闭的 `bench.type` 注册表；遇到未知适配器类型的基因组是 exit 2，
  绝不猜测。

### 内核封印与自我演化

每个注册基因组的 `kernel.immutableGlobs` 都会被哈希成 `<configDir>/kernels/`
下的封印清单；工作树漂移时基准与 self-eval 拒绝运行；触碰封印路径的变异候选在
路径阶段即被拒绝；只有人类 `promote` 会重新封印——且从被晋升的树封印。
`abathur kernel audit <label>` 对照工作树验证封印。完整契约（`abathur-self`
能碰什么、不能碰什么，快照覆盖式基准，为什么 v1 自我演化不能改依赖和构建配置）
在 [docs/immutable-kernel.md](docs/immutable-kernel.md)。

### 联邦：先有捆绑包，后有传输

v1 交付的是**格式和本地工具**，不是网络。bundle 是一个你用任何方式搬运的文件；
`bundle export` 是确定性的——账本未变时重复导出产出字节相同的 tarball，
字节相等规则贯穿所有嫁接闸门。只有当基因组指纹、benchDigest、评分溯源与
`requires[]` 探针全部在**本地**重算为字节相等时，graft 才接纳对端血缘；其余情况
一律隔离（quarantine）、排队（pending-bench）或拒绝，并把决定记入台账。
没有噪声容忍带，没有 `--force`，没有绕行。发现、传输、自动合并、自动晋升全部
明确**不在范围内**。逐字段的 schema、inspect 闸门顺序、graft 决策表见
[docs/federation.md](docs/federation.md)。

### 操作员职责

- **单飞契约**：每个基因组指纹、每个共享夹具服务，最多只有一个在跑的基准。
  `run`/`graft` 获取的基因组锁是**机器本地**的文件锁（它只在单机内串行化
  worktree、沙箱与台账）。historian 基准通过 `resetCommand` 共享 wiki，而它会
  清空整个 `_sandbox/*` 命名空间——两台机器拿同一个 historian 基因组对着同一个
  wiki 跑基准，会在运行中互相踩掉对方。historian 基准的跨机串行化是操作员的
  职责（排班、锁柜、一 wiki 一基准——随你选哪种）。
- 晋升与埋葬只属于你：`promote`/`tombstone` 不带 `--confirm`，因为 CLI 调用本身
  **就是**闸门；整个二进制里没有 `--force`。晋升前先查看 `abathur status` 的
  隔离深度与 `graft decisions` 行。
- 待嫁接队列（`<configDir>/graft-queue/`）里的陈旧条目表示某个 bundle 在等环境
  就绪——注册好基因组或修好探针，再跑一次 `graft`；终态决定会自动移除队列条目。
- 做 historian 工作时保持 `~/.wikijs-api-key` 有效、`ABATHUR_JUDGE_MODEL` 已导出；
  预算上限是每次运行的硬停，要提就在规格里郑重地提，不要在账外反复重跑。

### 退出码

对每个命令、无一例外的契约：

- `0`——ok / pass / nominated。
- `1`——blocked：已记录的**决定**（culled、indeterminate、quarantined、
  晋升被拒、未注册基因组的 pending）。
- `2`——cannot-answer：配置错误、输入畸形、引擎缺失、探针未就绪、预算截断
  （inconclusive）。绝不会静默跳过。

### 许可

MIT，见 [LICENSE](LICENSE)。
