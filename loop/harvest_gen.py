#!/usr/bin/env python3
"""harvest_gen.py <gen> [ignored] — 考场收口：先验证据面，再出 bundle，最后归档。

考场流水线跑在宿主侧（沙箱断网无法调用模型端点），故本脚本经插件 harvest 阶段执行。
第二个位置参数被忽略，仅为适配插件的 gen/item/stage 三字段封闭模式。

收口前的证据闸（`preharvest_gate`）在写任何文件之前运行：题目缺 transcript 或
verdict 时直接返回非零，不产生半成品 bundle/归档——事后再查等于允许写坏数据。
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNROOT = Path("/tmp")


def preharvest_gate(gen: str) -> list[str]:
    """Required evidence per drawn item, checked before anything is written."""
    ledger = ROOT / ".omo" / "evidence" / "draw-ledger.jsonl"
    items: list[str] = []
    if ledger.is_file():
        for line in ledger.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if row.get("gen") == gen and row.get("item") and row["item"] not in items:
                items.append(row["item"])
    if not items:
        return [f"{gen}: no drawn items in draw-ledger.jsonl"]
    problems: list[str] = []
    for item in items:
        harness = RUNROOT / f"abathur-loop-{gen}" / item / "harness"
        for rel in ("transcript.json", "judge-work/verdict.json", "candidate_state.json"):
            if not (harness / rel).is_file():
                problems.append(f"{item}: missing {rel}")
    return problems


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: harvest_gen.py <gen> [ignored]", file=sys.stderr)
        return 2
    gen = sys.argv[1]
    problems = preharvest_gate(gen)
    if problems:
        for row in problems:
            print("PREHARVEST-FAIL " + row, file=sys.stderr)
        print("PREHARVEST-BLOCKED " + gen, file=sys.stderr)
        return 3
    print("PREHARVEST-OK " + gen)
    steps = [
        [sys.executable, "loop/bundle_close.py", gen],
        [sys.executable, "loop/sweep.py", "archive", gen],
        [sys.executable, "loop/coverage.py", gen],
    ]
    for cmd in steps:
        joined = " ".join(cmd)
        print("+ " + joined, flush=True)
        rc = subprocess.call(cmd, cwd=ROOT)
        if rc != 0:
            print("STEP-FAIL rc=" + str(rc) + ": " + joined, file=sys.stderr)
            return rc
    print("HARVEST-OK " + gen)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
