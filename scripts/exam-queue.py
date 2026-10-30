#!/usr/bin/env python3
"""exam-queue.py — 宿主侧考场作业队列（沙箱内的座席只能"下单"，不能自己跑）。

为什么需要它：沙箱断网后，座席的 bash 里连不到模型端点，考场流水线
（seed_item → run_candidate → run_judge）必须在沙箱外以 lab 身份运行。
本脚本由 systemd --user 服务常驻，只接受三类固定作业，不接受任意命令。

作业格式（写入 .omo/exam-queue/*.json，文件名任意，内容必须是）：
  {"gen": "G61", "item": "SR4-64", "stage": "seed|candidate|judge"}

落盘契约：
  .omo/exam-queue/           待办（座席可写）
  .omo/exam-queue/running.json 正在跑（同一时刻只一个）
  .omo/exam-queue/done/<name>.result.json   rc / elapsed / 输出尾部
  .omo/exam-queue/rejected/<name>.json     非法作业 + 原因
  .omo/exam-queue/runner.log                追加式日志

用法：
  python3 scripts/exam-queue.py            # 常驻轮询（systemd 用）
  python3 scripts/exam-queue.py --once     # 处理一批后退出
  python3 scripts/exam-queue.py --dry-run  # 只校验并打印将要执行的命令
"""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
QUEUE = REPO / ".omo" / "exam-queue"
STAGES = {"seed": "seed_item.py", "candidate": "run_candidate.py", "judge": "run_judge.py"}
GEN_RE = re.compile(r"^G[0-9]+[A-Z]*$")
ITEM_RE = re.compile(r"^SR4-[0-9]+$")
TIMEOUT_S = 7200
LOG_MAX = 1_000_000


def log(msg):
    line = f"{time.strftime('%Y-%m-%dT%H:%M:%S%z')} {msg}\n"
    try:
        if (QUEUE / "runner.log").exists() and (QUEUE / "runner.log").stat().st_size > LOG_MAX:
            (QUEUE / "runner.log").replace(QUEUE / "runner.log.1")
    except OSError:
        pass
    with open(QUEUE / "runner.log", "a") as f:
        f.write(line)


def validate(req):
    if not isinstance(req, dict):
        return "作业不是 JSON 对象"
    gen, item, stage = req.get("gen"), req.get("item"), req.get("stage")
    if not isinstance(gen, str) or not GEN_RE.match(gen):
        return f"gen 非法：{gen!r}"
    if not isinstance(item, str) or not ITEM_RE.match(item):
        return f"item 非法：{item!r}"
    if stage not in STAGES:
        return f"stage 非法：{stage!r}"
    return None


def run_job(name, req, dry_run=False):
    gen, item, stage = req["gen"], req["item"], req["stage"]
    script = REPO / "loop" / STAGES[stage]
    if not script.exists():
        return {"rc": 2, "error": f"脚本不存在：{script}"}
    cmd = [sys.executable, str(script), gen, item]
    if dry_run:
        return {"dry_run": True, "cmd": " ".join(cmd)}
    (QUEUE / "running.json").write_text(json.dumps(req, ensure_ascii=False))
    t0 = time.time()
    try:
        p = subprocess.run(cmd, cwd=str(REPO), stdout=subprocess.PIPE,
                           stderr=subprocess.STDOUT, timeout=TIMEOUT_S,
                           env={k: v for k, v in os.environ.items() if not k.startswith("ABATHUR_")})
        rc, out = p.returncode, p.stdout.decode("utf-8", "replace")
    except subprocess.TimeoutExpired as e:
        rc, out = 124, (e.stdout or b"").decode("utf-8", "replace") + f"\n[超时 {TIMEOUT_S}s]"
    elapsed = round(time.time() - t0, 1)
    result = {"gen": gen, "item": item, "stage": stage, "rc": rc,
              "elapsed_s": elapsed, "tail": out[-4000:]}
    (QUEUE / "done").mkdir(exist_ok=True)
    (QUEUE / "done" / f"{name}.result.json").write_text(json.dumps(result, ensure_ascii=False, indent=1))
    (QUEUE / "running.json").unlink(missing_ok=True)
    log(f"DONE {name} gen={gen} item={item} stage={stage} rc={rc} {elapsed}s")
    return result


def process_once(dry_run=False):
    QUEUE.mkdir(parents=True, exist_ok=True)
    (QUEUE / "done").mkdir(exist_ok=True)
    (QUEUE / "rejected").mkdir(exist_ok=True)
    if (QUEUE / "running.json").exists() and not dry_run:
        log("BUSY 已有作业在跑，等待")
        return False
    jobs = sorted(p for p in QUEUE.glob("*.json") if p.name != "running.json")
    if not jobs:
        return False
    name = jobs[0].stem
    try:
        req = json.loads(jobs[0].read_text())
    except (OSError, json.JSONDecodeError) as e:
        (QUEUE / "rejected" / f"{name}.json").write_text(json.dumps(
            {"file": jobs[0].name, "reason": f"无法解析：{e}"}, ensure_ascii=False))
        jobs[0].unlink(missing_ok=True)
        log(f"REJECT {name}: 无法解析")
        return True
    err = validate(req)
    if err:
        (QUEUE / "rejected" / f"{name}.json").write_text(json.dumps(
            {"file": jobs[0].name, "reason": err, "request": req}, ensure_ascii=False))
        jobs[0].unlink(missing_ok=True)
        log(f"REJECT {name}: {err}")
        return True
    log(f"START {name} gen={req['gen']} item={req['item']} stage={req['stage']}")
    res = run_job(name, req, dry_run=dry_run)
    jobs[0].unlink(missing_ok=True)
    if dry_run:
        print(json.dumps(res, ensure_ascii=False))
    return True


def main():
    dry = "--dry-run" in sys.argv
    once = "--once" in sys.argv or dry
    while True:
        try:
            busy = process_once(dry_run=dry)
        except Exception as e:  # 守护进程不许因单次故障退出
            log(f"ERROR {type(e).__name__}: {e}")
            busy = False
        if once and not busy:
            break
        if dry:
            break
        time.sleep(2)


if __name__ == "__main__":
    main()
