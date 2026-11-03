#!/usr/bin/env python3
"""Generate a generation's NOMINATION.md from disk facts, gated twice.

Why this exists: three independent audits rejected G66's paper — every rejection
was about the paper's own literals, not the machine facts. Hand-typed values were
the disease; prose patches never cured it. This generator removes the class:

  1. it computes every value it writes (sha256 of a named file, a field of a named
     JSON, a git commit, a count of a directory) and records the source for each;
  2. it writes a facts map beside the page (literal -> source + how), so an auditor
     can re-derive any value without trusting the prose;
  3. it refuses to write the page unless every literal in the rendered page is in
      that facts map AND the checker re-verifies each literal against its own
      recorded source, recomputing file sha256 and git commits where it can — so a
      value echoed by an older page or a log cannot be laundered into legitimacy.

Contract:
  python3 loop/nominate.py GEN [--audit RUNID ...] [--gap TEXT ...] [--dry-run]

  --audit  independent-review run id; its space under ABATHUR_REVIEW_HOME must exist, else refused.
  --gap    a named gap; at least one is required.

Exit: 0 written + both gates green, 1 gate/contract failure (nothing written), 2 usage.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "loop"))

from verify_nomination_literals import ISO, SHA, SHA_PREFIX  # noqa: E402
from review_state import review_spaces_dir  # noqa: E402

ARCHIVE = os.path.join(REPO, ".omo", "evidence", "loop-archive")
EVIDENCE = os.path.join(REPO, ".omo", "evidence")
CHECKER = os.path.join(REPO, "loop", "verify_nomination_literals.py")
REVIEW_SPACES = str(review_spaces_dir())


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def commit_of(path: str) -> str:
    """Hash of the last commit touching path (git, no memory). Date intentionally omitted:
    a local-offset ISO string in prose would need its own registered source."""
    proc = subprocess.run(
        ["git", "-C", REPO, "log", "-1", "--format=%h", "--", os.path.relpath(path, REPO)],
        capture_output=True, text=True)
    return proc.stdout.strip() or "UNTRACKED"


class Facts:
    """literal -> (source path, how it was obtained). Every emitted value lands here."""

    def __init__(self) -> None:
        self.map: dict[str, dict] = {}

    def note(self, literal, source: str, how: str):
        if literal not in (None, ""):
            key = str(literal)
            holder = self.map.get(key)
            # Priority: a primary source (disk file / git) must not be downgraded by a later
            # quote inside the author-declared disposition ledger; the reverse upgrade is allowed
            # because the ledger is rendered before the sections that cite primary receipts.
            if holder is None or ("dispositions.json" in holder["source"]
                                  and "dispositions.json" not in source):
                self.map[key] = {"source": source, "how": how}
        return literal

    def file_sha(self, path: str) -> str:
        digest = sha256_file(path)
        self.note(digest, path, "sha256 of file bytes")
        return digest

    def field(self, path: str, value, name: str):
        self.note(value, path, f"field {name}")
        return value

    def any_text(self, text: str, source: str, how: str) -> str:
        for lit in SHA.findall(text) + SHA_PREFIX.findall(text) + ISO.findall(text):
            self.note(lit, source, how)
        return text


def archive_files(gen: str) -> list[str]:
    root = os.path.join(ARCHIVE, gen)
    out = []
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root)
            if rel.startswith("NOMINATION"):  # never let the page cite itself
                continue
            out.append(rel)
    return sorted(out)


def bell_runs(items: list[str], facts: Facts) -> list[dict]:
    runs = []
    if not os.path.isdir(ARCHIVE):
        return runs
    for name in sorted(os.listdir(ARCHIVE)):
        if not name.endswith("CAN"):
            continue
        bpath = os.path.join(ARCHIVE, name, "bundle.json")
        if not os.path.isfile(bpath):
            continue
        bundle = load_json(bpath)
        hit = [it["item"] for it in bundle.get("items", []) if it.get("item") in items]
        if not hit:
            continue
        runs.append({
            "gen": name,
            "items": hit,
            "killed": len(bundle.get("canaries_killed", [])),
            "closed_at": facts.field(bpath, bundle.get("closed_at", ""), "closed_at"),
            "sha": facts.file_sha(bpath),
        })
    return runs


def tally_ballots(space: str) -> tuple[dict, dict, int, int]:
    path = os.path.join(space, "TERMINALS.txt")
    if not os.path.isfile(path):
        return {}, {}, 0, 0
    ballots: dict[str, str] = {}
    sessions: dict[str, str] = {}
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            fields = {}
            for token in line.split():
                if "=" in token:
                    key, _, val = token.partition("=")
                    fields[key] = val
            worker = fields.get("worker")
            if not worker:
                continue
            if "ballot=" in line:
                ballots[worker] = line.split("ballot=", 1)[1].split()[0].strip()
            if fields.get("session"):
                sessions[worker] = fields["session"]
    approve = sum(1 for v in ballots.values() if v == "APPROVE")
    reject = sum(1 for v in ballots.values() if v == "REJECT")
    return ballots, sessions, approve, reject


def judge_receipt(gen: str, item: str) -> dict | None:
    done = os.path.join(REPO, ".omo", "exam-queue", "done")
    if not os.path.isdir(done):
        return None
    for name in sorted(os.listdir(done), reverse=True):
        if not name.endswith(".result.json"):
            continue
        path = os.path.join(done, name)
        try:
            with open(path, encoding="utf-8") as fh:
                rec = json.load(fh)
        except (OSError, ValueError):
            continue
        if rec.get("gen") != gen or rec.get("item") != item or rec.get("stage") != "judge":
            continue
        tail = str(rec.get("tail", ""))
        session = ""
        for token in tail.split():
            if token.startswith("session="):
                session = token.split("=", 1)[1].strip()
        return {"path": path, "sha": sha256_file(path), "session": session,
                "elapsed": rec.get("elapsed_s")}
    return None


def last_commit_utc(path_rel: str) -> str:
    proc = subprocess.run(["git", "log", "-1", "--format=%cI", "--", path_rel],
                          cwd=REPO, capture_output=True, text=True)
    raw = proc.stdout.strip()
    if not raw:
        return ""
    return datetime.fromisoformat(raw).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def computed_disclosures(bundle: dict, bells: list, facts: "Facts") -> list[str]:
    out: list[str] = []
    n = 0
    if bells:
        n += 1
        gens = ", ".join(b["gen"] for b in bells)
        out.append(f"D{n} 铃测独立性：{gens} 由提名席自己计划、播种、封包，无独立盲审席参与"
                   "（G62 先例为独立盲审 + 独立判定）。铃响只证明该判卷路径能杀假卷，不证明判卷席独立。")
    closed = str(bundle.get("closed_at", ""))
    drifted = []
    for rel in ("loop/run_judge.py", "loop/looplib.py", "loop/bundle_close.py"):
        when = last_commit_utc(rel)
        if when and closed and when > closed:
            drifted.append(f"{rel}（{facts.any_text(when, os.path.join(REPO, rel), 'git log -1 --format=%cI')}）")
    receipt = os.path.join(EVIDENCE, "g66-tooling-blob-hashes.txt")
    if drifted:
        n += 1
        if os.path.isfile(receipt):
            with open(receipt, encoding="utf-8") as fh:
                text = fh.read()
            facts.any_text(text, receipt, "verbatim in blob-hash receipt")
            for full in SHA.findall(text):
                facts.note(f"{full[:8]}…", receipt, "prefix of the full hash on a receipt line")
            out.append(f"D{n} 封包后工装漂移：{', '.join(drifted)} 的最后提交晚于封包时刻 {closed}；"
                       f"本次判卷使用的版本与当前盘面不同，两时点哈希回执在 {receipt}"
                       f"（{facts.file_sha(receipt)}）。封包时刻的 run_judge.py 哈希系由 `7a5871b^` blob "
                       "加回执时序推断，不是 closed_at 时刻拍下的快照")
        else:
            out.append(f"D{n} 封包后工装漂移：{', '.join(drifted)} 的最后提交晚于封包时刻 {closed}，"
                       "且未找到两时点哈希回执")
    for b in bells:
        bpath = b.get("path") or os.path.join(ARCHIVE, b["gen"], "bundle.json")
        if not os.path.isfile(bpath):
            continue
        try:
            with open(bpath, encoding="utf-8") as fh:
                bb = json.load(fh)
        except (OSError, ValueError):
            continue
        for it in bb.get("items", []):
            anomalies = str((it.get("judge_verdict") or {}).get("anomalies", "")).strip()
        if anomalies:
            n += 1
            out.append(f"D{n} {b['gen']}/{it.get('item','')} 判卷 anomalies 原文："
                           f"{facts.any_text(anomalies, bpath, 'judge_verdict.anomalies')}")
    return out


def main() -> int:
    argv = sys.argv[1:]
    if not argv:
        print("usage: nominate.py GEN [--audit RUNID ...] [--gap TEXT ...] [--dry-run]", file=sys.stderr)
        return 2
    gen = argv[0]
    audits: list[str] = []
    gaps: list[str] = []
    dry = False
    i = 1
    while i < len(argv):
        tok = argv[i]
        if tok == "--audit" and i + 1 < len(argv):
            audits.append(argv[i + 1]); i += 2; continue
        if tok == "--gap" and i + 1 < len(argv):
            gaps.append(argv[i + 1]); i += 2; continue
        if tok == "--dry-run":
            dry = True; i += 1; continue
        print(f"nominate: unexpected argument {tok!r}", file=sys.stderr)
        return 2

    adir = os.path.join(ARCHIVE, gen)
    bpath = os.path.join(adir, "bundle.json")
    if not os.path.isfile(bpath):
        print(f"nominate: no bundle at {bpath}", file=sys.stderr)
        return 1
    bundle = load_json(bpath)

    for run in audits:
        space = os.path.join(REVIEW_SPACES, run)
        if not os.path.isdir(space):
            print(f"nominate: audit {run} has no space at {space} — refusing to cite it", file=sys.stderr)
            return 1
    if not gaps:
        print("nominate: refusing to emit a page with no named gaps (--gap required)", file=sys.stderr)
        return 1

    facts = Facts()
    facts_dir = os.path.join(EVIDENCE, "nomination-history", gen)
    facts_path = os.path.join(facts_dir, "facts.json")
    disp_path = os.path.join(facts_dir, "dispositions.json")
    if not dry:
        os.makedirs(facts_dir, exist_ok=True)
        if not audits:
            print("nominate: refusing to write a page that cites no audit", file=sys.stderr)
            return 1
        if not os.path.isfile(disp_path):
            print(f"nominate: refusing to write without {disp_path} "
                  "(one disposition per ballot must-fix; deletions must be declared)", file=sys.stderr)
            return 1
        with open(disp_path, encoding="utf-8") as fh:
            loaded = json.load(fh)
        dispositions = loaded.get("runs", loaded) if isinstance(loaded, dict) else {}
        for run in audits:
            rows_d = dispositions.get(run) or []
            if not rows_d:
                print(f"nominate: dispositions missing for audit {run}", file=sys.stderr)
                return 1
            for row_d in rows_d:
                if row_d.get("status") not in ("landed", "superseded", "open"):
                    print(f"nominate: disposition {run}/{row_d.get('id')} status "
                          f"{row_d.get('status')!r} not in landed|superseded|open", file=sys.stderr)
                    return 1
    else:
        dispositions = {}
    stamp_path = os.path.join(EVIDENCE, f"nomination-{gen}.genstamp.txt")
    stamp_ts = utc_now()
    if not dry:
        with open(stamp_path, "w", encoding="utf-8") as fh:
            fh.write(f"generated_at={stamp_ts}\nby=loop/nominate.py\n")
    facts.note(stamp_ts, stamp_path, "generated_at in genstamp file (written before render)")

    rows = []
    for idx, it in enumerate(bundle.get("items", [])):
        item = it.get("item", "")
        vpath = os.path.join(adir, item, "verdict.json")
        has = os.path.isfile(vpath)
        jv = it.get("judge_verdict") or {}
        rows.append({
            "item": item,
            "verdict": facts.field(bpath, it.get("verdict", ""), f"items[{idx}].verdict"),
            "aggregate": facts.field(bpath, jv.get("aggregate", it.get("verdict", "")),
                                     f"items[{idx}].judge_verdict.aggregate"),
            "canary_kill": facts.field(bpath, jv.get("canary_kill"), f"items[{idx}].judge_verdict.canary_kill"),
            "memory": facts.field(bpath, it.get("memory_diff", ""), f"items[{idx}].memory_diff"),
            "vpath": vpath if has else "",
            "vsha": facts.file_sha(vpath) if has else "",
            "judge_receipt": judge_receipt(gen, item),
        })

    items = [r["item"] for r in rows]
    bells = bell_runs(items, facts)

    import draw  # noqa: E402  (repo module; path set above)
    duty = draw.regression_duty()

    file_rows = [(rel, facts.file_sha(os.path.join(adir, rel))) for rel in archive_files(gen)]

    L: list[str] = []
    add = L.append
    add(f"# 世代 {gen} 提名页（机器生成，勿手改）")
    add("")
    add(f"由 `loop/nominate.py` 于 {stamp_ts} 生成（该时刻同时记在 `{stamp_path}`）。")
    add(f"每个字面值的来源登记在旁车 `{facts_path}`：值 → 文件 + 获取方式。")
    add("写盘前过两道闸：①页内每个字面值都已在旁车登记；②闸 2 按**每个字面值登记的来源**逐一核对。")
    add("闸 2 能重算的一律重算（文件 sha256、git 最后提交）；其余只核对「原文出现在登记来源里」，两类数量分开列出。")
    add("")
    add("## 一、包面")
    add("")
    add(f"- 世代：{gen}")
    add(f"- 终态：{facts.field(bpath, bundle.get('terminal_state',''), 'terminal_state')}"
        f"｜可提名：{facts.field(bpath, bundle.get('nominatable'), 'nominatable')}")
    add(f"- 封包时刻：{facts.field(bpath, bundle.get('closed_at',''), 'closed_at')}")
    add(f"- 铃测击杀表：{facts.field(bpath, json.dumps(bundle.get('canaries_killed', []), ensure_ascii=False), 'canaries_killed')}")
    add(f"- 三章戳：{facts.field(bpath, ' + '.join(bundle.get('stamps', [])), 'stamps')}")
    roster = bundle.get("roster", {}) or {}
    add(f"- 选手模型：{facts.field(bpath, roster.get('candidate_model',''), 'roster.candidate_model')}"
        f"｜判卷模型：{facts.field(bpath, roster.get('judge_model',''), 'roster.judge_model')}")
    c = commit_of(bpath)
    c_label = facts.note(c, bpath, "git log -1 --format=%h -- <bundle>") if c != "UNTRACKED" else "不在 git 跟踪面（.omo 被 .gitignore 排除）"
    add(f"- `bundle.json`：sha256 `{facts.file_sha(bpath)}`；最后提交 {c_label}")
    add("")
    add("## 二、逐题判卷")
    add("")
    add("| 题 | 判卷结论 | 聚合 | 铃击 | 记忆 | 判卷原件 | 原件 sha256 |")
    add("|---|---|---|---|---|---|---|")
    for r in rows:
        add(f"| {r['item']} | {r['verdict']} | {r['aggregate']} | {r['canary_kill']} | {r['memory']} | {r['vpath'] or '（归档无此件）'} | {r['vsha'] or '—'} |")
    add("")
    add("判卷回执（宿主侧作业记录，非模型自述）：")
    add("")
    for r in rows:
        jr = r.get("judge_receipt")
        if not jr:
            add(f"- {r['item']}：未找到宿主侧判卷回执（这是缺口，不得写成「有回执」）。")
            continue
        sid = ""
        if jr.get("session"):
            sid = f"，session=`{facts.note(jr['session'], jr['path'], 'tail 里的 session= token')}`"
        add(f"- {r['item']}：`{jr['path']}`（sha256 "
            f"`{facts.note(jr['sha'], jr['path'], 'sha256sum of result json')}`，"
            f"耗时 {jr.get('elapsed')}s{sid}）")
    add("")
    add("## 三、债务与轮换")
    add("")
    add(f"`loop/draw.py` 的 `regression_duty()` 生成时刻实算：`{json.dumps(duty, ensure_ascii=False)}`")
    add("")
    add("## 四、铃测覆盖")
    add("")
    if bells:
        add("| 铃测世代 | 覆盖题 | 击杀数 | 封包时刻 | bundle sha256 |")
        add("|---|---|---|---|---|")
        for b in bells:
            add(f"| {b['gen']} | {', '.join(b['items'])} | {b['killed']} | {b['closed_at']} | `{b['sha']}` |")
    else:
        add("本代相关题无任何铃测世代——**此处是缺口，不得在呈报中写成「已验证」**。")
    add("")
    add("## 五、审计链")
    add("")
    if audits:
        for run in audits:
            space = os.path.join(REVIEW_SPACES, run)
            votes = [f for f in sorted(os.listdir(space)) if f.endswith(".md")]
            ballots, sessions, approve, reject = tally_ballots(space)
            tpath = os.path.join(space, "TERMINALS.txt")
            add(f"- `{run}`：票面 A{approve}/R{reject}｜票件 {len(votes)} 份（{', '.join(votes)}）")
            if ballots:
                detail = "; ".join(f"{w}={b}" for w, b in sorted(ballots.items()))
                add(f"  - 逐席：{detail}（来源 `{tpath}`）")
                for worker, sid in sorted(sessions.items()):
                    add(f"  - `{worker}` 会话：`{facts.note(sid, tpath, 'session field in TERMINALS.txt')}`")
            else:
                add("  - 票面未能解析（TERMINALS.txt 缺失或格式变动）——不得据 A0/R0 推断任何裁定的方向。")
        add("")
        add("### must-fix 处置账（逐票逐条；删改须具名声明，不得静默消失）")
        add("")
        ledger_path = os.path.join(EVIDENCE, "INTENT-LEDGER.md")
        if os.path.isfile(ledger_path):
            add(f"跨代上下文：G65 提名经审计 `sibyl-20261031T073920Z-3fc9` 裁定 REJECT 1A/2R；"
                f"台账锚 `INTENT-LEDGER.md:1011`"
                f"（run id 经 `{facts.any_text('sibyl-20261031T073920Z-3fc9', ledger_path, 'verbatim at INTENT-LEDGER.md:1011')}` 在同文件内逐字命中）。")
            add("")
        add("| 审计 | 条目 | 要求（票件摘录） | 处置 | 痕迹 |")
        add("|---|---|---|---|---|")
        for run in audits:
            for row_d in dispositions.get(run, []):
                add(f"| `{run}` | {row_d.get('id','')} | "
                    f"{facts.any_text(str(row_d.get('demand','')), disp_path, 'dispositions.json demand')} | "
                    f"{row_d.get('status','')} | "
                    f"{facts.any_text(str(row_d.get('trace','')), disp_path, 'dispositions.json trace')} |")
        add("")
        add("处置词义固定：landed=已落实并给痕迹；superseded=随旧版作废并说明为何不影响结论；open=仍未落实（留人类裁）。")
    else:
        add("未附审计 id。")
    add("")
    add("## 六、具名缺口（不得省略）")
    add("")
    for g in gaps:
        add(f"- {g}")
    auto = computed_disclosures(bundle, bells, facts)
    if auto:
        add("")
        add("以下各条由生成器从磁盘自动列入，不由人工缺口清单决定（从本页删除即越权）：")
        add("")
        for line in auto:
            add(f"- {line}")
    add("")
    add("## 七、归档清单（sha256 逐件）")
    add("")
    add(f"共 {len(file_rows)} 件（不含本页）。")
    add("")
    for rel, sha in file_rows:
        add(f"- `{rel}`：`{sha}`")
    add("")
    add("## 八、闸回执（生成器自述与覆盖边界）")
    add("")
    add("闸 1（页内每个字面值必须在旁车登记）覆盖 = 登记动作本身；它不能证明登记值正确，只证明没有未登记的字面值。")
    add("闸 2 按每个字面值登记的来源逐条核对：能重算的（文件 sha256、git 最后提交时间）当场重算，其余核对「原文出现在登记来源里」。")
    add(f"闸 2 的完整 stdout 与 RC 落在 `{facts_dir}/gate.txt`（每次生成覆盖写，末行 `RC=` 为判据）。")
    add("旁车 `facts.json` 与旧版页面都在检查根之外，避免旧页把值回声进对账（这是 2026-10-31 审计抓出的洞）。")
    add("")
    page = "\n".join(L) + "\n"

    # Lock 1: every literal in the rendered page must have a registered source.
    known = {str(k).rstrip("\u2026") for k in facts.map}
    missing: list[str] = []
    for lineno, line in enumerate(page.splitlines(), 1):
        lits = SHA.findall(line) + [m + "\u2026" for m in SHA_PREFIX.findall(line)] + ISO.findall(line)
        for lit in dict.fromkeys(lits):
            if lit.rstrip("\u2026") not in known:
                missing.append(f"line {lineno} {lit}")
    if missing:
        print("nominate: literals with no registered source — refusing to write:", file=sys.stderr)
        for m in missing[:20]:
            print(f"  {m}", file=sys.stderr)
        return 1

    if dry:
        print(page)
        return 0

    with open(facts_path, "w", encoding="utf-8") as fh:
        json.dump({"gen": gen, "generated_at": stamp_ts, "facts": facts.map},
                  fh, ensure_ascii=False, indent=1, sort_keys=True)

    out = os.path.join(adir, "NOMINATION.md")
    tmp = os.path.join(adir, "NOMINATION.md.gen")
    if os.path.isfile(out):
        # History stays outside the checker root; a page inside it would echo every literal.
        bak = os.path.join(facts_dir, f"NOMINATION.previous-{stamp_ts.replace(':', '')}.md")
        os.replace(out, bak)
        print(f"nominate: previous page kept as {bak}", file=sys.stderr)
    # Older backups (from hand-written editions) must also leave the checker root,
    # otherwise their literals echo into lock 2 and the gate proves nothing.
    for name in sorted(os.listdir(adir)):
        if not (name.startswith("NOMINATION.") and name.endswith(".md")):
            continue
        os.replace(os.path.join(adir, name), os.path.join(facts_dir, name))
        print(f"nominate: moved stray backup out of checker root: {os.path.join(facts_dir, name)}",
              file=sys.stderr)
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(page)

    # Lock 2 checks each literal against ITS registered source (recompute where the
    # source allows it), so old pages and logs cannot echo a value into legitimacy.
    proc = subprocess.run(
        [sys.executable, CHECKER, tmp, "--facts", facts_path],
        capture_output=True, text=True)
    gate_txt = os.path.join(facts_dir, "gate.txt")
    with open(gate_txt, "w", encoding="utf-8") as fh:
        fh.write(f"$ python3 loop/verify_nomination_literals.py {tmp} --facts {facts_path}\n")
        fh.write(proc.stdout + proc.stderr + f"RC={proc.returncode}\n")
    print(f"nominate: lock2 rc={proc.returncode} [{gate_txt}]")
    for ln in [x for x in proc.stdout.splitlines() if "checked=" in x][-1:]:
        print(f"  {ln}")
    if proc.returncode != 0:
        os.unlink(tmp)
        print("nominate: lock2 failed — page NOT written", file=sys.stderr)
        return 1
    os.replace(tmp, out)
    print(f"nominate: wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
