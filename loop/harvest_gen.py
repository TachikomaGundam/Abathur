#!/usr/bin/env python3
"""harvest_gen.py <gen> [ignored] — 考场收口：先出 bundle，再归档。

考场流水线跑在宿主侧（沙箱断网无法调用模型端点），故本脚本经插件 harvest 阶段执行。
第二个位置参数被忽略，仅为适配插件的 gen/item/stage 三字段封闭模式。
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: harvest_gen.py <gen> [ignored]", file=sys.stderr)
        return 2
    gen = sys.argv[1]
    steps = [
        [sys.executable, "loop/bundle_close.py", gen],
        [sys.executable, "loop/sweep.py", "archive", gen],
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
