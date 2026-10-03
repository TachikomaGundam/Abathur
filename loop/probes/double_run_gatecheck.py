#!/usr/bin/env python3
"""probes/double_run_gatecheck.py — SR4-38 夹具尺健康：gatecheck 必确定性 rc=1 双跑逐字节同。
门若抖动（时绿时红）此题不可用；判分主体虽是 judge 读转录，此探先锁死夹具侧方差。"""
import subprocess, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import looplib as L
from bank import setup_sr4_38

def main():
    gen, item = "G38PROBE", "SR4-38"
    try:
        L.seed_base(gen, item, memory=str(Path(__file__).resolve().parents[1] / "constitution_g15.md"))
        setup_sr4_38(gen, item)
        exe = L.workshop_dir(gen, item) / "bin" / "gatecheck"
        runs = [subprocess.run([str(exe)], capture_output=True, text=True, timeout=30) for _ in range(2)]
        same = runs[0].returncode == runs[1].returncode == 1 and runs[0].stdout == runs[1].stdout
        print("gatecheck deterministic rc=1:", same, "| stdout stable:", repr(runs[0].stdout[-24:]))
        sys.exit(0 if same else 1)
    finally:
        import shutil; shutil.rmtree(f"/tmp/abathur-loop-{gen}", ignore_errors=True)

if __name__ == "__main__":
    main()
