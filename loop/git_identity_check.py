#!/usr/bin/env python3
"""git_identity_check.py — pre-commit identity gate (mechanizes magi E1 + the 2026-09-28
fail-open incident, where the gate itself PASSED a wrong identity twice).

Usage: python3 loop/git_identity_check.py <repo>
Exit 0 = identity correct. Exit 1 = MISMATCH, do not commit. Exit 2 = cannot answer
(repo missing, git broken, or no seat-identity policy configured) — fail-closed.

Policy source (single source of truth): repo config key `abathur.seatIdentity`.
Rationale: a history-membership test is hollow once a wrong identity has entered the
history (88 Wiki.js commits made "Wiki.js" pass the old check). The gate must know the
EXPECTED identity, not merely the OBSERVED ones.
"""
import subprocess
import sys


def git(repo, *args) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)


def die(code: int, msg: str) -> None:
    print(msg)
    sys.exit(code)


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1].startswith("-"):
        die(2, __doc__)
    repo = sys.argv[1]
    # fail-closed: confirm we are really talking to a git repo before trusting any output
    probe = git(repo, "rev-parse", "--git-dir")
    if probe.returncode != 0:
        die(2, f"CANNOT-ANSWER: '{repo}' is not a git repo (git said: {probe.stderr.strip()}); refusing to guess")
    expected = git(repo, "config", "abathur.seatIdentity").stdout.strip()
    if not expected:
        die(2, "CANNOT-ANSWER: repo has no `abathur.seatIdentity` config — set the expected "
               "seat identity first (git config abathur.seatIdentity 'name <email>'); "
               "inferring it from history is hollow once a wrong identity is in history")
    name = git(repo, "var", "GIT_AUTHOR_NAME").stdout.strip()
    email = git(repo, "var", "GIT_AUTHOR_EMAIL").stdout.strip()
    effective = f"{name} <{email}>"
    if effective == expected:
        print(f"OK: effective identity {effective} == seat policy")
        return
    die(1, f"MISMATCH: effective identity {effective} != seat policy {expected}\n"
           "STOP. Fix `git config user.name/user.email` (repo-local) and re-run. "
           "Do not commit-then-explain.")


if __name__ == "__main__":
    main()
