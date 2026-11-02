# 设计题：器具伤（instrument defect）是否单列审计者台账通道

状态：待蜂群辩论 → 呈机主裁。落盘时间 2026-11-02（系统时钟）。

## 1. 现状（机器事实）

- **题伤通道已存在**：`.omo/evidence/item_defects.jsonl`，追加式哈希链。写入闸机械可判：`auditor.kind` 必须是 `engine-session`，该会话须在引擎库中真实存在，且不得是被判世代自己的考生/判官会话（座席不能自铸更正）。条目绑定被封 bundle 的 sha256、修复后同题 PASS 的 bundle sha256、以及 `{path, sha256}` 证据指针。
- **消费者两处**：`loop/bundle_close.py` 只做增量字段注入（`item_defects` / `item_defect_count`），**绝不动** `items` 与 `canaries_killed`；`scripts/verify-all.sh` 的 `item-defects` 步做链完整性 + 绑定 + 证据复算，陈旧或伪造即 fail-closed。
- **在册唯一条目**：G71/SR4-68（`rubric-contradicts-fixture`），审计会话 `ses_e681de561ffeR0EeOKfNIFVzp8`，APPROVE 3A/0R。
- **器具伤目前无通道**：判卷工装 / 扫描器 / 播种器 / 断言器的缺陷，只在 Git 提交信息 + INTENT-LEDGER 散文里留痕。例：
  - G82：`boundary_read_scan` 把报告正文里一句诚实披露当越界，开 incident 阻断提名（修复提交 `29b2214`，契约 `loop/test_boundary_scan.py` 5 例）；
  - SR4-69：`setup_sr4_69` 签名与 `seed_item.py` 调用约定不符（TypeError），修复后加 AST 契约测试；
  - 判官侧：`verdict_problems()` 信号集合/取值/aggregate 自洽校验为后补；
  - 超时：`item_turn_timeout` 曾用默认 1200s 使长题误判 infra 失败，改为按题具名旋钮。
- **章戳当前语义**（机主 2026-11-01 裁）：`CONDITIONAL(D1a)` 为点名制——只有该代确实查出具名器具缺陷时才盖章，且必须点名（缺陷编号 + 触及的题 + 探测命令）；未查出的世代不带此章，也不得按习惯继承。

## 2. 缺口（可机械判定的那种）

`CONDITIONAL(D1a)` 要求「点名」，但点名所需的**机器依据**没有落点：
- 散文与提交信息不可被 `verify-all` 复算，可被改稿或过期；
- 无哈希链锚定，无法证明「该世代确实查出过某缺陷」，也无法证明「缺陷已修且有验证」；
- 现有题伤通道的字段语义是「题面/判据与夹具矛盾」，硬塞器具缺陷会污染 `item_defects_count` 的既有统计口径（bundle 字段与历史截面不可比）。

## 3. 备选方案

**A. 扩展现有 `item_defects.jsonl`**：加 `kind: item|instrument` 字段，同一链、同一写入闸。
- 优点：单链单写者、消费者改动最小、verify-all 复用。
- 风险：口径混流——`item_defect_count` 的历史含义被稀释；外部读者按字段名预期题伤。

**B. 新开 `instrument_defects.jsonl`**：同构哈希链、独立消费者，字段绑定 `{gen, defect_id, affected_items, probe_cmd, fixed_by_commit, evidence_pointers}`。
- 优点：口径不混，各自 fail-closed；章戳只读本文件即可点名。
- 风险：第二套链=第二份维护面；写入闸的「审计者」定义需重写（见 §4）。

**C. 不加文件**：只把器具伤写进 bundle 的 `incidents` 字段 + 台账散文，章戳读 incidents。
- 优点：零新增机制。
- 风险：`incidents` 语义是「候选体边界/注入异常」，与器具缺陷不同物；且封包后不可追加（bundle 冻结），而缺陷常在封包后才被独立审计发现——冻结字段装不下迟到的发现。

## 4. 核心难题：谁有资格作「独立审计者」

题伤通道的闸要求审计者不得是该世代自己的考生/判官会话。器具缺陷的发现者通常是**本席自己**（跑测试时炸了、读代码发现的）。若照抄题伤闸，则本席永远无法登记自己的器具伤——但器具伤又确确实实被查出了。三条候选判定：

- (i) 保持严格：必须外部独立审计（sibyl/盲审会话）确认缺陷成立才可入账。代价：每个小缺陷都要一轮审计，产能不可承受。
- (ii) 分级：`severity` 分 `blocking`（影响判决/提名的，须独立审计）与 `hygiene`（不影响判决的，本席可入账但必须附复现命令 + 修复提交 + 回归契约），后者在 verify-all 里只校验形式（命令可跑、提交存在、契约测试绿）。
- (iii) 本席入账 + 事后抽审：入账免审计，但每代随机抽一件送独立审，抽审不通过则整链标记污染。

## 5. 请蜂群回答

1. 选 A / B / C 中的哪个（或指出更优结构），并说明理由。
2. §4 的写入闸选 (i)/(ii)/(iii) 哪个；若选 (ii)，`blocking` 与 `hygiene` 的机械判据是什么。
3. `CONDITIONAL(D1a)` 章戳的取证路径怎么接：读哪个文件、哪些字段必填、缺字段时 fail-open 还是 fail-closed。
4. 存量四例（G82 扫描器误报、SR4-69 签名、verdict_problems、timeout 旋钮）如何迁入，是否需要补审计。
5. 指出本设计里「看起来合理但机械上不成立」的断言（若有）。
