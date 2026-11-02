#!/usr/bin/env python3
"""Contract tests for loop/clean_run.py reclaim mode (2026-11-02 hygiene fix).

Runs the real script with ABATHUR_RUN_ROOT / ABATHUR_ARCHIVE_ROOT pointed at a
throwaway fixture, so nothing near real evidence is touched.
"""
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "clean_run.py"
PASS = FAIL = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name} {detail}")


def run(root: Path, archive: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        env={"ABATHUR_RUN_ROOT": str(root), "ABATHUR_ARCHIVE_ROOT": str(archive)},
        capture_output=True, text=True)


def make_run(root: Path, gen: str) -> Path:
    rd = root / f"abathur-loop-{gen}"
    (rd / "SR4-01" / "harness").mkdir(parents=True)
    (rd / "bundle.json").write_text("bundle")
    (rd / "SR4-01" / "harness" / "verdict.json").write_text("v")
    return rd


def make_archive(archive: Path, gen: str, corrupt: bool = False, empty: bool = False) -> Path:
    ad = archive / gen
    (ad / "SR4-01").mkdir(parents=True)
    (ad / "bundle.json").write_text("bundle")
    (ad / "SR4-01" / "verdict.json").write_text("v")
    files = {
        "bundle.json": hashlib.sha256(b"bundle").hexdigest(),
        "SR4-01/verdict.json": hashlib.sha256(b"v").hexdigest(),
    }
    if corrupt:
        files["bundle.json"] = "0" * 64
    if empty:
        files = {}
    (ad / "ARCHIVE-MANIFEST.json").write_text(json.dumps({"gen": gen, "files": files}))
    return ad


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="clean-run-test."))
    try:
        root, arch = tmp / "run", tmp / "arch"

        # 1 verified manifest -> run dir removed
        rd = make_run(root, "G9001")
        make_archive(arch, "G9001")
        p = run(root, arch, "reclaim", "G9001")
        check("verified manifest reclaims", p.returncode == 0 and not rd.exists(), p.stderr)

        # 2 no manifest -> refuse, run dir kept
        rd = make_run(root, "G9002")
        p = run(root, arch, "reclaim", "G9002")
        check("missing manifest refused", p.returncode == 2 and rd.exists(), p.stdout)

        # 3 hash mismatch -> refuse, run dir kept
        rd = make_run(root, "G9003")
        make_archive(arch, "G9003", corrupt=True)
        p = run(root, arch, "reclaim", "G9003")
        check("hash mismatch refused", p.returncode == 2 and rd.exists(), p.stdout)

        # 4 empty file list -> refuse
        rd = make_run(root, "G9004")
        make_archive(arch, "G9004", empty=True)
        p = run(root, arch, "reclaim", "G9004")
        check("empty file list refused", p.returncode == 2 and rd.exists(), p.stdout)

        # 5 absent run dir -> no-op success
        p = run(root, arch, "reclaim", "G9005")
        check("absent run dir is a no-op", p.returncode == 0, p.stderr)

        # 6 legacy mode unchanged: judged runs still never removed
        rd = make_run(root, "G9006")
        p = run(root, arch, "G9006", "SR4-01")
        check("legacy judged-run refusal intact", p.returncode == 2 and rd.exists(), p.stdout)

        # 7 bad token refused
        p = run(root, arch, "reclaim", "g61; rm -rf /")
        check("bad gen token refused", p.returncode == 2, p.stdout)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"# pass {PASS} / fail {FAIL}")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
