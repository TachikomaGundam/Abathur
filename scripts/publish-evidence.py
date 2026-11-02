#!/usr/bin/env python3
"""publish-evidence.py — mirror a generation's durable evidence into the git tree.

Why this exists: `.omo/` is gitignored, so evidence kept only there dies with the
machine and cannot be reviewed from a clone. The owner's objection (2026-11-01) was
exactly that: "为什么证据在.omo里，这合理吗？难道要我定期找一堆文件夹备份？"

The answer implemented here: durable evidence lives under `evidence/<GEN>/`, which IS
tracked by git, so a clone carries it and a backup of the repo is a backup of the
evidence. `.omo/` keeps the working copies; this script is the bridge.

Usage:
    python3 scripts/publish-evidence.py <GEN> [--dry-run]

It copies a fixed whitelist (bundle, per-item verdicts/transcripts/receipts,
nomination record, approval stamp if any), refuses when the source is missing a
required file, and writes `evidence/<GEN>/SHA256SUMS` over what it copied.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ARCHIVE = REPO / ".omo" / "evidence" / "loop-archive"
NOMINATION_HISTORY = REPO / ".omo" / "evidence" / "nomination-history"
OUT = REPO / "evidence"

REQUIRED_GEN = ["bundle.json", "BUNDLE.md"]
OPTIONAL_GEN = ["NOMINATION.md", "APPROVAL.md", "ARCHIVE-MANIFEST.json", "memory.txt"]
ITEM_FILES = [
    "verdict.json",
    "transcript.json",
    "candidate_state.json",
    "disk_probe.json",
    "manifest.json",
    "judge-work/verdict.json",
    "judge-work/session.txt",
]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# Filename whitelist. A manifest publishes NAMES as well as hashes; a name that
# embeds an address, an identity or a credential shape is itself an exposure that
# no content rule would catch (the file body may be clean). Fail-closed: anything
# not matching is refused rather than sanitised, because renaming would break the
# hash-to-name binding the manifest exists to provide.
SEGMENT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
FORBIDDEN_IN_NAME = re.compile(r"(?:@|\d+\.\d+\.\d+\.\d+|:\/\/|[A-Za-z]:\\\\)")


def check_name(rel: str) -> None:
    parts = rel.split("/")
    if len(parts) > 3:
        raise SystemExit(f"REFUSED: manifest name too deep: {rel!r}")
    for seg in parts:
        if not SEGMENT_RE.match(seg) or FORBIDDEN_IN_NAME.search(seg):
            raise SystemExit(f"REFUSED: manifest name not publishable: {rel!r}")


def git_blob(path: Path) -> str:
    out = subprocess.run(["git", "-C", str(REPO), "hash-object", str(path)],
                         capture_output=True, text=True, check=True).stdout.strip()
    return out


def git_head() -> str:
    out = subprocess.run(["git", "-C", str(REPO), "rev-parse", "HEAD"],
                         capture_output=True, text=True, check=True).stdout.strip()
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("gen")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    src = ARCHIVE / args.gen
    if not src.is_dir():
        print(f"REFUSED: no archive at {src}")
        return 2
    missing = [name for name in REQUIRED_GEN if not (src / name).is_file()]
    if missing:
        print(f"REFUSED: archive missing required files: {missing}")
        return 2

    dst = OUT / args.gen
    copied: list[tuple[str, str]] = []

    def take(rel: str, source: Path) -> None:
        target = dst / rel
        if not args.dry_run:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        copied.append((rel, sha256(source)))

    for name in REQUIRED_GEN + OPTIONAL_GEN:
        f = src / name
        if f.is_file():
            take(name, f)

    bundle = json.loads((src / "bundle.json").read_text(encoding="utf-8"))
    for row in bundle.get("items", []):
        item = row.get("item")
        if not item:
            continue
        for rel in ITEM_FILES:
            f = src / item / rel
            if f.is_file():
                take(f"{item}/{rel}", f)
        for zt in ("zerotrust",):
            d = src / item / zt
            if d.is_dir():
                for f in sorted(d.iterdir()):
                    if f.is_file():
                        take(f"{item}/{zt}/{f.name}", f)
    for zt in ("zerotrust",):
        d = src / zt
        if d.is_dir():
            for f in sorted(d.iterdir()):
                if f.is_file():
                    take(f"{zt}/{f.name}", f)

    nom = NOMINATION_HISTORY / args.gen
    if nom.is_dir():
        for f in sorted(nom.iterdir()):
            if f.is_file() and f.suffix in {".json", ".txt", ".md"}:
                take(f"_nomination/{f.name}", f)

    sums = "".join(f"{digest}  {rel}\n" for rel, digest in sorted(copied))
    for rel, _digest in copied:
        check_name(rel)
    manifest = {
        "gen": args.gen,
        "commit": git_head(),
        "files": [
            {"path": rel, "sha256": digest,
             "git_blob": "(dry-run)" if args.dry_run else git_blob(dst / rel)}
            for rel, digest in sorted(copied)
        ],
    }
    if not args.dry_run:
        (dst / "SHA256SUMS").write_text(sums, encoding="utf-8")
        (dst / "MANIFEST.json").write_text(
            json.dumps(manifest, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"PUBLISH-EVIDENCE {args.gen} files={len(copied)} -> {dst}")
    print(f"sums_sha256={hashlib.sha256(sums.encode()).hexdigest()}")
    for rel, digest in sorted(copied)[:6]:
        print(f"  {digest[:16]}  {rel}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
