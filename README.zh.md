# abathur

[English](README.md) | 中文

> 本文件是 [README.md](README.md) 的中文译本；内容冲突时以英文版为准。
<!-- translated-from: README.md sha256=fd25266a98593f08144410c77fc41477b2790482a4963c917440074a8936c7a1 -->

一个面向 OpenCode 智能体的进化工装：观察失败、变异、重测、筛选——晋升决定始终由人把关。
离线血缘包（bundle）让一个实例基于另一个实例的证据学习；v1 工装自身不含任何联网传输（模型与夹具流量取决于你的 bench 起了什么）。

## 它是什么

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
  `tombstone` 则埋葬它，`retract` 可撤销一次 promote（LIFO，受后代守卫）；`re-adjudicate <label> <genId>` 不启动引擎、纯从台账重算裁决记录（仅终端可达）。这些命令都是只追加的台账决定；任何数据都不删除。

## 安装

```bash
npm i -g @tachikomagundam/abathur  # 从 npm registry 安装
npm pack                          # 在 checkout 里执行；prepack 会先构建
npm i -g ./tachikomagundam-abathur-*.tgz   # 通配即当前版——npm pack 产出带版本号，此处永不钉死
abathur --help
```

需要 Node >= 22.22.1 与 `PATH` 上的 `git`。运行时依赖只有 `zod`——`@opencode-ai/plugin` 是可选对等依赖，仅在 opencode 加载插件适配器时需要（由宿主 opencode 提供）。安装后跑 `abathur init` 建立阿巴瑟自有部署面（数据家+锚链目录）并打印每个路径；任何安装钩子都不触碰设备共享设施。源码 checkout 在 <https://github.com/TachikomaGundam/Abathur>（`package.json` 的 `repository`）；npm tarball 只带构建后的 CLI，不带 `src/`。真实基准还需要
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

## 快速上手：零模型玩具环

不调模型、不联网：`toy-smoke` 基因组就随包发布（`dist/genomes/toy-smoke/`），
且预埋了一个 bug——`add()` 做的是减法。

```bash
abathur init                     # 仅需一次：创建并打印部署目录
mkdir -p ~/abathur-demo && cd ~/abathur-demo
export ABATHUR_PKG="$(npm root -g)/@tachikomagundam/abathur"

# 1. 物化一个独立的玩具基因组仓库（git init + 重写 repoPath；
#    基因组以标签 `toy-smoke` 注册）
node "$ABATHUR_PKG/dist/genomes/toy-smoke/init.mjs" ./genome
abathur genome add ./genome/genome.jsonc

# 2. 变异器是一条 argv 命令模板，不是可跳过的可选项：没有 --mutator，run 直接 exit 2。
#    包里带一个最小实现（`examples/toy-stub.mjs`），以及它导入的
#    `dist/core/evolve/stub-mutators.mjs` 库；该库导出 `scriptedPatches()`，
#    返回 `{id,description,file,from,to}` 补丁。示例向 stdout 打印
#    {"candidates":[{"id","rationale","diffs":[unified-diff]}]}。
cp "$ABATHUR_PKG/examples/toy-stub.mjs" ./toy-stub.mjs

# 3. 进化：{worktree} 和 {brief} 由工装渲染；模板按 argv 直接 spawn，绝不经过 shell。
abathur run --genome toy-smoke \
  --mutator "node $PWD/toy-stub.mjs --lib $ABATHUR_PKG/dist/core/evolve/stub-mutators.mjs --dir {worktree} --brief {brief}"
```

典型输出（玩具预算下几秒跑完）。`tokens` 是渲染文本的估算值，不是模型用量——
玩具环不调用模型：

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
abathur status toy-smoke                     # 只读台账视图；第一列是 genId
abathur promote toy-smoke g-...              # 人类闸门——通往新在位者的唯一路径
abathur bundle export toy-smoke --gen g-... --out ./bundles   # 离线血缘
abathur bundle inspect ./bundles/*.bundle.tgz
abathur graft ./bundles/*.bundle.tgz --genome toy-smoke       # 对端血缘包的本地重测
abathur run --genome toy-smoke --dry-run     # 计划 + requires[] 探针，零 spawn
```

## 在 opencode 里调用

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

**路线 B——纯配置（自动从 npm 下载）。** 把包名写进 opencode 配置
（`opencode.json` 或 `opencode.jsonc`）的 `plugin` 数组，再重启：

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

## Tier-1 纪律层（≥0.4.0）——诚实的能力边界

插件的纪律层（状态注入、考题文件守卫、环境注入、台账工具、占用探测）是
**防手滑 + 可见化，不是安全边界**：

- 考题文件守卫只拦截 `edit`/`write`/`apply_patch`；对受保护文件的 `bash`
  写入是具名残余（仅告警的启发式）。有决心的智能体可以绕过它——守卫的存在
  是为拦住手滑并让违规变响，不是为了对抗攻击者。
- 战役锁是协作式的：由 `abathur run`（≥0.4.0）写入，退出时移除。崩溃的运行
  会留下陈旧锁，插件按心跳 / pid / 启动时间判定；`SIGKILL` 落在心跳窗口中间时，
  按设计可能看起来是"pending"，最长 15 分钟。
- 在 <0.4.0 的引擎上，插件运行在 `FALLBACK-PROBE` 模式（用进程扫描代替锁）；
  探测自身的盲区记录在 `loop/proposals/plugin-tier1-design-20261020.md`。
- T3 环境注入默认关闭，除非操作员在插件选项里钉住 `repoRoot` 并提供
  `~/.config/opencode/abathur-shell-env.json`（人类持键面）；可注入键集合由
  `config/env-contract.jsonc` 固定。
- 台账工具强制哈希链追加，但在单用户机器上，链只能证明*其他*写者的篡改——
  座席自己可以重写自己的台账（具名缺口：外部锚定）。

## 历史学家基因组与操作员工作流

`historian` 是第一个真实基因组：OpenCode 智能体对着在线 Wiki.js 夹具完成 wiki
场景；script-first 评分器按 A–J 维度打分并有硬性 G 闸门。
`config/genomes/historian.example.jsonc` 是一份**模板**——每个机器相关值都是
`${VAR}` 占位符，因为仓库跟踪的文件里机器字面量为零。只有 `repoPath` 有内置的
环境变量解析（`effectiveRepoPath`，`src/core/spec.ts`）；`requires[]` 探针与所有
命令字符串都是 argv 直接 spawn、绝不经过 shell，所以其中的 `${VAR}` **不会**展开。
操作员需要解析模板：

1. 备好**你自己的** historian 基准仓库 checkout（基因组的夹具：必须提供
   `scenarios/`、`rubric.md`、`seed_sandbox.sh`、`baseline/**`）、一个运行中的
   wiki，以及该夹具文档所要求的 wiki-ops CLI。本仓库不发布这份夹具；由操作员自备。
2. 把模板复制成私有的 `*.local.jsonc` 文件（gitignore 规则在树的任何位置都覆盖
   它），把每个占位符替换为真实的绝对路径 / URL；然后对**那份文件**执行
   `abathur genome add`。打印出的指纹对每组解析后的路径是确定性的（编排者机器上
   是 `2b2456be6cddcb91`——你的路径会得到不同的值，但对那些路径保持稳定）。
3. 操作员必须维护的实跑环境：**父级** HOME 里的 `~/.wikijs-api-key`（`requires[]`
   探针子进程继承父环境并直接读取它），以及 `ABATHUR_WIKI_KEY_FILE`——指向该密钥
   文件的路径；沙箱侧脚本会把它重装进每个镜像沙箱 HOME，因为 `resetCommand`
   在每个单元运行前会清空沙箱 HOME 镜像（钩子顺序：reset 先于 mirror 执行，
   钩子需要的东西必须逐单元重装）。
4. `export ABATHUR_JUDGE_MODEL=...` 是强制的，即使为空：评分侧的 `opencode` 调用
   遇到**未设置**的变量会报错，遇到空值不会。
5. 不花模型费用验证环境：`abathur run --genome historian --dry-run` 会跑完所有
   `requires[]` 探针并打印计划；零引擎 spawn。

真实 run 会启动 `opencode` headless 并消耗 token。预算
（`budget.maxCandidates/maxModelCalls/maxTokens/maxWallS`）是硬停——越线截断为
`inconclusive`（exit 2），绝不会伪装成通过。

## D7 解耦保证

- 基因组注册表与一切可写产物都在**树外**、配置目录下；运行时 npm 包目录只读。
- `src/` 下的源码**零**机器 / 产品字面量（`src/test/**` 夹具按设计豁免）。
  执行闸门是 `src/test/d7-gate.test.ts`：它遍历 `src/**/*.ts`、跳过夹具豁免区，
  命中 `os.homedir()` 或 `historian` 产品名即失败。测试在运行时取得家目录路径，
  所以闸门自身不带机器字面量。同一测试还会扫描两份公开 README 的家目录
  字面量，所以手册不能引用源码不允许携带的内容；在源码 checkout 里先
  `npm ci` 再 `npm test` 即可执行它。配置模板用占位符表达。
- 机器路径只从配置与环境变量进入：`${VAR}` 字面量形式的 `repoPath` 按**未解析**
  字节参与指纹计算，因此规格身份与机器无关（abathur-self 在任何机器都是
  `1913fcec…`），只在文件系统接缝处解析；变量未设置就 exit 2 并点名该变量。
- 身份永远是内容指纹、不是标签：两份字节相同的规格在任何机器上都是同一个基因组；
  标签自由、可重复，但当一个标签被多个已注册基因组共用时，任何按标签取基因组的
  命令都会 fail-closed（exit 2）——报错会列出指纹，身份以指纹为准。
- 适配器是封闭的 `bench.type` 注册表；遇到未知适配器类型的基因组是 exit 2，
  绝不猜测。

## 内核封印与自我演化

每个注册基因组的 `kernel.immutableGlobs` 都会被哈希成 `<configDir>/kernels/`
下的封印清单；工作树漂移时基准与 self-eval 拒绝运行；触碰封印路径的变异候选在
路径阶段即被拒绝；只有人类 `promote` 会重新封印——且从被晋升的树封印。
`abathur kernel audit <label>` 对照工作树验证封印。完整契约（`abathur-self`
能碰什么、不能碰什么，快照覆盖式基准，为什么 v1 自我演化不能改依赖和构建配置）
在 [docs/immutable-kernel.md](docs/immutable-kernel.md)。

## 联邦：先有捆绑包，后有传输

v1 交付的是**格式和本地工具**，不是网络。bundle 是一个你用任何方式搬运的文件；
`bundle export` 是确定性的——账本未变时重复导出产出字节相同的 tarball，
字节相等规则贯穿所有嫁接闸门。只有当基因组指纹、benchDigest、评分溯源与
`requires[]` 探针全部在**本地**重算为字节相等时，graft 才接纳对端血缘；其余情况
一律隔离（quarantine）、排队（pending-bench）或拒绝，并把决定记入台账。
没有噪声容忍带，没有 `--force`，没有绕行。发现、传输、自动合并、自动晋升全部
明确**不在范围内**。逐字段的 schema、inspect 闸门顺序、graft 决策表见
[docs/federation.md](docs/federation.md)。

## 操作员职责

- **单飞契约**：每个基因组指纹、每个共享夹具服务，最多只有一个在跑的基准。
  `run`/`graft` 获取的基因组锁是**机器本地**的文件锁（它只在单机内串行化
  worktree、沙箱与台账）。historian 基准通过 `resetCommand` 共享 wiki，而它会
  清空整个 `_sandbox/*` 命名空间——两台机器拿同一个 historian 基因组对着同一个
  wiki 跑基准，会在运行中互相踩掉对方。historian 基准的跨机串行化是操作员的
  职责（排班、锁柜、一 wiki 一基准——随你选哪种）。
- 晋升、埋葬与撤回只属于你：`promote`/`tombstone`/`retract` 不带 `--confirm`，因为 CLI 调用本身
  **就是**闸门；整个二进制里没有 `--force`。晋升前先查看 `abathur status` 的
  隔离深度与待嫁接队列行（`abathur status <label>`）。
- 待嫁接队列（`<configDir>/graft-queue/`）里的陈旧条目表示某个 bundle 在等环境
  就绪——注册好基因组或修好探针，再跑一次 `graft`；终态决定会自动移除队列条目。
- 做 historian 工作时保持 `~/.wikijs-api-key` 有效、`ABATHUR_JUDGE_MODEL` 已导出；
  预算上限是每次运行的硬停，要提就在规格里郑重地提，不要在账外反复重跑。

## 退出码

对每个命令、无一例外的契约：

- `0`——ok / pass / nominated。
- `1`——blocked：已记录的**决定**（culled、indeterminate、quarantined、
  晋升被拒、未注册基因组的 pending）。
- `2`——cannot-answer：配置错误、输入畸形、引擎缺失、探针未就绪、预算截断
  （inconclusive）。绝不会静默跳过。

## 许可

MIT，见 [LICENSE](LICENSE)。
