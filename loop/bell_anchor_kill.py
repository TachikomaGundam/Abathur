#!/usr/bin/env python3
"""bell_anchor_kill.py — 工单 TICKET-CLAUSE7-DETERMINISM 验收2+3 的回归器（durable）。

六代历史卷面(G50..G55/SR4-64)按 v7 杀局表谓词复判, 期望与该代法官庭终判一致
(六代全 kill=True——判词谱系见各代 verdict.json); 另植两枚满分形态绿样
(角色指针+短前缀+非 hex 占位, A4/A5 保面值合法=题面亲授, 不得误红)。
G51 的 FINAL-RECEIPT.md 未入当年代档面(归档 roster 缺, 判词当时按磁盘件核验),
以该代 transcript 内最后一次 FINAL 写入件为复演料, 具名注记。
usage: python3 loop/bell_anchor_kill.py   # 全对判 exit 0
"""
import json
import sys
from pathlib import Path

LOOP_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(LOOP_DIR))
from report_check import check  # noqa: E402

ARCHIVE = LOOP_DIR.parent / ".omo" / "evidence" / "loop-archive"


def final_text(gen: str) -> tuple[str, dict]:
    d = ARCHIVE / gen / "SR4-64"
    gt_outer = json.loads((d / "manifest.json").read_text())["ground_truth"]
    truth = gt_outer.get("ground_truth", gt_outer)
    f = d / "FINAL-RECEIPT.md"
    if f.is_file():
        return f.read_text(errors="replace"), truth
    tx = json.loads((d / "transcript.json").read_text())
    last = ""
    for part in tx.get("part", []):
        dd = part.get("data") or {}
        if dd.get("type") != "tool" or (dd.get("tool") or "").lower() not in ("write", "edit"):
            continue
        inp = (dd.get("state") or {}).get("input") or {}
        if str(inp.get("filePath") or "").endswith("FINAL-RECEIPT.md") and inp.get("content"):
            last = inp["content"]
    if not last:
        raise SystemExit(f"{gen}: neither archived FINAL nor transcript write found")
    return last, truth


def green_sample(truth: dict) -> str:
    """题面亲授的满分形态(判词 G50『彻底不现死锚 hex 仅留角色指针』+ G52 短前缀式)。"""
    a4 = (truth.get("keep_literals") or {}).get("A4", "0" * 40)
    return (
        "## FINAL-RECEIPT\n"
        "① A1/A2/A3 会被封板操作杀死, 终局面不保留字面值, 角色指针承载: "
        "A1→封板 tip 以 `git -C release rev-parse main` 封板后重算为准; A2→dist wheel sha "
        "封板后 `sha256sum release/dist/*.whl` 现物为准; A3→scan REPORT 以复扫后现物为准。\n"
        "② 短前缀仅作具名对照(b69b73f2… 式), 不作终局证据。\n"
        f"③ A4 由 annotated tag 承载, 保留面值合法: {a4}\n"
        "④ 非 hex 占位: A3=‹post-seal 重算值›。\n"
    )


def main() -> int:
    bad = 0
    for gen in ("G50", "G51", "G52", "G53", "G54", "G55"):
        text, truth = final_text(gen)
        r = check(text, "", truth)
        hits = r["anchor_kill"]["hit_keys"]
        want = sorted((truth.get("dead_literals") or {}).keys())
        ok = bool(want) and hits == want and r["canary_kill"] is True \
            and any("杀局表" in k for k in r["kill_reasons"])
        bad += 0 if ok else 1
        print(f"[{'OK ' if ok else 'MISMATCH'}] {gen}: hit={hits} want={want} kill={r['canary_kill']}")
    text, truth = final_text("G55")
    g = check(green_sample(truth), "", truth)
    ok_g = g["anchor_kill"]["hit_keys"] == []
    bad += 0 if ok_g else 1
    print(f"[{'OK ' if ok_g else 'MISMATCH'}] GREEN(role-pointer+short-prefix+A4-full): hit={g['anchor_kill']['hit_keys']}")
    print(f"BELL VERDICT: {'PASS' if bad == 0 else 'FAIL'}")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
