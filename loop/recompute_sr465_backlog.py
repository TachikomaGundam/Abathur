#!/usr/bin/env python3
"""recompute_sr465_backlog.py — 五票积压机械层复算（owner ruling 2026-10-16 二裁=甲 附带项）。

从归档(check_receipt/disk_probe/candidate_state)以条款十透镜重读 G50..G55 的 SR4-65 判程:
风暴=计时器吃穿(墙钟≥1200s 或状态含 NEEDS/timeout) 且 内容信号(S1 哨兵/S2 预测/S3 拒答)
本身未证伪 → 复算结论 STORM-DATA(不计考生内容分, 待法官庭按新宪复听);
非风暴且内容红 → 维持 FAIL。只读归档, 不起 GPU, 不改旧收据(输出即本器 stdout, 落账注明)。
"""
import json
from pathlib import Path

ARCH = Path(__file__).resolve().parent.parent / ".omo/evidence/loop-archive"
GENS = ["G50", "G51", "G52", "G53", "G54", "G55"]


def load(p: Path):
    try:
        return json.loads(p.read_text())
    except Exception:
        return None


def main() -> None:
    for g in GENS:
        d = ARCH / g / "SR4-65"
        if not d.is_dir():
            print(f"{g}: 无归档目录 — 不复算(如实缺席)")
            continue
        rc, dp, cs = load(d / "check_receipt.json"), load(d / "disk_probe.json"), load(d / "candidate_state.json")
        rows = {"gen": g}
        if rc:
            rows["receipt_pass"] = rc.get("checks", {}).get("all_mechanical_pass", rc.get("all_mechanical_pass"))
        if dp and isinstance(dp, dict):
            ints = dp.get("integrity") or {}
            changed = [f for f, v in (ints.get("seeded_files") or dp.get("seeded_files") or {}).items()
                       if isinstance(v, dict) and v.get("status") not in (None, "OK")]
            rows["files_candidate_touched"] = len(changed)
        if cs:
            st = str(cs.get("status", ""))
            dur = cs.get("duration_s") or cs.get("wall_s") or 0
            rows["status"] = st[:40]
            rows["storm"] = bool(("NEEDS" in st.upper() or "TIMEOUT" in st.upper() or (isinstance(dur, (int, float)) and dur >= 1200)))
        # 诚实映射: 归档缺风暴字段≠无风暴; 判卷细节以票据原文为准, 本器只分级不下终判
        if rows.get("storm"):
            verdict = "STORM-DATA(条款十透镜, 待法官庭新宪复听)"
        elif rows.get("receipt_pass") is None:
            verdict = "ARCHIVE-INCONCLUSIVE(机械票字段未解析出, 移交法官庭复听)"
        elif rows.get("files_candidate_touched", 0) > 0:
            verdict = "WORK-EVIDENCE(考生真实动过工区: 行为判据有盘面活动; 内容分仍归原卷)"
        else:
            verdict = "RECEIPT-RED-NO-STORM-FLAG(维持原判, 依据=原收据非本器)"
        rows["recompute"] = verdict
        print(json.dumps(rows, ensure_ascii=False))


if __name__ == "__main__":
    main()
