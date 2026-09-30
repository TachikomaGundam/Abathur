# Release receipts
Law (human-approved 2026-09-30 after the npm 0.2.6 dual-vehicle collision):
no `refs/tags/v*` push without (1) a receipt here containing `gate: PASS` from a real
border run against the pushing worktree, (2) a matching lease
(`scripts/release-lease.sh acquire <version> <who>`), and (3) the version bump living
on the release branch only (main stays pinned to the last published version).
Install the hook after clones:
`cp scripts/git-hooks/pre-push "$(git rev-parse --git-common-dir)/hooks/pre-push" && chmod +x "$(git rev-parse --git-common-dir)/hooks/pre-push"`
Tag DELETIONS always pass — retiring a bad tag must never need paperwork.
