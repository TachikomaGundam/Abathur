#!/usr/bin/env python3
"""sweep.py — disposal tool for the self-evolution loop (policy: loop/HYGIENE.md).

usage:
  sweep.py status                              report sizes/counts by class
  sweep.py archive <gen>                       copy class-A evidence of /tmp/abathur-loop-<gen> to durable store + sha256 manifest
  sweep.py purge-loop <gen> [--apply]          delete the run dir ONLY if archived+verified and bundle closed
  sweep.py clean-cli [--older-than H] [--apply] delete concluded CLI temp dirs (whitelist, default 24h)

Default is dry-run. Every real deletion is appended to sweep-log.jsonl in the archive store.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import sys
import time
from pathlib import Path

TMP = Path("/tmp")
REPO = Path(__file__).resolve().parent.parent
ARCHIVE = REPO / ".omo" / "evidence" / "loop-archive"
SWEEP_LOG = ARCHIVE / "sweep-log.jsonl"

# class C: CLI temp prefixes concluded with their operation (ledgers live elsewhere). NEVER add abathur-loop / abathur-sync.
CLI_PREFIXES = ("abathur-promote-", "abathur-bundle-", "abathur-graft-", "abathur-selfmut-",
                "abathur-self-", "abathur-runloop-", "abathur-brief-", "abathur-qa-",
                "abathur-task13-evidence-")
MIN_AGE_S = 3600  # hard floor: never delete anything younger than 1h, whatever the flag says

EVIDENCE_FILES = ("bundle.json", "BUNDLE.md")
ITEM_EVIDENCE = ("manifest.json", "verdict.json", "transcript.json", "memory.txt",
                 "disk_probe.json", "hgf_prescan.json")


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def log(row: dict) -> None:
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    row = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), **row}
    with open(SWEEP_LOG, "a") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def du(p: Path) -> int:
    total = 0
    for f in p.rglob("*"):
        try:
            if f.is_file() and not f.is_symlink():
                total += f.stat().st_size
        except OSError:
            pass
    return total


def loop_dir(gen: str) -> Path:
    return TMP / f"abathur-loop-{gen}"


def cmd_status() -> None:
    groups: dict[str, list[Path]] = {}
    for d in TMP.glob("abathur-*"):
        if not d.is_dir() or d.is_symlink():
            continue
        key = next((p.rstrip("-") for p in CLI_PREFIXES if d.name.startswith(p)), None)
        if d.name.startswith("abathur-loop-"):
            key = "LOOP-RUN (class A/B — archive-then-purge only)"
        elif d.name.startswith("abathur-sync-"):
            key = "PROTECTED (release staging)"
        elif key:
            key = f"CLI-TEMP {key}-*"
        else:
            key = f"UNKNOWN ({d.name.split('-')[1] if '-' in d.name else d.name}) — never auto-deleted"
        groups.setdefault(key, []).append(d)
    for key in sorted(groups):
        ds = groups[key]
        print(f"{key:55s} n={len(ds):5d} size={sum(du(d) for d in ds) / 1e6:9.1f} MB")
    print(f"\ndurable archive store: {ARCHIVE}" + ("" if ARCHIVE.exists() else "  (not yet created)"))


def cmd_archive(gen: str) -> None:
    src = loop_dir(gen)
    if not src.is_dir():
        sys.exit(f"no such run dir: {src}")
    if not (src / "bundle.json").exists():
        sys.exit(f"REFUSAL: {src} has no bundle.json — generation not closed; archive only closed generations")
    dst = ARCHIVE / gen
    dst.mkdir(parents=True, exist_ok=True)
    copied: dict[str, str] = {}
    # gen-level evidence
    for name in EVIDENCE_FILES:
        p = src / name
        if p.exists():
            shutil.copy2(p, dst / name)
            copied[name] = sha256_file(p)
    # per-item evidence (harness/* + candidate files the probe flagged as changed/new)
    for item_dir in sorted(d for d in src.iterdir() if d.is_dir()):
        hd = item_dir / "harness"
        if not hd.is_dir():
            continue
        out = dst / item_dir.name
        out.mkdir(exist_ok=True)
        for name in ITEM_EVIDENCE:
            p = hd / name
            if p.exists():
                shutil.copy2(p, out / name)
                copied[f"{item_dir.name}/{name}"] = sha256_file(p)
        # candidate-side artifacts cited by evidence: files the disk probe calls CHANGED/new
        probe_p = hd / "disk_probe.json"
        if probe_p.exists():
            probe = json.loads(probe_p.read_text())
            sf = probe.get("seeded_files", {})
            sf_items = sf.items() if isinstance(sf, dict) else ((e["path"], e) for e in sf)
            changed = [rel for rel, e in sf_items if e.get("status") in ("CHANGED", "RETARGETED")]
            changed += probe.get("new_files", [])
            cdir = item_dir / "candidate"
            for rel in changed:
                p = cdir / rel
                if p.is_file():
                    q = out / "candidate-artifacts" / rel
                    q.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(p, q)
                    copied[f"{item_dir.name}/candidate-artifacts/{rel}"] = sha256_file(p)
    (dst / "ARCHIVE-MANIFEST.json").write_text(json.dumps(
        {"gen": gen, "source": str(src), "archived_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
         "files": copied}, indent=2, ensure_ascii=False))
    log({"op": "archive", "gen": gen, "files": len(copied), "dst": str(dst)})
    print(f"archived {len(copied)} evidence files -> {dst}")


def archive_verified(gen: str) -> bool:
    dst = ARCHIVE / gen / "ARCHIVE-MANIFEST.json"
    if not dst.exists():
        return False
    man = json.loads(dst.read_text())
    base = ARCHIVE / gen
    return all((base / rel).exists() and sha256_file(base / rel) == h for rel, h in man["files"].items())


def cmd_purge_loop(gen: str, apply: bool) -> None:
    src = loop_dir(gen)
    if not src.is_dir():
        sys.exit(f"no such run dir: {src}")
    bj = src / "bundle.json"
    if not bj.exists():
        sys.exit("REFUSAL: no bundle.json — not a closed generation")
    if not archive_verified(gen):
        sys.exit(f"REFUSAL: evidence archive missing/unverified for {gen} — run: sweep.py archive {gen}")
    size = du(src)
    if not apply:
        print(f"DRY-RUN: would delete {src} ({size / 1e6:.1f} MB) — evidence verified in {ARCHIVE / gen}")
        return
    shutil.rmtree(src)
    log({"op": "purge-loop", "gen": gen, "bytes": size, "src": str(src)})
    print(f"purged {src} ({size / 1e6:.1f} MB); evidence remains in {ARCHIVE / gen}")


def cmd_purge_manual(path: str, note: str | None, apply: bool) -> None:
    """fail-closed 手动清除唯一入口（E6 教训：inline rmtree 曾静默绕过归档守卫）。"""
    src = Path(path)
    if not str(src).startswith(str(TMP)):
        sys.exit(f"REFUSAL: purge-manual only covers {TMP} — outside paths need a human terminal")
    if not note:
        sys.exit("REFUSAL: --note required (why is this deletion legitimate without an archive?)")
    if not src.exists():
        sys.exit(f"nothing at {src}")
    size = du(src)
    if not apply:
        print(f"DRY-RUN would delete {src} ({size / 1e6:.1f} MB); note: {note}")
        return
    shutil.rmtree(src)
    log({"op": "purge-manual", "path": str(src), "bytes": size, "unarchived": True, "note": note})
    print(f"purged {src} ({size / 1e6:.1f} MB) UNARCHIVED — note logged: {note}")


def cmd_clean_cli(older_than_h: float, apply: bool) -> None:
    cutoff = time.time() - max(older_than_h * 3600, MIN_AGE_S)
    victims = []
    for d in TMP.iterdir():
        if not d.is_dir() or d.is_symlink():
            continue
        if not any(d.name.startswith(p) for p in CLI_PREFIXES):
            continue
        try:
            if d.stat().st_mtime > cutoff:
                continue
        except OSError:
            continue
        victims.append(d)
    total = sum(du(d) for d in victims)
    verb = "DELETE" if apply else "DRY-RUN would delete"
    print(f"{verb}: {len(victims)} dirs, {total / 1e6:.1f} MB (older than {older_than_h}h)")
    from collections import Counter
    for prefix, n in Counter(next(p for p in CLI_PREFIXES if d.name.startswith(p)) for d in victims).most_common():
        print(f"  {prefix}* x {n}")
    if apply:
        for d in victims:
            shutil.rmtree(d, ignore_errors=True)
        log({"op": "clean-cli", "dirs": len(victims), "bytes": total,
             "prefixes": sorted({d.name.split('-')[1] for d in victims})})
        print("done; logged to", SWEEP_LOG)


def main() -> None:
    argv = sys.argv[1:]
    apply = "--apply" in argv
    argv = [a for a in argv if a != "--apply"]
    if not argv or argv[0] == "status":
        cmd_status()
    elif argv[0] == "archive" and len(argv) == 2:
        cmd_archive(argv[1])
    elif argv[0] == "purge-loop" and len(argv) == 2:
        cmd_purge_loop(argv[1], apply)
    elif argv[0] == "purge-manual" and len(argv) >= 2:
        note = None
        if "--note" in argv:
            ni = argv.index("--note")
            note = argv[ni + 1] if ni + 1 < len(argv) else None
        cmd_purge_manual(argv[1], note, apply)
    elif argv[0] == "clean-cli":
        h = 24.0
        if "--older-than" in argv:
            i = argv.index("--older-than")
            h = float(argv[i + 1])
        cmd_clean_cli(h, apply)
    else:
        print(__doc__)
        sys.exit(2)


if __name__ == "__main__":
    main()
