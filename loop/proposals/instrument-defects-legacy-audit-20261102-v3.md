# 存量器具伤补审计 v3（引用经机械预检后重送）

版本链：v1 `instrument-defects-legacy-audit-20261102.md`（审 0A/3R，驳回于引用面）→ v2 `...-v2.md`（审 1A/2R，驳回于例4 四条行号越过 EOF）→ 本版。
v3 的每一条 `path:line` 均由 `scripts/check-citations.py` 机械复核（先存在性、再行号范围、再符号同现），该预检器本身即为「同类病第二次 → 结构修复」的交付物。

接受的两项审计判定，本版照办、不辩解：
- 例3 降级为 `hygiene`（具名理由：无任何「畸形票面落盘并致错判」的实测伤害记录）。
- 例4 的 `--resume` 说法作废：不存在该 flag；真实行为是**自动从上一轮记录续跑**（`loop/run_candidate.py:54-62`）。

## 例 1 — INS-20261031-G82SCAN / class=scanner-false-positive / blocking

- 缺陷：`loop/looplib.py:478` 的 `boundary_read_scan()` 曾对 tool-input 整个 JSON 做 `/home/lab/` 子串匹配，把候选报告正文里的**引用文字**当越界，开 incident，使 G82 失提名。
- 修复：`29b2214`（改动面 `loop/looplib.py` + `loop/test_boundary_scan.py`）。
- 复算：`git show 29b2214 --stat`；`python3 loop/test_boundary_scan.py`；G82 票据 `nominatable=false` 且 `incidents` 非空；G83 票据 `incidents=[]`、`nominatable=true`。
- 落点更正：器具在 `loop/looplib.py`，**不存在** `loop/boundary_read_scan.py`。

## 例 2 — INS-20261025-SR469SIG / class=seed-signature-mismatch / blocking

- 缺陷：`09ffecc` 之前 `setup_sr4_69(ws)` 为单参，而 `loop/seed_item.py:112` 以 `item["setup"](gen, item_id)` 双参调用 → 每次播种必抛 TypeError。
- 修复：现行 `loop/bank.py:5100` 为 `(gen, item)`；契约 `loop/test_bank_contract.py`（6 例，含 `test_setup_arity_matches_seed_item` 对全题库扫 arity）；`f60779a` 补 SR4-69 夹具。
- 已知轻债（审计方已判不阻断）：无当年运行期 traceback 存档；崩溃由静态 arity + 唯一调用点闭合。

## 例 3 — INS-20261026-VERDICT-SHAPE / class=verdict-validator-gap / **hygiene（审计判降级，本席接受）**

- 缺陷：`a02a4a2` 之前判官票面无形状校验。
- 修复：`loop/run_judge.py:31` 定义 `verdict_problems()`；`:239` 调用；`:235`、`:241` 写 `judge-work/verdict-problems.txt`；`:238`、`:243` `sys.exit(3)`；`:204` 清陈旧文件。
- **降级具名理由**：`verdict-problems.txt` 在全部 `.omo/evidence/loop-archive/` 中零命中（含 `a02a4a2` 之后的所有世代），台账亦无「畸形票面落盘/致错判」记录；`d7b7aa8`、`3015bee` 只证信任升级，不证伤害发生。故按 hygiene 入账，派生规则仍会把它推到 blocking，入账时以「审计判降级 + 本条具名理由」登记豁免，不静默改写派生值。
- 更正纪录：首轮审计称 `verdict-problems.txt` 在 `loop/` 零命中，与磁盘相反；v2 审计已复跑命中并撤回该点。

## 例 4 — INS-20261101-TIMEOUT / class=timeout-default / blocking

- 缺陷：全局默认 `TURN_TIMEOUT=1200`（`loop/looplib.py:59`）使长题撞闸。`.omo/tooling.json#item_turn_timeout_note` 内具名记录两次真实杀进程：g79-10 SR4-64 于 1201s `rc=-9`（会话 `ses_e64984ea9ffe`）、g81-5 SR4-65 于 1200s `rc=-9`（会话 `ses_e644d4b30ffe`）。**注**：两枚会话 id 系 tooling.json 中存储的 16 字符形式，逐字引用，未补全。
- 修复：`7e518a1`（per-item ceiling + 续跑）。现行：`loop/looplib.py:62-64` 的 `item_timeout()` 按题覆盖；`loop/run_candidate.py:63` 取 `L.item_timeout(item_id)`；`:54-62` 从上一轮记录自动续跑（非 flag）。旋钮 SR4-52/64/65 = 2400s。
- 复算：`git show 7e518a1 --stat`；`grep -n "item_timeout\|RESUMING" loop/run_candidate.py`；`grep -n "def item_timeout\|TURN_TIMEOUT" loop/looplib.py`。
- 具名缺口（审计方提出，本席认账）：尚无「>1200s 的回合在 2400s 闸下实际跑完」的逐题回执；G81 之后的新证据请见后续世代。

## 机械预检回执

`python3 scripts/check-citations.py loop/proposals/instrument-defects-legacy-audit-20261102-v3.md --strict-symbols` → `CITATIONS OK problems=0`（rc=0）。

## 请逐例回答

1. EXISTS（是/否）+ 依据
2. FIXED（是/否）+ 依据
3. 可支撑 severity（blocking / hygiene）+ 依据
