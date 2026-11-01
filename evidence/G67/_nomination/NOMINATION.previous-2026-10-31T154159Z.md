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
| G67.canaries_killed | G67 records canaries_killed (value at the pointer); NOT-TESTED, because no bell archive exists for this generation | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#canaries_killed` | PASS |
| G67.closed_at | G67 bundle records a value at closed_at (timestamp shape is not validated here) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#closed_at` | PASS |
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
| sibyl-20261031T152240Z-f609 | `/home/lab/.sibyl/runs.json#sibyl-20261031T152240Z-f609` | RESOLVES |

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
| sibyl-20261031T152240Z-f609 | 1 | loop/nomination_manifest.py:432 uses raw substring 'gen in text' for ballot-store gaps; apply the file's own gen_boundary() (defined line 167, used line 200) to both the enumeration filter and the present_in pattern, then regenerate — the phantom G-ballot-store row must go or be re-derived from a true mention. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T152240Z-f609#1` | QUOTE-VERBATIM |
| sibyl-20261031T152240Z-f609 | 2 | Bind audit enumeration to an independent append-only local receipt ledger (or emit an explicit gap row naming the 500-run store cap) so absence from runs.json can never be read as absence of audits. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T152240Z-f609#2` | QUOTE-VERBATIM |
| sibyl-20261031T152240Z-f609 | 3 | Emit an explicit enumeration-completeness row whenever audits, mustfix, or bell directories enumerate to zero, stating that emptiness is what the probe saw and cannot be distinguished from loss. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T152240Z-f609#3` | QUOTE-VERBATIM |
| sibyl-20261031T152240Z-f609 | 4 | G67.closed_at claim text says 'records a close timestamp' but the probe (json_selector truthy) never validates timestamp shape; either add an ISO-format check or downgrade the claim text to 'records a value at closed_at'. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T152240Z-f609#4` | QUOTE-VERBATIM |
| sibyl-20261031T152240Z-f609 | 5 | G-bundle-face text asserts 'the page never restates that note' while the same row paraphrases face_note; remove the paraphrase or the self-exemption so the row is not internally contradictory. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T152240Z-f609#5` | QUOTE-VERBATIM |
| sibyl-20261031T152240Z-f609 | 6 | Enumerate absence-adverses: when enumerate_bells(G67) is empty, emit a gap row stating no bell archive exists for this generation, and when the audits list is empty at write time, emit a G-no-audit row; enumeration must cover missing-directory facts or 'enumerated, not curated' is false as self-described | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T152240Z-f609#6` | QUOTE-VERBATIM |
| sibyl-20261031T152240Z-f609 | 7 | Bind the G67.canaries_killed claim to bell existence (nonempty bell-archive probe or a NOT-TESTED state when no G67*CAN directory exists) so a vacuous [] cannot render as PASS without qualification | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T152240Z-f609#7` | QUOTE-VERBATIM |
| sibyl-20261031T152240Z-f609 | 8 | Extend --run-probes to recompute manifest.json's sha256 and fail on mismatch with the latest gate.txt manifest_sha256 line, or print that exact comparison command in section 0, so the reproduced states are chained to a pinned manifest rather than trusting the file they read | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T152240Z-f609#8` | QUOTE-VERBATIM |
| sibyl-20261031T152240Z-f609 | 9 | Probe or pointer the two remaining prose assertions ('earlier generations had one' -> glob probe over docs/evidence-manifests for any {G}N-*.sha256 outside this gen; 'append-only' -> drop or point at the generator line), closing the unprobed-assertion class the record promises to have eliminated | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T152240Z-f609#9` | QUOTE-VERBATIM |
| sibyl-20261031T152240Z-f609 | 10 | Fix or qualify G-ballot-store-1fde: make enumerate_gaps use a word-boundary/pattern with context and quote the matched line in the row text, so a base64 session-id collision (ses_...PG67OzLb) is not presented as a G67-mentioning ballot store whose 'tickets are not quoted'. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T152240Z-f609#10` | QUOTE-VERBATIM |
| sibyl-20261031T152240Z-f609 | 11 | Add an ADMISSION row (the mechanism exists) stating that section 2/3 membership is frozen at write time and --run-probes does not re-derive it from ~/.sibyl/runs.json, and amend section 0's 're-runs every state shown below, section 2 and section 3 included' to 'stored rows only'; or add a membership/staleness probe that fails when a new runs.json entry matches the generation's inclusion rule. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T152240Z-f609#11` | QUOTE-VERBATIM |
| sibyl-20261031T152240Z-f609 | 12 | Probe or delete the 'earlier generations had one' clause in G-manifest (e.g. non-empty glob on docs/evidence-manifests for any prior G*-*.sha256). | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T152240Z-f609#12` | QUOTE-VERBATIM |

## 4. Gaps (enumerated, not curated)

State is PASS only when the row's own probe passes. Rows marked ADMISSION state a
limit of this record and check nothing; they are labelled so they cannot be read
as a verification.

| id | text | pointer | state |
| --- | --- | --- | --- |
| G-git | most of the archive, the ledger and the gate receipts live under .omo, and only a few of those files are tracked by git; the probe recomputes the tracked-versus-total comparison and the counts are not restated here | `/home/lab/workspace/harness/Abathur/.gitignore#file` | PASS |
| G-manifest | no git-tracked evidence manifest for this generation | `/home/lab/workspace/harness/Abathur/docs/evidence-manifests#dir` | PASS |
| G-gate | gate receipts live under .omo, which git does not track: they survive on this machine only | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/gate.txt#file` | PASS |
| G-stamp-1 | permanent disclosure stamp #1 is recorded in the bundle (its text is at the pointer, not restated here) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#stamps.0` | PASS |
| G-stamp-2 | permanent disclosure stamp #2 is recorded in the bundle (its text is at the pointer, not restated here) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#stamps.1` | PASS |
| G-stamp-3 | permanent disclosure stamp #3 is recorded in the bundle (its text is at the pointer, not restated here) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#stamps.2` | PASS |
| G-disposition | no demand on this page is marked satisfied or unsatisfied: disposition is a judgement over the artifact, and this generator cannot make it from disk; section 3 therefore reports quote fidelity only | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#items` | ADMISSION |
| G-bundle-face | section 1 points into bundle.json, and that file calls itself a decorative index rather than a compliance witness; this row does not paraphrase that note, and the pinned-code witnesses it defers to are reached through each item's verdict file, not this page | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#face_note` | PASS |
| G-array-count-sibyl-20261031T152240Z-f609 | section 3 rows and their quote probes come from one extraction pass; this row is the independent count check for that audit -- it counts the must_fix arrays still present in the ballot files and fails when that number exceeds the rows taken from them | `/home/lab/.sibyl/spaces/sibyl-20261031T152240Z-f609/BALTHASAR.md#file` | PASS |
| G-anomaly-G67-SR4-64 | judge-recorded anomaly for G67/SR4-64 (adverse fact; text is at the pointer, not restated here) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#items.0.judge_verdict.anomalies` | PASS |
| G-anomaly-G67-SR4-69 | judge-recorded anomaly for G67/SR4-69 (adverse fact; text is at the pointer, not restated here) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#items.1.judge_verdict.anomalies` | PASS |
| G-no-bells | no bell archive exists for this generation, so the judge was not exercised against a planted paper here; emptiness is what the directory scan saw and cannot be told apart from a lost directory | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive#dir` | PASS |
| G-membership-stale | section 2 and section 3 membership is a write-time snapshot: the read-only pass re-runs the stored rows but does not re-derive membership from the engine run store, so a run recorded after generation is not listed until the page is regenerated | `/home/lab/.sibyl/runs.json#file` | ADMISSION |
| G-store-cap | the engine run store is bounded in practice; an audit that rotated out of it disappears with no trace on this page, so an empty audit table cannot be read as evidence that no audit existed | `/home/lab/.sibyl/runs.json#file` | ADMISSION |

## 5. Receipts

The read-only pass above writes nothing. The write-time pass leaves two files next to this generation's manifest:

- `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/probes-last.json` -- this page's sha plus every probe result (sections 2 and 3 included)
- `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/gate.txt` -- append-only, one line per run, with coverage counts
