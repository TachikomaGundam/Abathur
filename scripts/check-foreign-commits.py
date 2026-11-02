#!/usr/bin/env python3
"""Foreign-commit detector (INCIDENT-20261103, L-LINE-BINDING enforcement).

Question it answers: "did anything other than a registered identity land a commit
anywhere in this repository's refs?"

Rule (closed):
  * Every commit reachable from HEAD must carry an identity registered in
    <git-common-dir>/allowed-identities (pair form `Name <email>` matches BOTH;
    legacy bare-email lines match email only).
  * Commits reachable from OTHER refs but not from HEAD are scanned separately
    ("other-ref"). This exists because a range-limited scan (`origin/main..HEAD`)
    once hid four same-identity commits that lived only on a pre-rewrite backup
    ref — the gate reported `new_foreign=0` while unadjudicated foreign commits
    were still on disk (found by sibyl-20261102T202251Z-7938).
  * Commits listed in the acknowledgement ledger
    (docs/evidence-manifests/ACKNOWLEDGED-FOREIGN-COMMITS.txt, one full sha per
    line, `#` comments allowed) are reported as PENDING-ADJUDICATION, not as
    failures — but not as amnesty either: the ledger's write rule forbids seat
    self-appends.

Known limitation (stated, not hidden): a foreign author who writes with a
registered identity (e.g. the owner's global git config) is INDISTINGUISHABLE
from that person. This gate catches name/email spoofing and unregistered seats;
it does NOT prove who typed a command. See INCIDENT-20261103 §5.

Exit: 0 clean or only recorded PENDING-ADJUDICATION items, 1 new foreign commit,
      2 cannot answer.

Usage: check-foreign-commits.py [--ack PATH]
  --ack PATH  use an alternate ledger (probe runs; never pollute the real one).
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ACK = REPO / "docs/evidence-manifests/ACKNOWLEDGED-FOREIGN-COMMITS.txt"
QUARANTINE = REPO / "docs/evidence-manifests/QUARANTINED-REFS.txt"
SEP = "\x1f"


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


def acknowledged(ack_path: Path) -> set[str]:
    if not ack_path.exists():
        return set()
    out = set()
    for raw in ack_path.read_text().splitlines():
        line = raw.split("#", 1)[0].strip()
        if line:
            out.add(line[:40])
    return out


def commits(rev_args: list[str]) -> list[tuple[str, str, str, str]]:
    out = git("log", f"--format=%H{SEP}%an{SEP}%ae{SEP}%s", *rev_args)
    rows = []
    for line in out.splitlines():
        parts = line.split(SEP)
        if len(parts) == 4:
            sha, name, email, subject = parts
            rows.append((sha, name, email, subject[:70]))
    return rows


def quarantined_refs(path: Path) -> list[str]:
    """Declared historical refs (e.g. filter-repo backups). Not an amnesty:
    commits reachable from HEAD are still scanned by the HEAD pass."""
    if not path.exists():
        return []
    pats = []
    for raw in path.read_text().splitlines():
        line = raw.split("#", 1)[0].strip()
        if line:
            pats.append(line)
    return pats


def refs_containing(sha: str) -> str:
    out = git("for-each-ref", "--contains", sha, "--format=%(refname:short)")
    names = [n for n in out.split() if n]
    return ",".join(names[:3]) if names else "?"


def is_registered(name: str, email: str, entries: list[tuple[str | None, str]]) -> bool:
    return any(
        (n is None and email == e) or (n is not None and name == n and email == e)
        for n, e in entries
    )


def main(argv: list[str]) -> int:
    ack_path = ACK
    if "--ack" in argv:
        i = argv.index("--ack")
        if i + 1 >= len(argv):
            print("usage: --ack PATH", file=sys.stderr)
            return 2
        ack_path = Path(argv[i + 1])

    entries = allowlist()
    ack = acknowledged(ack_path)

    head_rows = commits(["HEAD"])
    other_rows = commits(["--all", "--not", "HEAD"])

    qpats = quarantined_refs(QUARANTINE)
    q_shas: set[str] = set()
    for pat in qpats:
        try:
            q_shas.update(git("rev-list", pat).split())
        except SystemExit:
            continue

    new_foreign: list[tuple[str, str, str, str]] = []
    debt: list[tuple[str, str, str, str]] = []
    other_foreign: list[tuple[str, str, str, str]] = []
    quarantined: list[tuple[str, str, str, str]] = []
    for sha, name, email, subject in head_rows:
        if is_registered(name, email, entries):
            continue
        (debt if sha[:40] in ack else new_foreign).append((sha, name, email, subject))
    for sha, name, email, subject in other_rows:
        if is_registered(name, email, entries):
            continue
        if sha[:40] in ack:
            continue
        (quarantined if sha in q_shas else other_foreign).append((sha, name, email, subject))

    print(
        f"head_commits={len(head_rows)} other_ref_commits={len(other_rows)} "
        f"pending_adjudication={len(debt)} new_foreign={len(new_foreign)} "
        f"other_ref_foreign={len(other_foreign)} quarantined_ref_commits={len(quarantined)}"
    )
    for sha, name, email, subject in debt:
        print(f"  PENDING-ADJUDICATION {sha[:9]} {name} <{email}> {subject}")
    for sha, name, email, subject in new_foreign:
        print(f"  FOREIGN    {sha[:9]} {name} <{email}> {subject}")
    for sha, name, email, subject in other_foreign:
        print(f"  OTHER-REF-FOREIGN {sha[:9]} {name} <{email}> [{refs_containing(sha)}] {subject}")
    if quarantined:
        refs = ",".join(qpats)
        print(
            f"  QUARANTINED {len(quarantined)} commit(s) reachable only from declared "
            f"historical refs [{refs}] — see {QUARANTINE.name}; must never be pushed"
        )

    if new_foreign or other_foreign:
        print("VERDICT=FOREIGN-COMMITS FAIL — unregistered identity on this repository")
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
    sys.exit(main(sys.argv[1:]))
