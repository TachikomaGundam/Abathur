# 存量器具伤补审计 v2（四例，按首轮 must-fix 更正引用后重送）

更正记录（v1 = `instrument-defects-legacy-audit-20261102.md`，首轮审计 `sibyl-20261102T125606Z-0976` 判 0A/3R；四例实体均被独立证实 EXISTS+FIXED，驳回点为引用面）：
- 例1 器具落点由不存在的 `loop/boundary_read_scan.py` 更正为 **`loop/looplib.py:478` 的 `boundary_read_scan()`**（本席 `grep -n "def boundary_read_scan" loop/looplib.py` → `478:def boundary_read_scan(tx: dict) -> list:`）。
- 例1 修复后证据指针由 `G83/SR4-62/candidate_state.json`（无该键）更正为 **`.omo/evidence/loop-archive/G83/bundle.json`**。
- 例3 关于 `verdict-problems.txt` 的首轮判断与本席磁盘探测相反：本席 `grep -n "verdict.problems" loop/run_judge.py` 命中 **:204、:235、:241、:244**。以磁盘为准；若审计方复跑仍零命中，请贴出命令与 workdir。
- 例3 首轮实质问题（未记录「真实畸形票面曾落盘/曾致错判」）本版不回避，见该例「伤害证据」。

## 例 1 — INS-20261031-G82SCAN / class=scanner-false-positive / 期望 blocking

- 缺陷：`loop/looplib.py::boundary_read_scan()` 曾把候选报告**正文里的引用文字**当越界（对 tool-input 整个 JSON 做 `/home/lab/` 子串匹配），开 incident，使 G82 `nominatable=false`。
- 修复：提交 `29b2214`，改动面 = `loop/looplib.py` + `loop/test_boundary_scan.py`（5 例，含 `test_write_body_quoting_home_is_clean`）。
- 复算：`git show 29b2214 --stat`；`python3 loop/test_boundary_scan.py`；`python3 -c "import json;d=json.load(open('.omo/evidence/loop-archive/G82/bundle.json'));print(d['nominatable'],len(d['incidents']))"`；`python3 -c "import json;d=json.load(open('.omo/evidence/loop-archive/G83/bundle.json'));print(d['incidents'],d['nominatable'],[i['item'] for i in d['items']])"`。

## 例 2 — INS-20261025-SR469SIG / class=seed-signature-mismatch / 期望 blocking

- 缺陷：`setup_sr4_69(ws)` 与 `loop/seed_item.py:112` 的 `item["setup"](gen, item_id)` 参数个数不符 → 必抛 TypeError。
- 修复：`09ffecc`（签名改 `(gen, item)`，`loop/bank.py:5100`）+ 契约 `loop/test_bank_contract.py`（6 例，含 `test_setup_arity_matches_seed_item`）；`f60779a` 补 SR4-69 夹具。
- 复算：`git show 09ffecc^:loop/bank.py | grep -n "def setup_sr4_69"`；`grep -n "def setup_sr4_69" loop/bank.py`；`python3 loop/test_bank_contract.py`。
- 已知轻微债：无当年运行期 traceback 存档，崩溃由静态 arity + 调用点闭合。

## 例 3 — INS-20261026-VERDICT-SHAPE / class=verdict-validator-gap / 期望 blocking（伤害证据不足请判降级）

- 缺陷：`a02a4a2` 之前判官输出无形状校验，畸形票面可落盘。
- 修复：`a02a4a2` 引入 `verdict_problems()`；现行 `loop/run_judge.py:31` 定义、`:239` 调用、`:235/:241` 写 `judge-work/verdict-problems.txt` 并 `:238/:243` `sys.exit(3)`；`:204` 清陈旧文件。
- 复算：`git show a02a4a2 --stat`；`grep -n "def verdict_problems" loop/run_judge.py`；`grep -n "verdict-problems.txt" loop/run_judge.py`。
- 伤害证据（供判定）：后续 `d7b7aa8`（判官票面绑定引擎会话）、`3015bee`（重判票绑定真实审计 run）都是在「票面可被信任」前提受质疑后加的闸。但本席**未能给出单一事故记录**（某次畸形票面确实落盘并致错判）。若审计方认为该缺口使 blocking 不成立，请判 `hygiene` 并写明理由；入账时按你的判定写，派生值若仍推到 blocking，则以「审计判降级 + 具名理由」登记豁免，不静默改写派生规则。

## 例 4 — INS-20261101-TIMEOUT / class=timeout-default / 期望 blocking

- 缺陷：全局默认 `TURN_TIMEOUT=1200s`（`loop/looplib.py:59`）使长题撞闸：`.omo/tooling.json#item_turn_timeout_note` 记录 g79-10 SR4-64 于 1201s rc=-9（ses_e64984ea9ffe）、g81-5 SR4-65 于 1200s rc=-9（ses_e644d4b30ffe）。
- 修复：`7e518a1`（per-item ceiling + `--resume`，`looplib.py:62-64`、`run_candidate.py:312/338/353/405`）；旋钮 SR4-52/64/65=2400s。
- 复算：`git show 7e518a1 --stat`；`grep -n "item_turn_timeout" -A 6 loop/looplib.py`；`python3 -c "import json;print(json.load(open('.omo/tooling.json'))['item_turn_timeout'])"`；`git log --oneline --grep resume-after-turn-timeout`。

## 请逐例回答

1. EXISTS（是/否）+ 依据
2. FIXED（是/否）+ 依据
3. 可支撑的 severity（blocking / hygiene）+ 依据；例3 请明确表态
