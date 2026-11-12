# Tests for spool ingestion and the spawn dry plan (Campaign B).
import hashlib
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


def cell_manifest(cid):
    return {"cell_id": cid, "brief_path": os.path.join(FIXTURES, "brief_alpha.md"),
            "allowed_roots": [FIXTURES], "cwd": FIXTURES, "kind": "gen"}


def make_planned_wave(tmp_path, cid="alpha"):
    man = tmp_path / "w1.json"
    man.write_text(json.dumps({"wave_id": "w1", "cells": [cell_manifest(cid)]}))
    r = run(tmp_path, "plan", str(man))
    assert r.returncode == 0, r.stderr
    r = run(tmp_path, "launch", "w1", "--cells", cid)
    assert r.returncode == 0, r.stderr
    r = run(tmp_path, "claim", "w1", cid)
    assert r.returncode == 0, r.stderr
    return tmp_path / "w1" / "spool" / cid


def write_spool_receipt(spool, receipt, artifacts):
    spool.mkdir(parents=True, exist_ok=True)
    for name, data in artifacts.items():
        (spool / name).write_bytes(data)
    (spool / "receipt.json").write_text(json.dumps(receipt))


def sha(b):
    return hashlib.sha256(b).hexdigest()


def test_done_from_spool_clean(tmp_path):
    spool = make_planned_wave(tmp_path)
    art = b"artifact body\n"
    write_spool_receipt(
        spool,
        {"status": "done", "receipt_text": "wrote %s/out.md per brief, inside allowed_roots" % FIXTURES,
         "artifacts": [{"path": "art.md", "sha256": sha(art)}]},
        {"art.md": art})
    r = run(tmp_path, "done", "w1", "alpha", "--from-spool")
    assert r.returncode == 0, r.stderr
    assert "done w1/alpha" in r.stdout and "DONE-POLLUTED" not in r.stdout
    ingested = tmp_path / "w1" / "alpha.receipt.json"
    assert ingested.is_file() and json.loads(ingested.read_text())["status"] == "done"
    cell = json.loads((tmp_path / "w1" / "alpha.json").read_text())
    assert cell["state"] == "done" and cell["pollution"] is False


def test_done_from_spool_pair_fail_marks_polluted(tmp_path):
    spool = make_planned_wave(tmp_path)
    write_spool_receipt(
        spool,
        {"status": "done", "receipt_text": "all good (self-claimed)",
         "artifacts": [{"path": "art.md", "sha256": sha(b"different bytes")}]},
        {"art.md": b"actual bytes\n"})
    r = run(tmp_path, "done", "w1", "alpha", "--from-spool")
    assert "DONE-POLLUTED" in r.stdout and "SPOOL-PAIR-FAIL:art.md" in r.stdout
    cell = json.loads((tmp_path / "w1" / "alpha.json").read_text())
    assert cell["pollution"] is True


def test_done_from_spool_missing_artifact_fails_pair(tmp_path):
    spool = make_planned_wave(tmp_path)
    write_spool_receipt(
        spool,
        {"status": "done", "receipt_text": "claims an artifact that never lands",
         "artifacts": [{"path": "ghost.md", "sha256": sha(b"x")}]},
        {})
    r = run(tmp_path, "done", "w1", "alpha", "--from-spool")
    assert "DONE-POLLUTED" in r.stdout and "SPOOL-PAIR-FAIL:ghost.md" in r.stdout


def test_done_from_spool_rejects_path_escape(tmp_path):
    spool = make_planned_wave(tmp_path)
    write_spool_receipt(
        spool,
        {"status": "done", "receipt_text": "escape attempt",
         "artifacts": [{"path": "../alpha.json", "sha256": sha(b"x")}]},
        {})
    r = run(tmp_path, "done", "w1", "alpha", "--from-spool")
    assert "DONE-POLLUTED" in r.stdout and "escapes spool" in r.stdout


def test_spawn_dry_needs_signed_template_and_prints_plan(tmp_path):
    man = tmp_path / "w1.json"
    man.write_text(json.dumps({"wave_id": "w1", "cells": [cell_manifest("alpha")]}))
    assert run(tmp_path, "plan", str(man)).returncode == 0
    tpl = tmp_path / "tpl.json"
    tpl.write_text(json.dumps({"version": 1, "net": "closed", "home": "/home/lab"}))
    sig = tmp_path / "sig.json"
    sig.write_text(json.dumps({"entries": []}))
    r = run(tmp_path, "spawn", "w1", "--cells", "alpha", "--dry",
            "--template", str(tpl), "--signatures", str(sig), "--target", "shell", "--cmd", "true")
    assert r.returncode != 0 and "TEMPLATE-UNSIGNED" in (r.stderr + r.stdout)
    sig.write_text(json.dumps({"entries": [{
        "sha256": hashlib.sha256(tpl.read_bytes()).hexdigest(), "signed_by": "owner"}]}))
    r = run(tmp_path, "spawn", "w1", "--cells", "alpha", "--dry",
            "--template", str(tpl), "--signatures", str(sig), "--target", "shell", "--cmd", "true")
    assert r.returncode == 0, r.stderr
    assert "SPAWN-DRY alpha" in r.stdout and "--unshare-net" in r.stdout
    cell = json.loads((tmp_path / "w1" / "alpha.json").read_text())
    assert cell["state"] == "new"  # dry must not claim or transition
