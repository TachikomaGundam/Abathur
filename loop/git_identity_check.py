#!/usr/bin/env python3
"""git_identity_check.py — pre-commit identity gate (mechanizes magi E1).

Principle: before any commit batch, the identity about to be used MUST be checked
against the repo's public-history identity set. Mismatch => stop and ask the owner;
never commit-then-explain, never package pollution as an options menu.

Usage: python3 loop/git_identity_check.py <repo> [--base origin/HEAD]
Exit 0 = identity consistent (or repo has no history yet). Exit 1 = MISMATCH, do not commit.
"""
import sys, subprocess

def git(repo, *args) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)

def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    repo = sys.argv[1]
    base = sys.argv[sys.argv.index("--base") + 1] if "--base" in sys.argv else None
    name = git(repo, "config", "user.name").stdout.strip()
    email = git(repo, "config", "user.email").stdout.strip()
    if not name or not email:
        # fall back to effective identity
        name = git(repo, "var", "GIT_AUTHOR_NAME").stdout.strip()
        email = git(repo, "var", "GIT_AUTHOR_EMAIL").stdout.strip()
    effective = f"{name} <{email}>"
    rev = base or "HEAD"
    log = git(repo, "log", "--format=%an <%ae>", rev)
    authors = set(log.stdout.split()) if log.returncode == 0 else set()
    authors = {a for a in (l.strip() for l in log.stdout.splitlines()) if a}
    if not authors:
        print(f"OK: no history at {rev} — first-commit repo, identity {effective} unconstrained")
        return
    if effective in authors:
        print(f"OK: {effective} ∈ history identity set {sorted(authors)}")
        return
    print(f"MISMATCH: effective identity {effective} NOT in history identity set {sorted(authors)}")
    print("STOP. Ask the owner which identity to use. Do not commit-then-explain.")
    sys.exit(1)

if __name__ == "__main__":
    main()
