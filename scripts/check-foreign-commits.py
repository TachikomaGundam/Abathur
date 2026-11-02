#!/usr/bin/env python3
"""Foreign-commit detector (INCIDENT-20261103, L-LINE-BINDING enforcement).

Question it answers: "did anything other than a registered identity land a commit
on this lineage?"

Rule (closed):
  * Every commit in `origin/main..HEAD` must carry an identity registered in
    <git-common-dir>/allowed-identities (pair form `Name <email>` matches BOTH;
    legacy bare-email lines match email only).
  * Commits listed in the acknowledgement ledger
    docs/evidence-manifests/ACKNOWLEDGED-FOREIGN-COMMITS.txt (one full sha per
    line, `#` comments allowed) are reported as PENDING-ADJUDICATION, not as failures —
but not as amnesty either: the ledger's write rule forbids seat self-appends.
    The ledger is append-only evidence: adding a line to silence a NEW commit is
    exactly the act this gate exists to make visible.

Known limitation (stated, not hidden): a foreign author who writes with a
registered identity (e.g. the owner's global git config) is INDISTINGUISHABLE
from that person. This gate catches name/email spoofing and unregistered seats;
it does NOT prove who typed a command. See INCIDENT-20261103 §5.

Exit: 0 clean (or only acknowledged debt), 1 new foreign commits, 2 cannot answer.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ACK = REPO / "docs/evidence-manifests/ACKNOWLEDGED-FOREIGN-COMMITS.txt"


def git(*args: str) -> str:
    p = subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True)
    if p.returncode != 0:
        raise SystemExit(f"cannot answer: git {' '.join(args)} failed: {p.stderr.strip()}")
    return p.stdout


def allowlist() -> list[tuple[str | None, str]]:
    common = git("rev-parse", "--git-common-dir").strip()
    path = (REPO / common / "allowed-identities").resolve()
    if not path.exists():
        raise SystemExit(f"cannot answer: allowlist absent at {path}")
    entries: list[tuple[str | None, str]] = []
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "<" in line and line.endswith(">"):
            name, _, rest = line.partition("<")
            entries.append((name.strip(), rest[:-1].strip()))
        else:
            entries.append((None, line))
    return entries


def acknowledged() -> set[str]:
    if not ACK.exists():
        return set()
    out = set()
    for raw in ACK.read_text().splitlines():
        line = raw.split("#", 1)[0].strip()
        if line:
            out.add(line[:40])
    return out


def main() -> int:
    entries = allowlist()
    ack = acknowledged()
    try:
        rng = git("rev-list", "origin/main..HEAD").split()
    except SystemExit:
        rng = git("rev-list", "HEAD").split()

    new_foreign: list[tuple[str, str, str, str]] = []
    debt: list[tuple[str, str, str, str]] = []
    for sha in rng:
        name = git("show", "-s", "--format=%an", sha).strip()
        email = git("show", "-s", "--format=%ae", sha).strip()
        subject = git("show", "-s", "--format=%s", sha).strip()[:70]
        ok = any(
            (n is None and email == e) or (n is not None and name == n and email == e)
            for n, e in entries
        )
        if ok:
            continue
        (debt if sha[:40] in ack else new_foreign).append((sha, name, email, subject))

    print(
        f"range_commits={len(rng)} pending_adjudication={len(debt)} "
        f"new_foreign={len(new_foreign)}"
    )
    for sha, name, email, subject in debt:
        print(f"  PENDING-ADJUDICATION {sha[:9]} {name} <{email}> {subject}")
    for sha, name, email, subject in new_foreign:
        print(f"  FOREIGN    {sha[:9]} {name} <{email}> {subject}")
    if new_foreign:
        print("VERDICT=FOREIGN-COMMITS FAIL — unregistered identity on this lineage")
        return 1
    if debt:
        print(
            "VERDICT=FOREIGN-COMMITS OK (with PENDING-ADJUDICATION items — "
            "not amnesty; see ACKNOWLEDGED-FOREIGN-COMMITS.txt write rule)"
        )
        return 0
    print("VERDICT=FOREIGN-COMMITS OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
