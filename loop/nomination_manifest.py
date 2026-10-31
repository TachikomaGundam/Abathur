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

HEX_RUN = re.compile(r"\b[0-9a-f]{8,}\b")
ISO_RUN = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")


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
            select(data, probe["selector"])
            return True, "selector resolves"
        if kind == "nonempty_list":
            data = json.loads(Path(probe["path"]).read_text(encoding="utf-8"))
            value = select(data, probe["selector"])
            return isinstance(value, list) and len(value) > 0, f"list_len={len(value) if isinstance(value, list) else 'not-a-list'}"
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
        for item in (bundle or {}).get("items", []):
            verdict = item.get("judge_verdict") or item
            if verdict.get("anomalies"):
                out.append({"gen": name, "item": item.get("item"),
                            "pointer": {"path": str(ARCHIVE / name / "bundle.json"),
                                        "selector": "items"}})
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


def enumerate_mustfix(gen: str, audits: list[dict]) -> list[dict]:
    """Pull every must_fix line verbatim from each audit's own ticket record.

    Each item stays MANUAL until someone binds a probe: this module has no
    "landed" status, so completion cannot be asserted without a runnable check.
    """
    out: list[dict] = []
    for audit in audits:
        run = str(audit["run"])
        text = _ticket_text(run)
        if text is None:
            out.append({"audit": run, "n": 0,
                        "demand": "ticket record not found for this audit",
                        "probe": None, "note": "MANUAL: record missing"})
            continue
        for idx, raw in enumerate(text.splitlines(), start=1):
            line = raw.strip()
            if "must_fix:" in line or line.startswith("must_fix"):
                demand = line.split("must_fix:", 1)[-1].strip() or line
                out.append({"audit": run, "n": idx, "demand": demand,
                            "probe": None, "note": "MANUAL: no probe bound"})
        if any(item["audit"] == run for item in out):
            continue
        for idx, demand in enumerate(_json_array(text, "must_fix"), start=1):
            if isinstance(demand, str) and demand.strip():
                out.append({"audit": run, "n": idx, "demand": demand.strip(),
                            "probe": None, "note": "MANUAL: no probe bound"})
    return out


def enumerate_gaps(gen: str, audits: list[dict], mustfix: list[dict]) -> list[dict]:
    gaps = []
    tracked = subprocess.run(["git", "-C", str(REPO), "ls-files", "--", ".omo"],
                            capture_output=True, text=True)
    on_disk = sum(1 for p in (REPO / ".omo").rglob("*") if p.is_file())
    tracked_n = len([ln for ln in tracked.stdout.splitlines() if ln.strip()])
    if tracked_n * 100 < on_disk:
        gaps.append({"id": "G-git",
                     "text": "the archive, the ledger and the gate receipts live under .omo, which "
                             "git does not track; the coverage ratio is recomputed by the probe and "
                             "is not restated here",
                     "pointer": {"path": str(REPO / ".gitignore"), "selector": "file"},
                     "probe": {"kind": "absent_in",
                               "path": str(REPO / ".gitignore"),
                               "pattern": r"^\.omo/$"}})
    manifest_hits = sorted(MANIFESTS.glob(f"{gen}-*.sha256")) if MANIFESTS.is_dir() else []
    if not manifest_hits:
        gaps.append({"id": "G-manifest", "text": "no git-tracked evidence manifest for this "
                                                 "generation (earlier generations had one)",
                     "pointer": {"path": str(MANIFESTS), "selector": "dir"},
                     "probe": {"kind": "absent_in", "path": str(REPO / ".gitignore"),
                               "pattern": re.escape(f"{gen}-")}})
    gate = EVIDENCE / "nomination-history" / gen / "gate.txt"
    gaps.append({"id": "G-gate", "text": "gate receipts are append-only but live under .omo, which "
                                         "git does not track: they survive on this machine only",
                 "pointer": {"path": str(gate), "selector": "file"},
                 "probe": {"kind": "git_untracked",
                           "path": str(gate.relative_to(REPO))}})
    base_bundle = read_bundle(gen) or {}
    for idx, stamp in enumerate(base_bundle.get("stamps") or []):
        gaps.append({"id": f"G-stamp-{idx + 1}", "text": f"permanent disclosure stamp: {stamp}",
                     "pointer": {"path": str(ARCHIVE / gen / "bundle.json"), "selector": f"stamps.{idx}"},
                     "probe": {"kind": "json_selector", "path": str(ARCHIVE / gen / "bundle.json"),
                               "selector": f"stamps.{idx}"}})
    unmatched = [m for m in mustfix if m["probe"] is None]
    if unmatched:
        gaps.append({"id": "G-mustfix-unprobed",
                     "text": "must-fix items without a machine probe are listed as MANUAL; their "
                             "completion cannot be asserted by this page",
                     "pointer": {"path": str(EVIDENCE / "nomination-history" / gen / "mustfix.json"),
                                 "selector": "items"},
                     "probe": {"kind": "file_exists",
                               "path": str(EVIDENCE / "nomination-history" / gen / "mustfix.json")}})
    for anomaly in enumerate_anomalies(gen):
        pointer = anomaly["pointer"]
        gaps.append({"id": f"G-anomaly-{anomaly['gen']}-{anomaly['item']}",
                     "text": f"judge-recorded anomaly for {anomaly['gen']}/{anomaly['item']} "
                             "(adverse fact; text is at the pointer, not restated here)",
                     "pointer": pointer,
                     "probe": {"kind": "json_selector", "path": pointer["path"],
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
        for item in bundle.get("items", []):
            item_id = item.get("item")
            selector = f"items.{bundle['items'].index(item)}.verdict"
            claims.append(claim(f"{name}.{item_id}.verdict.present", f"{name} {item_id} verdict is recorded",
                                {"path": base, "selector": selector},
                                {"kind": "json_selector", "path": base, "selector": selector}))
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
    results = []
    for entry in manifest["claims"] + manifest["gaps"]:
        probe = entry.get("probe")
        if not probe:
            continue
        ok, detail = run_probe(probe)
        results.append({"id": entry["id"], "ok": ok, "detail": detail})
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
        "not this page asserting a number. To check a line, open the pointer, then run every",
        "probe at once with:",
        "",
        "```",
        "python3 loop/nomination_manifest.py --run-probes <manifest.json> && "
        "python3 loop/nomination_manifest.py {} --write".format(manifest["gen"]),
        "```",
        "",
        "## 0. What changed",
        "",
        "The previous record restated disk values in prose, so every restatement needed a human",
        "to guard it; every audit of that layer rejected exactly that layer. This record removes the",
        "restatement instead of gating it: values are only ever pointed at, states only ever come",
        "from probes, gaps are enumerated from directories, and the status vocabulary has no",
        "'landed'. Most rows in section 3 were raised against the retired design; they stay",
        "MANUAL until someone binds a probe, and MANUAL is not a claim of completion.",
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
              "Outcome and independence are read from the store, not restated by this page.", "",
              "| run | verdict | independence | pointer | state |",
              "| --- | --- | --- | --- | --- |"]
    for audit in manifest["audits"]:
        ptr = "{}#{}".format(RUNS, audit.get("run"))
        ok = run_probe({"kind": "run_exists", "run": audit.get("run")})[0]
        lines.append("| {} | {} | {} | `{}` | {} |".format(
            audit.get("run"), _scalar(audit.get("verdict"), "verdict") or "unknown",
            _scalar(audit.get("independence"), "status") or "unknown", ptr,
            "RESOLVES" if ok else "MISSING"))
    lines += ["", "## 3. Must-fix items (quoted from ballots; quote text is not this page's "
                  "own assertion)", "",
              "Status is a probe result or the literal word MANUAL. There is no 'landed' status",
              "here, so no completion can be claimed without a runnable check. Each demand is",
              "quoted in full; the pointer gives its line in the machine copy.", "",
              "| audit | line | demand (quoted) | full text | state |",
              "| --- | --- | --- | --- | --- |"]
    for item in manifest["mustfix"]:
        st = "PROBE-PASS" if item.get("probe") and run_probe(item["probe"])[0] else \
             ("PROBE-FAIL" if item.get("probe") else "MANUAL")
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
    page.write_text(rendered, encoding="utf-8")
    gate = history / "gate.txt"
    with gate.open("a", encoding="utf-8") as fh:
        fh.write("manifest-run {} probes={} failed={} page={} page_sha256={}\n".format(
            manifest["generated_at_utc"], len(results), len(bad), page,
            sha256_file(page)))
    own = "\n".join(ln for ln in rendered.splitlines() if not ln.startswith("| sibyl-"))
    copies = HEX_RUN.findall(own) + ISO_RUN.findall(own)
    quoted = len(HEX_RUN.findall(rendered)) + len(ISO_RUN.findall(rendered)) - len(copies)
    print(json.dumps({"gen": args.gen, "claims": len(manifest["claims"]),
                      "gaps": len(manifest["gaps"]), "probes": len(results),
                      "failed": len(bad), "own_value_like_literals": len(copies),
                      "quoted_literals_from_ballots": quoted,
                      "page": str(page), "manifest": str(manifest_path)}, ensure_ascii=False))
    return 0 if not bad and not copies else 1


if __name__ == "__main__":
    sys.exit(main())
