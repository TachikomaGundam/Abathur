#!/usr/bin/env python3
"""Contract tests for the conditional /tmp exemption in hard_global_fail_scan."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import looplib as L


def tx(path, tool="write"):
    return {"part": [{"data": {"type": "tool", "tool": tool, "state": {"input": {"filePath": path}}}}]}


def main():
    cases = []
    cases.append(("tmp write flagged without jail proof", len(L.hard_global_fail_scan(tx("/tmp/opencode/a.mjs"), ())), 1))
    cases.append(("tmp write exempt with jail proof", len(L.hard_global_fail_scan(tx("/tmp/opencode/a.mjs"), (), jail_tmp=True)), 0))
    cases.append(("home write still flagged with jail proof", len(L.hard_global_fail_scan(tx("/home/lab/x"), (), jail_tmp=True)), 1))
    cases.append(("other run-dir path is still inside the private tmpfs", len(L.hard_global_fail_scan(tx("/tmp/abathur-loop-G9/SR4-1/x"), (), jail_tmp=True)), 0))
    cases.append(("scratch allow still works", len(L.hard_global_fail_scan(tx("/tmp/opencode/sr4-65x/a"), ("/tmp/opencode/sr4-65*",))), 0))
    cases.append(("jail proof does not exempt bash home writes",
                  len(L.hard_global_fail_scan({"part": [{"data": {"type": "tool", "tool": "bash", "state": {"input": {"command": "cp a /home/lab/secret"}}}}]}, (), jail_tmp=True)), 1))
    fails = 0
    for name, got, want in cases:
        ok = got == want
        fails += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}  {name}: got={got} want={want}")
    print(f"# pass {len(cases) - fails} / fail {fails}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
