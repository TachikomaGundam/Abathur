#!/usr/bin/env python3
"""Cross-line read-model orchestration for the wave engine.

Reads the VideoGen line's FIREABLE-v1 roster READ-ONLY and derives wave-engine
read-models: fire-cell manifests (plan-fires), owner-gate census (gates),
verification queue (verif-queue), and a cross-line safety self-test (selftest).

Stdlib only. No network. The only writes are the manifest under the wave
state dir (same base as wave.py: env ABATHUR_WAVES_DIR / --base). Line roots
come exclusively from line_roots.json (single source; no hardcodes).
No output ever claims a number it did not parse from the roster.
"""
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import wave as wave_mod  # noqa: E402  (reuse state-dir convention + plan validator; read-only import)

LINE_KEY = "otm_videogen"
ROSTER_REL = os.path.join("evolution", "production", "staging", "assembly", "FIREABLE-v1.md")
DEFAULT_LINE_ROOTS = wave_mod.DEFAULT_LINE_ROOTS
FILE_RE = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.\-]*\.(?:png|jpg|jpeg|webp|gif|bmp|mp4|mov|webm|wav|mp3|ass|srt)")
CELL_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._\-]*")
SEP_CELL_RE = re.compile(r":?-{2,}:?")

# Reason classes for the blocked census, checked in order (first match wins).
REASON_CLASSES = (
    ("面卡终批", "FACECARD_FINAL"),
    ("ENV-PLATE", "ENV_PLATE"),
    ("面闸", "FACE_GATE"),
    ("卡缺", "CARD_MISSING"),
    ("卡闸", "CARD_GATE"),
    ("PENDING-卡", "CARD_GATE"),
    ("案", "CASE"),
)


class RosterError(Exception):
    """Ambiguous/unparseable roster — caller exits 2, naming the offending line."""


def die_json(msg):
    print(json.dumps({"error": msg}, ensure_ascii=False))
    sys.exit(2)


def load_line_root(line_roots_path, key):
    cfg = wave_mod.load_line_roots(line_roots_path)
    roots = cfg.get("lines", {}).get(key)
    if not roots:
        die_json("line_roots.json has no roots for key %r (single source, refusing to guess)" % key)
    return os.path.normpath(roots[0]), cfg


def roster_path(video_gen_root):
    p = os.path.join(os.path.abspath(video_gen_root), ROSTER_REL)
    if not os.path.isfile(p):
        die_json("roster not found: %s" % p)
    return p


def read_roster_lines(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return fh.read().splitlines()
    except OSError as exc:
        die_json("roster unreadable: %s (%s)" % (path, exc))


def classify_section(header):
    if "FIREABLE-CANDIDATE" in header:
        return "candidate"
    if "火表" in header and "FIREABLE" in header:
        return "fireable"
    if "VERIF-PENDING" in header:
        return "verif"
    if "他闸/案" in header and "blocked" in header:
        return "blocked"
    return None


def parse_sections(lines):
    """Map section key -> list of (lineno, text) belonging to that section."""
    sections = {}
    cur = None
    for lno, line in enumerate(lines, 1):
        if line.startswith("##"):
            cur = classify_section(line)
            continue
        if line.startswith("# "):
            cur = None
            continue
        if cur is not None:
            sections.setdefault(cur, []).append((lno, line))
    return sections


def parse_table_rows(section_lines, what):
    """Return [(lineno, [cells,...])] for body rows after the |---| separator."""
    pipe_rows = [(lno, l) for lno, l in section_lines if l.strip().startswith("|")]
    if not pipe_rows:
        raise RosterError("%s section has no markdown table" % what)
    sep_idx = None
    for i, (lno, l) in enumerate(pipe_rows):
        inner = l.strip().strip("|")
        cells = [c.strip() for c in inner.split("|")]
        if cells and all(SEP_CELL_RE.fullmatch(c) for c in cells if c) and any(SEP_CELL_RE.fullmatch(c) for c in cells):
            sep_idx = i
            break
    if sep_idx is None:
        raise RosterError("%s table has no |---| separator row (unparseable)" % what)
    rows = []
    for lno, l in pipe_rows[sep_idx + 1:]:
        s = l.strip()
        if not s.endswith("|"):
            raise RosterError("ambiguous table row (no closing pipe) at line %d: %s" % (lno, s))
        cells = [c.strip() for c in s[1:-1].split("|")]
        rows.append((lno, cells))
    return rows


def require_cell_id(lno, cells):
    if not cells or not cells[0]:
        raise RosterError("empty cell id at line %d: %s" % (lno, " | ".join(cells)))
    cid = cells[0]
    if not CELL_ID_RE.fullmatch(cid):
        raise RosterError("unparseable cell id %r at line %d" % (cid, lno))
    return cid


def extract_files(text):
    seen, out = set(), []
    for m in FILE_RE.findall(text):
        if m not in seen:
            seen.add(m)
            out.append(m)
    return out


def parse_fire_cells(sections, line_root):
    """FIREABLE + FIREABLE-CANDIDATE tables -> (cells, n_fireable);
    a row with no anchor file = exit 2 (never guess a missing anchor)."""
    cells, seen_ids = [], {}
    n_fireable = 0
    for key, what in (("fireable", "FIREABLE"), ("candidate", "FIREABLE-CANDIDATE")):
        if key not in sections:
            raise RosterError("roster missing %s (%s) section" % (what, key))
        rows = parse_table_rows(sections[key], what)
        if key == "fireable":
            n_fireable = len(rows)
        for lno, row in rows:
            cid = require_cell_id(lno, row)
            if cid in seen_ids:
                raise RosterError("duplicate cell %s (first seen line %d, again line %d)"
                                  % (cid, seen_ids[cid], lno))
            seen_ids[cid] = lno
            anchors = extract_files(" ".join(row[1:]))
            if not anchors:
                raise RosterError("cell %s at line %d names no anchor file — refusing to guess "
                                  "a missing anchor: %s" % (cid, lno, " | ".join(row)))
            cells.append({
                "cell_id": cid,
                "kind": "gen",
                "allowed_roots": [line_root],
                "anchors": anchors,
                "wave": 0,
            })
    return cells, n_fireable


def cmd_plan_fires(args):
    line_root, _ = load_line_root(args.line_roots, LINE_KEY)
    if not re.fullmatch(r"[A-Za-z0-9._-]+", args.wave_id):
        die_json("wave_id must be a safe directory name: %r" % args.wave_id)
    path = roster_path(args.video_gen_root)
    lines = read_roster_lines(path)
    cells, n_fireable = parse_fire_cells(parse_sections(lines), line_root)
    manifest = {
        "wave_id": args.wave_id,
        "source": path,
        "line": LINE_KEY,
        "line_root": line_root,
        "counts": {"fireable": n_fireable, "candidate": len(cells) - n_fireable,
                   "total": len(cells)},
        "cells": cells,
    }
    os.makedirs(args.base, exist_ok=True)
    mpath = os.path.join(args.base, args.wave_id + ".manifest.json")
    wave_mod.atomic_write(mpath, manifest)
    print(json.dumps(manifest, indent=2, ensure_ascii=False))


def cmd_gates(args):
    path = roster_path(args.video_gen_root)
    lines = read_roster_lines(path)
    sections = parse_sections(lines)
    if "blocked" not in sections:
        die_json("roster missing 他闸/案 blocked section: " + path)
    rows = parse_table_rows(sections["blocked"], "他闸/案 blocked")
    counts, order = {}, []
    for lno, row in rows:
        require_cell_id(lno, row)
        probe = " ".join(row[1:])
        cls = next((c for needle, c in REASON_CLASSES if needle in probe), None)
        if cls is None:
            raise RosterError("unclassifiable blocked row at line %d (ambiguous roster): %s"
                              % (lno, " | ".join(row)))
        if cls not in counts:
            counts[cls] = 0
            order.append(cls)
        counts[cls] += 1
    total = sum(counts.values())
    header_claim = None
    for lno, line in enumerate(lines, 1):
        m = re.search(r"他闸/案\s*=\s*(\d+)", line)
        if m:
            header_claim = int(m.group(1))
            header_line = lno
            break
    print("%-16s %s" % ("reason_class", "count"))
    for cls in order:
        print("%-16s %d" % (cls, counts[cls]))
    machine = "TOTAL_BLOCKED=%d %s" % (total, " ".join("%s=%d" % (c, counts[c]) for c in order))
    if header_claim is None:
        machine += " HEADER_BLOCKED=ABSENT CROSSCHECK=MISMATCH (no 他闸/案 = N claim found in header)"
    elif header_claim == total:
        machine += " HEADER_BLOCKED=%d CROSSCHECK=OK" % header_claim
    else:
        machine += (" HEADER_BLOCKED=%d CROSSCHECK=MISMATCH (header line %d claims %d, "
                    "table parses %d — neither trusted, owner must reconcile)"
                    % (header_claim, header_line, header_claim, total))
    print(machine)


def build_file_index(root):
    idx = {}
    for dirpath, dirnames, filenames in os.walk(root):
        if ".git" in dirnames:
            dirnames.remove(".git")
        for f in filenames:
            idx.setdefault(f, os.path.join(dirpath, f))
    return idx


def cmd_verif_queue(args):
    root = os.path.abspath(args.video_gen_root)
    path = roster_path(root)
    lines = read_roster_lines(path)
    sections = parse_sections(lines)
    if "verif" not in sections:
        die_json("roster missing 候验 VERIF-PENDING section: " + path)
    rows = parse_table_rows(sections["verif"], "候验 VERIF-PENDING")
    entries = []
    for lno, row in rows:
        cid = require_cell_id(lno, row)
        files = extract_files(" ".join(row[1:]))
        if not files:
            raise RosterError("VERIF-PENDING cell %s at line %d names no artifact file — "
                              "nothing to verify: %s" % (cid, lno, " | ".join(row)))
        entries.append((cid, files))
    idx = build_file_index(root)
    n_found = n_missing = 0
    for cid, files in entries:
        print("cell %s" % cid)
        for f in files:
            hit = idx.get(f)
            if hit:
                n_found += 1
                print("  FOUND   %s -> %s" % (f, hit))
            else:
                n_missing += 1
                print("  MISSING %s" % f)
    print("VERIF_CELLS=%d FILES_TOTAL=%d FOUND=%d MISSING=%d"
          % (len(entries), n_found + n_missing, n_found, n_missing))


def cmd_selftest(args):
    line_root, line_cfg = load_line_root(args.line_roots, LINE_KEY)
    path = roster_path(line_root)  # VideoGen root resolved via line_roots.json, never hardcoded
    cells, n_fireable = parse_fire_cells(parse_sections(read_roster_lines(path)), line_root)
    checks, passes = 0, 0

    def check(ok, label, detail=""):
        nonlocal checks, passes
        checks += 1
        if ok:
            passes += 1
            print("  ok   %s%s" % (label, (" (%s)" % detail) if detail else ""))
        else:
            print("  FAIL %s%s" % (label, (" (%s)" % detail) if detail else ""))

    bad = [c["cell_id"] for c in cells if c["allowed_roots"] != [line_root]]
    check(not bad, "every parsed fire cell pins allowed_roots to the %s root" % LINE_KEY,
          "%d cells, root=%s" % (len(cells), line_root) if not bad else "offenders: %s" % bad)

    aihr_root = line_cfg["lines"]["aihr"][0]
    evil = {"cell_id": "EVIL-CROSSLNE", "kind": "gen", "allowed_roots": [aihr_root],
            "cwd": HERE, "brief_path": args.line_roots}
    errors = wave_mod.validate_manifest({"cells": [evil]}, line_cfg)
    rejected = any("cross-line pollution" in e and "aihr" in e for e in errors)
    check(rejected, "wave.py plan validator REJECTS cross-line cell (root=%s)" % aihr_root,
          "errors=%d" % len(errors))

    good = {"cell_id": "OK-INLINE", "kind": "gen",
            "allowed_roots": [line_cfg["lines"][line_cfg["self"]][0]],
            "cwd": HERE, "brief_path": args.line_roots}
    errors = wave_mod.validate_manifest({"cells": [good]}, line_cfg)
    check(not errors, "validator still accepts an in-line cell (reject-everything guard)",
          "errors=%d" % len(errors))

    if passes == checks:
        print("SELFTEST PASS %d/%d checks, %d roster cells parsed (%d FIREABLE + %d CANDIDATE)"
              % (passes, checks, len(cells), n_fireable, len(cells) - n_fireable))
    else:
        print("SELFTEST FAIL %d/%d checks passed, %d roster cells parsed" % (passes, checks, len(cells)))
        sys.exit(1)


def build_parser():
    ap = argparse.ArgumentParser(prog="orchestrate.py", description=__doc__)
    ap.add_argument("--base", default=wave_mod.DEFAULT_BASE,
                    help="wave state dir (same convention as wave.py; env ABATHUR_WAVES_DIR)")
    ap.add_argument("--line-roots", default=DEFAULT_LINE_ROOTS)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("plan-fires", help="parse FIREABLE+CANDIDATE tables -> fire-cell manifest")
    p.add_argument("--video-gen-root", required=True)
    p.add_argument("--wave-id", required=True)
    p.set_defaults(func=cmd_plan_fires)

    p = sub.add_parser("gates", help="owner-gate census of the blocked table + header cross-check")
    p.add_argument("--video-gen-root", required=True)
    p.set_defaults(func=cmd_gates)

    p = sub.add_parser("verif-queue", help="VERIF-PENDING cells: FOUND/MISSING per named artifact")
    p.add_argument("--video-gen-root", required=True)
    p.set_defaults(func=cmd_verif_queue)

    p = sub.add_parser("selftest", help="cross-line safety self-test (uses line_roots.json only)")
    p.set_defaults(func=cmd_selftest)
    return ap


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        args.func(args)
    except RosterError as exc:
        die_json(str(exc))


if __name__ == "__main__":
    main()
