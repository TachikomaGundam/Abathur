#!/usr/bin/env python3
"""Abathur-line wave engine.

OTM-independent supervisor fanout: replaces the team-engine maxParallel=4 cap
and sleep-holding seats. Plans a manifest into per-cell launchpacks, launches
ready cells concurrently, tracks the state machine new->launched->claimed->
done/failed, and detects receipt pollution (writes mentioned outside the
cell's allowed_roots).

Stdlib only. State lives under BASE (default ~/.local/state/abathur/waves).
"""
import argparse
import json
import os
import re
import shlex
import sys
import time
from datetime import datetime, timezone

DEFAULT_BASE = os.environ.get(
    "ABATHUR_WAVES_DIR",
    os.path.join(os.path.expanduser("~"), ".local", "state", "abathur", "waves"),
)
HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DEFAULT_LINE_ROOTS = (
    os.environ.get("ABATHUR_LINE_ROOTS")
    or os.path.join(HERE, "line_roots.local.json")
)
DEFAULT_CLOUDQ = os.environ.get("ABATHUR_CLOUDQ", "")
TARGET_CONCURRENCY = 64
KINDS = ("gen", "verify", "doc", "build")
INFLIGHT_WORDS = {"queued", "pending", "running", "launched", "dispatched",
                  "submitted", "in-flight", "inflight"}
STATE_ORDER = ["new", "launched", "claimed", "done", "failed"]


def now_pair():
    ts = time.time()
    iso = datetime.fromtimestamp(ts, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    return ts, iso


def die(msg, code=2):
    print("ERROR: " + msg, file=sys.stderr)
    sys.exit(code)


def wave_dir(base, wave_id):
    return os.path.join(base, wave_id)


def cell_path(base, wave_id, cell_id):
    return os.path.join(wave_dir(base, wave_id), cell_id + ".json")


def read_json(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def atomic_write(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def load_cell(base, wave_id, cell_id):
    p = cell_path(base, wave_id, cell_id)
    if not os.path.isfile(p):
        die("no such cell: %s/%s (%s)" % (wave_id, cell_id, p))
    return read_json(p)


def save_cell(base, wave_id, cell, obj):
    atomic_write(cell_path(base, wave_id, cell), obj)


def load_line_roots(path):
    """Load the single authority for line roots and protected surfaces.

    Object-per-line schema is required. The old array schema is rejected by
    name: silently guessing where a forbidden list lives would let a missing
    key pass as "nothing forbidden".
    """
    if not os.path.isfile(path):
        die("line_roots config not found: %s (copy line_roots.example.json to "
            "line_roots.local.json and edit; set ABATHUR_LINE_ROOTS to use another path)" % path)
    data = read_json(path)
    if "lines" not in data or "self" not in data:
        die("line_roots.json malformed (need self + lines): %s" % path)
    if data["self"] not in data["lines"]:
        die("line_roots.json: self line %r is not in lines" % data["self"])
    for line, cfg in data["lines"].items():
        if isinstance(cfg, list):
            die("line_roots.json: line %r uses the legacy array schema; migrate to "
                "{roots: [...], forbidden_surfaces: [...]}" % line)
        if not isinstance(cfg, dict):
            die("line_roots.json: line %r must be an object" % line)
        if not cfg.get("roots") or not isinstance(cfg["roots"], list):
            die("line_roots.json: line %r needs a non-empty roots list" % line)
        if "forbidden_surfaces" not in cfg or not isinstance(cfg["forbidden_surfaces"], list):
            die("line_roots.json: line %r is missing forbidden_surfaces (fail closed)" % line)
    return data


def forbidden_entries(line_cfg):
    """Yield (line, absolute forbidden path) for every declared surface.

    Relative entries resolve against that line's first root. Entries that
    vanish from the file cannot be detected here; plan pins the file sha256.
    """
    out = []
    for line, cfg in line_cfg["lines"].items():
        base = norm_abs(cfg["roots"][0])
        for raw in cfg["forbidden_surfaces"]:
            p = raw if os.path.isabs(raw) else os.path.join(base, raw)
            out.append((line, norm_abs(p)))
    return out


def forbidden_violations(paths, line_cfg):
    """Reject roots/cwd that are equal to or inside a protected surface."""
    out = []
    for raw in paths:
        p = norm_abs(raw)
        for line, surface in forbidden_entries(line_cfg):
            if p == surface or p.startswith(surface + os.sep):
                out.append((p, line, surface))
    return out


def broad_forbidden_overlaps(roots, line_cfg):
    """Report broad roots that contain protected surfaces.

    A repo-root allowed_root necessarily contains protected files. Plan cannot
    prove those files will not be written; it records the overlap and relies
    on receipt-path checks plus human review. It is not mount enforcement.
    """
    out = []
    for raw in roots:
        r = norm_abs(raw)
        for line, surface in forbidden_entries(line_cfg):
            if surface.startswith(r + os.sep) and not r.startswith(surface + os.sep):
                out.append((r, line, surface))
    return out


def line_roots_sha256(path):
    import hashlib
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def norm_abs(p):
    """Resolve a manifest path against REPO_ROOT, never the caller's cwd.

    realpath is deliberate: a symlinked cwd inside an allowed root would
    otherwise pass the lexical prefix check while writing elsewhere.
    """
    if not os.path.isabs(p):
        p = os.path.join(REPO_ROOT, p)
    return os.path.realpath(os.path.normpath(p))


def expect_root_violations(roots, cwd, expect_root):
    """Return roots (and cwd) that fall outside an explicit gate root."""
    out = []
    exp = norm_abs(expect_root)
    for raw in list(roots) + [cwd]:
        p = norm_abs(raw)
        if not (p == exp or p.startswith(exp + os.sep)):
            out.append(p)
    return out


def overlaps(a, b):
    return a == b or a.startswith(b + os.sep) or b.startswith(a + os.sep)


def cross_line_violations(allowed_roots, line_cfg):
    """Reject any allowed_root that overlaps a root of a line other than self."""
    out = []
    self_line = line_cfg["self"]
    for raw in allowed_roots:
        r = norm_abs(raw)
        for line, cfg in line_cfg["lines"].items():
            if line == self_line:
                continue
            for root in cfg["roots"]:
                R = norm_abs(root)
                if overlaps(r, R):
                    out.append((raw, line, root))
    return out


def topo_waves(cells, max_width):
    """Group cells into dependency waves; a wave's cells may all run concurrently."""
    by_id = {c["cell_id"]: c for c in cells}
    level = {}
    pending = dict(by_id)
    guard = 0
    while pending:
        guard += 1
        if guard > len(by_id) + 1:
            die("dependency cycle among cells: %s" % sorted(pending))
        for cid in sorted(pending):
            deps = by_id[cid].get("deps", [])
            if all(d in level for d in deps):
                level[cid] = 0 if not deps else 1 + max(level[d] for d in deps)
        for cid in list(level):
            pending.pop(cid, None)
    waves = []
    for lv in range(max(level.values()) + 1):
        members = sorted(cid for cid, l in level.items() if l == lv)
        for i in range(0, len(members), max_width):
            waves.append(members[i:i + max_width])
    return waves


def validate_manifest(man, line_cfg):
    errors = []
    seen = set()
    for cell in man.get("cells", []):
        cid = cell.get("cell_id", "<missing>")
        if not cell.get("cell_id"):
            errors.append("cell missing cell_id")
            continue
        if cid in seen:
            errors.append("duplicate cell_id: %s" % cid)
        seen.add(cid)
        if cell.get("kind") not in KINDS:
            errors.append("cell %s: kind must be one of %s, got %r" % (cid, KINDS, cell.get("kind")))
        if not cell.get("allowed_roots"):
            errors.append("cell %s: allowed_roots must be non-empty" % cid)
        else:
            roots = [norm_abs(r) for r in cell["allowed_roots"]]
            for raw, line, root in cross_line_violations(cell["allowed_roots"], line_cfg):
                errors.append("cell %s: cross-line pollution: allowed_root %r overlaps other line '%s' root %r"
                              % (cid, raw, line, root))
            for p, line, surface in forbidden_violations(cell["allowed_roots"], line_cfg):
                errors.append("cell %s: protected surface: allowed_root %r is inside %s surface %r"
                              % (cid, p, line, surface))
            read_roots = cell.get("read_roots", [])
            if not isinstance(read_roots, list):
                errors.append("cell %s: read_roots must be a list" % cid)
                read_roots = []
            for raw in read_roots:
                rp = norm_abs(raw)
                if not os.path.isdir(rp):
                    errors.append("cell %s: read_root is not a directory: %s" % (cid, rp))
                if under_any(rp, roots) or any(overlaps(rp, r) for r in roots):
                    errors.append("cell %s: read_root %r overlaps allowed_roots (read channel must be read-only)"
                                  % (cid, raw))
        cwd = cell.get("cwd")
        if not cwd:
            errors.append("cell %s: cwd is required (the directory commands run in)" % cid)
        else:
            cwd_abs = norm_abs(cwd)
            if not os.path.isdir(cwd_abs):
                errors.append("cell %s: cwd is not a directory: %s" % (cid, cwd_abs))
            roots = [norm_abs(r) for r in cell.get("allowed_roots", [])]
            if roots and not under_any(cwd_abs, roots):
                errors.append("cell %s: cwd %r is outside allowed_roots %s"
                              % (cid, cwd_abs, roots))
        if not cell.get("brief_path"):
            errors.append("cell %s: missing brief_path" % cid)
        elif not os.path.isfile(norm_abs(cell["brief_path"])):
            errors.append("cell %s: brief_path not found: %s" % (cid, cell["brief_path"]))
    for cell in man.get("cells", []):
        for d in cell.get("deps", []):
            if d not in seen:
                errors.append("cell %s: dep does not exist: %s" % (cell.get("cell_id"), d))
            if d == cell.get("cell_id"):
                errors.append("cell %s: self-dependency" % cell.get("cell_id"))
    return errors


def parse_iso(ts):
    s = ts.strip().replace("Z", "+00:00")
    return datetime.fromisoformat(s).timestamp()


def role_check(cell, role_dir, session_start, session_start_label):
    """Return (error, metadata) for a cell-declared role.

    Roles are frozen at session start. A role file created after that moment
    is not dispatchable in this session; the caller must restart. This is a
    plan-time check, not an opencode hot-reload hook.
    """
    role = cell.get("role")
    if not role:
        return None, None
    if re.search(r"[/\\]|\.\.", role):
        return "cell %s: unsafe role name %r" % (cell["cell_id"], role), None
    path = os.path.join(role_dir, role + ".md")
    if not os.path.isfile(path):
        return ("UNKNOWN-ROLE cell %s role=%s path=%s"
                % (cell["cell_id"], role, path)), None
    mtime = os.path.getmtime(path)
    meta = {
        "role": role,
        "role_path": norm_abs(path),
        "role_mtime": datetime.fromtimestamp(mtime, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "session_start": session_start_label,
    }
    if mtime > session_start:
        return ("RESTART-REQUIRED cell %s role=%s path=%s mtime=%s session_start=%s"
                % (cell["cell_id"], role, path, meta["role_mtime"], session_start_label)), meta
    return None, meta


def validate_roles(man, role_dir, session_start_raw):
    errors = []
    metas = {}
    roles = [c for c in man.get("cells", []) if c.get("role")]
    if not roles:
        return errors, metas
    if not role_dir or not session_start_raw:
        return (["cell %s: role declared; plan requires --role-dir and --session-start"
                 % c["cell_id"] for c in roles]), metas
    try:
        session_start = parse_iso(session_start_raw)
    except ValueError:
        return ["invalid --session-start (need ISO-8601): %r" % session_start_raw], metas
    if not os.path.isdir(norm_abs(role_dir)):
        return ["--role-dir is not a directory: %s" % role_dir], metas
    rd = norm_abs(role_dir)
    for cell in roles:
        err, meta = role_check(cell, rd, session_start, session_start_raw)
        if err:
            errors.append(err)
        if meta:
            metas[cell["cell_id"]] = meta
    return errors, metas


def cmd_plan(args):
    man = read_json(args.manifest)
    for key in ("wave_id", "cells"):
        if key not in man:
            die("manifest missing key: %s" % key)
    wid = man["wave_id"]
    if not re.fullmatch(r"[A-Za-z0-9._-]+", wid):
        die("wave_id must be a safe directory name: %r" % wid)
    line_cfg = load_line_roots(args.line_roots)
    errors = validate_manifest(man, line_cfg)
    role_errors, role_metas = validate_roles(man, args.role_dir, args.session_start)
    errors.extend(role_errors)
    broad_overlaps = []
    for cell in man.get("cells", []):
        for root, line, surface in broad_forbidden_overlaps(cell.get("allowed_roots", []), line_cfg):
            broad_overlaps.append((cell.get("cell_id"), root, line, surface))
    if args.expect_root:
        for cell in man.get("cells", []):
            if not cell.get("cwd"):
                continue
            bad = expect_root_violations(cell.get("allowed_roots", []), cell["cwd"], args.expect_root)
            for p in bad:
                errors.append("cell %s: path outside --expect-root %r: %s"
                              % (cell.get("cell_id"), norm_abs(args.expect_root), p))
    if errors:
        for e in errors:
            print("INVALID: " + e, file=sys.stderr)
        die("manifest validation failed (%d error(s)); nothing written" % len(errors))
    roots_sha = line_roots_sha256(args.line_roots)
    forbidden_snapshot = [{"line": line, "path": p} for line, p in forbidden_entries(line_cfg)]
    if broad_overlaps:
        print("WARNING: protected-surface overlap on a broad allowed_root "
              "(receipt checks + human review, not mount enforcement):")
        for cid, root, line, surface in broad_overlaps:
            print("  %s: %s contains %s surface %s" % (cid, root, line, surface))
    wdir = wave_dir(args.base, wid)
    existing = [c["cell_id"] for c in man["cells"] if os.path.isfile(cell_path(args.base, wid, c["cell_id"]))]
    if existing and not args.force:
        die("launchpacks already exist for cells %s; rerun with --force to overwrite" % existing)
    os.makedirs(wdir, exist_ok=True)
    ts, iso = now_pair()
    for cell in man["cells"]:
        pack = {
            "wave_id": wid,
            "cell_id": cell["cell_id"],
            "brief_path": norm_abs(cell["brief_path"]),
            "allowed_roots": [norm_abs(r) for r in cell["allowed_roots"]],
            "read_roots": [norm_abs(r) for r in cell.get("read_roots", [])],
            "cwd": norm_abs(cell["cwd"]),
            "kind": cell["kind"],
            "deps": list(cell.get("deps", [])),
            "state": "new",
            "created_at": iso,
            "created_epoch": ts,
            "line_roots_sha256": roots_sha,
            "line_roots_path": norm_abs(args.line_roots),
            "forbidden_surfaces": forbidden_snapshot,
            "notes": [],
        }
        if cell["cell_id"] in role_metas:
            pack.update(role_metas[cell["cell_id"]])
        atomic_write(cell_path(args.base, wid, cell["cell_id"]), pack)
    atomic_write(os.path.join(wdir, "meta.json"), {
        "wave_id": wid, "manifest": os.path.abspath(args.manifest),
        "created_at": iso, "cells": [c["cell_id"] for c in man["cells"]],
        "line_roots": norm_abs(args.line_roots),
        "line_roots_sha256": roots_sha,
        "forbidden_surfaces": forbidden_snapshot,
    })
    waves = topo_waves(man["cells"], args.max_width)
    print("planned wave %s: %d cells -> %s" % (wid, len(man["cells"]), wdir))
    print("supervisor fanout plan (max width per wave = %d):" % args.max_width)
    for i, w in enumerate(waves):
        print("  wave %d (width %d, fire concurrently): %s" % (i, len(w), ", ".join(w)))


def deps_satisfied(base, wid, cell):
    for d in cell.get("deps", []):
        try:
            dep = load_cell(base, wid, d)
        except SystemExit:
            return False, d
        if dep["state"] != "done":
            return False, d
    return True, None


def dispatch_line(base, wid, cell):
    cwd = shlex.quote(cell["cwd"])
    wave = shlex.quote(os.path.join(HERE, "wave.py"))
    read_roots = cell.get("read_roots", [])
    extras = ""
    if read_roots:
        extras += (' read_roots=%s; READ-ONLY REVIEW REQUIRED: never write under read_roots; '
                   'this is a declaration, not mount enforcement; human review required;' % read_roots)
    if cell.get("role"):
        extras += (' role=%s; roles are frozen at session start: if this role file postdates '
                   'session_start=%s stop with RESTART-REQUIRED;'
                   % (cell["role"], cell.get("session_start")))
    return ('task(category="general", prompt="Wave %s cell %s: read launchpack %s; brief %s; '
            'cwd=%s; allowed_roots=%s;%s every command starts with: cd %s && ... ; '
            'FIRST run: cd %s && python3 %s claim %s %s; '
            'on finish run: cd %s && python3 %s done %s %s --receipt <path>; '
            'on failure run: cd %s && python3 %s fail %s %s --note <why>")'
            % (wid, cell["cell_id"], cell_path(base, wid, cell["cell_id"]), cell["brief_path"],
               cell["cwd"], cell["allowed_roots"], extras, cwd,
               cwd, wave, wid, cell["cell_id"],
               cwd, wave, wid, cell["cell_id"],
               cwd, wave, wid, cell["cell_id"]))


def cmd_launch(args):
    wdir = wave_dir(args.base, args.wave_id)
    if not os.path.isdir(wdir):
        die("no such wave: %s (%s)" % (args.wave_id, wdir))
    meta = read_json(os.path.join(wdir, "meta.json"))
    cells = [load_cell(args.base, args.wave_id, cid) for cid in meta["cells"]]
    if args.cells.strip().lower() == "all":
        targets = [c for c in cells if c["state"] == "new" and deps_satisfied(args.base, args.wave_id, c)[0]]
        blocked = [c["cell_id"] for c in cells if c["state"] == "new" and c not in targets]
        if blocked:
            print("not ready (deps unmet), held back: %s" % ", ".join(blocked))
    else:
        want = [s.strip() for s in args.cells.split(",") if s.strip()]
        by_id = {c["cell_id"]: c for c in cells}
        targets = []
        for cid in want:
            if cid not in by_id:
                die("no such cell in wave: %s" % cid)
            c = by_id[cid]
            if c["state"] != "new":
                die("cell %s: state is %s, launch only applies to new" % (cid, c["state"]))
            ok, blocker = deps_satisfied(args.base, args.wave_id, c)
            if not ok:
                die("cell %s: dep not done: %s" % (cid, blocker))
            targets.append(c)
    if not targets:
        print("nothing to launch (no ready new cells)")
        return
    ts, iso = now_pair()
    for c in targets:
        c["state"] = "launched"
        c["launched_at"] = iso
        c["launched_epoch"] = ts
        save_cell(args.base, args.wave_id, c["cell_id"], c)
    print("launched %d cell(s) of wave %s at %s" % (len(targets), args.wave_id, iso))
    print("FIRE ALL %d DISPATCH LINES IN ONE MESSAGE (concurrent, no serial waiting):" % len(targets))
    for i, c in enumerate(targets, 1):
        print("%d. %s" % (i, dispatch_line(args.base, args.wave_id, c)))


def require_state(cell, allowed, action):
    if cell["state"] not in allowed:
        die("cell %s: cannot %s from state %s (need one of %s)"
            % (cell["cell_id"], action, cell["state"], allowed))


def require_cwd(cell):
    """Re-check at claim/done time: the cwd validated at plan may be swapped.

    Resolve only the cwd; allowed_roots were canonicalized at plan time and
    are compared as stored. Re-resolving a swapped root would bless the swap.
    """
    raw = cell.get("cwd")
    if not raw:
        die("cell %s: launchpack has no cwd (legacy wave); replan with cwd" % cell["cell_id"])
    cwd = os.path.realpath(raw)
    if not os.path.isdir(cwd):
        die("cell %s: cwd vanished or is not a directory: %s"
            % (cell["cell_id"], cwd))
    if not under_any(cwd, cell.get("allowed_roots", [])):
        die("cell %s: cwd %r is outside allowed_roots %s"
            % (cell["cell_id"], cwd, cell.get("allowed_roots", [])))
    return cwd


def cmd_claim(args):
    cell = load_cell(args.base, args.wave_id, args.cell_id)
    require_state(cell, ["launched"], "claim")
    require_cwd(cell)
    ts, iso = now_pair()
    cell["state"] = "claimed"
    cell["claimed_at"] = iso
    cell["claimed_epoch"] = ts
    if args.note:
        cell["notes"].append("claim: " + args.note)
    save_cell(args.base, args.wave_id, args.cell_id, cell)
    print("claimed %s/%s at %s" % (args.wave_id, args.cell_id, iso))


URL_RE = re.compile(r"\b[a-zA-Z][a-zA-Z0-9+.\-]*://\S+")
TOKEN_RE = re.compile(r"[^\s'\"`,;:()\[\]{}<>|*]+")
SEG_RE = re.compile(r"^[\w.\-]+$")


def extract_paths(text, base):
    """Deterministic path extraction: whitespace-split; drop URLs; keep tokens that
    are absolute paths or slash-containing relative paths; resolve relatives
    against the cell's cwd (never the supervisor's cwd or REPO_ROOT);
    strip trailing :line suffixes."""
    text = URL_RE.sub(" ", text)
    found = []
    for tok in TOKEN_RE.findall(text):
        tok = tok.strip(".,;:!?\"'`")
        tok = re.sub(r":\d+$", "", tok)
        if tok.count("/") == 0:
            continue
        segs = [s for s in tok.split("/") if s]
        if not segs or not all(SEG_RE.match(s) for s in segs):
            continue
        if not (tok.startswith("/") or tok.startswith("./") or tok.startswith("../")):
            if not SEG_RE.match(segs[0]):
                continue
        p = os.path.realpath(os.path.normpath(
            tok if os.path.isabs(tok) else os.path.join(base, tok)))
        if p not in found:
            found.append(p)
    return found


def under_any(path, roots):
    return any(path == r or path.startswith(r + os.sep) for r in roots)


def append_metric(base, entry):
    os.makedirs(base, exist_ok=True)
    with open(os.path.join(base, "metrics.jsonl"), "a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")


def cmd_done(args):
    cell = load_cell(args.base, args.wave_id, args.cell_id)
    require_state(cell, ["claimed"], "done")
    if not args.receipt:
        die("cell %s: done requires --receipt PATH" % cell["cell_id"])
    cwd = require_cwd(cell)
    if cell.get("line_roots_sha256"):
        current = line_roots_sha256(cell["line_roots_path"])
        if current != cell["line_roots_sha256"]:
            die("cell %s: LINE-ROOTS-DRIFT: %s changed since plan (%s != %s); replan"
                % (cell["cell_id"], cell["line_roots_path"], current, cell["line_roots_sha256"]))
    if args.expect_root:
        bad = expect_root_violations(cell["allowed_roots"], cwd, args.expect_root)
        if bad:
            die("cell %s: allowed_roots/cwd outside --expect-root %r: %s"
                % (cell["cell_id"], norm_abs(args.expect_root), ", ".join(bad)))
    rp = norm_abs(args.receipt)
    if not os.path.isfile(rp):
        die("cell %s: receipt path does not exist: %s" % (cell["cell_id"], rp))
    with open(rp, "r", encoding="utf-8", errors="replace") as fh:
        text = fh.read()
    paths = extract_paths(text, cwd)
    read_mentions = [p for p in paths if under_any(p, cell.get("read_roots", []))]
    violations = [p for p in paths
                  if not under_any(p, cell["allowed_roots"])
                  and not under_any(p, cell.get("read_roots", []))]
    forbidden_mentions = []
    for entry in cell.get("forbidden_surfaces", []):
        surface = entry.get("path")
        for p in paths:
            if p == surface or p.startswith(surface + os.sep):
                if p not in forbidden_mentions:
                    forbidden_mentions.append(p)
    if forbidden_mentions:
        violations = sorted(set(violations + forbidden_mentions))
    ts, iso = now_pair()
    cell["state"] = "done"
    cell["ended_at"] = iso
    cell["ended_epoch"] = ts
    cell["receipt"] = rp
    cell["read_mentions"] = read_mentions
    cell["forbidden_mentions"] = forbidden_mentions
    cell["pollution"] = bool(violations)
    cell["pollution_violations"] = violations
    if args.note:
        cell["notes"].append("done: " + args.note)
    save_cell(args.base, args.wave_id, args.cell_id, cell)
    append_metric(args.base, {
        "ts": iso, "ts_epoch": ts, "wave_id": args.wave_id, "cell_id": cell["cell_id"],
        "kind": cell["kind"], "event": "done", "state": "done",
        "launched_epoch": cell.get("launched_epoch"), "claimed_epoch": cell.get("claimed_epoch"),
        "ended_epoch": ts, "pollution": cell["pollution"],
    })
    if violations:
        print("DONE-POLLUTED %s/%s at %s — receipt mentions paths OUTSIDE allowed_roots "
              "or inside protected surfaces:" % (args.wave_id, args.cell_id, iso))
        for v in violations:
            print("  VIOLATION: " + v)
    else:
        print("done %s/%s at %s (receipt clean; %d read-only mention(s))"
              % (args.wave_id, args.cell_id, iso, len(read_mentions)))


def cmd_fail(args):
    cell = load_cell(args.base, args.wave_id, args.cell_id)
    require_state(cell, ["launched", "claimed"], "fail")
    ts, iso = now_pair()
    cell["state"] = "failed"
    cell["ended_at"] = iso
    cell["ended_epoch"] = ts
    if args.receipt:
        cell["receipt"] = norm_abs(args.receipt)
    if args.note:
        cell["notes"].append("fail: " + args.note)
    save_cell(args.base, args.wave_id, args.cell_id, cell)
    append_metric(args.base, {
        "ts": iso, "ts_epoch": ts, "wave_id": args.wave_id, "cell_id": cell["cell_id"],
        "kind": cell["kind"], "event": "fail", "state": "failed",
        "launched_epoch": cell.get("launched_epoch"), "claimed_epoch": cell.get("claimed_epoch"),
        "ended_epoch": ts, "pollution": False,
    })
    print("failed %s/%s at %s" % (args.wave_id, args.cell_id, iso))


def cmd_requeue(args):
    cell = load_cell(args.base, args.wave_id, args.cell_id)
    require_state(cell, ["failed"], "requeue")
    _, iso = now_pair()
    cell["state"] = "new"
    for k in ("launched_at", "launched_epoch", "claimed_at", "claimed_epoch",
              "ended_at", "ended_epoch", "receipt", "pollution", "pollution_violations"):
        cell.pop(k, None)
    cell["notes"].append("requeue: " + (args.note or "manual requeue after fail"))
    save_cell(args.base, args.wave_id, args.cell_id, cell)
    print("requeued %s/%s to new at %s (metrics history preserved)" % (args.wave_id, args.cell_id, iso))


def iter_waves(base):
    if not os.path.isdir(base):
        return []
    out = []
    for name in sorted(os.listdir(base)):
        if os.path.isfile(os.path.join(base, name, "meta.json")):
            out.append(name)
    return out


def wave_cells(base, wid):
    meta = read_json(os.path.join(wave_dir(base, wid), "meta.json"))
    return [load_cell(base, wid, cid) for cid in meta["cells"]]


def cmd_status(args):
    cells = wave_cells(args.base, args.wave_id)
    counts = {}
    for c in cells:
        counts[c["state"]] = counts.get(c["state"], 0) + 1
    print("wave %s: %s" % (args.wave_id, "  ".join("%s=%d" % (s, counts[s]) for s in STATE_ORDER if s in counts) or "empty"))
    hdr = "%-14s %-9s %-7s %-21s %-21s %-21s %s" % ("cell", "state", "kind", "launched", "claimed", "ended", "flags")
    print(hdr)
    for c in cells:
        flags = "DONE-POLLUTED" if c.get("pollution") else ""
        print("%-14s %-9s %-7s %-21s %-21s %-21s %s" % (
            c["cell_id"], c["state"], c["kind"], c.get("launched_at", "-"),
            c.get("claimed_at", "-"), c.get("ended_at", "-"), flags))


def read_metrics(base):
    p = os.path.join(base, "metrics.jsonl")
    rows = []
    if os.path.isfile(p):
        with open(p, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    rows.append(json.loads(line))
    return rows


def mean(vals):
    return sum(vals) / len(vals) if vals else None


def fmt_secs(s):
    return "-" if s is None else ("%.1fs" % s)


def read_cloudq(path):
    """READ-ONLY cross-line read (legal per assignment; write never). Returns
    (in_flight_count or None, note)."""
    if not os.path.isfile(path):
        return None, "CLOUDQ.tsv absent: " + path
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            lines = [l.rstrip("\n") for l in fh if l.strip() and not l.startswith("#")]
    except OSError as exc:
        return None, "CLOUDQ.tsv unreadable: %s" % exc
    if not lines:
        return 0, "CLOUDQ.tsv empty"
    header = [h.strip().lower() for h in lines[0].split("\t")]
    status_idx = next((i for i, h in enumerate(header) if "status" in h or "state" in h), None)
    body = lines[1:]
    if status_idx is None:
        return len(body), "no status/state column: counted all data rows"
    n = sum(1 for row in body if len(row.split("\t")) > status_idx
            and row.split("\t")[status_idx].strip().lower() in INFLIGHT_WORDS)
    return n, "counted rows with in-flight status"


def cmd_gauge(args):
    waves = iter_waves(args.base)
    all_cells = []
    for wid in waves:
        all_cells.extend(wave_cells(args.base, wid))
    counts = {}
    for c in all_cells:
        counts[c["state"]] = counts.get(c["state"], 0) + 1
    print("waves: %d  cells total: %d" % (len(waves), len(all_cells)))
    for s in STATE_ORDER:
        print("  %-9s %d" % (s, counts.get(s, 0)))
    in_flight = counts.get("launched", 0) + counts.get("claimed", 0)
    metrics = read_metrics(args.base)
    dones = [m for m in metrics if m["event"] == "done"]
    fails = [m for m in metrics if m["event"] == "fail"]
    cold = mean([m["claimed_epoch"] - m["launched_epoch"] for m in dones
                 if m.get("claimed_epoch") and m.get("launched_epoch")])
    work = mean([m["ended_epoch"] - m["claimed_epoch"] for m in dones
                 if m.get("ended_epoch") and m.get("claimed_epoch")])
    epochs = [m["ts_epoch"] for m in metrics]
    span_h = (max(epochs) - min(epochs)) / 3600.0 if len(epochs) >= 2 else 0.0
    if dones and span_h <= 0:
        span_h = max((max(epochs) - min(epochs)), 1.0) / 3600.0
    rate = (len(dones) / span_h) if span_h > 0 else None
    total_end = len(dones) + len(fails)
    rework = (len(fails) / total_end) if total_end else None
    cloud, cloud_note = read_cloudq(args.cloudq)
    print("KPI:")
    print("  sessions_in_flight = %d (launched-not-done, local estimate)" % in_flight)
    print("  cells_completed_per_hour = %s" % ("-" if rate is None else "%.2f" % rate))
    print("  rework_rate = %s (fail/(done+fail) from metrics.jsonl)"
          % ("-" if rework is None else "%.3f" % rework))
    print("  avg_cold_start_launch_to_claim = %s" % fmt_secs(cold))
    print("  avg_work_claim_to_done = %s" % fmt_secs(work))
    print("  cloud_tasks_in_flight = %s (%s)" % ("n/a" if cloud is None else cloud, cloud_note))
    util = 100.0 * in_flight / TARGET_CONCURRENCY
    print("  local vLLM saturation: in_flight %d / target %d = %.1f%%" % (in_flight, TARGET_CONCURRENCY, util))
    if in_flight < TARGET_CONCURRENCY:
        print("  hint: UNDER TARGET — batch more ready cells per launch (engine has no width cap; do not serialize)")


def build_parser():
    ap = argparse.ArgumentParser(prog="wave.py", description=__doc__)
    ap.add_argument("--base", default=DEFAULT_BASE, help="waves state dir (env ABATHUR_WAVES_DIR)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("plan", help="validate manifest, write launchpacks, print fanout plan")
    p.add_argument("manifest")
    p.add_argument("--line-roots", default=DEFAULT_LINE_ROOTS)
    p.add_argument("--role-dir", default=None,
                   help="directory of <role>.md files, snapshot at --session-start")
    p.add_argument("--session-start", default=None,
                   help="ISO-8601 session start; roles newer than this need a restart")
    p.add_argument("--max-width", type=int, default=TARGET_CONCURRENCY)
    p.add_argument("--expect-root", default=None,
                   help="fail-closed gate: every cwd/allowed_root must be under this root")
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=cmd_plan)

    p = sub.add_parser("launch", help="mark cells launched, print concurrent dispatch lines")
    p.add_argument("wave_id")
    p.add_argument("--cells", default="all", help="comma list or 'all' (ready cells)")
    p.set_defaults(func=cmd_launch)

    for name, func in (("claim", cmd_claim), ("done", cmd_done), ("fail", cmd_fail)):
        p = sub.add_parser(name)
        p.add_argument("wave_id")
        p.add_argument("cell_id")
        p.add_argument("--receipt", default=None)
        p.add_argument("--note", default=None)
        if name == "done":
            p.add_argument("--expect-root", default=None,
                           help="fail-closed gate: allowed_roots/cwd must be under this root")
        p.set_defaults(func=func)

    p = sub.add_parser("requeue", help="failed -> new (retry path; done stays terminal)")
    p.add_argument("wave_id")
    p.add_argument("cell_id")
    p.add_argument("--note", default=None)
    p.set_defaults(func=cmd_requeue)

    p = sub.add_parser("status", help="per-wave state dashboard")
    p.add_argument("wave_id")
    p.set_defaults(func=cmd_status)

    p = sub.add_parser("gauge", help="cross-wave saturation dashboard + KPIs")
    p.add_argument("--cloudq", default=DEFAULT_CLOUDQ)
    p.set_defaults(func=cmd_gauge)
    return ap


def main(argv=None):
    args = build_parser().parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
