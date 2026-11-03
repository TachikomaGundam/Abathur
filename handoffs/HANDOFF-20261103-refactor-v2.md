# HANDOFF — 阿巴瑟 v2 重构（新会话开工单）

- 交接时刻：2026-11-03（北京时间）
- 交接人：阿巴瑟席（会话 `ses_e71abdd1cffe6ItzlhIVZECLDu`）
- 接收人：**新会话中的阿巴瑟席**
- 权威仓：`/home/lab/workspace/harness/Abathur`
- 持久草稿：`/home/lab/workspace/harness/Abathur/.omo/drafts/refactor-abathur-v2.md`
  （**第一件事：完整读它**；本文件是入口与边界）

**术语**
- **列零任务行**：行首无缩进的 Markdown 任务行。实现 `- [ ] 12. 标题`；终验 `- [ ] F3. 标题`。
  「F 波」= 全部实现任务后的并行终验组。
- **执行通道**（实测挂载，勿凭印象）：bash 工具 = bwrap，**仓目录
  `/home/lab/workspace/harness/Abathur` 以读写方式绑定（仓内写入持久）**；`/home/lab` 其余部分是
  tmpfs（仓外写入蒸发）；宿主 `/tmp` 不可见；无网络。`宿主` = `interactive_bash` 起 tmux，
  能看全盘与网络。**v2 树 `/home/lab/workspace/harness/Abathur-v2` 的一切读写一律走宿主**；
  沙箱内可见性先探：`ls -d /home/lab/workspace/harness/Abathur-v2`（预期不可见或空目录）——
  该探测回执写入新会话第一条台账。**规则：凡输入或输出路径含 `Abathur-v2` 的命令一律走宿主**；
  下文每条命令标注通道；未标注即**沙箱**。
- **方法论的处置**（机主「上网学习」的具名落地）：已从本机权威源吸收并转为自有制度
  （§4 第 P 类），不另设联网学习步骤；若需外部佐证，只补笔记不入判据。

---

## 1. 任务（机主逐字）

> 「从0开始重构阿巴瑟。准备一个新版本，一次性解决所有问题，不要打补丁，把解决的功能从方法论上
> 归类然后重构，代码和规则相结合。这是个大工程，规划好。你学会OMO插件的那套流程了吗？由Prometheus
> 构建整个plan的过程，上网学习一下，然后把这套方法论引用到你自己身上。我临时允许你构建一个给
> 自己升级的工作版本，而非常规的ABCD四端隔离，来完成这次重构。开始。」

> 「我不是要你去抄OMO，而是要你把这套方法论用到你自己身上，而且这部分要作为你的未来能力存在。」

> 「每一个需要我过目的东西都要过西比拉系统。」

**边界**
- 要做：写计划 → 过西比拉 → 在独立副本实现 → 逐波收口 → 终验 → 呈报（呈报也要过西比拉）。
- 不许做：打补丁式修复；复制旧码冒充重构；改生产安装/已发布面；绕过西比拉；把决定推回机主。

---

## 2. 开工顺序

### 步骤 0：入口存在性回执（沙箱）
```
ls -l /home/lab/workspace/harness/Abathur/.omo/drafts/refactor-abathur-v2.md
sha256sum /home/lab/workspace/harness/Abathur/.omo/drafts/refactor-abathur-v2.md
```
期望值（交接时实测）：`ac57a0a2b16df02b60a8309fc1003ba1d7d3992636080473849107607266b550`。
两行输出记入新会话第一条台账；与期望值不符即停，先查明再动（若你改动过草稿，须先解释再更新期望值）。

### 步骤 1：读草稿（沙箱）
`/home/lab/workspace/harness/Abathur/.omo/drafts/refactor-abathur-v2.md`（八类 + P 类 + 波次 + 决策）。

### 步骤 2：先造 W0 三件（沙箱可写仓内；模板导出走宿主）
`loop/plan_check.py` 必须在计划送审**之前**存在，否则第 3 步无判据。W0 一次交付三件：
1. `loop/plan_check.py`：校验八个模板标题齐全、任务列零、每条 todo 四要素、类覆盖（A–H 或 P）、
   `## Scope` 含非空 Must-NOT-Have、波次无环；`PLAN-CHECK OK n=<count> rc=0`，缺失 rc=1 具名。
   **唯一归属=主树**，v2 内不重复实现。
2. `scripts/copy-similarity.py`（**宿主通道**，读 v2 树；v2 不可见时 rc=2 fail-closed，禁止空集通过）：
   算法（置换不变，逐条可测）：切 token → 剥离注释与字符串字面量 → **所有标识符归一为单标记 `ID`**
   （不按出现序编号）→ 取 5-gram **排序多重集** → 多重集 Jaccard。**主判据=全 token 排序后的 unigram 多重集 Jaccard**（对标识符改名、行重排、注释改写均不变）；
   5-gram 只作辅助信号，不单独判负。配对不限于同路径；聚合=每个 v1 文件的 token 多重集被 v2 全部文件多重集并集
   覆盖的比例（containment），≥0.80 且无 CARRY-OVERRIDES 条目即判负；`git hash-object` 相同却标
   「重写」→rc=1；<5 token 的空集对视为相同。误判申诉：≥0.80 者可发起一次具名申诉，附独立
   `sibyl_audit` 回执（APPROVE + INDEPENDENT + 双方文件 sha256），不占携带配额。
   **四枚必拦夹具**（样件落 `scripts/fixtures/copy-similarity/`，任一未拦=工具不合格 rc≠1）：
   ①同内容改路径 ②全标识符改名+行重排 ③注释/字符串全改写 ④文件头前置无关新代码。
3. `docs/PLAN-TEMPLATE.md`：八标题自有模板。导出源：
   `/home/lab/.cache/opencode/packages/oh-my-openagent@latest/node_modules/oh-my-openagent/dist/skills/ulw-plan/scripts/scaffold-plan.mjs`
   （**宿主**跑，先 `ls` 实测存在）；若该源缺失，按下述八标题手写，不阻塞。
- 另在同一步：在 `INTENT-LEDGER` 追加一行具名占号（`SR4-76 = plan-discipline, SR4-70 已入库现役 canary，71–75 候补保留`），作为改号证据。
- W0 三件完成后**先提交**，之后主树基线以该提交为准（见 §8.6）。

### 步骤 3：写计划（沙箱可写仓内）
- 目标：`/home/lab/workspace/harness/Abathur/.omo/plans/refactor-abathur-v2.md`
- **模板权威是我自己的件**：`/home/lab/workspace/harness/Abathur/docs/PLAN-TEMPLATE.md`
  （W0 从 scaffold 一次性导出后自持 vendored），此后不依赖 OMO 包路径。
- 八个标题逐字：`## TL;DR (For humans)`、`## Scope`、`## Verification strategy`、
  `## Execution strategy`、`## Todos`、`## Final verification wave`、`## Commit strategy`、
  `## Success criteria`。
- 写完跑 `python3 loop/plan_check.py <计划路径>`，rc=0 才送审。波次以草稿 §6 为唯一源。

### 步骤 4：计划送审（沙箱工具调用，不是 shell 命令）
```
sibyl_audit(artifact="<计划绝对路径>", goal="判定是否 decision-complete、是否按八类方法学而非打补丁、是否含不可执行/自相矛盾项；逐条给 must-fix")
```
- 必须 `independence=INDEPENDENT` 且 `verdict=APPROVE` 才进入实现。
- 同一文档两轮 REJECT → 上呈机主并附全部回执（本单取止损器规则，不再自动开第三轮）。

### 步骤 5：建 v2 副本（宿主；v2 树一切读写只走宿主）
- 路径：`/home/lab/workspace/harness/Abathur-v2`（新建；不复用主树 worktree）
- **v2 从空目录起步**：`mkdir -p` 新结构 + `git init`（无远端），写 `package.json`、
  `rules/registry.yaml`、模块骨架。
- 旧码（`src/`、`loop/`、`scripts/`）**只作只读对照**，路径指向主树，**禁止复制进 v2**。
  某模块确需迁移时，必须在该 todo 内具名「为何不是重写」，并在计划评审时获通过，
  且在 `/home/lab/workspace/harness/Abathur-v2/docs/CARRY-OVERRIDES.md` 留条目。
- 硬判据（机械，不靠文字）：`scripts/copy-similarity.py` 对每对 (v1 文件, v2 文件) 判
  `git hash-object` 是否相同、并算 token shingle 相似度；哈希相同却标「重写」= 判负；
  相似度 ≥ 0.80 且无 CARRY-OVERRIDES 条目 = 判负；任何进入 v2 的旧文件必须映射到 A–H/P
  某一类并通过该类机器判据，无映射不得入 v2。

### 步骤 6：按波次实现（宿主），每波三件套
1. 机器判据通过（`npm test` 或对应 check，回执落盘）
2. `rules/registry.yaml` 增补 clause（check + exam_item 或 no_exam_reason）
3. 证据落 `.omo/evidence/`（绝对路径 + sha256）

---

## 3. 八类问题（草稿 §3 详述）

A 身份与来源 / B 隔离与边界 / C 证据与回执 / D 判定与验证 /
E 裁决与人类门 / F 自省与复发 / G 卫生与资源 / H 车道与共面。

**完成判据（每类四件套）**：不变量 + 机器判据 + 规则条款 + 考题（或具名 `no_exam_reason`）。
**八类之外的缺陷**：三选一登记到 `.omo/evidence/defect-intake.md`——归入既有类 / 开新类 /
拒收并具名理由；无处置即未完成。

---

## 4. 第九类能力：规划（P）

方法论内化为我自己的制度，不依赖 OMO 包：
- 四段：草案 → 计划 → 独立评审 → 执行；产物与判据见草稿 §4。
- 器具：`loop/plan_check.py`（主树，W0，先于计划门）、`docs/PLAN-TEMPLATE.md`（自有权威模板）、
  `rules/registry.yaml`、`skills/abathur-plan/SKILL.md`（升级为本生命周期手册）。
- 新题 **`SR4-76` plan-discipline**（canary；SR4-70 已是现役 canary，71–75 为候补保留
  （`loop/proposals/engine-ops-incident-units-20261022.md:22-23`）；本单取 76，改号在 W0 台账具名登记）。假计划（整拷旧码/无 Must-NOT-Have/todo 缺 QA）
  必须被判不可执行并逐条指出。
- 判据：`loop/plan_check.py` 对计划 rc=0。**SR4-76 的「实弹 PASS 且铃测能杀」依赖 v2 exam 的
  铃测跑器与判卷组件（W5 交付）；在 W5 前该判据记为具名缺口，不进终验。**

---

## 5. 关键事实（引用前当场重探，勿抄死值）

| 事实 | 回执命令 | 通道 |
|---|---|---|
| 晋升 33 代 / 0 VERIFIED / G73–G83 零批准 | `python3 scripts/promotion-inventory.py` | 沙箱 |
| 外线 48 笔 / 10 笔触 src / 0 笔在 tag | `python3 scripts/check-foreign-commits.py --allow-pending` | 沙箱 |
| 身份闸三例实测（宿主） | `cd /home/lab/workspace/harness/Abathur && bash .omo/scratch/identity-probe.sh`；日志 `.omo/evidence/identity-gate-probe-20261103.log` | 宿主 |
| 锚链完整性 | `bash /home/lab/workspace/infra/anchor-chain/verify.sh`（**只取当场输出，引用需带时间戳；尾戳随追加必变，不得写死**） | 宿主 |
| dev-link 已撤 | `ls -l ~/.npm-global/lib/node_modules/@tachikomagundam/` → 空 | 宿主 |
| 已发布版 | `npm view @tachikomagundam/abathur version` → 交接时实测 `0.4.1` | 宿主 |
| G84 半播 | `.omo/exam-queue/g84-5-cand-sr469.json` 存在，未跑 | 沙箱 |

---

## 6. 环境坑（实测）

1. **裸命令**：bash 工具只给裸命令 + `workdir`；手打 `bwrap` 前缀会被 `SANDBOX-PREFIX-COPIED`
   拦（本会话 10+ 次）。此规只约束 bash 工具，不约束宿主 tmux 里的裸命令。
2. **宿主才可见**：`~/.cache`、`~/.npm-global`、宿主 `/tmp`、锚链家目录——用 `read`/`glob`
   工具或 tmux。
3. **回收必须宿主跑**：`cd /home/lab/workspace/harness/Abathur && python3 loop/clean_run.py reclaim <GEN>`
   在沙箱看不到 `/tmp/abathur-loop-*`；宿主处方一律带绝对路径或同行 `cd`。
4. **`.omo/` 不入 git**：回执以绝对路径 + sha256 引用。
5. **引用当场核**：`python3 scripts/check-citations.py <doc>`（宿主）。

---

## 7. 冻结与默认

- 冻结：G84 半播、所有非重构工作。
- 默认（宣布式采用，未否决即执行）：包名沿用 `@tachikomagundam/abathur`；版本 `0.5.0`
  （交接时实测已发布版 `0.4.1`；收口前重探，目标版本 = max(0.5.0, 已发布次版本号+1 且补丁位归零)；
  例：0.4.1→0.5.0、0.5.3→0.6.0、0.6.0→0.7.0）；旧 `loop/`、`scripts/` 留主树只读；G84 重构期间不续跑。
  均写入计划 Open assumptions。
- **权威面声明**：写面白名单的**唯一权威=本节**；波次顺序的**唯一权威=草稿 §6**（冲突以本节为准并回改草稿）。
- **W0 写面白名单**（主树；全部在 W0 一次做完并提交；此后**git 跟踪面**零写）：
  新增 `loop/plan_check.py`、`scripts/copy-similarity.py`、`docs/PLAN-TEMPLATE.md`、
  `scripts/fixtures/copy-similarity/**`；追加 `INTENT-LEDGER` 一行占号；
  对 `skills/abathur-plan/SKILL.md` 做**追加式升级**（只增「四段生命周期」章节，不删不改既有五格内容）。
  `loop/bank.py`、`loop/draw.py` **不在白名单**：SR4-76 注册在 v2 自有 exam 注册表，不动 v1 题库。
- 遗留脏项处置：交接时 `git status --porcelain` 已有 10 条（README/package.json/3 个 src/test/
  README.zh.md/docs/evidence/examples/handoffs 各一）；W0 必须逐条归因（纳入本重构或明确保留），
  处置结果一并写入基线文件——不得默认为「空」。
  （`CARRY-OVERRIDES.md` 只存在于 v2 树：`/home/lab/workspace/harness/Abathur-v2/docs/CARRY-OVERRIDES.md`。）

---

## 8. 验收（自称完成前全绿）

1. 计划通过 `sibyl_audit`（APPROVE + INDEPENDENT + artifact sha 绑定）。
2. 八类 + P 类各自四件套齐全，逐类给证据路径。
3. v2 独立副本 `npm test` 全绿（宿主通道，回执落盘）。
4. **全量对照表 + 机械反拷贝闸**：v1 每个文件 → v2 去向（重写/携带/废弃）；v1 集合 =
   `git -C /home/lab/workspace/harness/Abathur ls-files`（具名排除：`package-lock.json`、二进制、
   `docs/evidence-manifests/**` 生成物）；v2 集合 = `git -C /home/lab/workspace/harness/Abathur-v2 ls-files`。
   用（**宿主**，主树绝对路径
   `/home/lab/workspace/harness/Abathur/scripts/copy-similarity.py`）逐对判定；v2 路径不可见时
   rc=2 fail-closed（禁止空集通过）：`git hash-object` 相同却标「重写」= 判负；
   相似度 ≥ 0.80 且无
   `/home/lab/workspace/harness/Abathur-v2/docs/CARRY-OVERRIDES.md` 具名条目 = 判负；无去向条目 = 未完成。
   **携带面有上限**：条目 ≤3 条且 ≤v2 文件总数 10%；每条必须引用一次独立的 `sibyl_audit`
   回执（APPROVE + INDEPENDENT + 该条目文本 sha）；超限、或条目缺少对应的独立 `sibyl_audit` 回执
   （APPROVE + INDEPENDENT + 该条目文本 sha256）= 判负。
5. 八类实证病在 v2 上被拦或明确标记（逐条回执）。
6. 未触碰生产/远端/主树发布面，三条逐字比对：
   - 生产（宿主）：`ls -l ~/.npm-global/lib/node_modules/@tachikomagundam/` → 空
   - 远端（宿主）：`git -C /home/lab/workspace/harness/Abathur-v2 remote -v` → rc=0 且空输出；
     `fatal: not a git repository` 即判负
   - 主树基线：**W0 全部白名单动作提交后**，把 `git -C /home/lab/workspace/harness/Abathur rev-parse HEAD`
     与 `git -C /home/lab/workspace/harness/Abathur status --porcelain`（排序后）两段原文写入
     `/home/lab/workspace/harness/Abathur/.omo/evidence/refactor-baseline-20261103.txt` 并记 sha256。
     收口判据（机械）：HEAD 与该文件逐字相等，且 `status --porcelain` 排序后与该文件逐行相等
     （即**与 W0 基线条目集相同**，不是「为空」——交接时已有 10 条遗留改动，W0 一并处置）。
     `.omo/**` 是允许写入的证据面（`.gitignore` 已排除），不计入 git 跟踪面写入。
7. 最终呈报送 `sibyl_audit` 得 APPROVE 后才发机主。

---

## 9. 一句话交接

**读草稿 → 先造 plan_check → 写计划（自有模板）→ 西比拉过 → 空目录建 v2 → 按波次实现
（波次以草稿 §6 为唯一源）→ 每波三件套 → F 波终验 → 呈报再过西比拉 → 发机主。**
不打补丁，不复制旧码，不问「要不要」。
