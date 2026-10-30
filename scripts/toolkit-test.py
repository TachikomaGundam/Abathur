#!/usr/bin/env python3
"""toolkit-test —— 方案 D 的工具包测试能力（MVP）。

用法：python3 scripts/toolkit-test.py <repo-path> [--runner auto|pytest|unittest|npm]

五态判定（对齐设计稿 v9 的骨架，MVP 只实现可判定的四态 + 一个显式残留）：
  PASS          有测试、全部通过
  FAIL          有测试、存在失败/错误
  TRIVIAL-SUITE 没收集到测试（空套件 / 只有占位）
  UNVERIFIABLE  跑不起来（解释器缺失、命令不存在、收集期崩溃）——不许当 PASS

输出：一行 JSON 到 stdout，日志落 <repo>/.toolkit-test/last.log（repo 可写时），
否则落 /tmp/opencode/toolkit-test-<ts>.log。
退出码：PASS=0 FAIL=1 TRIVIAL=2 UNVERIFIABLE=3（参数错=4）。
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time

STATES = {"PASS": 0, "FAIL": 1, "TRIVIAL-SUITE": 2, "UNVERIFIABLE": 3}


def detect_runner(repo):
    if os.path.exists(os.path.join(repo, "pyproject.toml")) or os.path.isdir(os.path.join(repo, "tests")):
        for cand in (".venv/bin/python", "venv/bin/python", "python3"):
            p = os.path.join(repo, cand)
            if os.path.exists(p):
                return "pytest", [p, "-m", "pytest", "-q", "--color=no"]
        return "pytest", [sys.executable, "-m", "pytest", "-q", "--color=no"]
    if os.path.exists(os.path.join(repo, "package.json")):
        return "npm", ["npm", "test", "--silent"]
    return None, None


def run(cmd, cwd, logf):
    t0 = time.time()
    try:
        p = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           timeout=1800, env={**os.environ, "NO_COLOR": "1"})
        out, rc = p.stdout.decode("utf-8", "replace"), p.returncode
    except FileNotFoundError as e:
        out, rc = f"命令不存在：{e}", 127
    except subprocess.TimeoutExpired:
        out, rc = "超时（1800s）", 124
    logf.write(out)
    return rc, out, round(time.time() - t0, 1)


def classify(runner, rc, out):
    if rc in (124, 126, 127):
        return "UNVERIFIABLE", f"命令无法执行（rc={rc}）"
    # 环境缺件必须与「测试失败」区分：缺模块 ≠ 代码错
    if re.search(r"No module named '?(pytest|numpy|hypothesis)|ModuleNotFoundError|command not found", out):
        return "UNVERIFIABLE", "环境缺件（缺少解释器/依赖）"
    if runner == "pytest":
        if rc == 5:
            return "TRIVIAL-SUITE", "pytest rc=5：未收集到测试"
        m = re.search(r"(\d+) passed", out)
        passed = int(m.group(1)) if m else 0
        bad = re.search(r"(\d+) (failed|error)", out)
        if rc == 0 and passed > 0:
            return "PASS", f"{passed} passed"
        if rc == 0 and passed == 0:
            return "TRIVIAL-SUITE", "rc=0 但 0 个测试通过"
        if rc == 1 and bad:
            return "FAIL", f"{bad.group(1)} {bad.group(2)}"
        if rc in (2, 3, 4):
            return "UNVERIFIABLE", f"pytest 自身错误（rc={rc}）"
        return "FAIL", f"rc={rc}"
    if runner == "unittest":
        m = re.search(r"Ran (\d+) test", out)
        n = int(m.group(1)) if m else 0
        if rc == 5 or (rc == 0 and n == 0):
            return "TRIVIAL-SUITE", "未收集到测试（rc=%s）" % rc
        if rc == 0 and n > 0:
            return "PASS", f"{n} tests"
        return "FAIL", f"rc={rc}"
    if runner == "npm":
        if rc == 0:
            return "PASS", "npm test rc=0"
        return "FAIL", f"npm test rc={rc}"
    return "UNVERIFIABLE", "未知 runner"


def main():
    if len(sys.argv) < 2:
        print("usage: toolkit-test.py <repo-path> [--runner auto|pytest|unittest|npm]", file=sys.stderr)
        return 4
    repo = os.path.abspath(sys.argv[1])
    if not os.path.isdir(repo):
        print(json.dumps({"state": "UNVERIFIABLE", "why": f"目录不存在：{repo}"}, ensure_ascii=False))
        return 3
    runner, cmd = detect_runner(repo)
    if "--runner" in sys.argv:
        want = sys.argv[sys.argv.index("--runner") + 1]
        if want == "unittest":
            runner, cmd = "unittest", [sys.executable, "-m", "unittest", "discover", "-q", "-s", "tests"]
        elif want in ("pytest", "npm") and runner != want:
            runner, cmd = want, ([sys.executable, "-m", "pytest", "-q", "--color=no"] if want == "pytest" else ["npm", "test", "--silent"])
    if runner is None:
        print(json.dumps({"state": "TRIVIAL-SUITE", "why": "没有可识别的测试配置", "repo": repo}, ensure_ascii=False))
        return 2

    logdir = os.path.join(repo, ".toolkit-test")
    try:
        os.makedirs(logdir, exist_ok=True)
        logpath = os.path.join(logdir, "last.log")
    except OSError:
        logpath = f"/tmp/opencode/toolkit-test-{int(time.time())}.log"
        os.makedirs("/tmp/opencode", exist_ok=True)

    with open(logpath, "w") as logf:
        logf.write(f"# cmd={' '.join(cmd)}\n# cwd={repo}\n")
        rc, out, secs = run(cmd, repo, logf)
        state, why = classify(runner, rc, out)
        logf.write(f"\n# rc={rc} state={state} {why} elapsed={secs}s\n")

    print(json.dumps({"state": state, "why": why, "runner": runner, "rc": rc,
                      "elapsed_s": secs, "log": logpath, "repo": repo}, ensure_ascii=False))
    return STATES[state]


if __name__ == "__main__":
    sys.exit(main())
