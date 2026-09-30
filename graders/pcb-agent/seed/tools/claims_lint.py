#!/usr/bin/env python3
# ============================================================================
# claims_lint.py — RM-26 (round-4) + RM-37 v2 (round-6): mechanical claim
# verification for reports/attestations/receipts.
# ----------------------------------------------------------------------------
# v1 (RM-26): EVERY absolute-path claim that appears with a 64-hex token on the
# same line (+/-60 chars) must resolve to a file whose RAW sha256 equals the
# claim; bare path tokens inside backticks on evidence/ledger/receipt context
# lines must at least exist.
#
# v2 (RM-37, RC-2 / incident #4 root cause): cited HISTORY (session/message
# rows and dispatch/ledger/receipt ids) bypassed v1 because v1 only verified
# FILE PATHS. An attestation could cite a fabricated ses_/msg_/receipt id and
# v1 stayed green. In --claims mode v2 additionally requires that every such
# identifier RESOLVE against live sources:
#   * ses_<id>  -> a real row in the `session` table of the authoritative
#                  opencode DB opened READ-ONLY (sqlite URI mode=ro).
#   * msg_<id>  -> a real row in the `message` table of that DB.
#   * pcb-dispatch-<...>, denied-<...>  -> a file whose name matches the id
#                  under an allowlisted dispatch/ledger dir.
#   * round-approval-<n>-<UTC>          -> a receipt file of that exact name
#                  under an allowlisted capabilities dir.
# Any unresolved identifier -> exit 1 listing every miss. v1 path+sha behaviour
# is fully preserved and runs in BOTH modes; --report keeps the historical
# (path/sha-only) surface with no DB dependency (backward compatible, <2s).
#
# Usage:
#   python3 tools/claims_lint.py --report FILE [--base DIR]        # v1 surface
#   python3 tools/claims_lint.py --claims FILE [--base DIR] [--db PATH]  # v1 + ids
#   --db  authoritative opencode DB for session/message resolution. Default:
#         $OPENCODE_DB if it exists, else $XDG_DATA_HOME|~/.local/share /opencode/
#         opencode.db. Always opened `mode=ro`. Unreadable/missing DB is a
#         fail-closed ERROR (every ses_/msg_ claim then counts as unresolved).
#
# v3 counts extension (round-10, R9-07: orchestrator prose child-count drift —
# receipts/ledgers are authoritative over prose):
#   python3 tools/claims_lint.py --counts FILE --dir D [--dir D2 ...]
#                                [--since YYYY-MM-DDTHH:MM:SSZ]
#   For every line matching a NUMERIC English count claim of the form
#   "<N> children", "<N> dispatched children", "<N> receipts" or
#   "<N> ledger lines" (case-insensitive), N is compared against a
#   mechanically derived count over the explicit --dir set:
#     children / dispatched children -> dispatch RECEIPT files (*.json that do
#         NOT start with "denied-") carrying a non-empty "child_session_id";
#     receipts                       -> the same receipt files, counted;
#     ledger lines                   -> ledger files (name starts with
#         "denied-" and ends with ".json").
#   --since (UTC ISO-8601) filters files by modification time >= since
#   (fail-closed: a malformed --since is a hard error). Any mismatch is a
#   lint ERROR listing claimed vs actual per line; exit 1 iff any mismatch.
#   v1/v2 behavior is UNTOUCHED and --claims stays the default full surface;
#   --counts is an independent mode (no path/DB coupling, and the count modes
#   never run the DB resolver).
# ============================================================================
import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys

# ---- v1 patterns -----------------------------------------------------------
# ABS_PATH_RE: RM-37 adds the (?!\w) end-guard. Without it the shorter extension
# alternatives (sh, json) shadow their longer siblings (sha256, jsonl) and truncate
# a real "...sha256" token to "...sh", producing a false PATH MISSING. The detection
# semantics (abs path paired with a nearby 64-hex) are otherwise unchanged from RM-26.
ABS_PATH_RE = re.compile(r"(?<![\w./+-])/[\w][\w./+-]*\.(?:sha256|jsonl|json|patch|diff|yaml|yml|log|txt|md|csv|py|sh|ts)(?!\w)")
HEX64_RE = re.compile(r"\b[0-9a-f]{64}\b")
BARE_TICK_RE = re.compile(r"`([\w][\w./+-]*\.(?:json|jsonl|md|txt|py|sh|ts|log|sha256|csv|yaml|yml))`")
CONTEXT_RE = re.compile(r"evidence|ledger|receipt", re.IGNORECASE)
HEX_WINDOW = 60

# ---- v2 identifier classes (RM-37 step 7) ---------------------------------
# Each entry: (class-name, regex). Regexes are unanchored; a single line may
# carry many. The trailing-char classes stop at punctuation/quotes/backticks.
SESSION_ID_RE = re.compile(r"\bses_[A-Za-z0-9]{20,}")
MSG_ID_RE = re.compile(r"\bmsg_[A-Za-z0-9]{20,}")
DISPATCH_ID_RE = re.compile(r"\bpcb-dispatch-[a-z0-9][a-z0-9-]*")
DENIED_ID_RE = re.compile(r"\bdenied-[a-z0-9][a-z0-9-]*")
RECEIPT_ID_RE = re.compile(r"\bround-approval-\d+-\d{8}T\d{6}Z")

WORKSPACE_ROOT = "/home/lab/workspace"
# Allowlisted dirs for dispatch/ledger/receipt id resolution (RM-37 step 7).
DISPATCH_DIRS = [
    os.path.join(WORKSPACE_ROOT, "pcb-control", "dispatches"),
    os.path.join(WORKSPACE_ROOT, "pcb-control", "state", "dispatches"),
    os.path.join(WORKSPACE_ROOT, "pcb-control", "state", "discovery-findings"),
]
RECEIPT_DIRS = [
    os.path.join(WORKSPACE_ROOT, "pcb-control", "state", "capabilities"),
    os.path.join(WORKSPACE_ROOT, "harness", "PCB-Agent", "reports", "recovery", "dispatches"),
]


def default_db_path():
    env = os.environ.get("OPENCODE_DB")
    if env and os.path.isfile(env):
        return env
    xdg = os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")
    return os.path.join(xdg, "opencode", "opencode.db")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class IdResolver:
    """Resolve v2 identifiers against live sources (DB read-only + allowlist)."""

    def __init__(self, db_path, unverifiable_path=None):
        self.db_path = db_path
        self.unverifiable = {"session": set(), "message": set()}
        self.unverifiable_reason = ""
        if unverifiable_path and os.path.isfile(unverifiable_path):
            with open(unverifiable_path, "r", encoding="utf-8") as f:
                reg = json.load(f)
            self.unverifiable_reason = str(reg.get("reason", ""))
            for kind in ("session", "message"):
                self.unverifiable[kind] = set(reg.get("ids", {}).get(kind, []))
        self._conn = None
        self._db_error = None
        self._dir_index = None
        self._seen = {}

    # -- DB (mode=ro) ---------------------------------------------------------
    def _open(self):
        if self._conn is not None or self._db_error is not None:
            return self._conn
        try:
            if not os.path.isfile(self.db_path):
                raise OSError("db file not found")
            uri = "file:%s?mode=ro" % self.db_path
            self._conn = sqlite3.connect(uri, uri=True, timeout=10)
            # guard: read-only connection must not be able to write
            self._conn.execute("SELECT 1 FROM sqlite_master LIMIT 1")
        except Exception as e:  # fail-closed: a DB error makes ses_/msg_ unresolved
            self._db_error = str(e)
            self._conn = None
        return self._conn

    def _row_exists(self, table, ident):
        conn = self._open()
        if conn is None:
            return False
        try:
            cur = conn.execute("SELECT 1 FROM %s WHERE id = ? LIMIT 1" % table, (ident,))
            return cur.fetchone() is not None
        except sqlite3.Error:
            return False

    # -- directory allowlist --------------------------------------------------
    def _index(self):
        if self._dir_index is not None:
            return self._dir_index
        entries = {}
        for d in DISPATCH_DIRS + RECEIPT_DIRS:
            try:
                if os.path.isdir(d):
                    entries[d] = os.listdir(d)
            except OSError:
                pass
        self._dir_index = entries
        return entries

    def _file_id_resolves(self, token, dirs):
        idx = self._index()
        for d in dirs:
            for name in idx.get(d, []):
                # exact id, id.<ext>, or an id embedded in a longer ledger name
                if name == token or name.startswith(token + ".") or token in name:
                    return True
        return False

    def unverifiable_hit(self, kind, token):
        return kind in self.unverifiable and token in self.unverifiable[kind]

    def resolve(self, kind, token):
        key = (kind, token)
        if key in self._seen:
            return self._seen[key]
        if kind == "session":
            ok = self._row_exists("session", token)
        elif kind == "message":
            ok = self._row_exists("message", token)
        elif kind == "dispatch":
            ok = self._file_id_resolves(token, DISPATCH_DIRS)
        elif kind == "denied":
            # denied-* are ledger files: match under dispatch/ledger dirs too
            ok = self._file_id_resolves(token, DISPATCH_DIRS + RECEIPT_DIRS)
        elif kind == "receipt":
            ok = self._file_id_resolves(token, RECEIPT_DIRS)
        else:
            ok = False
        self._seen[key] = ok
        return ok

    def close(self):
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:
                pass


IDENT_CLASSES = [
    ("session", SESSION_ID_RE),
    ("message", MSG_ID_RE),
    ("dispatch", DISPATCH_ID_RE),
    ("denied", DENIED_ID_RE),
    ("receipt", RECEIPT_ID_RE),
]


def lint(report_path, base_dir, check_ids=False, db_path=None, unverifiable_path=None):
    failures = 0
    claims = 0
    id_claims = 0
    try:
        with open(report_path, encoding="utf-8", errors="replace") as f:
            text = f.read()
        lines = text.splitlines()
    except OSError as e:
        print("FAIL: report unreadable: %s (%s)" % (report_path, e))
        return 1, 0
    report_dir = os.path.dirname(os.path.abspath(report_path))

    resolver = IdResolver(db_path, unverifiable_path) if check_ids else None
    db_unavailable_noted = False
    try:
        for no, line in enumerate(lines, 1):
            hexes = list(HEX64_RE.finditer(line))
            for m in ABS_PATH_RE.finditer(line):
                path_tok = m.group(0)
                hm = None
                for hx in hexes:
                    if hx.start() - m.end() <= HEX_WINDOW and m.start() - hx.end() <= HEX_WINDOW:
                        hm = hx
                        break
                if not hm:
                    continue
                claims += 1
                want = hm.group(0)
                if not os.path.isfile(path_tok):
                    print("FAIL line %d: PATH MISSING: %s (claimed sha %s...)" % (no, path_tok, want[:16]))
                    failures += 1
                    continue
                try:
                    have = sha256_file(path_tok)
                except OSError as e:
                    print("FAIL line %d: PATH UNREADABLE: %s (%s)" % (no, path_tok, e))
                    failures += 1
                    continue
                if have != want:
                    print("FAIL line %d: SHA256 MISMATCH: %s: claimed %s... disk %s..." % (no, path_tok, want[:16], have[:16]))
                    failures += 1
                else:
                    print("OK   line %d: %s == %s..." % (no, path_tok, want[:16]))
            if CONTEXT_RE.search(line):
                for m in BARE_TICK_RE.finditer(line):
                    rel = m.group(1)
                    cands = [os.path.join(report_dir, rel), os.path.join(base_dir, rel), rel]
                    if any(os.path.isfile(c) for c in cands):
                        continue
                    print("FAIL line %d: ARTIFACT MISSING (evidence/ledger/receipt context): %s" % (no, rel))
                    failures += 1

            # ---- v2 identifier resolution (only in --claims mode) ----
            if check_ids:
                for kind, rx in IDENT_CLASSES:
                    for im in rx.finditer(line):
                        token = im.group(0)
                        id_claims += 1
                        if resolver.unverifiable_hit(kind, token):
                            print("NOTE line %d: %s ID %s is ATTESTED-PURGED (declared-unverifiable registry: %s)"
                                  % (no, kind, token, resolver.unverifiable_reason))
                            continue
                        if resolver.resolve(kind, token):
                            continue
                        if kind in ("session", "message") and not db_unavailable_noted and resolver._db_error:
                            print("FAIL: session/message DB unreadable for identifier resolution: %s (%s)"
                                  % (resolver.db_path, resolver._db_error))
                            db_unavailable_noted = True
                        print("FAIL line %d: UNRESOLVED %s ID: %s (must resolve against the read-only DB / allowlisted dirs)"
                              % (no, kind, token))
                        failures += 1
    finally:
        if resolver is not None:
            resolver.close()

    summary = "claims_lint: %d lines; path+hash claims=%d; failures=%d" % (len(lines), claims, failures)
    if check_ids:
        summary += "; id-claims=%d" % id_claims
    print(summary)
    return failures, claims


# ---- v3 count-claim mode (R9-07) --------------------------------------------
COUNT_CLAIM_RE = re.compile(
    r"\b(\d+)\s+(dispatched children|children|receipts|ledger[ _-]lines)\b",
    re.IGNORECASE)


def _parse_since(s):
    # strict ISO-8601 UTC instant; anything else -> fail closed (None)
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z)$", s or "")
    if not m:
        return None
    import calendar
    try:
        y, mo, d, h, mi, se = (int(g) for g in m.groups()[:6])
        return calendar.timegm((y, mo, d, h, mi, se, 0, 0, 0))
    except (ValueError, OverflowError):
        return None


def scan_counts(dirs, since_iso=None):
    """Mechanically derive (receipts, children, ledger_lines) over --dir set."""
    since = None
    if since_iso is not None:
        since = _parse_since(since_iso)
        if since is None:
            raise ValueError("malformed --since (want YYYY-MM-DDTHH:MM:SSZ UTC): %r" % since_iso)
    receipts = 0
    children = 0
    ledger_lines = 0
    for d in dirs:
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            p = os.path.join(d, name)
            if not os.path.isfile(p) or not name.endswith(".json"):
                continue
            if since is not None and os.path.getmtime(p) < since:
                continue
            if name.startswith("denied-"):
                ledger_lines += 1
                continue
            receipts += 1
            try:
                with open(p, encoding="utf-8", errors="replace") as f:
                    rec = json.load(f)
                cid = rec.get("child_session_id") if isinstance(rec, dict) else None
                if isinstance(cid, str) and cid:
                    children += 1
            except (OSError, ValueError):
                pass
    return receipts, children, ledger_lines


def counts_lint(counts_file, dirs, since_iso=None):
    if not dirs:
        print("counts_lint: --counts requires at least one --dir (fail-closed)")
        return 1
    try:
        actual = scan_counts(dirs, since_iso)
    except ValueError as e:
        print("counts_lint: %s" % e)
        return 1
    receipts, children, ledger_lines = actual
    try:
        with open(counts_file, encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()
    except OSError as e:
        print("counts_lint: counts file unreadable: %s (%s)" % (counts_file, e))
        return 1
    failures = 0
    claims = 0
    for no, line in enumerate(lines, 1):
        for m in COUNT_CLAIM_RE.finditer(line):
            claims += 1
            n = int(m.group(1))
            noun = m.group(2).lower().replace("_", " ").replace("-", " ")
            if "child" in noun:
                got, label = children, "children"
            elif "receipt" in noun:
                got, label = receipts, "receipts"
            else:
                got, label = ledger_lines, "ledger lines"
            if n == got:
                print("OK   line %d: claimed %d %s == actual %d (dirs=%d)" % (no, n, label, got, len(dirs)))
            else:
                print("FAIL line %d: COUNT MISMATCH: claimed %d %s, mechanically derived actual %d over --dir set"
                      % (no, n, label, got))
                failures += 1
    print("counts_lint: %d lines; count-claims=%d; receipts=%d; children=%d; ledger_lines=%d; failures=%d"
          % (len(lines), claims, receipts, children, ledger_lines, failures))
    return 1 if failures else 0


def main():
    ap = argparse.ArgumentParser(description="RM-26/RM-37 mechanical claim verifier (paths, hashes, and cited session/dispatch/receipt ids) + round-10 R9-07 count-claim verification")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--report", metavar="FILE", help="v1 surface: path+sha + evidence-context existence checks")
    mode.add_argument("--claims", metavar="FILE", help="v2 surface: --report checks PLUS identifier resolution (DB mode=ro + allowlist)")
    ap.add_argument("--unverifiable", metavar="FILE", help="explicit declared-unverifiable registry (purge victims: resolve + annotate, never silently)")
    mode.add_argument("--counts", metavar="FILE", help="count-claim surface (R9-07): verify '<N> children|dispatched children|receipts|ledger lines' lines against a mechanical count over the --dir set")
    ap.add_argument("--base", default=".", help="base dir for relative backtick paths")
    ap.add_argument("--db", default=None, help="authoritative opencode DB for session/message rows (read-only)")
    ap.add_argument("--dir", action="append", default=None, metavar="DIR", help="count mode: directory scanned (repeatable; e.g. dispatch receipts dir, ledger dir)")
    ap.add_argument("--since", default=None, metavar="UTC", help="count mode: only count files modified at/after this UTC instant (ISO-8601)")
    a = ap.parse_args()
    if a.counts:
        sys.exit(counts_lint(a.counts, a.dir or [], a.since))
    target = a.claims if a.claims else a.report
    check_ids = bool(a.claims)
    db_path = a.db or default_db_path()
    failures, _claims = lint(target, os.path.abspath(a.base), check_ids=check_ids, db_path=db_path, unverifiable_path=getattr(a, "unverifiable", None))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
