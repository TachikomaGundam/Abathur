# Contributing

Thanks for your interest. Abathur is a self-evolution harness; contributions are welcome.

## Setup

```bash
npm ci
npm test        # builds, then runs the full suite
```

Requires Node `^22.22.2 || ^24.15.0 || >=26.0.0`.

## Ground rules

- **Tests are the contract.** Every behavior change needs a failing test first, then the
  fix. `npm test` must stay green; one optional live-integration anchor skips without
  its service environment.
- **No machine-local literals.** Source and shipped assets must not contain personal
  absolute paths, local model identifiers, or host names. The package-surface tests
  enforce this; keep them passing.
- **Sealed kernel.** `genomes/abathur-self.jsonc` lists sealed paths (`src/core/**`,
  `src/bench/fixture.*`, ledger, constitution). Changes there are governance decisions —
  open an issue before sending a PR against sealed code.
- **Exit codes are a contract**: `0` ok, `1` blocked/failed decision, `2` cannot-answer
  (tool error). Do not add new exit codes without documenting them.

## Pull requests

- Keep commits atomic: one concern per commit.
- Describe *why*, not only *what* — the reasoning is what a reviewer cannot reconstruct.
- If you touch the package surface (`package.json` `files`, `exports`), say so in the PR
  description explicitly; the package-surface tests will hold you to it.

## Reporting bugs

Open a GitHub issue with: version (`abathur --version`), command run, expected vs actual
output, and the exit code. For security issues see [SECURITY.md](SECURITY.md).
