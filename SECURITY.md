# Security Policy

## Reporting a vulnerability

Abathur evaluates and mutates code repositories, manages git worktrees, and can publish
packages. A vulnerability here can mean secret leakage, unexpected exfiltration, or
unsafe mutation of a repository you did not intend to touch.

**Do not open a public issue for security reports.**

Instead, report privately to the maintainer: **TachikomaGundam** via GitHub private
vulnerability reporting (repository → Security → "Report a vulnerability").

Include:

- the affected version (`abathur --version`),
- a minimal reproduction,
- the impact you believe is possible.

You will receive an acknowledgement within 7 days. If the report is confirmed, a fix
release and a published advisory follow; reporters are credited unless they prefer
anonymity.

## Supported versions

Only the latest published minor line receives security fixes. Check
`npm view @tachikomagundam/abathur version` for the current release.

## Scope notes

- The `--allow-dirty` / force flags and the `promote`/`tombstone` commands are
  deliberately gated behind explicit invocation; bypasses of those gates are in scope.
- The engine executes mutator commands declared in a genome file you supply. Running a
  genome from an untrusted author is out of scope — that is executing arbitrary code by
  definition.
