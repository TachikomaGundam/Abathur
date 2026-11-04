import json
import os
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
WAVE = os.path.join(HERE, "..", "wave.py")
FIXTURES = os.path.join(HERE, "fixtures")
VIDEOGEN = "/home/lab/workspace/harness/VideoGen"
PCB = "/home/lab/workspace/harness/PCB-Agent"


def run(base, *argv):
    env = dict(os.environ, ABATHUR_WAVES_DIR=str(base))
    return subprocess.run([sys.executable, WAVE, "--base", str(base)] + list(argv),
                          capture_output=True, text=True, env=env)


def cell_manifest(cid, deps=None, roots=None, brief=None):
    m = {"cell_id": cid, "brief_path": brief or os.path.join(FIXTURES, "brief_alpha.md"),
         "allowed_roots": roots if roots is not None else [FIXTURES],
         "kind": "gen"}
    if deps:
        m["deps"] = deps
    return m


def make_manifest(tmp_path, cells, wave_id="w1"):
    p = tmp_path / ("%s.json" % wave_id)
    p.write_text(json.dumps({"wave_id": wave_id, "cells": cells}))
    return str(p)


def read_cell(base, wave_id, cid):
    with open(base / wave_id / (cid + ".json")) as fh:
        return json.load(fh)


def write_receipt(tmp_path, name, text):
    r = tmp_path / name
    r.write_text(text)
    return str(r)


def test_happy_path(tmp_path):
    man = make_manifest(tmp_path, [cell_manifest("alpha"), cell_manifest("beta", brief=os.path.join(FIXTURES, "brief_beta.md"))])
    r = run(tmp_path, "plan", man)
    assert r.returncode == 0, r.stderr
    assert "wave 0 (width 2" in r.stdout
    pack = read_cell(tmp_path, "w1", "alpha")
    assert pack["state"] == "new" and pack["kind"] == "gen" and pack["created_at"]
    assert os.path.isfile(tmp_path / "w1" / "beta.json") and os.path.isfile(tmp_path / "w1" / "meta.json")

    r = run(tmp_path, "launch", "w1", "--cells", "all")
    assert r.returncode == 0, r.stderr
    assert "FIRE ALL 2 DISPATCH LINES IN ONE MESSAGE" in r.stdout
    assert read_cell(tmp_path, "w1", "alpha")["state"] == "launched"

    r = run(tmp_path, "claim", "w1", "alpha")
    assert r.returncode == 0, r.stderr
    assert read_cell(tmp_path, "w1", "alpha")["state"] == "claimed"

    receipt = write_receipt(tmp_path, "r.txt", "wrote %s/out.md per brief, all inside allowed_roots" % FIXTURES)
    r = run(tmp_path, "done", "w1", "alpha", "--receipt", receipt)
    assert r.returncode == 0, r.stderr
    assert "receipt clean" in r.stdout
    cell = read_cell(tmp_path, "w1", "alpha")
    assert cell["state"] == "done" and cell["pollution"] is False

    r = run(tmp_path, "status", "w1")
    assert r.returncode == 0 and "done=1" in r.stdout and "launched=1" in r.stdout


def test_cross_line_root_rejected_at_plan(tmp_path):
    man = make_manifest(tmp_path, [
        cell_manifest("ok"),
        cell_manifest("evil", roots=[FIXTURES, VIDEOGEN + "/evolution"]),
    ])
    r = run(tmp_path, "plan", man)
    assert r.returncode != 0
    assert "cross-line pollution" in r.stderr
    assert "otm_videogen" in r.stderr
    assert not (tmp_path / "w1").exists(), "fail-closed plan must write nothing"


def test_receipt_pollution_detection(tmp_path):
    man = make_manifest(tmp_path, [cell_manifest("alpha")])
    assert run(tmp_path, "plan", man).returncode == 0
    run(tmp_path, "launch", "w1", "--cells", "alpha")
    run(tmp_path, "claim", "w1", "alpha")
    receipt = write_receipt(tmp_path, "dirty.txt",
                            "touched %s/board.kicad and wrote %s/out.md" % (PCB, FIXTURES))
    r = run(tmp_path, "done", "w1", "alpha", "--receipt", receipt)
    assert r.returncode == 0, r.stderr
    assert "DONE-POLLUTED" in r.stdout
    assert PCB in r.stdout
    cell = read_cell(tmp_path, "w1", "alpha")
    assert cell["state"] == "done" and cell["pollution"] is True
    assert cell["pollution_violations"] == [PCB + "/board.kicad"]


def test_dep_gating_order(tmp_path):
    man = make_manifest(tmp_path, [cell_manifest("a"), cell_manifest("b", deps=["a"])])
    r = run(tmp_path, "plan", man)
    assert r.returncode == 0 and "wave 0 (width 1, fire concurrently): a" in r.stdout
    assert "wave 1 (width 1, fire concurrently): b" in r.stdout

    r = run(tmp_path, "launch", "w1", "--cells", "b")
    assert r.returncode != 0 and "dep not done" in r.stderr

    r = run(tmp_path, "launch", "w1", "--cells", "all")
    assert r.returncode == 0, r.stderr
    assert "held back: b" in r.stdout
    assert read_cell(tmp_path, "w1", "a")["state"] == "launched"
    assert read_cell(tmp_path, "w1", "b")["state"] == "new"

    run(tmp_path, "claim", "w1", "a")
    receipt = write_receipt(tmp_path, "ra.txt", "artifact: %s/a.out" % FIXTURES)
    assert run(tmp_path, "done", "w1", "a", "--receipt", receipt).returncode == 0

    r = run(tmp_path, "launch", "w1", "--cells", "all")
    assert r.returncode == 0, r.stderr
    assert read_cell(tmp_path, "w1", "b")["state"] == "launched"


def test_manifest_validation_errors(tmp_path):
    man = make_manifest(tmp_path, [
        cell_manifest("dup"),
        cell_manifest("dup"),
        dict(cell_manifest("ghostdep"), deps=["nowhere"]),
        cell_manifest("emptyroots", roots=[]),
        dict(cell_manifest("badkind"), kind="magic"),
        cell_manifest("nobrief", brief=str(tmp_path / "missing.md")),
    ])
    r = run(tmp_path, "plan", man)
    assert r.returncode != 0
    for needle in ("duplicate cell_id: dup", "dep does not exist: nowhere",
                   "allowed_roots must be non-empty", "kind must be one of", "brief_path not found"):
        assert needle in r.stderr, needle
    assert not (tmp_path / "w1").exists()


def test_requeue_retry_path(tmp_path):
    man = make_manifest(tmp_path, [cell_manifest("alpha")])
    assert run(tmp_path, "plan", man).returncode == 0
    run(tmp_path, "launch", "w1", "--cells", "alpha")
    assert run(tmp_path, "fail", "w1", "alpha", "--note", "boom").returncode == 0
    assert run(tmp_path, "launch", "w1", "--cells", "alpha").returncode != 0
    r = run(tmp_path, "requeue", "w1", "alpha", "--note", "retry")
    assert r.returncode == 0 and "requeued" in r.stdout
    assert read_cell(tmp_path, "w1", "alpha")["state"] == "new"
    r = run(tmp_path, "launch", "w1", "--cells", "alpha")
    assert r.returncode == 0, r.stderr


def test_done_requires_existing_receipt(tmp_path):
    man = make_manifest(tmp_path, [cell_manifest("alpha")])
    assert run(tmp_path, "plan", man).returncode == 0
    run(tmp_path, "launch", "w1", "--cells", "alpha")
    run(tmp_path, "claim", "w1", "alpha")
    r = run(tmp_path, "done", "w1", "alpha")
    assert r.returncode != 0 and "--receipt" in r.stderr
    r = run(tmp_path, "done", "w1", "alpha", "--receipt", str(tmp_path / "nope.txt"))
    assert r.returncode != 0 and "does not exist" in r.stderr
    assert read_cell(tmp_path, "w1", "alpha")["state"] == "claimed"
