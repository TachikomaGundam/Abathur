# 设计题 v2：器具伤单列台账通道（吸收蜂群 must-fix 后）

状态：v2 待机主裁。v1 经蜂群 `sibyl-20261102T124039Z-6412` 审（REJECT 1A/2R，independence=NOT-INDEPENDENT——此轮是设计辩论，不作盲审收据）。落盘 2026-11-02（系统时钟）。

## 0. 推荐结论（先给答案）

**取 B + 修订版 (ii)**：
- **B**：新开 `.omo/evidence/instrument_defects.jsonl`，与 `item_defects.jsonl` 同构但独立，两链各自 fail-closed，禁止同一事实双链重复记录（单一事实单链）。
- **修订版 (ii)**：`severity` 不由入账者自评，而由**封闭路径清单机械派生**；`blocking` 必须独立审计，`hygiene` 走形式校验。
- **否决 (iii)**（随机抽审判整链污染→制造「不登记更安全」的逆向激励）与**裸 (i)**（每个小缺陷一轮审计，产能不可承受）。
- **否决 C**（bundle 封包即冻结，装不下迟到的独立审计发现；`incidents` 语义是候选体边界异常，与器具缺陷不同物）。

## 1. 数据面

文件：`.omo/evidence/instrument_defects.jsonl`（追加式，仅 EOF 追加，哈希链）。

创世锚与写者登记（L-STATE-ATOMIC，首次写入前必须就位）：
- 首项锚定创世哈希（全零 sha256 的规范化前缀）；
- 写者登记只存在于文件外部（本设计文档 + 台账条目），文件内自声明无效；
- 写者注册链终止于具名人类签署条目。

条目字段（`schema: 2`）：

| 字段 | 必填 | 语义 |
|---|---|---|
| `gen` | 是 | 发现缺陷的世代 |
| `defect_id` | 是 | 稳定标识，形如 `INS-<YYYYMMDD>-<slug>`，全链唯一 |
| `class` | 是 | 封闭枚举：`scanner-false-positive` / `seed-signature-mismatch` / `verdict-validator-gap` / `timeout-default` / `bundle-field-leak` / `draw-guard-drift` / `other`（`other` 须附一句判据） |
| `affected_items` | 是 | 受影响的题 id 列表（可为空列表，但空列表必须在 `affected_paths` 里给出受影响代码面） |
| `affected_paths` | 是 | 命中的代码文件路径列表（相对仓根） |
| `severity` | 派生 | **不写入者填**；由 §2 谓词从 `affected_paths` + 时间窗机械派生，写入者填了也以派生值为准 |
| `introduced_at` | 是 | 缺陷引入的 commit（`git merge-base --is-ancestor` 可验） |
| `fixed_at` | 是 | 修复 commit |
| `probe_before` | 是 | `{cmd, rc, output_sha256}`：修复前复现记录（入账时封存） |
| `probe_after` | 是 | `{cmd, rc, output_sha256}`：修复后同命令记录；两值必须不同（`probe-before==probe-after` 视为空转，fail-closed） |
| `contract` | 是 | `{path, blob_sha256}`：回归契约测试文件的**blob 哈希**（`git cat-file -p <fixed_at>:<path>` 复算），不在当前工作树重跑 |
| `auditor` | blocking 必填 | `{kind: "engine-session", session_id}`；该会话须在引擎库真实存在，且不是本世代考生/判官会话 |
| `audit_receipt` | blocking 必填 | 审计轮 run id（sibyl run 或盲审会话 id） + 裁决 |
| `legacy` | 否 | 存量补录标记；补录条目必须带 `backfilled_at`，且不得追溯补章 |

## 2. severity 机械谓词（封闭，作者自报无效）

`severity = blocking` 当且仅当下列任一命中；判不清默认 `blocking`：

1. `affected_paths` 命中**判决面清单**（封闭枚举，写入 `loop/instrument_defects.py` 常量）：
   `loop/run_judge.py`、`loop/bundle_close.py`、`loop/looplib.py`、`loop/draw.py`、`loop/harvest_gen.py`、`loop/seed_item.py`、`loop/coverage.py`、`loop/assertions.py`、`scripts/verify-all.sh`、`.opencode/plugins/abathur-exam-runner.js`。
2. `introduced_at..fixed_at` 时间窗内，`affected_items` 与任一已封 bundle 的 `items` 相交，或与任一在提名/已批准世代的题面相交。
3. 缺陷「可改变 `items` / `canaries_killed` / `nominatable` 任一字段的取值」——由第 1 条清单兜底，清单外另需命中才成立。

否则 `hygiene`。

## 3. verify-all 的校验边界（修订：禁止执行台账命令）

`verify-all` 的 `instrument-defects` 步**只做静态复算**：
- 链完整性（`prev` 哈希逐项相接 + 创世锚）；
- `defect_id` 唯一性、必填字段齐全、`class` 在封闭枚举内；
- `introduced_at` / `fixed_at` 提交存在且 `introduced_at` 是 `fixed_at` 的祖先；
- `contract.blob_sha256` = `git cat-file -p <fixed_at>:<path>` 的 sha256；
- `probe_before.output_sha256 != probe_after.output_sha256`；
- `severity` 派生值与声明值一致（不一致即 fail-closed，并报「分类洗白」）。

**不得**执行 `probe_cmd`。复现证据只可另跑：一次性沙箱 + 落回执 + 非门径步骤（失败不阻断，但记录）。

## 4. D1a 章戳与台账的双向闭环（封闭）

`stamp = CONDITIONAL(D1a)` 的判定改为**裁决时刻实时计算**，不在封包时烙死：

- 输入：`instrument_defects.jsonl` 中 `gen == <本代>` 的条目 + 本代 bundle。
- 规则 1：存在 `gen==本代 ∧ severity=blocking ∧ 未闭合` 的条目 → 章戳必须存在，且章戳必须具名（`defect_id` + `affected_items` + 探针引用）。
- 规则 2：章戳存在而台账无对应条目 → fail-closed（凭空盖章）。
- 规则 3：章戳存在而台账条目全部 `hygiene` 且已闭合 → 允许，但章戳正文必须写明「仅 hygiene 面」，不得暗示判决面。
- 规则 4：无条目而章戳缺席 → 允许，但 bundle 必须带 `d1a_scan: {checked: true, ledger_entries: 0}` 字段，防「未查=无缺陷」被读成「无缺陷」。
- 规则 5：已提名未批准的世代被新的 `blocking` 条目命中 → 提名状态置 `TAINTED`，晋升动作必须重新裁决（具名动作，不许静默继续）。

迟到缺陷时序：封包后发现的缺陷不回填冻结 bundle；章戳由 `promotion_record.py` / `verify-all` 在裁决时刻从台账计算，bundle 内只存快照供对比。

## 5. 存量四例迁移（按谓词逐案分类，不整批回填）

| 例 | `affected_paths` | 派生 severity | 处理 |
|---|---|---|---|
| G82 扫描器误报（boundary_read_scan 把诚实披露当越界） | `loop/boundary_read_scan.py`（判卷工装） | **blocking**（曾阻断 G82 提名） | 补独立审计收据后入账；`legacy: true` |
| SR4-69 `setup_sr4_69` 签名不匹配 | `loop/bank.py`（播种器面） | **blocking** | 同上 |
| `verdict_problems` 校验后补 | `loop/run_judge.py` | **blocking** | 同上 |
| `item_turn_timeout` 默认 1200s 致长题误判 | `loop/looplib.py` | **blocking** | 同上 |

一律 `legacy: true` + `backfilled_at`，**不追溯补章**（历史 bundle 不重写）。若审计不可得，则该条记 `auditor: null` 并在台账具名「未获独立审计的补录」——不得静默回填为已审。

## 6. item / instrument 的分界（封闭判据 + tie-break）

- `item_defects`：缺陷在**题面或判据文本**里，修法是改题面/判据/夹具期望，且修复后**同一答卷**判定翻转。
- `instrument_defects`：缺陷在**代码**里，修法是改代码，且修复后**同一答卷**判定不变、但同一输入的扫描/校验输出翻转。
- **tie-break**（G71/SR4-68 型「题面与夹具矛盾」）：若修复需要同时改题面与代码，则拆两条：题面部分入 `item_defects`，代码部分入 `instrument_defects`，两条互相引用 `defect_id`；**同一事实禁止在两链各记一条完整条目**（L-SINGLE-SOURCE）。

## 7. 未决（请机主裁）

1. 是否采纳 B + 修订版 (ii)（本页 §0）。
2. 规则 5 的 `TAINTED` 语义是否授权本席机械置位（还是必须人类点签）。
3. 存量四例补审计：是现在补（每例一轮蜂群/盲审），还是先以「未获独立审计的补录」形态入账、之后随代补。
