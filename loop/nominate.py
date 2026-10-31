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

  --audit  sibyl run id; ~/.sibyl/spaces/<runid> must exist, else refused.
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

ARCHIVE = os.path.join(REPO, ".omo", "evidence", "loop-archive")
EVIDENCE = os.path.join(REPO, ".omo", "evidence")
CHECKER = os.path.join(REPO, "loop", "verify_nomination_literals.py")
SIBYL_SPACES = os.path.expanduser("~/.sibyl/spaces")


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
            self.map[str(literal)] = {"source": source, "how": how}
        return literal

    def file_sha(self, path: str) -> str:
        digest = sha256_file(path)
        self.note(digest, path, "sha256 of file bytes")
        return digest

    def field(self, path: str, value, name: str):
        self.note(value, path, f"field {name}")
        return value


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
        space = os.path.join(SIBYL_SPACES, run)
        if not os.path.isdir(space):
            print(f"nominate: audit {run} has no space at {space} — refusing to cite it", file=sys.stderr)
            return 1
    if not gaps:
        print("nominate: refusing to emit a page with no named gaps (--gap required)", file=sys.stderr)
        return 1

    facts = Facts()
    facts_dir = os.path.join(EVIDENCE, "nomination-history", gen)
    facts_path = os.path.join(facts_dir, "facts.json")
    if not dry:
        os.makedirs(facts_dir, exist_ok=True)
    stamp_path = os.path.join(EVIDENCE, f"nomination-{gen}.genstamp.txt")
    stamp_ts = utc_now()
    if not dry:
        with open(stamp_path, "w", encoding="utf-8") as fh:
            fh.write(f"generated_at={stamp_ts}\nby=loop/nominate.py\n")
    facts.note(stamp_ts, stamp_path, "generated_at in genstamp file (written before render)")

    rows = []
    for it in bundle.get("items", []):
        item = it.get("item", "")
        vpath = os.path.join(adir, item, "verdict.json")
        has = os.path.isfile(vpath)
        jv = it.get("judge_verdict") or {}
        rows.append({
            "item": item,
            "verdict": it.get("verdict", ""),
            "aggregate": jv.get("aggregate", it.get("verdict", "")),
            "canary_kill": jv.get("canary_kill"),
            "memory": it.get("memory_diff", ""),
            "vpath": vpath if has else "",
            "vsha": facts.file_sha(vpath) if has else "",
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
    add(f"- 终态：{bundle.get('terminal_state','')}｜可提名：{facts.field(bpath, bundle.get('nominatable'), 'nominatable')}")
    add(f"- 封包时刻：{facts.field(bpath, bundle.get('closed_at',''), 'closed_at')}")
    add(f"- 铃测击杀表：{facts.field(bpath, json.dumps(bundle.get('canaries_killed', []), ensure_ascii=False), 'canaries_killed')}")
    add(f"- 三章戳：{' + '.join(bundle.get('stamps', []))}")
    add(f"- 选手模型：{bundle.get('roster',{}).get('candidate_model','')}｜判卷模型：{bundle.get('roster',{}).get('judge_model','')}")
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
            space = os.path.join(SIBYL_SPACES, run)
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
        add("本生成器只填票面与出处，不代填裁定原文与 must-fix 处置；那部分须逐条引票件。")
    else:
        add("未附审计 id。")
    add("")
    add("## 六、具名缺口（不得省略）")
    add("")
    for g in gaps:
        add(f"- {g}")
    add("")
    add("## 七、归档清单（sha256 逐件）")
    add("")
    add(f"共 {len(file_rows)} 件（不含本页）。")
    add("")
    for rel, sha in file_rows:
        add(f"- `{rel}`：`{sha}`")
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
