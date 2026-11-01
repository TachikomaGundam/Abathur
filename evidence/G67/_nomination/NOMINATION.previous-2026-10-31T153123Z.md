# PROMOTION RECORD (derived view -- regenerate, never hand-edit)

This page's own assertions carry no values: every state comes from a probe and every
address is a pointer. The only literals on the page are inside QUOTED ballot demands in
section 3, which belong to the ballots and are shown in full on purpose; a quotation is
not this page asserting a number. To check a line, open the pointer, then run the
read-only probe pass (this mutates nothing):

```
python3 /home/lab/workspace/harness/Abathur/loop/nomination_manifest.py --run-probes /home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/manifest.json
```

Regenerating the page is a separate, mutating step; do not run it while auditing:

```
python3 /home/lab/workspace/harness/Abathur/loop/nomination_manifest.py G67 --write
```

## 0. What changed

The previous record restated disk values in prose, so every restatement needed a human
to guard it; every audit of that layer rejected exactly that layer. This record removes the
restatement instead of gating it: values are only ever pointed at, states only ever come
from probes, gaps are enumerated from directories, and the status vocabulary has no
'landed'. The command above re-runs every state shown below, section 2 and section 3
included, and fails if this page's bytes no longer match the receipt that cites it.
The no-values rule is enforced by machine for hex digests, ISO timestamps, clock times
and percentages; bare counts are not gated, so a number written as a word count would
pass unnoticed.

## 1. Claims

| id | claim | pointer | state |
| --- | --- | --- | --- |
| G67.terminal_state | G67 bundle field terminal_state equals the promotion contract | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#terminal_state` | PASS |
| G67.nominatable | G67 bundle field nominatable equals the promotion contract | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#nominatable` | PASS |
| G67.canaries_killed | G67 bundle field canaries_killed equals the promotion contract | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#canaries_killed` | PASS |
| G67.closed_at | G67 bundle records a close timestamp | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#closed_at` | PASS |
| G67.SR4-64.verdict | G67 SR4-64 verdict equals PASS (promotion contract for a run) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#items.0.verdict` | PASS |
| G67.SR4-69.verdict | G67 SR4-69 verdict equals PASS (promotion contract for a run) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#items.1.verdict` | PASS |

## 2. Audits (pointers into the engine run store)

Outcome and independence are not restated on this page: open the pointer.
Inclusion rule, stated because the filter was invisible before: a run is listed
when its stored artifact path or goal text mentions this generation. Runs that
merely quote the generation in a ballot body are not listed; each such ballot
store is gap-listed instead. A pointer of the form `store#id` is a lookup
convention over a JSON array; this prints the record it names:

```
python3 -c "import json,sys;d=json.load(open(sys.argv[1]));r=d.get('runs',d);print(r[sys.argv[2]] if isinstance(r,dict) else [x for x in r if (x.get('runId') or x.get('run'))==sys.argv[2]][0])" /home/lab/.sibyl/runs.json <run-id>
```

| run | pointer | state |
| --- | --- | --- |

## 3. Must-fix items (quoted from ballots; quote text is not this page's own assertion)

The state column says one thing only: QUOTE-VERBATIM means the quoted text is
still present in the ballot file it was taken from. It does not mean the demand
was satisfied. Whether a demand is met is not machine-decided on this page and is
listed as a gap. Cells are checked against the machine copy after markdown pipe
escaping, so the displayed text is not claimed to be byte-identical to the ballot.

A `file#audit#line` pointer is a lookup convention over the machine copy; this
prints the row it names:

```
python3 -c "import json,sys;d=json.load(open(sys.argv[1]))['items'];print([i for i in d if i['audit']==sys.argv[2] and i['n']==int(sys.argv[3])][0])" /home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json <audit-run-id> <line>
```

| audit | line | demand (quoted) | full text | quote state |
| --- | --- | --- | --- | --- |

## 4. Gaps (enumerated, not curated)

State is PASS only when the row's own probe passes. Rows marked ADMISSION state a
limit of this record and check nothing; they are labelled so they cannot be read
as a verification.

| id | text | pointer | state |
| --- | --- | --- | --- |
| G-git | most of the archive, the ledger and the gate receipts live under .omo, and only a few of those files are tracked by git; the probe recomputes the tracked-versus-total comparison and the counts are not restated here | `/home/lab/workspace/harness/Abathur/.gitignore#file` | PASS |
| G-manifest | no git-tracked evidence manifest for this generation (earlier generations had one) | `/home/lab/workspace/harness/Abathur/docs/evidence-manifests#dir` | PASS |
| G-gate | gate receipts are append-only but live under .omo, which git does not track: they survive on this machine only | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/gate.txt#file` | PASS |
| G-stamp-1 | permanent disclosure stamp #1 is recorded in the bundle (its text is at the pointer, not restated here) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#stamps.0` | PASS |
| G-stamp-2 | permanent disclosure stamp #2 is recorded in the bundle (its text is at the pointer, not restated here) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#stamps.1` | PASS |
| G-stamp-3 | permanent disclosure stamp #3 is recorded in the bundle (its text is at the pointer, not restated here) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#stamps.2` | PASS |
| G-disposition | no demand on this page is marked satisfied or unsatisfied: disposition is a judgement over the artifact, and this generator cannot make it from disk; section 3 therefore reports quote fidelity only | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#items` | ADMISSION |
| G-bundle-face | section 1 points into bundle.json, and that file calls itself a decorative index rather than a compliance witness; the page never restates that note, and the pinned-code witnesses it defers to are reached through each item's verdict file, not through this page | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#face_note` | PASS |
| G-ballot-store-sibyl-20261023T185828Z-1fde | ballot store sibyl-20261023T185828Z-1fde mentions G67 but is not listed in section 2; its tickets are not quoted on this page | `/home/lab/.sibyl/spaces/sibyl-20261023T185828Z-1fde/BALTHASAR.md#file` | PASS |
| G-anomaly-G67-SR4-64 | judge-recorded anomaly for G67/SR4-64 (adverse fact; text is at the pointer, not restated here) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#items.0.judge_verdict.anomalies` | PASS |
| G-anomaly-G67-SR4-69 | judge-recorded anomaly for G67/SR4-69 (adverse fact; text is at the pointer, not restated here) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#items.1.judge_verdict.anomalies` | PASS |

## 5. Receipts

The read-only pass above writes nothing. The write-time pass leaves two files next to this generation's manifest:

- `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/probes-last.json` -- this page's sha plus every probe result (sections 2 and 3 included)
- `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/gate.txt` -- append-only, one line per run, with coverage counts
