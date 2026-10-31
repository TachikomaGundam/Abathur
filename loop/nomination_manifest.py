#!/usr/bin/env python3
"""Nomination as machine-runnable claims, not restated prose.

Why this exists: five independent audits rejected the G66 nomination page in a
row, and every rejection was about PAPER, never about data: a value copied from
memory, a disclosure silently dropped, a must-fix marked "landed" whose trace
pointed at text that was not there, a gate whose verification source was the
author's own file. The root cause is duplication: the page restated facts that
already lived on disk, so every restatement needed a human to guard it.

This module removes the duplication instead of gating it:
  - the page contains POINTERS (path + selector) and STATES, never values;
  - every state comes from a probe that can be re-run by anyone;
  - disclosures/gaps are ENUMERATED from directories, not listed from memory;
  - must-fix items carry a probe or are marked MANUAL -- the word "landed"
    does not exist here, so it cannot be claimed falsely.

Usage:
  python3 loop/nomination_manifest.py G66            # print manifest JSON
  python3 loop/nomination_manifest.py G66 --write    # write manifest + page + gate receipt
  python3 loop/nomination_manifest.py --run-probes <manifest.json>
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ARCHIVE = REPO / ".omo" / "evidence" / "loop-archive"
EVIDENCE = REPO / ".omo" / "evidence"
MANIFESTS = REPO / "docs" / "evidence-manifests"
RUNS = Path.home() / ".sibyl" / "runs.json"
SCRIPT = Path(__file__).resolve()

HEX_RUN = re.compile(r"\b[0-9a-f]{8,}\b")
ISO_RUN = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")
CLOCK_RUN = re.compile(r"\b\d{2}:\d{2}(?::\d{2})?Z?\b")
PCT_RUN = re.compile(r"\b\d+(?:\.\d+)?\s?%")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def select(data, selector: str):
    cur = data
    for part in selector.split("."):
        cur = cur[int(part)] if isinstance(cur, list) else cur[part]
    return cur


def run_probe(probe: dict) -> tuple[bool, str]:
    """Return (ok, detail). Detail is a short machine string, never a quoted value."""
    kind = probe["kind"]
    try:
        if kind == "file_exists":
            return Path(probe["path"]).is_file(), "is_file"
        if kind == "dir_exists":
            return Path(probe["path"]).is_dir(), "is_dir"
        if kind == "json_selector":
            data = json.loads(Path(probe["path"]).read_text(encoding="utf-8"))
            value = select(data, probe["selector"])
            return value is not None and value != "", "selector resolves to a value"
        if kind == "nonempty_list":
            data = json.loads(Path(probe["path"]).read_text(encoding="utf-8"))
            value = select(data, probe["selector"])
            return isinstance(value, list) and len(value) > 0, f"list_len={len(value) if isinstance(value, list) else 'not-a-list'}"
        if kind == "nonempty_text":
            data = json.loads(Path(probe["path"]).read_text(encoding="utf-8"))
            value = select(data, probe["selector"])
            text = value if isinstance(value, str) else ""
            return bool(text.strip()), f"text_len={len(text.strip())}"
        if kind == "text_in_file":
            # A regenerated page must not drift from the ballot it quotes. The
            # ballot stores the demand JSON-escaped, so both forms count as verbatim.
            text = Path(probe["path"]).read_text(encoding="utf-8", errors="replace")
            raw = probe["text"]
            escaped = json.dumps(raw, ensure_ascii=False)[1:-1]
            ok = raw in text or escaped in text
            return ok, "verbatim" if ok else "quote drifted"
        if kind == "run_exists":
            store = json.loads(RUNS.read_text(encoding="utf-8"))
            runs = store.get("runs", store) if isinstance(store, dict) else store
            if isinstance(runs, dict):
                keys = set(runs.keys())
            else:
                # Engine store keys the id as runId; older fixtures may use run.
                keys = {str(r.get("runId") or r.get("run")) for r in runs}
            return probe["run"] in keys, "run present in store" if probe["run"] in keys else "run absent"
        if kind == "json_equals":
            data = json.loads(Path(probe["path"]).read_text(encoding="utf-8"))
            got = select(data, probe["selector"])
            return got == probe["expect"], f"selector {'==' if got == probe['expect'] else '!='} expected"
        if kind == "sha256_equals":
            got = sha256_file(Path(probe["path"]))
            return got == probe["expect"], f"sha {'==' if got == probe['expect'] else '!='} expected"
        if kind == "absent_in":
            text = Path(probe["path"]).read_text(encoding="utf-8", errors="replace")
            hits = len(re.findall(probe["pattern"], text))
            return hits == 0, f"matches={hits}"
        if kind == "present_in":
            text = Path(probe["path"]).read_text(encoding="utf-8", errors="replace")
            hits = len(re.findall(probe["pattern"], text))
            return hits > 0, f"matches={hits}"
        if kind == "cmd_rc0":
            proc = subprocess.run(probe["argv"], cwd=probe.get("cwd"), capture_output=True,
                                  text=True, timeout=120)
            return proc.returncode == 0, f"rc={proc.returncode}"
        if kind == "cmd_empty_stdout":
            proc = subprocess.run(probe["argv"], cwd=probe.get("cwd"), capture_output=True,
                                  text=True, timeout=120)
            return proc.returncode == 0 and not proc.stdout.strip(), \
                f"rc={proc.returncode} lines={len(proc.stdout.splitlines())}"
        if kind == "glob_empty":
            hits = sorted(Path(probe["dir"]).glob(probe["pattern"]))
            return not hits, f"matches={len(hits)}"
        if kind == "array_needles_lte":
            needles = 0
            for f in probe["files"]:
                try:
                    needles += Path(f).read_text(encoding="utf-8", errors="replace").count('"must_fix"')
                except OSError:
                    return False, f"unreadable {f}"
            return needles <= probe["expect"], f"arrays={needles} rows={probe['expect']}"
        if kind == "git_track_ratio":
            tracked = subprocess.run(["git", "-C", str(REPO), "ls-files", "--", ".omo"],
                                     capture_output=True, text=True)
            tracked_n = len([ln for ln in tracked.stdout.splitlines() if ln.strip()])
            on_disk = sum(1 for p in (REPO / ".omo").rglob("*") if p.is_file())
            return tracked_n * 20 < on_disk, f"tracked={tracked_n} total={on_disk}"
        if kind == "git_untracked":
            proc = subprocess.run(["git", "-C", str(REPO), "ls-files", "--error-unmatch",
                                   probe["path"]], capture_output=True, text=True)
            return proc.returncode != 0, f"ls-files rc={proc.returncode}"
        if kind == "git_clean":
            proc = subprocess.run(["git", "-C", str(REPO), "status", "--porcelain", "--",
                                   probe["path"]], capture_output=True, text=True, timeout=60)
            return proc.returncode == 0 and not proc.stdout.strip(), "porcelain-empty" \
                if not proc.stdout.strip() else "dirty"
        return False, f"unknown probe kind {kind!r}"
    except Exception as exc:  # fail closed: a probe that cannot run is not a pass
        return False, f"{type(exc).__name__}: {exc}"


def claim(cid: str, text: str, pointer: dict, probe: dict) -> dict:
    """A claim may not restate a value: literals are refused at construction time."""
    for pat, label in ((HEX_RUN, "hex"), (ISO_RUN, "iso-timestamp")):
        if pat.search(text):
            raise ValueError(f"claim {cid!r} restates a {label} value; use a pointer instead")
    return {"id": cid, "claim": text, "pointer": pointer, "probe": probe}


def enumerate_bells(gen: str) -> list[str]:
    return sorted(p.name for p in ARCHIVE.iterdir() if p.is_dir() and p.name.startswith(gen)
                  and "CAN" in p.name)


def enumerate_generations(gen: str) -> list[str]:
    """Directories whose bundles belong to this promotion (base gen + bells)."""
    return [gen] + enumerate_bells(gen)


def read_bundle(gen: str) -> dict | None:
    path = ARCHIVE / gen / "bundle.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def enumerate_audits(gen: str) -> list[dict]:
    """Audits are discovered from the engine-side run store, not from my memory."""
    if not RUNS.is_file():
        return []
    try:
        store = json.loads(RUNS.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    runs = store.values() if isinstance(store, dict) else store
    out = []
    for run in runs:
        if not isinstance(run, dict):
            continue
        artifact = str(run.get("artifact") or "")
        goal = str(run.get("goal") or "")
        if gen in artifact or gen in goal:
            out.append({"run": run.get("run") or run.get("runId"), "artifact": artifact,
                        "verdict": run.get("verdict"),
                        "independence": run.get("independence")})
    return sorted((a for a in out if a["run"]), key=lambda a: a["run"])


def enumerate_anomalies(gen: str) -> list[dict]:
    """Judge-recorded anomalies are adverse facts; enumerate them, do not curate."""
    out = []
    for name in enumerate_generations(gen):
        bundle = read_bundle(name)
        for idx, item in enumerate((bundle or {}).get("items", [])):
            nested = item.get("judge_verdict") or {}
            if nested.get("anomalies"):
                selector = f"items.{idx}.judge_verdict.anomalies"
            elif item.get("anomalies"):
                selector = f"items.{idx}.anomalies"
            else:
                continue
            out.append({"gen": name, "item": item.get("item"),
                        "pointer": {"path": str(ARCHIVE / name / "bundle.json"),
                                    "selector": selector}})
    return out


def _json_array(text: str, key: str) -> list:
    """Extract one balanced JSON array that follows a key in a mixed text record.

    Ticket records interleave prose with JSON blobs, so a regex stop at the first
    bracket truncates on any ']' inside a string. Depth counting is the only
    reliable scan here.
    """
    at = text.find(f'"{key}"')
    if at < 0:
        return []
    start = text.find("[", at)
    if start < 0:
        return []
    depth = 0
    in_str = False
    esc = False
    for pos in range(start, len(text)):
        ch = text[pos]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start:pos + 1])
                except json.JSONDecodeError:
                    return []
    return []


def _ticket_text(run: str) -> str | None:
    """Ballots carry the demands; TERMINALS.txt is only the ballot log."""
    space = Path.home() / ".sibyl" / "spaces" / run
    if space.is_dir():
        parts = [p.read_text(encoding="utf-8", errors="replace")
                 for p in sorted(space.glob("*.md"))]
        if parts:
            return "\n".join(parts)
    for dump in sorted(EVIDENCE.glob("sibyl-*.txt")):
        text = dump.read_text(encoding="utf-8", errors="replace")
        if run in text and "must_fix" in text:
            return text
    return None


def _ticket_files(run: str) -> list[Path]:
    """Every ballot file for a run, so no seat's demands can be dropped."""
    space = Path.home() / ".sibyl" / "spaces" / run
    if space.is_dir():
        files = sorted(space.glob("*.md"))
        if files:
            return files
    return []


PARSE_FAILURES: list[tuple] = []


def _all_json_arrays(text: str, key: str, source=None) -> list[list]:
    """Collect EVERY array under `key`, not just the first one.

    The earlier single-array parser silently dropped the other two ballots of
    each audit (disk had ~85 demands, the page showed 30) and the dropped ones
    were the most adverse.  An audit found this by counting; this loop exists so
    counting is no longer necessary.
    """
    out: list[list] = []
    dec = json.JSONDecoder()
    needle = f'"{key}"'
    pos = 0
    while True:
        hit = text.find(needle, pos)
        if hit < 0:
            return out
        pos = hit + len(needle)
        bracket = text.find("[", pos)
        if bracket < 0:
            return out
        try:
            value, end = dec.raw_decode(text[bracket:])
        except json.JSONDecodeError:
            PARSE_FAILURES.append((str(source), hit))
            continue
        pos = bracket + end
        if isinstance(value, list):
            out.append(value)


def _quote_probe(fh, demand: str):
    if fh is None:
        return None
    return {"kind": "text_in_file", "path": str(fh), "text": demand}


def enumerate_mustfix(gen: str, audits: list[dict]) -> list[dict]:
    """Pull every must_fix line verbatim from each audit's own ballot files.

    Each item stays MANUAL until someone binds a probe: this module has no
    "landed" status, so completion cannot be asserted without a runnable check.
    """
    out: list[dict] = []
    for audit in audits:
        run = str(audit["run"])
        files = _ticket_files(run)
        if not files:
            text = _ticket_text(run)
            if text is None:
                out.append({"audit": run, "n": 0,
                            "demand": "ticket record not found for this audit",
                            "probe": None, "note": "MANUAL: record missing"})
                continue
            files = []
            texts = [(None, text)]
        else:
            texts = [(f, f.read_text(encoding="utf-8", errors="replace")) for f in files]
        n = 0
        for fh, text in texts:
            for arr in _all_json_arrays(text, "must_fix", fh):
                for raw in arr:
                    if isinstance(raw, str) and raw.strip():
                        n += 1
                        out.append({"audit": run, "n": n, "demand": raw.strip(),
                                    "probe": _quote_probe(fh, raw.strip()),
                                    "source": str(fh) if fh else "evidence-dump"})
            if n:
                continue
            for idx, raw in enumerate(text.splitlines(), start=1):
                line = raw.strip()
                if line.startswith("must_fix") or "must_fix:" in line:
                    demand = line.split("must_fix:", 1)[-1].strip() or line
                    n += 1
                    out.append({"audit": run, "n": n, "demand": demand,
                                "probe": _quote_probe(fh, demand),
                                "source": str(fh) if fh else "evidence-dump"})
    return out


def enumerate_gaps(gen: str, audits: list[dict], mustfix: list[dict]) -> list[dict]:
    gaps = []
    tracked = subprocess.run(["git", "-C", str(REPO), "ls-files", "--", ".omo"],
                            capture_output=True, text=True)
    on_disk = sum(1 for p in (REPO / ".omo").rglob("*") if p.is_file())
    tracked_n = len([ln for ln in tracked.stdout.splitlines() if ln.strip()])
    if tracked_n * 20 < on_disk:
        gaps.append({"id": "G-git",
                     "text": "most of the archive, the ledger and the gate receipts live under "
                             ".omo, and only a few of those files are tracked by git; the probe "
                             "recomputes the tracked-versus-total comparison and the counts are "
                             "not restated here",
                     "pointer": {"path": str(REPO / ".gitignore"), "selector": "file"},
                     "probe": {"kind": "git_track_ratio"}})
    manifest_hits = sorted(MANIFESTS.glob(f"{gen}-*.sha256")) if MANIFESTS.is_dir() else []
    if not manifest_hits:
        gaps.append({"id": "G-manifest", "text": "no git-tracked evidence manifest for this "
                                                 "generation (earlier generations had one)",
                     "pointer": {"path": str(MANIFESTS), "selector": "dir"},
                     "probe": {"kind": "glob_empty", "dir": str(MANIFESTS),
                               "pattern": f"{gen}-*.sha256"}})
    gate = EVIDENCE / "nomination-history" / gen / "gate.txt"
    gaps.append({"id": "G-gate", "text": "gate receipts are append-only but live under .omo, which "
                                         "git does not track: they survive on this machine only",
                 "pointer": {"path": str(gate), "selector": "file"},
                 "probe": {"kind": "git_untracked",
                           "path": str(gate.relative_to(REPO))}})
    base_bundle = read_bundle(gen) or {}
    for idx, _stamp in enumerate(base_bundle.get("stamps") or []):
        gaps.append({"id": f"G-stamp-{idx + 1}",
                     "text": f"permanent disclosure stamp #{idx + 1} is recorded in the bundle "
                             "(its text is at the pointer, not restated here)",
                     "pointer": {"path": str(ARCHIVE / gen / "bundle.json"), "selector": f"stamps.{idx}"},
                     "probe": {"kind": "json_selector", "path": str(ARCHIVE / gen / "bundle.json"),
                               "selector": f"stamps.{idx}"}})
    bundle_path = ARCHIVE / gen / "bundle.json"
    if bundle_path.is_file():
        gaps.append({"id": "G-bundle-face",
                     "text": "section 1 points into bundle.json, and that file calls itself a "
                             "decorative index rather than a compliance witness; the page never "
                             "restates that note, and the pinned-code witnesses it defers to are "
                             "reached through each item's verdict file, not through this page",
                     "pointer": {"path": str(bundle_path), "selector": "face_note"},
                     "probe": {"kind": "present_in", "path": str(bundle_path),
                               "pattern": "DECORATIVE"}})
    listed = {str(a["run"]) for a in audits}
    spaces = Path.home() / ".sibyl" / "spaces"
    if spaces.is_dir():
        for space in sorted(spaces.iterdir()):
            if not space.is_dir() or space.name in listed:
                continue
            hits = [p for p in space.glob("*.md")
                    if gen in p.read_text(encoding="utf-8", errors="replace")]
            if not hits:
                continue
            gaps.append({"id": f"G-ballot-store-{space.name}",
                         "text": f"ballot store {space.name} mentions {gen} but is not listed "
                                 "in section 2; its tickets are not quoted on this page",
                         "pointer": {"path": str(hits[0]), "selector": "file"},
                         "probe": {"kind": "present_in", "path": str(hits[0]), "pattern": gen}})
    for audit in audits:
        files = [str(f) for f in _ticket_files(str(audit["run"]))]
        if not files:
            continue
        rows = len([m for m in mustfix if m["audit"] == str(audit["run"])])
        gaps.append({"id": f"G-array-count-{audit['run']}",
                     "text": "section 3 rows and their quote probes come from one extraction "
                             "pass; this row is the independent count check for that audit -- "
                             "it counts the must_fix arrays still present in the ballot files "
                             "and fails when that number exceeds the rows taken from them",
                     "pointer": {"path": files[0], "selector": "file"},
                     "probe": {"kind": "array_needles_lte", "files": files, "expect": rows}})
    for anomaly in enumerate_anomalies(gen):
        pointer = anomaly["pointer"]
        gaps.append({"id": f"G-anomaly-{anomaly['gen']}-{anomaly['item']}",
                     "text": f"judge-recorded anomaly for {anomaly['gen']}/{anomaly['item']} "
                             "(adverse fact; text is at the pointer, not restated here)",
                     "pointer": pointer,
                      "probe": {"kind": "nonempty_text", "path": pointer["path"],
                                "selector": pointer["selector"]}})
    return gaps


def bind_probes(mustfix: list[dict], gen: str) -> None:
    """Optional per-item probes; an item without one stays MANUAL forever."""
    path = EVIDENCE / "nomination-history" / gen / "mustfix-probes.json"
    if not path.is_file():
        return
    try:
        binding = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return
    for item in mustfix:
        probe = binding.get(f"{item['audit']}#{item['n']}")
        if isinstance(probe, dict) and probe.get("kind"):
            item["probe"] = probe
            item["note"] = "probe bound"


CONTRACT = {"terminal_state": "CONVERGED", "nominatable": True, "canaries_killed": []}


def build(gen: str) -> dict:
    gens = enumerate_generations(gen)
    claims = []
    seen: set[str] = set()
    for name in gens:
        bundle = read_bundle(name)
        if bundle is None:
            claims.append(claim(f"bundle-{name}", f"{name} bundle present",
                                {"path": str(ARCHIVE / name), "selector": "bundle.json"},
                                {"kind": "file_exists", "path": str(ARCHIVE / name / "bundle.json")}))
            continue
        base = str(ARCHIVE / name / "bundle.json")
        is_base = name == gen
        for field, expected in CONTRACT.items():
            if is_base:
                claims.append(claim(f"{name}.{field}", f"{name} bundle field {field} equals the "
                                                     "promotion contract",
                                    {"path": base, "selector": field},
                                    {"kind": "json_equals", "path": base, "selector": field,
                                     "expect": expected}))
            elif field == "canaries_killed":
                claims.append(claim(f"{name}.{field}", f"{name} bell killed at least one canary",
                                    {"path": base, "selector": field},
                                    {"kind": "nonempty_list", "path": base, "selector": field}))
        claims.append(claim(f"{name}.closed_at", f"{name} bundle records a close timestamp",
                            {"path": base, "selector": "closed_at"},
                            {"kind": "json_selector", "path": base, "selector": "closed_at"}))
        expected_verdict = "PASS" if is_base else "FAIL"
        for idx, item in enumerate(bundle.get("items", [])):
            item_id = item.get("item")
            claims.append(claim(f"{name}.{item_id}.verdict",
                                f"{name} {item_id} verdict equals {expected_verdict} "
                                f"(promotion contract for a {'run' if is_base else 'bell'})",
                                {"path": base, "selector": f"items.{idx}.verdict"},
                                {"kind": "json_equals", "path": base,
                                 "selector": f"items.{idx}.verdict", "expect": expected_verdict}))
    for c in claims:
        if c["id"] in seen:
            raise SystemExit(f"nomination_manifest: duplicate claim id {c['id']}")
        seen.add(c["id"])
    audits = enumerate_audits(gen)
    mustfix = enumerate_mustfix(gen, audits)
    bind_probes(mustfix, gen)
    history = EVIDENCE / "nomination-history" / gen
    history.mkdir(parents=True, exist_ok=True)
    (history / "mustfix.json").write_text(json.dumps({"gen": gen, "items": mustfix},
                                                     ensure_ascii=False, indent=1) + "\n",
                                          encoding="utf-8")
    manifest = {
        "gen": gen,
        "generated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generations": gens,
        "claims": claims,
        "audits": audits,
        "mustfix": mustfix,
        "gaps": enumerate_gaps(gen, audits, mustfix),
    }
    for entry in manifest["claims"] + manifest["gaps"]:
        for pat in (HEX_RUN, ISO_RUN):
            if pat.search(json.dumps(entry["pointer"], ensure_ascii=False)):
                continue  # pointers may name a path that itself contains hex; claims may not
    return manifest


def run_probes(manifest: dict) -> list[dict]:
    # Covers every rendered state: a read-only pass that skipped 99 of 121 cells
    # was the ba2e rejection.
    results = []
    for entry in manifest["claims"] + manifest["gaps"]:
        probe = entry.get("probe")
        if not probe:
            continue
        ok, detail = run_probe(probe)
        results.append({"id": entry["id"], "ok": ok, "detail": detail})
    for n, audit in enumerate(manifest.get("audits") or []):
        probe = {"kind": "run_exists", "run": str(audit.get("run"))}
        ok, detail = run_probe(probe)
        results.append({"id": f"audit#{n}", "ok": ok, "detail": detail})
    for item in manifest.get("mustfix") or []:
        probe = item.get("probe")
        if not probe:
            results.append({"id": f"{item['audit']}#{item['n']}", "ok": False,
                            "detail": "no probe bound"})
            continue
        ok, detail = run_probe(probe)
        results.append({"id": f"quote:{item['audit']}#{item['n']}", "ok": ok, "detail": detail})
    return results


def _scalar(value, key: str) -> str:
    if isinstance(value, dict):
        return str(value.get(key) or "")
    return str(value or "")


def render(manifest: dict, results: list[dict]) -> str:
    state = {r["id"]: r for r in results}
    lines = [
        "# PROMOTION RECORD (derived view -- regenerate, never hand-edit)",
        "",
        "This page's own assertions carry no values: every state comes from a probe and every",
        "address is a pointer. The only literals on the page are inside QUOTED ballot demands in",
        "section 3, which belong to the ballots and are shown in full on purpose; a quotation is",
        "not this page asserting a number. To check a line, open the pointer, then run the",
        "read-only probe pass (this mutates nothing):",
        "",
        "```",
        "python3 {script} --run-probes {manifest}".format(
            script=SCRIPT, manifest=EVIDENCE / "nomination-history" / manifest["gen"] / "manifest.json"),
        "```",
        "",
        "Regenerating the page is a separate, mutating step; do not run it while auditing:",
        "",
        "```",
        "python3 {script} {gen} --write".format(script=SCRIPT, gen=manifest["gen"]),
        "```",
        "",
        "## 0. What changed",
        "",
        "The previous record restated disk values in prose, so every restatement needed a human",
        "to guard it; every audit of that layer rejected exactly that layer. This record removes the",
        "restatement instead of gating it: values are only ever pointed at, states only ever come",
        "from probes, gaps are enumerated from directories, and the status vocabulary has no",
        "'landed'. The command above re-runs every state shown below, section 2 and section 3",
        "included; its receipt is cited at the end of this page.",
        "",
        "## 1. Claims",
        "",
        "| id | claim | pointer | state |",
        "| --- | --- | --- | --- |",
    ]
    for entry in manifest["claims"]:
        st = state.get(entry["id"])
        mark = "PASS" if st and st["ok"] else ("FAIL" if st else "NOT-RUN")
        ptr = "{}#{}".format(entry["pointer"]["path"], entry["pointer"].get("selector", ""))
        lines.append("| {} | {} | `{}` | {} |".format(entry["id"], entry["claim"], ptr, mark))
    lines += ["", "## 2. Audits (pointers into the engine run store)", "",
              "Outcome and independence are not restated on this page: open the pointer.",
              "Inclusion rule, stated because the filter was invisible before: a run is listed",
              "when its stored artifact path or goal text mentions this generation. Runs that",
              "merely quote the generation in a ballot body are not listed; each such ballot",
              "store is gap-listed instead.", "",
              "| run | pointer | state |", "| --- | --- | --- |"]
    for audit in manifest["audits"]:
        ptr = "{}#{}".format(RUNS, audit.get("run"))
        ok = run_probe({"kind": "run_exists", "run": audit.get("run")})[0]
        lines.append("| {} | `{}` | {} |".format(
            audit.get("run"), ptr, "RESOLVES" if ok else "MISSING"))
    lines += ["", "## 3. Must-fix items (quoted from ballots; quote text is not this page's "
                  "own assertion)", "",
              "The state column says one thing only: QUOTE-VERBATIM means the quoted text is",
              "still present in the ballot file it was taken from. It does not mean the demand",
              "was satisfied. Whether a demand is met is not machine-decided on this page and is",
              "listed as a gap.", "",
              "| audit | line | demand (quoted) | full text | quote state |",
              "| --- | --- | --- | --- | --- |"]
    for item in manifest["mustfix"]:
        st = "QUOTE-VERBATIM" if item.get("probe") and run_probe(item["probe"])[0] else \
             ("QUOTE-DRIFT" if item.get("probe") else "MANUAL")
        demand = item["demand"].replace("|", "\\|")
        full = "{}#{}#{}".format(EVIDENCE / "nomination-history" / manifest["gen"] / "mustfix.json",
                                 item["audit"], item["n"])
        lines.append("| {} | {} | {} | `{}` | {} |".format(item["audit"], item["n"], demand,
                                                          full, st))
    lines += ["", "## 4. Gaps (enumerated, not curated)", "",
              "| id | text | pointer | state |", "| --- | --- | --- | --- |"]
    for gap in manifest["gaps"]:
        st = state.get(gap["id"])
        mark = "PASS" if st and st["ok"] else "FAIL"
        ptr = "{}#{}".format(gap["pointer"]["path"], gap["pointer"].get("selector", ""))
        lines.append("| {} | {} | `{}` | {} |".format(gap["id"], gap["text"], ptr, mark))
    lines += ["", "## 5. Receipts", "",
              "The read-only pass above writes nothing. The write-time pass leaves two files "
              "next to this generation's manifest:", "",
              "- `{}` -- this page's sha plus every probe result (sections 2 and 3 included)".format(
                  EVIDENCE / "nomination-history" / manifest["gen"] / "probes-last.json"),
              "- `{}` -- append-only, one line per run, with coverage counts".format(
                  EVIDENCE / "nomination-history" / manifest["gen"] / "gate.txt")]
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("gen", nargs="?")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--run-probes", metavar="MANIFEST")
    args = ap.parse_args()
    if args.run_probes:
        manifest = json.loads(Path(args.run_probes).read_text(encoding="utf-8"))
        results = run_probes(manifest)
        bad = [r for r in results if not r["ok"]]
        print(json.dumps({"probes": len(results), "failed": len(bad),
                          "failures": bad}, ensure_ascii=False, indent=1))
        return 0 if not bad else 1
    if not args.gen:
        ap.error("missing generation (or pass --run-probes)")
    manifest = build(args.gen)
    if PARSE_FAILURES:
        print(json.dumps({"gen": args.gen, "parse_failures": PARSE_FAILURES,
                          "note": "an unparsable must_fix array would be a silent drop; "
                                  "refusing to write a page that claims completeness"},
                         ensure_ascii=False))
        return 1
    results = run_probes(manifest)
    bad = [r for r in results if not r["ok"]]
    if not args.write:
        print(json.dumps(manifest, ensure_ascii=False, indent=1))
        return 0 if not bad else 1
    history = EVIDENCE / "nomination-history" / args.gen
    history.mkdir(parents=True, exist_ok=True)
    manifest_path = history / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n",
                             encoding="utf-8")
    page = ARCHIVE / args.gen / "NOMINATION.md"
    page.parent.mkdir(parents=True, exist_ok=True)
    if page.is_file():
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
        (history / f"NOMINATION.previous-{stamp}.md").write_bytes(page.read_bytes())
    rendered = render(manifest, results)
    drift = [f"{item['audit']}#{item['n']}" for item in manifest["mustfix"]
             if item["demand"].replace("|", "\\|") not in rendered]
    if drift:
        print(json.dumps({"gen": args.gen, "page_quote_drift": drift,
                          "note": "rendered rows do not byte-match the machine copy; "
                                  "refusing to write"}, ensure_ascii=False))
        return 1
    page.write_text(rendered, encoding="utf-8")
    receipt = history / "probes-last.json"
    receipt.write_text(json.dumps({"gen": args.gen, "run_at_utc": manifest["generated_at_utc"],
                                   "page_sha256": sha256_file(page), "results": results},
                                  ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    gate = history / "gate.txt"
    with gate.open("a", encoding="utf-8") as fh:
        fh.write("manifest-run {} probes={} failed={} coverage=claims:{}+gaps:{}+audits:{}+"
                 "mustfix:{} page={} page_sha256={} receipt={} receipt_sha256={}\n".format(
                     manifest["generated_at_utc"], len(results), len(bad),
                     len(manifest["claims"]), len(manifest["gaps"]),
                     len(manifest.get("audits") or []), len(manifest.get("mustfix") or []),
                     page, sha256_file(page), receipt, sha256_file(receipt)))
    own = "\n".join(ln for ln in rendered.splitlines() if not ln.startswith("| sibyl-"))
    copies = (HEX_RUN.findall(own) + ISO_RUN.findall(own) + CLOCK_RUN.findall(own)
              + PCT_RUN.findall(own))
    quoted = len(HEX_RUN.findall(rendered)) + len(ISO_RUN.findall(rendered)) - len(copies)
    print(json.dumps({"gen": args.gen, "claims": len(manifest["claims"]),
                      "gaps": len(manifest["gaps"]), "probes": len(results),
                      "failed": len(bad), "own_value_like_literals": len(copies),
                      "quoted_literals_from_ballots": quoted,
                      "page": str(page), "manifest": str(manifest_path)}, ensure_ascii=False))
    return 0 if not bad and not copies else 1


if __name__ == "__main__":
    sys.exit(main())
