# 耦合修复与能力覆盖处置计划 v9.1 定稿（sibyl-20261019T113517Z-6177 APPROVE 3A/0R 过会；尾部两条定稿建议已吸收：G-REVIEW-FORGE 防歧义措辞、ABATHUR_SIBYL_RUNS 回落可见化）

谱系：v1…v8（八轮 1A/2R；v6 起 CASPER 席磁盘复验连续全闭环）。v8 残余 4 条：vitest 系误抄上轮 must-fix 的错误事实（真实框架 node:test，认账）、A1 重放 grep 对无扩展名 hook 机械盲、CLI 烟测缺 hermetic 状态源、助手注入通道不该留给实现提交。

## A1. 发布模板具名本机工具

- 三处同改：TEMPLATE.md:7 `border-findings`→`gate-findings`；scripts/git-hooks/pre-push:32 与已装副本 .git/hooks/pre-push:32 文案改 `gate PASS transcript`。历史收据 3 张不动。
- **五文件逐一点名**（当场回执）：①docs/release/TEMPLATE.md（1 处，改）②docs/release/v0.2.7.md（1 处，冻）③docs/release/v0.2.8.md（1 处，冻）④docs/release/v0.3.0.md（1 处，冻）⑤loop/proposals/本计划文档（2 处，叙事不改）。5 文件/6 处。
- **重放命令修盲**（无扩展名钩子不再漏）：`grep -rn 'border-findings' /home/lab/workspace/harness/Abathur --exclude-dir=node_modules --exclude-dir=.git`；已装副本 .git/hooks/pre-push 属本机安装面单独列示，验收方式=与仓库副本 diff 同步。
- **改前预录**（当场回执）：两份钩子各自恰 1 处 'border' 命中=行 32 文案 `(write it from docs/release/TEMPLATE.md with the border PASS transcript)`，无功能性调用——零命中验收可达，不构成假闸。
- 验收：仓库面 `grep -rn 'border' docs/release/TEMPLATE.md scripts/git-hooks/` 零命中（loop/proposals/** 具名排除）；安装面 .git/hooks/pre-push 与 scripts/git-hooks/pre-push diff 为空。

## A2. 考题材料具名

- **活体双通道**（实测）：pgrep+ps 对 pid 3289020/3289021 两形态命中 rc=0。pcb-agent campaign 在跑，A2 排队等收束。
- **动笔序列+留痕定式**：INTENT-LEDGER 声明条目同条含=目标文件+声明时间戳+双通道命令原文+空输出+date 实际输出，缺一不动笔。**具名残余**：探测→落笔竞态窗口不宣称封堵；对账冲突处置序列=作废该写+具名伤单+等收束后重排队。
- **改前清点**：10 处逐一分类（初步：SR4-19=唯一候选可改；SR4-25/26/27 区、SR4-50 区=冻；2027/2450=豁免注释）。
- **令牌已定名**：`gatefile.yaml`。碰撞首查回执：`grep -cF 'gatefile' loop/bank.py`=0（rc=1）。
- **残留检查命令**（scope=考题本体单文件）：`grep -nF 'gatefile' /home/lab/workspace/harness/Abathur/loop/bank.py`；期望=改动后仅命中改订后 SR4-19 题面行；改动前基线=0 命中（rc=1，回执在册）。执行后实际输出当场 append INTENT-LEDGER。
- **改号**：G44 先例具名改号+双版本证据+INTENT-LEDGER 登记。
- **draw.py 守卫验收**：①`cd /home/lab/workspace/harness/Abathur && python3 -c "import sys; sys.path.insert(0,'loop'); import bank"` exit 0；②`python3 loop/draw.py --help` exit 0（docstring 逐字一致在册）；③事件锚定真守卫=改动后首个真实抽签（G56 开局）exit 0。
- plain-watch.py 保留正则+豁免注释；另立静默失效伤单。

## A3. 评审单点 → 不抽象接口，硬切割+绑定+内容锚

- **生效机制**：无条件代码路径——exportBundle（src/core/bundle-export.ts）对新构建 bundle 一律要求 nomination 带 `external-review` 字段，无版本谓词、无格式自声明逃逸门。历史处置：存量 bundle 产物不重建；`bundle inspect` 只读不校验；历史 gen 重新 export 走同一路径同样要字段（纯归档需求用原 tar）。
- **runs.json 寻址（单一名义决定，不再留给实现提交）**：新检查经专用环境变量 `ABATHUR_SIBYL_RUNS` 定位评审台账；未设时默认 ~/.sibyl/runs.json。**回落可见化**（定稿吸收评审尾部建议）：export 每次解析台账路径后把实际路径打印到 stderr 并入操作回执——若夹具变量泄漏进人类 shell，正式 export 的假台账来源当场可见，不静默。测试与 CLI 烟测一律指向临时夹具台账，**永不读生产 runs.json**（hermetic，无跑序/状态敏感）。
- **测试构造面处置**：实现提交新增测试助手=临时目录造 mock runs.json+夹具工件，经上述环境变量注入。构造点交叉计数（精确+宽松两 grep 当场回执一致）：`exportBundle` 直接调用点=graft.test.ts 恰 2 处；bundle.test.ts 的 90 处 'bundle' 引用为下层函数面（manifest 构建等），逐区补字段；nomination 命中六文件（fixture-loop/friction/graft/self-snapshot/stats-acceptance/stats）同步补。若实现时发现间接调用点漏网，同提交补并在提交说明具名。
- **校验点唯一**：bundle 构建；随 0.3.1 出。
- **绑定判据**：`external-review: {runId, artifactPath, artifactSha256AtReview}`；校验=runs.json runId 匹配 ∧ record.artifact==artifactPath ∧ record.verdict.verdict=="APPROVE" ∧ 重算 sha256(artifactPath)==artifactSha256AtReview。run-id 语法 `sibyl-<yyyymmddThhmmssZ>-<hex>`（266 条样本实测）。
- **验收（确定性双层）**：①主验收=三个新增 **node:test** 用例（`import {test} from 'node:test'`，与 package.json:37 真实框架一致）入 src/test/bundle.test.ts：valid 通过 / 缺字段拒绝且 stderr 含 `external-review` / 哈希不符拒绝且含 `artifactSha256AtReview`；运行命令=`npm test`（npm run build && node --test "dist/test/**/*.test.js"）或 build 后 `node --test dist/test/bundle.test.js`。②CLI 烟测=`ABATHUR_SIBYL_RUNS=<临时夹具台账> abathur bundle export <label> --gen <genId> --out <dir>`，夹具 genId 由实现提交钉入测试台账与提交说明。
- **具名未闭合缺口三枚**：G-REVIEW-FORGE=runs.json 座席可写面无外部锚——**效力边界（两句互补不矛盾，定稿措辞）**：对"忘了过评审"（疏漏）该字段是硬闸；对"蓄意伪造评审记录"（伪造）它防护力为零，因为台账本身在座席可写面——外部锚落地前，防伪造的唯一实体防线是人类批准门。后续引用本条不得只引半句高估效力；G-BUNDLE-TAMPER=构建后篡改面；G-OLD-BUILDER=旧版从 npm/npx 绕行（缓解=L-ENGINE-ISOLATION，条款级）。

## B. 能力覆盖

B1 委派模板加对照格（立）；B2 设计件排 G56 后（缓）；B3 车道归属小节入 ~/.config/opencode/AGENTS.md（治理面=人类键）。

## C. 下一轮优先级

A1/A2/A3 并入 0.3.1 发布支 → 0.3.1 发布切（发布支全量 npm test 绿+边检 PASS+lease+人类 push/tag）→ G2/G4 闸化 → G56 开局 → 变异器里程碑（g3 待机主裁）。基线：14 提交、391/391 pass（当场重跑 166s）。
