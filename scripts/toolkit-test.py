#!/usr/bin/env python3
"""toolkit-test —— 方案 D 的工具包测试能力（MVP）。

用法：python3 scripts/toolkit-test.py <repo-path> [--runner auto|pytest|unittest|npm]
        [--allow-npm] [--allow-foreign] [--timeout 秒（默认 300）]

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


def run(cmd, cwd, logf, timeout=300):
    t0 = time.time()
    try:
        p = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           timeout=timeout, env={**os.environ, "NO_COLOR": "1"})
        out, rc = p.stdout.decode("utf-8", "replace"), p.returncode
    except FileNotFoundError as e:
        out, rc = f"命令不存在：{e}", 127
    except subprocess.TimeoutExpired as e:
        part = (e.stdout or b"").decode("utf-8", "replace")
        out, rc = f"{part}\n超时（{timeout}s），已终止", 124
    logf.write(out)
    return rc, out, round(time.time() - t0, 1)


def classify(runner, rc, out):
    if rc == 124:
        return "UNVERIFIABLE", "超时，结果不可判"
    if rc in (126, 127):
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
    # 车道纪律（L-LINE-BINDING）：默认只测本线仓；他线仓必须显式带 --allow-foreign
    own = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    scratch = "/tmp/opencode"
    if not (repo == own or repo.startswith(own + os.sep) or repo == scratch or repo.startswith(scratch + os.sep)) and "--allow-foreign" not in sys.argv:
        print(json.dumps({"state": "UNVERIFIABLE",
                          "why": f"跨线仓默认拒绝：{repo}（他线可能正在作业；确需测试请带 --allow-foreign）",
                          "repo": repo}, ensure_ascii=False))
        return 3
    runner, cmd = detect_runner(repo)
    if "--runner" in sys.argv:
        want = sys.argv[sys.argv.index("--runner") + 1]
        if want == "unittest":
            runner, cmd = "unittest", [sys.executable, "-m", "unittest", "discover", "-q", "-s", "tests"]
        elif want in ("pytest", "npm") and runner != want:
            runner, cmd = want, ([sys.executable, "-m", "pytest", "-q", "--color=no"] if want == "pytest" else ["npm", "test", "--silent"])
    if runner == "npm" and "--allow-npm" not in sys.argv:
        print(json.dumps({"state": "UNVERIFIABLE",
                          "why": "npm 自动选择已禁用（可能重负载/有副作用）；确需运行请显式带 --allow-npm",
                          "repo": repo}, ensure_ascii=False))
        return 3
    if runner is None:
        print(json.dumps({"state": "TRIVIAL-SUITE", "why": "没有可识别的测试配置", "repo": repo}, ensure_ascii=False))
        return 2

    # 日志永不写进被测仓：他线仓只读，本线仓也不留垃圾
    logdir = "/tmp/opencode/toolkit-test"
    os.makedirs(logdir, exist_ok=True)
    logpath = os.path.join(logdir, f"{os.path.basename(repo)}-{int(time.time())}.log")

    with open(logpath, "w") as logf:
        logf.write(f"# cmd={' '.join(cmd)}\n# cwd={repo}\n")
        tmo = int(sys.argv[sys.argv.index("--timeout") + 1]) if "--timeout" in sys.argv else 300
        rc, out, secs = run(cmd, repo, logf, timeout=tmo)
        state, why = classify(runner, rc, out)
        logf.write(f"\n# rc={rc} state={state} {why} elapsed={secs}s\n")

    print(json.dumps({"state": state, "why": why, "runner": runner, "rc": rc,
                      "elapsed_s": secs, "log": logpath, "repo": repo}, ensure_ascii=False))
    return STATES[state]


if __name__ == "__main__":
    sys.exit(main())
