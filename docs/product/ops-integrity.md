# Ops Integrity — product note

## One sentence

`abathur ops` gives a repository a fast local check for the “agent waited thirty minutes for a stale file” class of failure, with a report that never calls itself externally verified.

## Who it is for

- A developer who runs local agent harnesses and wants a quick check before trusting a run.
- A small team that wants a shared guardrail without adding a server, database, account, or container.
- A future team that can opt into CI or an external anchor when they need a proof stronger than local files.

## Promise and non-promise

It promises:

- a deterministic scan of the local checkout;
- a declared contract of surfaces and exceptions;
- failure when a contract is missing, malformed, or an exception has expired;
- a machine-readable claim that says **local, not anchored**.

It does not promise:

- protection against a same-uid process that edits files or the report;
- an independent timestamp or an external proof;
- a sandbox for target code;
- detection of every possible wait mechanism or malicious code.

The report says `LOCAL-INTEGRITY-ONLY`. It does not print a bare “PASS”.

## Tiers

| Tier | Name | Extra cost | Claim |
|---|---|---|---|
| 0 | Local check | none | local integrity only |
| 1 | Team CI anchor | CI provider | machine attestation, not human approval |
| 2 | External human anchor | human signature + external log | externally anchored |
| 3 | Air-gapped | manual export | locally trusted, explicitly not online |

Only Tier 0 is implemented. Tier 1 and Tier 2 are product directions, not current claims.

## First run

```sh
cd /path/to/project && /home/lab/workspace/harness/Abathur/cli/abathur-v2.mjs ops init
cd /path/to/project && /home/lab/workspace/harness/Abathur/cli/abathur-v2.mjs ops audit
```

`init` writes:

- `ops/execution-contract.json` — schema, project, detected surfaces, empty exceptions;
- `ops/propagation.jsonl` — a genesis entry with the contract hash, then append-only entries.

After editing the contract, seal it:

```sh
cd /path/to/project && /home/lab/workspace/harness/Abathur/cli/abathur-v2.mjs ops seal
cd /path/to/project && /home/lab/workspace/harness/Abathur/cli/abathur-v2.mjs ops audit
```

`audit` fails when the latest ledger binding does not match the current
contract hash. The ledger is hash-chained; a broken chain is `UNVERIFIED`.

It does not require a key, login, network, daemon, database, or container.

## States

| State | Exit | Meaning |
|---|---:|---|
| `LOCAL-PASS` | 0 | The local checks passed. The claim is local only. |
| `UNVERIFIED` | 2 | No contract, empty ledger, no declared surfaces, or a missing detection. Not green. |
| `FAIL` | 1 | A wait primitive, surface mismatch, expired exception, malformed contract, or invalid ledger was found. |
| operational error | 3 | Bad usage or an `OpsError` (for example, contract already exists). |
| unexpected error | 70 | Internal failure; not a result. |

The exit code is part of the product. A CI job fails on `2` and `3`, not just on `1`.

## Report shape

Every report carries:

- `state`;
- `claim.tier = "local"`;
- `claim.anchored = false`;
- `claim.external_verification = "none"`;
- `claim.guarantees` and `claim.limits`;
- hashes of the contract, scanner, and ledger;
- findings and reasons;
- `excepted_count` and the excepted findings;
- a `coverage` block: excluded directories, symlink policy, depth cap, code extensions, wait primitives, and language gaps;
- `report_sha256`, computed without `generated_at`.

The human form prints the same limits before the hash. A reader cannot see a green word without also seeing “local only”.

## Contract

```json
{
  "schema": "abathur.ops.contract.v1",
  "project": "example",
  "owner": "local",
  "created_at": "2026-11-06T00:00:00.000Z",
  "surfaces": [
    { "path": "bin/tool", "kind": "bin-file", "invocation": "argv", "wait": "none" }
  ],
  "exceptions": [
    {
      "surface": "src/retry.mjs",
      "primitive": "setTimeout",
      "reason": "bounded retry",
      "expires_at": "2026-12-31T00:00:00.000Z"
    }
  ]
}
```

An exception is a timeout, not a permanent waiver. `primitive` is required, and `expires_at` may not exceed 90 days. Expired exceptions fail. Exceptions are counted in `excepted_count`; they do not hide suppression.

The audit also compares detected entrypoints against `surfaces`: detected-but-undeclared is `SURFACE-MISSING`, declared-but-undetected is `SURFACE-STALE`, and a declared path that does not exist is `SURFACE-PATH-MISSING`. Exceptions may target any scanned file, not only a declared entrypoint.

## Supported shapes (Tier 0)

- `package.json` `bin` and `scripts`;
- `pyproject.toml` `[project.scripts]`;
- files under `bin/`;
- shell scripts with `.sh` / `.bash`;
- wait primitives in common code files, excluding `test`/`dist`/`build`/`coverage`/`.next` directories, symlinks, and files deeper than 8 levels;
- wait primitives for Python, JavaScript/TypeScript, and shell only. Go, Java, Kotlin, Rust, and Ruby files are scanned but their native wait primitives are a disclosed gap.

Unsupported shapes are reported as `UNVERIFIED` or as zero surfaces. They are never silently treated as covered. Every report carries the full `coverage` block.

## What is deferred

- Tier 1: CI OIDC/Sigstore, protected environment, read-only agent token.
- Tier 2: human signature over the report digest, GitHub tag protection or external log, max-age.
- Team roles, key rotation, recovery, privacy controls, upgrade/migration, uninstall.
- Real sandboxing; that is a separate runner concern.

## Acceptance for Tier 0

- A fresh supported repo: `init` then `audit` in under two minutes.
- No network or credentials needed.
- Missing contract exits 2, not 0.
- An operational error exits 3; an unexpected error exits 70.
- A detected entrypoint missing from the contract exits 1.
- A contract edit without `ops seal` fails with `LEDGER-CONTRACT-MISMATCH`.
- A `setTimeout` poll on an active surface exits 1.
- An unexpired exception suppresses only its exact surface/primitive.
- An expired exception exits 1.
- JSON report contains `anchored:false` and a hash.
- Human report contains at least one explicit limit.
- No new runtime dependency.

## Current status

Tier 0 is implemented in `kernel/ops/` and exposed as `abathur ops init|audit`. `abathur gate run` runs the ops audit only when `ops/execution-contract.json` exists; non-adopters are untouched. The installed 0.5.6 package does not contain `ops`; the next release must ship it before this is a product.
