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


def cell_manifest(cid, deps=None, roots=None, brief=None, cwd=None):
    m = {"cell_id": cid, "brief_path": brief or os.path.join(FIXTURES, "brief_alpha.md"),
         "allowed_roots": roots if roots is not None else [FIXTURES],
         "cwd": cwd or FIXTURES,
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


def test_cwd_required_and_bounded(tmp_path):
    missing = cell_manifest("nocwd")
    missing.pop("cwd")
    outside = cell_manifest("outside", cwd=str(tmp_path))
    notdir = cell_manifest("notdir", cwd=os.path.join(FIXTURES, "nope"))
    man = make_manifest(tmp_path, [missing, outside, notdir])
    r = run(tmp_path, "plan", man)
    assert r.returncode != 0
    assert "cwd is required" in r.stderr
    assert "outside allowed_roots" in r.stderr
    assert "cwd is not a directory" in r.stderr
    assert not (tmp_path / "w1").exists()


def test_symlinked_cwd_escape_rejected(tmp_path):
    root = tmp_path / "root"
    outside = tmp_path / "outside"
    root.mkdir()
    outside.mkdir()
    link = root / "escape"
    os.symlink(outside, link)
    man = make_manifest(tmp_path, [
        cell_manifest("escape", roots=[str(root)], cwd=str(link)),
    ])
    r = run(tmp_path, "plan", man)
    assert r.returncode != 0
    assert "outside allowed_roots" in r.stderr
    assert not (tmp_path / "w1").exists()


def test_cwd_swap_after_plan_rejected(tmp_path):
    root = tmp_path / "root"
    outside = tmp_path / "outside"
    root.mkdir()
    outside.mkdir()
    man = make_manifest(tmp_path, [
        cell_manifest("swap", roots=[str(root)], cwd=str(root)),
    ])
    assert run(tmp_path, "plan", man).returncode == 0
    assert run(tmp_path, "launch", "w1", "--cells", "swap").returncode == 0
    root.rmdir()
    os.symlink(outside, root)
    r = run(tmp_path, "claim", "w1", "swap")
    assert r.returncode != 0
    assert "outside allowed_roots" in r.stderr


def test_dispatch_line_carries_cwd(tmp_path):
    man = make_manifest(tmp_path, [cell_manifest("alpha")])
    assert run(tmp_path, "plan", man).returncode == 0
    r = run(tmp_path, "launch", "w1", "--cells", "all")
    assert r.returncode == 0, r.stderr
    assert "cd %s &&" % FIXTURES in r.stdout
    assert "cwd=%s" % FIXTURES in r.stdout
    assert read_cell(tmp_path, "w1", "alpha")["cwd"] == FIXTURES


def test_relative_receipt_resolves_against_cell_cwd(tmp_path):
    man = make_manifest(tmp_path, [cell_manifest("alpha")])
    assert run(tmp_path, "plan", man).returncode == 0
    run(tmp_path, "launch", "w1", "--cells", "alpha")
    run(tmp_path, "claim", "w1", "alpha")
    receipt = write_receipt(tmp_path, "relative.txt", "wrote artifacts/out.md under my cwd")
    r = run(tmp_path, "done", "w1", "alpha", "--receipt", receipt)
    assert r.returncode == 0, r.stderr
    assert "receipt clean" in r.stdout
    assert read_cell(tmp_path, "w1", "alpha")["pollution"] is False


def test_expect_root_gate(tmp_path):
    man = make_manifest(tmp_path, [cell_manifest("alpha")])
    r = run(tmp_path, "plan", man, "--expect-root", str(tmp_path))
    assert r.returncode != 0
    assert "outside --expect-root" in r.stderr
    assert not (tmp_path / "w1").exists()

    r = run(tmp_path, "plan", man, "--expect-root", FIXTURES)
    assert r.returncode == 0, r.stderr
    run(tmp_path, "launch", "w1", "--cells", "alpha")
    run(tmp_path, "claim", "w1", "alpha")
    receipt = write_receipt(tmp_path, "ra.txt", "artifact: %s/out.md" % FIXTURES)
    r = run(tmp_path, "done", "w1", "alpha", "--receipt", receipt,
            "--expect-root", FIXTURES)
    assert r.returncode == 0, r.stderr
    assert read_cell(tmp_path, "w1", "alpha")["state"] == "done"


def write_line_map(tmp_path, roots, forbidden, name="line_roots.json"):
    p = tmp_path / name
    p.write_text(json.dumps({
        "self": "abathur",
        "lines": {"abathur": {"roots": [str(r) for r in roots],
                              "forbidden_surfaces": list(forbidden)}},
    }))
    return str(p)


def test_legacy_line_schema_rejected(tmp_path):
    legacy = tmp_path / "legacy.json"
    legacy.write_text(json.dumps({"self": "abathur", "lines": {"abathur": [FIXTURES]}}))
    man = make_manifest(tmp_path, [cell_manifest("alpha")])
    r = run(tmp_path, "plan", man, "--line-roots", str(legacy))
    assert r.returncode != 0
    assert "legacy array schema" in r.stderr
    assert not (tmp_path / "w1").exists()


def test_forbidden_surface_rejects_narrow_root(tmp_path):
    root = tmp_path / "line"
    protected = root / "protected"
    protected.mkdir(parents=True)
    lm = write_line_map(tmp_path, [root], ["protected"])
    man = make_manifest(tmp_path, [
        cell_manifest("inside", roots=[str(protected)], cwd=str(protected)),
    ])
    r = run(tmp_path, "plan", man, "--line-roots", lm)
    assert r.returncode != 0
    assert "protected surface" in r.stderr
    assert not (tmp_path / "w1").exists()


def test_forbidden_surface_receipt_pollution(tmp_path):
    lm = write_line_map(tmp_path, [FIXTURES], ["protected"])
    man = make_manifest(tmp_path, [cell_manifest("alpha")])
    r = run(tmp_path, "plan", man, "--line-roots", lm)
    assert r.returncode == 0, r.stderr
    assert "WARNING: protected-surface overlap" in r.stdout
    pack = read_cell(tmp_path, "w1", "alpha")
    assert pack["line_roots_sha256"]
    assert pack["forbidden_surfaces"][0]["path"] == os.path.join(FIXTURES, "protected")
    run(tmp_path, "launch", "w1", "--cells", "alpha")
    run(tmp_path, "claim", "w1", "alpha")
    receipt = write_receipt(tmp_path, "dirty.txt",
                            "wrote %s/protected/ledger.md" % FIXTURES)
    r = run(tmp_path, "done", "w1", "alpha", "--receipt", receipt)
    assert r.returncode == 0, r.stderr
    assert "DONE-POLLUTED" in r.stdout
    assert "protected/ledger.md" in r.stdout


def test_line_roots_drift_blocks_done(tmp_path):
    lm = write_line_map(tmp_path, [FIXTURES], [])
    man = make_manifest(tmp_path, [cell_manifest("alpha")])
    assert run(tmp_path, "plan", man, "--line-roots", lm).returncode == 0
    run(tmp_path, "launch", "w1", "--cells", "alpha")
    run(tmp_path, "claim", "w1", "alpha")
    write_line_map(tmp_path, [FIXTURES], ["protected"], name="line_roots.json")
    receipt = write_receipt(tmp_path, "ok.txt", "wrote %s/out.md" % FIXTURES)
    r = run(tmp_path, "done", "w1", "alpha", "--receipt", receipt)
    assert r.returncode != 0
    assert "LINE-ROOTS-DRIFT" in r.stderr


def test_read_roots_are_read_only_channel(tmp_path):
    read_dir = tmp_path / "read"
    read_dir.mkdir()
    cell = cell_manifest("alpha")
    cell["read_roots"] = [str(read_dir)]
    man = make_manifest(tmp_path, [cell])
    r = run(tmp_path, "plan", man)
    assert r.returncode == 0, r.stderr
    pack = read_cell(tmp_path, "w1", "alpha")
    assert pack["read_roots"] == [os.path.realpath(str(read_dir))]
    r = run(tmp_path, "launch", "w1", "--cells", "alpha")
    assert "read_roots=" in r.stdout and "READ-ONLY REVIEW REQUIRED" in r.stdout
    run(tmp_path, "claim", "w1", "alpha")
    receipt = write_receipt(tmp_path, "read.txt", "read %s/spec.md" % read_dir)
    r = run(tmp_path, "done", "w1", "alpha", "--receipt", receipt)
    assert r.returncode == 0, r.stderr
    assert "receipt clean" in r.stdout and "1 read-only mention" in r.stdout
    assert read_cell(tmp_path, "w1", "alpha")["read_mentions"]


def test_read_root_overlap_rejected(tmp_path):
    cell = cell_manifest("alpha")
    cell["read_roots"] = [FIXTURES]
    man = make_manifest(tmp_path, [cell])
    r = run(tmp_path, "plan", man)
    assert r.returncode != 0
    assert "read_root" in r.stderr and "overlaps allowed_roots" in r.stderr


def test_role_newer_than_session_requires_restart(tmp_path):
    roles = tmp_path / "roles"
    roles.mkdir()
    (roles / "new.md").write_text("new role")
    cell = cell_manifest("alpha")
    cell["role"] = "new"
    man = make_manifest(tmp_path, [cell])
    r = run(tmp_path, "plan", man, "--role-dir", str(roles),
            "--session-start", "2000-01-01T00:00:00Z")
    assert r.returncode != 0
    assert "RESTART-REQUIRED" in r.stderr
    assert "session_start=2000-01-01T00:00:00Z" in r.stderr


def test_role_snapshot_accepts_old_role(tmp_path):
    roles = tmp_path / "roles"
    roles.mkdir()
    role = roles / "old.md"
    role.write_text("old role")
    os.utime(role, (1000, 1000))
    cell = cell_manifest("alpha")
    cell["role"] = "old"
    man = make_manifest(tmp_path, [cell])
    r = run(tmp_path, "plan", man, "--role-dir", str(roles),
            "--session-start", "2026-11-04T00:00:00Z")
    assert r.returncode == 0, r.stderr
    pack = read_cell(tmp_path, "w1", "alpha")
    assert pack["role"] == "old" and pack["role_path"].endswith("old.md")


def test_role_without_snapshot_flags_rejected(tmp_path):
    cell = cell_manifest("alpha")
    cell["role"] = "any"
    man = make_manifest(tmp_path, [cell])
    r = run(tmp_path, "plan", man)
    assert r.returncode != 0
    assert "--role-dir and --session-start" in r.stderr
