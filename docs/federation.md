# Federation — the bundle format and the graft contract

v1 federation is a **file format plus local tools**. A bundle is a `.tgz` you
carry by any means you like; `bundle export`, `bundle inspect`, and `graft`
run entirely offline. There are no signatures, no trust, no discovery, no
transport, no auto-merge, and no auto-promotion — the verification model
replaces all of those with byte-equality. Schemas and gate behavior below are
field-for-field from `src/core/bundle-manifest.ts`, `src/core/bundle-inspect.ts`,
`src/core/graft.ts`, `src/core/graft-gates.ts`, `src/core/graft-rebench.ts`,
and `src/core/graft-support.ts`.

## Bundle v1 — container layout

Tarball name: `abathur-<fp16>-<genId>.bundle.tgz` (`<fp16>` = first 16 hex of
the genome fingerprint). Generation content is read from **git objects**
(`git archive`) at export time, never from a working tree. Members:

| Member | Content |
|---|---|
| `manifest.json` | the v1 manifest below — the only file that pins everything else |
| `README.md` | human summary: fingerprint, gen list, primary commit/tree, verdict, rationale |
| `lineage.json` | per-generation ledger-row summaries (`LineageEntry`: genId, parent, commitSha, treeSha, verdict, rationale) |
| `patch.diff` | unified diff primary parent → primary commit |
| `trees/<genId>/**` | full contained tree per generation — exempt from masking (byte truth) |
| `evidence/<genId>/<runId>.jsonl` | bench transcripts — **train units only, structurally never val**, and mask-scanned |

The export is **deterministic**: re-exporting an unchanged ledger produces a
byte-identical tarball (proven in packaging evidence: identical sha256 across
two exports). Nothing about a bundle is authoritative until re-verified —
`bundle inspect` re-hashes every pinned member from the contained bytes.

### Masking (leak gate)

Evidence and manifest strings pass a fail-closed secret-scan before the
tarball is written, and `inspect` re-runs it over the final bytes:

- Always masked → placeholder: this machine's `HOME` → `<HOME>`, the genome's
  `repoPath` → `<GENOME>`.
- Extended per genome by `spec.bundle.maskLiterals` → `<MASKED-n>` (indexed by
  list order).
- `trees/**` members are exempt: they are the byte-truth content, and sealing
  plus review keep machine literals out of genomes by construction.
- A leak on export refuses the write (exit 1, nothing produced); a leak found
  by `inspect` is a blocked verdict with `member:line` and snippet.

## Bundle v1 — `manifest.json` schema (strict object; unknown keys are rejected)

Key insertion order IS the serialized byte order (pins determinism).

| Field | Type / shape | Meaning |
|---|---|---|
| `schema_version` | literal `1` | format version |
| `digest_algo` | string | must be `sha256-canonical-v1`; any other value → inspect exit 2 (cannot answer — wrong tool for the format) |
| `genome` | `{ label: string≥1, fingerprint: sha256-hex(64) }` | which genome this lineage belongs to; identity is the fingerprint, the label rides along for humans |
| `parent` | git commit id (hex 7–64) | primary parent commit |
| `benchDigest` | sha256-hex(64) | digest of the bench SURFACE for the primary tree under this spec (`benchDigestFor`) — what was measured, not the score |
| `benchProvenance` | object, all fields nullable | scoring conditions, see below |
| `budgetCounters` | `{ candidates, modelCalls, tokens, wallS }` | budget the peer spent producing this lineage |
| `stats` | `{ matrix: unitMatrixRow[], verdict: "nominated"\|"culled"\|"indeterminate"\|"inconclusive"\|null }` | the peer's **claim** — per-unit rows + final verdict; never trusted, always re-benched |
| `sealedGlobs` | string[] | copy of `kernel.immutableGlobs` at export |
| `files` | `[{ path, sha256, len }]`, ≥1 | every other member, pinned by hash and length; `manifest.json` never pins itself |
| `rationale` | string | primary generation's rationale |
| `frictionDigests` | string[] | friction-digest ids that motivated this lineage, for cross-instance learning |

`benchProvenance` fields (the scoring-provenance subset):

| Field | Derivation (`deriveBenchProvenance`) | Toy genome value |
|---|---|---|
| `opencodeVersion` | from the bench row's version probes (`bin == "opencode"`) | `null` |
| `agentModel` | `spec.bench.agentModel` | engine-driven only |
| `adapterConfigDigest` | fingerprint of `{adapterIface: abathur-bench-adapter-v1, benchType, graderCommand, judgeCommand, resetCommand, runCommand, seedCommand, timeoutS}` | digest over the inert descriptor commands |
| `fixtureSeedId` | `fingerprint({seedCommand})` | `null` when no seedCommand |
| `judgeModel` | `spec.bench.judgeModel` | engine-driven only |
| `mutatorModel` | constant `null` in v1 | `null` — honest absence, never a guess |
| `nRepeats` | the peer row's reps | e.g. 2 |
| `statsConfigDigest` | `fingerprint(bench.stats)` | digest of the stats gates |

Fields a bench kind genuinely does not have are explicit `null`s — the manifest
never fabricates provenance to look comparable.

## `bundle inspect` — gate order and exit codes

`inspect` answers "is this bundle internally honest", from contained bytes only:

1. read/gunzip container — garbage → **exit 2**
2. parse + schema-validate `manifest.json` — invalid → **exit 2**; unknown
   `digest_algo` → **exit 2**
3. re-hash every pinned member — missing member, sha or length mismatch, or
   unexpected member → **exit 1**; a `path` escaping the bundle (absolute,
   `..`, backslash, NUL) is rejected at tar-read → **exit 2**
4. `patch.diff` present (it is schema-pinned content) — missing → **exit 1**
5. genome check — no `trees/<genId>` members at all → **exit 2**; contained
   spec's fingerprint or label disagreeing with `manifest.genome` → **exit 1**
6. recompute `benchDigest` from the contained primary tree + contained spec —
   mismatch → **exit 1**
7. val exclusion — any `evidence/` row for a val-split unit → **exit 1**
8. mask re-scan over manifest + evidence — leak → **exit 1**

On success: exit 0 with a member count, re-hash count, and the primary verdict.

## `graft` — four steps, six decisions

The graft target is a bundle plus a locally registered `--genome label`. Every
step happens **before** the next; the first three never create a worktree.

1. **Full inspect** (above). Integrity failure is a decision, not a
   negotiation: `quarantined` booked to the local ledger, exit 1.
   Container garbage (exit-2 class) leaves no state — a refusal line only.
2. **Registration + duplicate check**: genome not registered locally →
   `pending-bench`: an entry under `<configDir>/graft-queue/<bundle-sha256>.json`,
   exit 1, zero bench runs. Repair (register the genome), then re-run `graft` —
   pending rows are explicitly non-terminal. On a registered genome the ledger
   is then checked for a prior terminal decision on this exact bundle + genome:
   any terminal row (`quarantined`/`nominated`/`culled`/`indeterminate`/
   `inconclusive`) → refusal, exit 1 ("export a newer bundle; re-running never
   re-benches").
3. **Byte-exact gates**, in order; any miss → `quarantined` (exit 1, one
   `graft_import` ledger row naming the failing gate, no worktree, no bench):
   - gate 1 genome fingerprint: local spec must fingerprint **byte-equal** to
     `manifest.genome.fingerprint`;
   - gate 2 benchDigest: recomputed from the contained primary tree under the
     LOCAL spec vs `manifest.benchDigest`;
   - gate 3 scoring provenance: the five recomputable fields
     (`agentModel, judgeModel, statsConfigDigest, adapterConfigDigest,
     fixtureSeedId`) must agree **three ways** — manifest claim vs what the
     bundle's own contained spec derives vs local — and `opencodeVersion` must
     be semver-equal to the local incumbent bench row's version (both-null is
     the honest equality for toy; unparsable is incomparable);
   - gate 4 `requires[]` probes via the todo-6 machinery (argv spawn, 30 s cap,
     fixture genomes additionally through the engine/minVersion probe).
     Probe failure → `pending-bench` (exit 2 this time — repair setup, re-run).
4. **Local re-bench** — only if all gates passed. A fresh worktree is created
   from the LOCAL incumbent HEAD, the bundle's tree bytes are applied as
   byte-truth (`applyBundleTree`: overwrite every member, remove tracked files
   the bundle lacks), and the candidate is benched at **LOCAL** reps
   (`clampReps` under the local stats config) and **LOCAL** thresholds, under
   the machine-local genome lock, inside the normal budget machinery. The todo-7
   statistics gate decides. The bundle's scores never enter the math — they are
   booked as `peerClaim` metadata in the single `graft_import` row.

Decision table — the complete outcome surface:

| Outcome | Trigger | Exit | Ledger / state |
|---|---|---|---|
| `nominated` | local re-bench passes all gates' stats | 0 | `graft_import` + generation row; waits for human `promote` — graft itself never promotes (`promote.ts` is structurally not imported) |
| `culled` | local stats say no (peer claim irrelevant either way) | 1 | `graft_import` + generation row |
| `indeterminate` | local stats degenerate (e.g. zero-variance) | 1 | `graft_import` + generation row |
| `inconclusive` | local bench truncated by budget/timeout | 2 | `graft_import` + generation row — cannot-answer, never a fake pass |
| `quarantined` | any gate 0–3 integrity/fingerprint/digest/provenance mismatch | 1 | exactly one `graft_import` row; **no worktree, no bench** |
| `pending-bench` | genome unregistered (exit 1) or probes unmet (exit 2) | 1 / 2 | queue file under `<configDir>/graft-queue/` (+ row if a ledger exists); non-terminal by design |

`graftGenId = fingerprint({ graft: bundleSha256, sourceGenome, parent })` — a
grafted generation has a deterministic id derived from the bundle content, and
the sealed row carries `commitSha`/`treeSha` of what was actually benched.

## Honest limitation: env-bound genomes re-derive identity per machine

Byte-equality is literal. A genome whose spec contains **resolved absolute
paths** — the historian case, where the operator materializes
`config/genomes/historian.example.jsonc` into a machine-specific
`*.local.jsonc` — fingerprints over those bytes. Its fingerprint
(on the orchestrator's paths: `2b2456be6cddcb91…`) and every digest derived
from its spec (`benchDigest`, `adapterConfigDigest`) are therefore stable **per
resolved path set**, not across machines. Grafting a historian bundle onto a
peer whose local spec resolved to different paths fails gate 1 — quarantined,
correctly: "same genome" for v1 means "byte-identical spec", and different
paths can genuinely mean different fixture services.

The escape hatch is the one abathur-self uses: keep the spec bytes
machine-independent (e.g. the `${ABATHUR_SELF_REPO}` unresolved-literal
`repoPath` pattern, resolved only at filesystem seams, `effectiveRepoPath` in
`src/core/spec.ts`) and machine-neutral commands. Then the same spec
fingerprints identically everywhere (`1913fcec…`) and graft works across
machines as designed. What v1 will not do is pretend two differently-resolved
genomes are comparable.

## Out of scope (v1, explicitly)

Bundle signing or any trust chain; discovery, transport, or sync protocols;
merge of two incumbent branches; auto-promotion or any bypass flag
(`--force` does not exist in the binary); noise-tolerance bands on digest
equality. Every one of these, if ever built, must fit the invariant the whole
design rests on: **a verdict exists only if it was recomputed locally from
bytes that hash the same on both sides.**
