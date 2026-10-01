#!/usr/bin/env python3
"""run_check.py <gen> <item-id> — 对候选体产物跑 report_check/v1，落 harness/check_receipt.json。

时序：run_candidate.py 之后、run_judge.py 之前执行（judge 按文件存在性注入收据）。
pack 文本 = manifest.files 里的播种文件（排除候选记忆 AGENTS.md 与本收据输入 REPORT.md）
现读现算；证据包被改写会同时被磁盘探测（manifest 重算）具名，双通道互为佐证。
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import looplib as L
from report_check import check


def main():
    if len(sys.argv) != 3:
        print("usage: run_check.py <gen> <item-id>", file=sys.stderr)
        sys.exit(2)
    gen, item_id = sys.argv[1], sys.argv[2]
    hd2, ws = L.harness_dir(gen, item_id), L.workshop_dir(gen, item_id)
    manifest = json.loads((hd2 / "manifest.json").read_text())
    report = ws / "REPORT.md"
    pack_parts = []
    for rel in manifest["files"]:
        p = L.cand_root(gen, item_id) / rel
        if rel.endswith("workshop/REPORT.md") or rel.endswith("AGENTS.md") or not p.is_file():
            continue
        pack_parts.append(f"===== {rel} =====\n" + p.read_text(errors="replace"))
    truth = {k: v for k, v in manifest["ground_truth"].items()}
    receipt = {
        "gen": gen, "item": item_id,
        "report_present": report.is_file(),
        "report_sha256": L.sha256_file(report) if report.is_file() else None,
        "checks": check(report.read_text(errors="replace"), "\n".join(pack_parts), truth) if report.is_file() else None,
    }
    out = hd2 / "check_receipt.json"
    out.write_text(json.dumps(receipt, indent=2, ensure_ascii=False))
    print(f"receipt -> {out}\n" + json.dumps(receipt, indent=2, ensure_ascii=False))
    if not receipt["report_present"]:
        sys.exit(1)
    sys.exit(0 if receipt["checks"]["all_mechanical_pass"] else 1)


if __name__ == "__main__":
    main()
