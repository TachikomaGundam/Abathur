#!/usr/bin/env python3
"""bell_sr4_65.py — SR4-65 chain-failure-hygiene 铃测器（durable; 非一次性）。

在一次性世代 bell65-<pid> 里真实落种本包夹具, 然后植入三份答案给 S1 工装实跑:
  V1 copy-original = broken/release.sh 原样照抄       → 必须 FAIL-as-required(哨兵出现, s1_pass=false)
  V2 set-e-only    = 原链只在 shebang 后插 `set -e`   → 必须 FAIL-as-required(机器事实: 失败步处于
                     `cmd && echo` 列表非末位被 POSIX set -e 豁免, 下游照常执行; 此变体若翻绿,
                     说明 bash 语义已变或工装失灵, kill② 与铃测须按新事实重设计)
  V3 reference-fix = 参考修复(set -euo pipefail+裸命令行) → 必须 PASS(防常响尺: 好答案不得误红)
三份期望全部命中 → BELL VERDICT: PASS; 任一失配 → FAIL 且 exit 1。跑完即清世代目录。

usage: python3 loop/bell_sr4_65.py
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

LOOP_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(LOOP_DIR))
import looplib as L  # noqa: E402
from bank import ITEMS  # noqa: E402

GEN = "bell65-%d" % os.getpid()
ITEM = "SR4-65"


def plant_and_replay(run: Path, hd: Path, name: str, text: str) -> dict:
    plant = hd / ("bell-plant-%s.sh" % name)
    plant.write_text(text)
    plant.chmod(0o755)
    out = hd / ("bell-verdict-%s.json" % name)
    r = subprocess.run([sys.executable, str(hd / "replay_fixed.py"), str(run),
                        "--script", str(plant), "--out", str(out)],
                       capture_output=True, text=True, timeout=600)
    verdict = json.loads(out.read_text())
    verdict["_replay_rc"] = r.returncode
    return verdict


def main() -> int:
    run = L.run_dir(GEN, ITEM)
    if run.exists():
        print("REFUSAL: %s 已存在(世代不净), 先人工核查" % run)
        return 2
    try:
        L.seed_base(GEN, ITEM)
        setup_ret = ITEMS[ITEM]["setup"](GEN, ITEM)
        gt = setup_ret["ground_truth"]
        hd = L.harness_dir(GEN, ITEM)
        ws = L.workshop_dir(GEN, ITEM)

        broken = (ws / "broken" / "release.sh").read_text()
        lines = broken.splitlines(keepends=True)
        sete_only = lines[0] + "set -e\n" + "".join(lines[1:])
        reference = (hd / "reference-fix.sh").read_text()

        cases = [
            ("V1 copy-original", broken, False, True),
            ("V2 set-e-only", sete_only, False, True),
            ("V3 reference-fix", reference, True, False),
        ]
        all_ok = True
        for label, text, expect_pass, expect_sentinel in cases:
            v = plant_and_replay(run, hd, label.split()[0], text)
            sentinel = bool(v.get("observations", {}).get("sentinels"))
            ok = (v.get("s1_pass") is expect_pass
                  and sentinel is expect_sentinel
                  and v["_replay_rc"] == (0 if expect_pass else 1))
            all_ok = all_ok and ok
            print("%-18s s1_pass=%-5s sentinel=%-5s replay_rc=%d expected(s1_pass=%s, sentinel=%s) -> %s"
                  % (label, v.get("s1_pass"), sentinel, v["_replay_rc"],
                     expect_pass, expect_sentinel, "OK" if ok else "MISMATCH"))
            print("                 rcs=%s sentinels=%s"
                  % ([x["rc"] for x in v.get("runs", [])],
                     v.get("observations", {}).get("sentinels")))
        print("accident face pinned by seed self-test: commit=%s tag=%s broken_core=%s"
              % (gt["accident_commit_sha"][:12], gt["accident_tag_sha"][:12],
                 gt["broken_tree_core_sha256"][:12]))
        print("BELL VERDICT: %s" % ("PASS — 假卷皆红(哨兵实证)且真卷绿, 尺辨双向"
                                     if all_ok else "FAIL — 铃测失配, 尺不可用"))
        return 0 if all_ok else 1
    finally:
        shutil.rmtree(run, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
