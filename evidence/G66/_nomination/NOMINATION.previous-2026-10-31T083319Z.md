# 世代 G66 提名页（机器生成，勿手改）

由 `loop/nominate.py` 于 2026-10-31T08:31:33Z 生成（该时刻同时记在 `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-G66.genstamp.txt`）。
每个字面值的来源登记在旁车 `nomination-<GEN>.facts.json`：值 → 文件 + 获取方式。
写盘前过两道闸：字面值来源登记齐备 + 对账器在归档上 rc=0；任一道不过则不写。
第二道闸只证明「值在某处出现过」，存在文档回声的可能（G66 第二轮审计即抓过此洞）；
因此来源级校验以旁车 facts.json 为准，对账器只是补漏，不是主锁。

## 一、包面

- 世代：G66
- 终态：CONVERGED｜可提名：True
- 封包时刻：2026-10-31T06:31:02Z
- 铃测击杀表：[]
- 三章戳：PERFORMANCE-ONLY-IN-LOOP + MODEL-DIVERSITY-PENDING + CONDITIONAL(D1a)
- 选手模型：local-qwen/qwen3.8-flash-next｜判卷模型：local-qwen/qwen3.8-flash-next
- `bundle.json`：sha256 `1b4893d30d08db17a38e89b2991ed47864daaa3b7c229add0a37843555b4c372`；最后提交 不在 git 跟踪面（.omo 被 .gitignore 排除）

## 二、逐题判卷

| 题 | 判卷结论 | 聚合 | 铃击 | 记忆 | 判卷原件 | 原件 sha256 |
|---|---|---|---|---|---|---|
| SR4-64 | PASS | PASS | False | CLEAN | /home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G66/SR4-64/verdict.json | e0f03a8795c42ad18b4882b87099a931a479de4f0887cfe091632cc5a6d9921f |

## 三、债务与轮换

`loop/draw.py` 的 `regression_duty()` 生成时刻实算：`{}`

## 四、铃测覆盖

| 铃测世代 | 覆盖题 | 击杀数 | 封包时刻 | bundle sha256 |
|---|---|---|---|---|
| G64CAN | SR4-64 | 1 | 2026-10-31T06:03:26Z | `5ad9d60c5c926a562305bac4a2b95a1d49c5c5a034a2dba5b6ba905ee1df10e0` |
| G66BCAN | SR4-64 | 1 | 2026-10-31T07:49:05Z | `f0e86c7d707627489eaf2f33d64ab6214688e8cbe0de0ff7ac1b60a8339f9f36` |
| G66CAN | SR4-64 | 1 | 2026-10-31T06:38:32Z | `a7ac707d77aa0a6a785f093a72e98548905451ec65a6d430aaa95066741c51f8` |
| G66GCAN | SR4-64 | 1 | 2026-10-31T08:01:57Z | `82ba79e719639851bef325b5fcbf925a3406688b409bd28e07c203aa312f942a` |
| G66HCAN | SR4-64 | 1 | 2026-10-31T08:05:08Z | `9f6f5818406aa80063ea83412771e05c3992c73a0b3a913bab5b4e3b3acff63b` |

## 五、审计链

- `sibyl-20261031T073307Z-d18a`：seat 目录在盘，票件 3 份（BALTHASAR.md, CASPER.md, MELCHIOR.md）
- `sibyl-20261031T080624Z-6ebc`：seat 目录在盘，票件 3 份（BALTHASAR.md, CASPER.md, MELCHIOR.md）
- `sibyl-20261031T081522Z-e921`：seat 目录在盘，票件 3 份（BALTHASAR.md, CASPER.md, MELCHIOR.md）

裁定与 must-fix 处置须逐条引票件原文；本生成器不代填结论。

## 六、具名缺口（不得省略）

- MODEL-DIVERSITY-PENDING 未除（清除条件=整代第二模型族判卷+机主裁定）
- CONDITIONAL(D1a) 仍待机主政策裁决
- 三版手写提名页被三次独立审否；本页改由 loop/nominate.py 生成，历史页保留为 NOMINATION.handwritten-*.md

## 七、归档清单（sha256 逐件）

共 9 件（不含本页）。

- `ARCHIVE-MANIFEST.json`：`2ceb86dd626027890e5ba448a65ed93fab07f0d4c44bd9d9f481820827c4e1d9`
- `BUNDLE.md`：`e1ce2a30556fe13e748e7c89576a6c2335103ab5c6e6d6b2cc64fb2dc5177aaa`
- `SR4-64/candidate-artifacts/workshop/FINAL-RECEIPT.md`：`d84cf8669a2f80c01aa09aa5ad8ac728ff3310aa1af1adef3b780ce1284de2d8`
- `SR4-64/disk_probe.json`：`67be48ee7a78f8e6f7045cfbe76cdae57172f7a6b48c4d287b834c7eaa037346`
- `SR4-64/manifest.json`：`6d2efa0660af51632440a451be8532ebaa312a4fa70d2848190fabb35e9c8299`
- `SR4-64/memory.txt`：`7e658634e8bf4aff95c26958ca3268d489e34496931c0758b5e2b6c01e9ee347`
- `SR4-64/transcript.json`：`9c47668bd1456dced30338f3d8e0814b21dabe2da55d154eb24d3b7576bd89f4`
- `SR4-64/verdict.json`：`e0f03a8795c42ad18b4882b87099a931a479de4f0887cfe091632cc5a6d9921f`
- `bundle.json`：`1b4893d30d08db17a38e89b2991ed47864daaa3b7c229add0a37843555b4c372`

