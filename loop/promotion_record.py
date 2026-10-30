#!/usr/bin/env python3
"""promotion_record.py <GEN> — 晋升记录法定查询器。

法定面（owner ruling 2026-10-16 一裁=先甲后乙）: 操作员账本 INTENT-LEDGER.md +
loop-archive 证据目录 = 考场世代晋升的 canonical record；引擎 run 道修造为后续
独立工程立项（届时本器改为双面对账器）。

用法: python3 loop/promotion_record.py G49R4
输出: 世代名、bundle 终态、NOMINATION 路径+批准行、manifest-hashes（如封箱）、
      宪律快照与默认指针、机主批准原文的账本行号、相关议会票号（若卷宗载明）。
"""
import json
import re
import sys
from pathlib import Path

LOOP = Path(__file__).resolve().parent
ROOT = LOOP.parent
ARCH = ROOT / ".omo/evidence/loop-archive"
LEDGER = ROOT / ".omo/evidence/INTENT-LEDGER.md"


def approval_stamp(text: str, gen: str) -> str:
    tokens = {gen, gen.split("R")[0]}
    pattern = "|".join(rf"\b{re.escape(t)}\b" for t in sorted(tokens, key=len, reverse=True))
    lines = [ln.strip() for ln in text.splitlines()]
    stamped = [ln for ln in lines if ln.startswith("APPROVED") and re.search(pattern, ln)]
    mentions = [ln for ln in lines if "APPROVED" in ln]
    if len(stamped) == 1:
        return stamped[0][:160]
    if len(stamped) > 1:
        return f"AMBIGUOUS_APPROVAL_STAMPS(count={len(stamped)})"
    return f"NO_APPROVAL_STAMP_FOUND(prose_mentions={len(mentions)})"


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    gen = sys.argv[1]
    d = ARCH / gen
    if not d.is_dir():
        cands = sorted(p for p in ARCH.iterdir() if p.is_dir() and p.name.startswith(gen))
        if len(cands) != 1:
            print(f"REFUSED: 世代 {gen} 无唯一归档目录 (candidates: {[c.name for c in cands]})")
            return 2
        d = cands[0]
        gen = d.name
    out = {"generation": gen, "evidence_dir": str(d)}
    b = d / "bundle.json"
    if b.is_file():
        j = json.loads(b.read_text())
        out["bundle"] = {k: j.get(k) for k in ("terminal_state", "nominatable", "canaries_killed")}
    nom = d / "NOMINATION.md"
    if nom.is_file():
        out["nomination_approved_line"] = approval_stamp(nom.read_text(), gen)
    mh = d / "manifest-hashes.txt"
    if mh.is_file():
        out["sealed_manifest"] = mh.read_text().splitlines()[:1]
    led = LEDGER.read_text().splitlines()
    out["owner_rulings"] = [f"{i+1}: {l[:90]}" for i, l in enumerate(led)
                            if ("批准晋升" in l and gen.split("R")[0] in l) or f"[{gen} 呈报候裁]" in l][:4]
    import subprocess
    cur = subprocess.run(["git", "-C", str(ROOT), "log", "--oneline", "-3", "--", "loop/looplib.py"],
                         capture_output=True, text=True).stdout.strip().splitlines()
    out["constitution_pointer_history"] = cur
    print(json.dumps(out, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
