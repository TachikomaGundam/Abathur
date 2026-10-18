# abathur

An evolution harness for OpenCode agents: observe failures, mutate, re-bench,
select — with promotion held by a human gate. Offline lineage bundles let one
instance learn from another's evidence; the harness itself performs no network
transport in v1 (model and fixture traffic is whatever your bench spawns).

一个面向 OpenCode 智能体的进化工装：观察失败、变异、重测、筛选——晋升决定始终由人把关。
离线血缘包（bundle）让一个实例基于另一个实例的证据学习；v1 工装自身不含任何联网传输（模型与夹具流量取决于你的 bench 起了什么）。

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
  against the incumbent; the statistics gates decide.
- **bundle** — an offline lineage export (`.bundle.tgz`): generation trees,
  patch, ledger summaries, redacted train-only evidence, and a v1 manifest
  that `bundle inspect` re-verifies from the contained bytes. See
  [docs/federation.md](docs/federation.md).
- **graft** — importing a peer's bundle: four byte-exact gates, then a local
  re-bench at local reps and thresholds. The bundle's scores are recorded as
  `peerClaim` metadata and never feed nomination math.
- **run loop** — incumbent → brief (failure observations) → mutator session →
  candidate diffs → seal → re-bench → verdicts. Nominated generations sit in
  the quarantine queue until a human runs `promote`; `tombstone` buries them; `retract` undoes a promote (LIFO, descendant-guarded); `re-adjudicate <label> <genId>` re-computes a verdict from ledger state without spawning engines (terminal-only).
  All three are append-only ledger decisions; nothing is ever deleted.

### Install

```bash
npm i -g @tachikomagundam/abathur  # from the npm registry
npm pack                          # in a checkout; prepack runs the build
npm i -g ./tachikomagundam-abathur-*.tgz   # glob: npm pack emits the current version — never pin it here
abathur --help
```

Requires Node `^22.22.2 || ^24.15.0 || >=26.0.0` and `git` on `PATH`. The core
runtime depends only on `zod`. The optional OpenCode adapter requires its host
to resolve the `@opencode-ai/plugin` peer.
Real benches additionally need the `opencode` CLI (path via `opencodeBin` in
config or `PATH` lookup) and whatever a genome's `requires[]` probes name.

Config resolution is fail-closed: `$ABATHUR_CONFIG` (must exist when set) >
`~/.config/abathur/config.jsonc` > `<package>/config/abathur.jsonc`, with a
gitignored sibling `*.local.jsonc` deep-merged on top; with none of the three
files present, built-in defaults apply. Unknown keys are exit 2.
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
export ABATHUR_PKG="$(npm root -g)/@tachikomagundam/abathur"

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

### Inside opencode

Abathur ships an official opencode plugin adapter. The harness remains the
orchestrator, but once set up an opencode session can also drive the CLI
directly. Two install routes:

Both routes deliver the tool **and** the `/abathur` slash command; pick by
taste — A needs no edit of your opencode config and works fully offline, B
needs no file copying and removes with one deleted line.

**Route A — one command (file-copy installer).**

```bash
npm i -g @tachikomagundam/abathur
abathur opencode install    # copies plugin assets into ~/.config/opencode/
# restart opencode
```

**Route B — config only (auto-downloaded from npm).** Put the package name in
your opencode config and restart:

```jsonc
{ "plugin": ["@tachikomagundam/abathur"] }
```

opencode then downloads the package from npm at startup into its own cache
(`~/.cache/opencode/packages/…`) and loads the package's `./server` export —
no file copying, no uninstall step (delete the line). Since 0.2.3 the plugin
also self-registers `/abathur` through its `config` hook: slash commands are
entries in the merged config's `command` map, and a plugin may add one there
— the upstream `opencode-acp` plugin registers `/acp` the same way (the
0.2.0–0.2.2 note here claiming plugins cannot register slash commands was
wrong; corrected). If Route A's copied `commands/abathur.md` exists it stays
authoritative — the injection never overwrites it, and the name-keyed command
map means `/abathur` can never appear twice. One honest limit stands for both
routes: the tool spawns the `abathur` **CLI**, which must exist on `PATH` (or
via `ABATHUR_BIN`) — keep the `npm i -g` install.

Either route gives the session:

- the agent tool **`abathur`** — spawns the `abathur` CLI argv-only (never a
  shell), restricted to eight commands (`genome`, `run`, `status`, `bundle`,
  `graft`, `self-eval`, `kernel`, `--help`), with a 120 s timeout and a 64 KB
  output cap. The binary resolves from `PATH` unless `ABATHUR_BIN` overrides
  it. Honest privilege note: the tool carries bash-equivalent privilege —
  `run` and `genome` legitimately spawn mutator/engine binaries by design —
  so the allowlist limits typos and UX, not capability. `promote`,
  `tombstone` and `retract` are deliberately NOT reachable through the tool:
  they are human gates and must be run in a terminal.
- the user command **`/abathur <args…>`** — a slash command that tells the
  agent to translate its arguments into a tool call and report the exit code.
  Route A provides it as the copied `commands/abathur.md` file; Route B gets
  it from the plugin's `config` hook at startup.

Route A ships its own manager commands: `abathur opencode status` shows each
target's path, installed/packaged sha256, and state (up-to-date / outdated /
foreign / absent).
`abathur opencode uninstall` removes only files carrying the abathur marker. A
foreign file at a target path makes `install` and `uninstall` refuse with exit 2
and name the path, while `status` reports the foreign state and exits 0 (it
observes; it does not act) — nothing is ever overwritten or deleted behind your back (there is
still no `--force` anywhere).

Caveat: fixture benches mirror the real `~/.config/opencode` (plugins and
commands included) into their sandboxed HOMEs, so an installed plugin also
loads inside bench sessions. Uninstall first if a bench needs a clean plugin
environment.

### Optional bench integrations

The npm package ships the generic fixture adapter, not any service-specific
bench. A Wiki.js, CAD, or other external-service integration belongs in its
own checkout and must provide its own private genome specification, fixtures,
grader, credentials, and service lifecycle. The core package accepts that
specification only when its commands and prerequisites pass the normal
fail-closed probes. It never supplies a provider default or credentials.

### D7 decoupling guarantees

- The genome registry and every writable artifact live **out-of-tree** under
  the config dir; the npm package directory is read-only at runtime.
- Source under `src/` contains **zero** machine or product literals
  (`src/test/**` fixtures are exempt by design). The CI gate scans `src/` for
  its configured machine-root sentinel and `historian`; it yields nothing
  outside `src/test/**` fixtures. Config templates spell out placeholders
  instead.
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
  **machine-local** file lock. Cross-machine serialization of any external
  fixture service is the integration operator's responsibility.
- Promotion, burial and retraction are yours alone: `promote`/`tombstone`/`retract` carry no
  `--confirm` because the CLI invocation **is** the gate; there is no
  `--force` anywhere in the binary. Review `abathur status` quarantine depth
  and the `graft decisions` rows before promoting.
- Stale pending-bench queue entries (`<configDir>/graft-queue/`) mean a
  bundle waits on setup — register the genome or repair a probe, then re-run
  `graft`; terminal decisions retire the entry automatically.
- Keep each external integration's credentials and binaries outside this
  package. Budget caps are per-run hard stops, so raise them deliberately in
  the spec, never by re-running off-book.

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
  `tombstone` 则埋葬它，`retract` 可撤销一次 promote（LIFO，受后代守卫）；`re-adjudicate <label> <genId>` 不启动引擎、纯从台账重算裁决记录（仅终端可达）。三者都是只追加的台账决定；任何数据都不删除。

### 安装

```bash
npm i -g @tachikomagundam/abathur  # 从 npm registry 安装
npm pack                          # 在 checkout 里执行；prepack 会先构建
npm i -g ./tachikomagundam-abathur-*.tgz   # 通配即当前版——npm pack 产出带版本号，此处永不钉死
abathur --help
```

需要 Node `^22.22.2 || ^24.15.0 || >=26.0.0` 与 `PATH` 上的 `git`。核心运行时只依赖
`zod`。可选 OpenCode 适配器要求宿主解析 `@opencode-ai/plugin` peer。真实基准还需要
`opencode` CLI（通过配置里的 `opencodeBin` 或 `PATH` 解析），以及基因组
`requires[]` 探针点名的那些工具。

配置解析是 fail-closed：`$ABATHUR_CONFIG`（设置就必须存在）>
`~/.config/abathur/config.jsonc` > `<package>/config/abathur.jsonc`，同级
gitignored 的 `*.local.jsonc` 会深合并覆盖其上；三者皆不存在时用内置默认。未知键直接 exit 2。
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
export ABATHUR_PKG="$(npm root -g)/@tachikomagundam/abathur"

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

### 在 opencode 里调用

Abathur 自带官方 opencode 插件适配器。工装仍是编排者，但配置之后，opencode
会话也可以直接驱动 CLI。安装有两条路线：

两条路线都交付工具**和** `/abathur` 斜杠命令，按喜好挑选：A 不必改动你的
opencode 配置、且完全离线可用；B 不复制任何文件、删掉一行即卸载。

**路线 A——一条命令（文件复制安装器）。**

```bash
npm i -g @tachikomagundam/abathur
abathur opencode install    # 把插件资产复制进 ~/.config/opencode/
# 重启 opencode
```

**路线 B——纯配置（自动从 npm 下载）。** 把包名写进 opencode 配置再
重启：

```jsonc
{ "plugin": ["@tachikomagundam/abathur"] }
```

opencode 会在启动时自行从 npm 把包下载到它自己的缓存
（`~/.cache/opencode/packages/…`）并加载该包的 `./server` 导出——不复制文件，
也没有 uninstall 步骤（删掉那行即可）。自 0.2.3 起，插件还会通过它的
`config` 钩子自注册 `/abathur`：斜杠命令本质是合并后配置的 `command`
映射里的条目，插件可以在钩子里添加一条——上游的 `opencode-acp` 插件正是
这样注册 `/acp` 的（0.2.0–0.2.2 在此声称"插件无法注册斜杠命令"是错的，
已更正）。若路线 A 复制的 `commands/abathur.md` 存在，它保持权威——注入
绝不覆盖它，而且命令映射按名字键控，`/abathur` 绝不会出现两份。对两条
路线同样成立的一个诚实限制：工具 spawn 的是 `abathur` **CLI**，CLI 必须
在 `PATH`（或 `ABATHUR_BIN`）上可达，`npm i -g` 不能省。

任一路线都会让会话获得：

- 智能体工具 **`abathur`**——以纯 argv 方式 spawn `abathur` CLI（绝不经过
  shell），顶层命令限定为八个（`genome`、`run`、`status`、`bundle`、`graft`、
  `self-eval`、`kernel`、`--help`），120 秒超时、64 KB 输出封顶。二进制从
  `PATH` 解析，除非用 `ABATHUR_BIN` 覆盖。诚实的权限说明：该工具具备与
  bash 等同的权限——`run` 与 `genome` 按设计就会 spawn 变异器/引擎二进制——
  所以允许清单限制的是笔误与体验，而非能力。`promote`、`tombstone` 与 `retract` 刻意
  不可经由工具触达：它们是人类闸门，必须在终端里运行。
- 用户命令 **`/abathur <参数…>`**——斜杠命令，指示智能体把参数
  翻译成工具调用并回报退出码。路线 A 由复制的 `commands/abathur.md`
  文件提供；路线 B 由插件的 `config` 钩子在启动时注册。

路线 A 自带管理命令：`abathur opencode status` 逐目标打印路径、已安装/随包
sha256 与状态
（up-to-date / outdated / foreign / absent）。
`abathur opencode uninstall` 只删除带有 abathur 标记的文件；若目标路径上躺着
别人的文件，install 与 uninstall 会拒绝、exit 2 并点名路径；status 只报告 foreign 状态并 exit 0（它观察，不动手）——绝不会背着你覆盖或删除任何东西
（整个二进制依然没有 `--force`）。

注意：夹具基准会把真实的 `~/.config/opencode`（含插件与命令）镜像进沙箱 HOME，
因此装好的插件在基准会话里同样会加载。若基准需要干净的插件环境，请先 uninstall。

### 可选基准集成

npm 包只交付通用夹具适配器，不交付任何特定服务的基准。Wiki.js、CAD 或其他外部
服务集成必须放在自己的 checkout，并自带私有基因组规格、夹具、评分器、凭据与
服务生命周期。核心包只在命令和前置探针通过时执行该规格；它不提供服务默认值或凭据。

### D7 解耦保证

- 基因组注册表与一切可写产物都在**树外**、配置目录下；运行时 npm 包目录只读。
- `src/` 下的源码**零**机器 / 产品字面量（`src/test/**` 夹具按设计豁免）。CI
  闸门扫描 `src/` 中配置的机器根哨兵与 `historian`；在 `src/test/**` 夹具之外
  一无所获。配置模板用占位符表达。
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
  `run`/`graft` 获取的基因组锁是**机器本地**的文件锁。外部夹具服务的跨机串行化
  由对应集成的操作员负责。
- 晋升、埋葬与撤回只属于你：`promote`/`tombstone`/`retract` 不带 `--confirm`，因为 CLI 调用本身
  **就是**闸门；整个二进制里没有 `--force`。晋升前先查看 `abathur status` 的
  隔离深度与 `graft decisions` 行。
- 待嫁接队列（`<configDir>/graft-queue/`）里的陈旧条目表示某个 bundle 在等环境
  就绪——注册好基因组或修好探针，再跑一次 `graft`；终态决定会自动移除队列条目。
- 外部集成的凭据和可执行体不属于本包；预算上限是每次运行的硬停，要提就在规格里
  郑重地提，不要在账外反复重跑。

### 退出码

对每个命令、无一例外的契约：

- `0`——ok / pass / nominated。
- `1`——blocked：已记录的**决定**（culled、indeterminate、quarantined、
  晋升被拒、未注册基因组的 pending）。
- `2`——cannot-answer：配置错误、输入畸形、引擎缺失、探针未就绪、预算截断
  （inconclusive）。绝不会静默跳过。

### 许可

MIT，见 [LICENSE](LICENSE)。
