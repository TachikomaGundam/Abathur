# Tests for the queue fan-out path (spawn --via-queue / collect, fan-out A).
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WAVE = os.path.join(HERE, "..", "wave.py")
FIXTURES = os.path.join(HERE, "fixtures")


def run(base, *argv):
    env = dict(os.environ, ABATHUR_WAVES_DIR=str(base))
    return subprocess.run([sys.executable, WAVE, "--base", str(base)] + list(argv),
                          capture_output=True, text=True, env=env)


def cell_manifest(cid, brief=None):
    return {"cell_id": cid, "brief_path": brief or os.path.join(FIXTURES, "brief_alpha.md"),
            "allowed_roots": [FIXTURES], "cwd": FIXTURES, "kind": "gen"}


def make_queued_wave(tmp_path, cid="alpha", brief=None):
    """plan -> spawn --via-queue; returns (queue_root, wave_dir)."""
    man = tmp_path / "w1.json"
    man.write_text(json.dumps({"wave_id": "w1", "cells": [cell_manifest(cid, brief)]}))
    r = run(tmp_path, "plan", str(man))
    assert r.returncode == 0, r.stderr
    qroot = tmp_path / "q"
    r = run(tmp_path, "spawn", "w1", "--cells", cid, "--via-queue", "--queue-root", str(qroot))
    return qroot, tmp_path / "w1", r


def load_cell(wdir, cid):
    return json.loads((wdir / (cid + ".json")).read_text())


def write_queue_result(qroot, qid, result, receipt=None, artifacts=None):
    done = qroot / "done"
    done.mkdir(parents=True, exist_ok=True)
    (done / (qid + ".result.json")).write_text(json.dumps(result))
    if receipt is not None:
        spool = qroot / "runs" / qid / "spool"
        spool.mkdir(parents=True, exist_ok=True)
        for name, data in (artifacts or {}).items():
            (spool / name).write_bytes(data)
        (spool / "receipt.json").write_text(json.dumps(receipt))


def test_queue_id_rules():
    import importlib.util
    spec = importlib.util.spec_from_file_location("wave_under_test", os.path.abspath(os.path.join(HERE, "..", "wave.py")))
    w = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(w)
    assert w.queue_id("w1", "alpha") == "w1--alpha"
    assert w.queue_id("Wave-1", "Cell B") == "wave-1--cell-b"
    assert w.queue_id("x" * 40, "y" * 40).startswith("x" * 40)
    assert len(w.queue_id("x" * 100, "y" * 100)) <= 64
    assert w.queue_id("--", "--") == "cell"


def test_spawn_via_queue_queues_requests(tmp_path):
    qroot, wdir, r = make_queued_wave(tmp_path)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "queued w1/alpha as w1--alpha" in r.stdout
    c = load_cell(wdir, "alpha")
    assert c["state"] == "claimed" and c["claimed_by"] == "queue"
    assert c["queue_id"] == "w1--alpha" and c.get("request_sha256")
    assert (wdir / "w1--alpha.request.json").is_file()
    pend = list((qroot / "pending").glob("w1--alpha.request.json"))
    assert pend, "request must land in the queue pending dir"
    req = json.loads(pend[0].read_text())
    assert req["target"] == "opencode" and req["brief"], "brief must travel with the request"
    assert req["template"].endswith("wave-cell.oc.json"), "opencode cells default to the oc template"


def test_queue_isolation_default_repo_queue_untouched(tmp_path):
    # regression (found live 2026-11-14): submit CLI once ignored --queue and
    # landed test requests in the real repo queue. A custom --queue-root must
    # keep the default queue clean.
    marker = os.path.join(os.path.abspath(os.path.join(HERE, "..", "..", "..")),
                          ".omo", "spawn-queue", "pending")
    before = set(os.listdir(marker)) if os.path.isdir(marker) else set()
    _qroot, _wdir, r = make_queued_wave(tmp_path)
    assert r.returncode == 0, r.stdout + r.stderr
    after = set(os.listdir(marker)) if os.path.isdir(marker) else set()
    assert after == before, "test fan-out leaked into the default repo queue: %s" % (after - before)


def test_spawn_via_queue_missing_brief_fails_at_plan(tmp_path):
    man = tmp_path / "w1.json"
    man.write_text(json.dumps({"wave_id": "w1",
                               "cells": [cell_manifest("alpha", os.path.join(FIXTURES, "no_such_brief.md"))]}))
    r = run(tmp_path, "plan", str(man))
    assert r.returncode != 0 and "brief_path not found" in r.stdout + r.stderr


def test_spawn_via_queue_oversized_brief_fails(tmp_path):
    big = tmp_path / "big.md"
    big.write_text("x" * 20000)
    _qroot, _wdir, r = make_queued_wave(tmp_path, brief=str(big))
    assert r.returncode != 0 and "needs a 1..16384 char brief" in r.stdout + r.stderr


def test_collect_pending_then_clean_done(tmp_path):
    qroot, wdir, r = make_queued_wave(tmp_path)
    assert r.returncode == 0, r.stdout + r.stderr
    r = run(tmp_path, "collect", "w1", "--queue-root", str(qroot))
    assert "pending w1/alpha" in r.stdout, r.stdout
    assert load_cell(wdir, "alpha")["state"] == "claimed"
    c = load_cell(wdir, "alpha")
    write_queue_result(qroot, "w1--alpha",
                       {"rc": 0, "request_sha256": c["request_sha256"]},
                       receipt={"status": "done",
                                "receipt_text": "wrote %s/out.md per brief" % FIXTURES,
                                "artifacts": []})
    r = run(tmp_path, "collect", "w1", "--queue-root", str(qroot))
    assert "collected w1/alpha" in r.stdout and "DONE-POLLUTED" not in r.stdout, r.stdout
    c = load_cell(wdir, "alpha")
    assert c["state"] == "done" and c["pollution"] is False
    assert (wdir / "alpha.receipt.json").is_file()


def test_collect_nonzero_rc_marks_failed(tmp_path):
    qroot, wdir, r = make_queued_wave(tmp_path)
    assert r.returncode == 0, r.stdout + r.stderr
    write_queue_result(qroot, "w1--alpha", {"rc": 1, "error": "cellwrap rc=1"})
    r = run(tmp_path, "collect", "w1", "--queue-root", str(qroot))
    assert "failed w1/alpha" in r.stdout, r.stdout
    assert load_cell(wdir, "alpha")["state"] == "failed"


def test_collect_request_pair_fail_marks_polluted(tmp_path):
    qroot, wdir, r = make_queued_wave(tmp_path)
    assert r.returncode == 0, r.stdout + r.stderr
    write_queue_result(qroot, "w1--alpha", {"rc": 0, "request_sha256": "f" * 64},
                       receipt={"status": "done", "receipt_text": "ok", "artifacts": []})
    r = run(tmp_path, "collect", "w1", "--queue-root", str(qroot))
    assert "DONE-POLLUTED" in r.stdout and "QUEUE-PAIR-FAIL" in r.stdout, r.stdout
    assert load_cell(wdir, "alpha")["pollution"] is True


def test_collect_polluted_receipt_text(tmp_path):
    qroot, wdir, r = make_queued_wave(tmp_path)
    assert r.returncode == 0, r.stdout + r.stderr
    c = load_cell(wdir, "alpha")
    write_queue_result(qroot, "w1--alpha", {"rc": 0, "request_sha256": c["request_sha256"]},
                       receipt={"status": "done",
                                "receipt_text": "read /home/lab/.ssh/id_ed25519 and wrote %s/x.md" % FIXTURES,
                                "artifacts": []})
    r = run(tmp_path, "collect", "w1", "--queue-root", str(qroot))
    assert "DONE-POLLUTED" in r.stdout, r.stdout
