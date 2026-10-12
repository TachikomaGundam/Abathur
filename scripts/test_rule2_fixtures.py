#!/usr/bin/env python3
"""test_rule2_fixtures.py — anti-vacuity regression for PLAIN-WATCH RULE TWO.

20 cases: 5 proven prescriptions (expect SILENT), 5 unproven (expect VIOLATION
with correct family), 10 citation/read-only/below-threshold decoys (expect SILENT).
Both miss (unproven slips through) and false-kill (silent case flagged) are ruler
injuries: exit 1 lists every failure by name. Fixture owner-ruling 2026-10-12.
"""
import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "pw", str(Path(__file__).resolve().parent / "plain-watch.py"))
pw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pw)

FILL = "背景铺垫" * 60  # safely over the 200-char candidate floor
assert len(FILL) >= 200

def msg(fenced: str) -> str:
    return FILL + "\n\n```bash\n" + fenced + "\n```\n"

# (name, message_text, prior_tool_blob, expected_flagged_families)
CASES = [
    # ---- A. proven prescriptions: silent ----
    ("A1-push-with-lsremote", msg("git push --force URL refs/heads/main"), "git ls-remote origin main", []),
    ("A2-rm-with-ls", msg("rm -rf /tmp/scratch/pkg"), "ls -ld /tmp/scratch/pkg", []),
    ("A3-publish-with-dryrun", msg("npm publish --access public"), "npm pack --dry-run", []),
    ("A4-sed-with-grep", msg("sed -i s/a/b/ cfg.txt"), "grep -n 'a' cfg.txt", []),
    ("A5-repo-create-with-ghapi", msg("gh repo create me/private --private"), "gh api user/login", []),
    # ---- B. unproven prescriptions: each family must fire ----
    ("B1-push-no-evidence", msg("git push --force origin main"), "", ["push"]),
    ("B2-tag-new-no-evidence", msg("git tag v9.9.9 HEAD"), "", ["tag-new"]),
    ("B3-promote-no-ledger", msg("abathur promote abathur-self sr9"), "npm test output ok", ["promote"]),
    ("B4-curl-post-no-evidence", msg("curl -X DELETE https://api/x"), "", ["net-mutate"]),
    ("B5-border-push-no-check", msg("border push --config cfg.yaml"), "ls -la", ["border-push"]),
    # ---- C. decoys: must stay silent ----
    ("C1-cited-push-in-corner-quotes", msg("\u300e git push --force origin main \u300f \u662f\u539f\u6587\u8f6c\u8ff0"), "", []),
    ("C2-cited-push-in-double-bracket", msg("\u300cgit push --force x\u300d \u5f15\u7528"), "", []),
    ("C3-inline-backtick-citation", msg("echo ok\n`git push --force origin main` \u4e0d\u5728\u6b64\u5757"), "", []),
    ("C4-prose-mention-nofence", "讨论 " + "git push --force " * 20 + FILL, "", []),
    ("C5-below-threshold", "```bash\ngit push origin main\n```", "", []),
    ("C6-readonly-block", msg("cat file.txt\nls -la\ngrep x y"), "", []),
    ("C7-curl-get", msg("curl -s https://registry/x"), "", []),
    ("C8-rm-bare-no-flags", msg("rm note.txt"), "", []),
    ("C9-verb-not-line-start", msg("hint: 'git push' was rejected upstream"), "", []),
    ("C10-git-tag-list", msg("git tag -l 'v*'"), "", []),
]

fails = []
for name, text, blob, expect in CASES:
    flagged = []
    for fam, _excerpt in pw.prescription_findings(text):
        if not pw.evidence_ok(fam, blob):
            flagged.append(fam)
    got = sorted(set(flagged))
    want = sorted(expect)
    if got != want:
        fails.append(f"{name}: expect={want} got={got}")

# exemption 2 (receipt-index opener) needs the pre-fence opener — separate case
ri = "\u56de\u6267\u7d22\u5f15\u5c42\n\n" + msg("git push --force origin main")
if pw.prescription_findings(ri):
    fails.append("C11-receipt-index-exempt: flagged but must be silent")

print(f"rule-two fixture: {len(CASES) + 1} cases, {len(fails)} fail")
for f in fails:
    print("FAIL", f)
sys.exit(1 if fails else 0)
