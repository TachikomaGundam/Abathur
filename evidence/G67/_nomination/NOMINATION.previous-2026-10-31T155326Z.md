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
'landed'. The command above re-runs the states stored in the manifest -- every claim
row, every gap row, and each audit's existence check -- and it fails if this page's bytes
no longer match the receipt that cites it. Membership in sections 2 and 3 is a write-time
snapshot: only regenerating refreshes it, as the staleness gap states. The pin chain
(manifest, probes-last.json, gate.txt) lives in the same untracked tree and carries no
external anchor, so it is machine-local; the gap rows state that limit.
The no-values rule is enforced by machine for hex digests, ISO timestamps, clock times
and percentages; bare counts and numbers written as words are not gated.

## 1. Claims

| id | claim | pointer | state |
| --- | --- | --- | --- |
| G67.terminal_state | G67 bundle field terminal_state equals the promotion contract | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#terminal_state` | PASS |
| G67.nominatable | G67 bundle field nominatable equals the promotion contract | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#nominatable` | PASS |
| G67.canaries_killed | G67 records canaries_killed (value at the pointer); NOT-TESTED, because no bell archive exists for this generation | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#canaries_killed` | ADMISSION |
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
python3 -c "import json,sys;d=json.load(open(sys.argv[1]));r=d.get('runs',d) if isinstance(d,dict) else d;print(r[sys.argv[2]] if isinstance(r,dict) else [x for x in r if (x.get('runId') or x.get('run'))==sys.argv[2]][0])" /home/lab/.sibyl/runs.json <run-id>
```

RESOLVES certifies only that the record exists in the store; it says nothing about
the outcome stored there, which is not restated on this page.

| run | pointer | state |
| --- | --- | --- |
| sibyl-20261031T152240Z-f609 | `/home/lab/.sibyl/runs.json#sibyl-20261031T152240Z-f609` | RESOLVES |
| sibyl-20261031T153144Z-eef7 | `/home/lab/.sibyl/runs.json#sibyl-20261031T153144Z-eef7` | RESOLVES |

## 3. Must-fix items (quoted from ballots; quote text is not this page's own assertion)

The state column says one thing only: QUOTE-VERBATIM means the quoted text is
still present in the ballot file named in that row's ballot source column. It does
not mean the demand
was satisfied. Whether a demand is met is not machine-decided on this page and is
listed as a gap. Cells are checked against the machine copy after markdown pipe
escaping, so the displayed text is not claimed to be byte-identical to the ballot.

A `file#audit#line` pointer is a lookup convention over the machine copy; this
prints the row it names:

```
python3 -c "import json,sys;d=json.load(open(sys.argv[1]))['items'];print([i for i in d if i['audit']==sys.argv[2] and i['n']==int(sys.argv[3])][0])" /home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json <audit-run-id> <line>
```

| audit | line | demand (quoted) | full text | ballot source | quote state |
| --- | --- | --- | --- | --- | --- |
| sibyl-20261031T152240Z-f609 | 1 | loop/nomination_manifest.py:432 uses raw substring 'gen in text' for ballot-store gaps; apply the file's own gen_boundary() (defined line 167, used line 200) to both the enumeration filter and the present_in pattern, then regenerate — the phantom G-ballot-store row must go or be re-derived from a true mention. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T152240Z-f609#1` | `/home/lab/.sibyl/spaces/sibyl-20261031T152240Z-f609/BALTHASAR.md` | QUOTE-VERBATIM |
| sibyl-20261031T152240Z-f609 | 2 | Bind audit enumeration to an independent append-only local receipt ledger (or emit an explicit gap row naming the 500-run store cap) so absence from runs.json can never be read as absence of audits. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T152240Z-f609#2` | `/home/lab/.sibyl/spaces/sibyl-20261031T152240Z-f609/BALTHASAR.md` | QUOTE-VERBATIM |
| sibyl-20261031T152240Z-f609 | 3 | Emit an explicit enumeration-completeness row whenever audits, mustfix, or bell directories enumerate to zero, stating that emptiness is what the probe saw and cannot be distinguished from loss. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T152240Z-f609#3` | `/home/lab/.sibyl/spaces/sibyl-20261031T152240Z-f609/BALTHASAR.md` | QUOTE-VERBATIM |
| sibyl-20261031T152240Z-f609 | 4 | G67.closed_at claim text says 'records a close timestamp' but the probe (json_selector truthy) never validates timestamp shape; either add an ISO-format check or downgrade the claim text to 'records a value at closed_at'. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T152240Z-f609#4` | `/home/lab/.sibyl/spaces/sibyl-20261031T152240Z-f609/BALTHASAR.md` | QUOTE-VERBATIM |
| sibyl-20261031T152240Z-f609 | 5 | G-bundle-face text asserts 'the page never restates that note' while the same row paraphrases face_note; remove the paraphrase or the self-exemption so the row is not internally contradictory. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T152240Z-f609#5` | `/home/lab/.sibyl/spaces/sibyl-20261031T152240Z-f609/BALTHASAR.md` | QUOTE-VERBATIM |
| sibyl-20261031T152240Z-f609 | 6 | Enumerate absence-adverses: when enumerate_bells(G67) is empty, emit a gap row stating no bell archive exists for this generation, and when the audits list is empty at write time, emit a G-no-audit row; enumeration must cover missing-directory facts or 'enumerated, not curated' is false as self-described | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T152240Z-f609#6` | `/home/lab/.sibyl/spaces/sibyl-20261031T152240Z-f609/CASPER.md` | QUOTE-VERBATIM |
| sibyl-20261031T152240Z-f609 | 7 | Bind the G67.canaries_killed claim to bell existence (nonempty bell-archive probe or a NOT-TESTED state when no G67*CAN directory exists) so a vacuous [] cannot render as PASS without qualification | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T152240Z-f609#7` | `/home/lab/.sibyl/spaces/sibyl-20261031T152240Z-f609/CASPER.md` | QUOTE-VERBATIM |
| sibyl-20261031T152240Z-f609 | 8 | Extend --run-probes to recompute manifest.json's sha256 and fail on mismatch with the latest gate.txt manifest_sha256 line, or print that exact comparison command in section 0, so the reproduced states are chained to a pinned manifest rather than trusting the file they read | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T152240Z-f609#8` | `/home/lab/.sibyl/spaces/sibyl-20261031T152240Z-f609/CASPER.md` | QUOTE-VERBATIM |
| sibyl-20261031T152240Z-f609 | 9 | Probe or pointer the two remaining prose assertions ('earlier generations had one' -> glob probe over docs/evidence-manifests for any {G}N-*.sha256 outside this gen; 'append-only' -> drop or point at the generator line), closing the unprobed-assertion class the record promises to have eliminated | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T152240Z-f609#9` | `/home/lab/.sibyl/spaces/sibyl-20261031T152240Z-f609/CASPER.md` | QUOTE-VERBATIM |
| sibyl-20261031T152240Z-f609 | 10 | Fix or qualify G-ballot-store-1fde: make enumerate_gaps use a word-boundary/pattern with context and quote the matched line in the row text, so a base64 session-id collision (ses_...PG67OzLb) is not presented as a G67-mentioning ballot store whose 'tickets are not quoted'. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T152240Z-f609#10` | `/home/lab/.sibyl/spaces/sibyl-20261031T152240Z-f609/MELCHIOR.md` | QUOTE-VERBATIM |
| sibyl-20261031T152240Z-f609 | 11 | Add an ADMISSION row (the mechanism exists) stating that section 2/3 membership is frozen at write time and --run-probes does not re-derive it from ~/.sibyl/runs.json, and amend section 0's 're-runs every state shown below, section 2 and section 3 included' to 'stored rows only'; or add a membership/staleness probe that fails when a new runs.json entry matches the generation's inclusion rule. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T152240Z-f609#11` | `/home/lab/.sibyl/spaces/sibyl-20261031T152240Z-f609/MELCHIOR.md` | QUOTE-VERBATIM |
| sibyl-20261031T152240Z-f609 | 12 | Probe or delete the 'earlier generations had one' clause in G-manifest (e.g. non-empty glob on docs/evidence-manifests for any prior G*-*.sha256). | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T152240Z-f609#12` | `/home/lab/.sibyl/spaces/sibyl-20261031T152240Z-f609/MELCHIOR.md` | QUOTE-VERBATIM |
| sibyl-20261031T153144Z-eef7 | 1 | 1. Section 2: 'A pointer of the form `store#id` is a lookup convention over a JSON array; this prints the record it names' — the printed command 'd.get('runs',d)' raises AttributeError (rc=1, live-verified) because runs.json is a top-level list; fix the command or the pointer convention, as printed the sole audit pointer is unverifiable. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T153144Z-eef7#1` | `/home/lab/.sibyl/spaces/sibyl-20261031T153144Z-eef7/BALTHASAR.md` | QUOTE-VERBATIM |
| sibyl-20261031T153144Z-eef7 | 2 | 2. Section 1 row G67.canaries_killed shows state PASS while its probe is kind=admission which 'states a limit, checks nothing' (nomination_manifest.py:115-116) and the claims renderer has no ADMISSION branch; an unchecked no-op renders as PASS next to the row's own 'NOT-TESTED' text — unresolved must-fix 7, and it contradicts section 4's 'State is PASS only when the row's own probe passes'. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T153144Z-eef7#2` | `/home/lab/.sibyl/spaces/sibyl-20261031T153144Z-eef7/BALTHASAR.md` | QUOTE-VERBATIM |
| sibyl-20261031T153144Z-eef7 | 3 | 3. Gap row G-array-count claims it 'counts the must_fix arrays still present in the ballot files and fails when that number exceeds the rows taken from them'; the probe counts literal occurrences of the string '"must_fix"' (nomination_manifest.py:120-127) — live count is exactly 1 per ballot (3 total, expect 12), so it can never fail in the stated mode; the PASS overstates the guarantee. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T153144Z-eef7#3` | `/home/lab/.sibyl/spaces/sibyl-20261031T153144Z-eef7/BALTHASAR.md` | QUOTE-VERBATIM |
| sibyl-20261031T153144Z-eef7 | 4 | 4. Gap row G-bundle-face says 'this row does not paraphrase that note' while the same row paraphrases face_note ('decorative index rather than a compliance witness' vs 'DECORATIVE INDEX; compliance witnesses come from pinned code only'); unresolved internal contradiction from must-fix 5. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T153144Z-eef7#4` | `/home/lab/.sibyl/spaces/sibyl-20261031T153144Z-eef7/BALTHASAR.md` | QUOTE-VERBATIM |
| sibyl-20261031T153144Z-eef7 | 5 | 5. Section 0 're-runs every state shown below, section 2 and section 3 included' overstates: G-membership-stale admits membership is not re-derived, and this is live material — runs.json now holds a second G67 audit of the same NOMINATION.md (sibyl-20261031T153144Z-eef7, recorded 21s after the page write) that the page cannot show; amend per must-fix 11 to 'stored rows only' or add the staleness probe. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T153144Z-eef7#5` | `/home/lab/.sibyl/spaces/sibyl-20261031T153144Z-eef7/BALTHASAR.md` | QUOTE-VERBATIM |
| sibyl-20261031T153144Z-eef7 | 6 | 6. Section 5 asserts gate.txt is 'append-only, one line per run' with no probe or pointer — the only unprobed prose assertion outside section 3 quotes, so section 0's claim that the record eliminated the unprobed-assertion class is false (second half of must-fix 9); also nothing pins gate.txt itself while it is the root of the manifest/receipt chain that section 0 leans on. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T153144Z-eef7#6` | `/home/lab/.sibyl/spaces/sibyl-20261031T153144Z-eef7/BALTHASAR.md` | QUOTE-VERBATIM |
| sibyl-20261031T153144Z-eef7 | 7 | 7. Header claim 'The only literals on the page are inside QUOTED ballot demands in section 3' is contradicted on-page by the G-stamp-1/2/3 rows ('stamp #1', '#2', '#3'), which are literals outside section 3. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T153144Z-eef7#7` | `/home/lab/.sibyl/spaces/sibyl-20261031T153144Z-eef7/BALTHASAR.md` | QUOTE-VERBATIM |
| sibyl-20261031T153144Z-eef7 | 8 | 1. Section 2: 'this prints the record it names' is false as printed — /home/lab/.sibyl/runs.json is a JSON array and the one-liner evaluates d.get('runs',d) on the list, raising AttributeError: 'list' object has no attribute 'get' (reproduced verbatim on this machine); fix the command and re-run it exactly as displayed before shipping the page. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T153144Z-eef7#8` | `/home/lab/.sibyl/spaces/sibyl-20261031T153144Z-eef7/CASPER.md` | QUOTE-VERBATIM |
| sibyl-20261031T153144Z-eef7 | 9 | 2. Gaps row G-no-bells: 'no bell archive exists for this generation... emptiness is what the directory scan saw' is backed by probe {"kind":"glob_empty","pattern":"G67[A-Z]*CAN"} executed via Path.glob, which cannot match 'G67CAN' — the exact convention of every bell archive on disk (G44CAN…G66CAN) — so the probe passes whether or not a bell exists; reuse the generator's own bell_pattern (nomination_manifest.py:159) and demonstrate the probe fires on a planted G67CAN fixture. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T153144Z-eef7#9` | `/home/lab/.sibyl/spaces/sibyl-20261031T153144Z-eef7/CASPER.md` | QUOTE-VERBATIM |
| sibyl-20261031T153144Z-eef7 | 10 | 3. Section 1 row G67.canaries_killed shows state 'PASS' while its own claim says 'NOT-TESTED, because no bell archive exists for this generation' and its probe is {"kind":"admission"}, which the code itself labels 'admission row: states a limit, checks nothing'; this contradicts section 4's rule 'State is PASS only when the row's own probe passes' and reproduces the vacuous-PASS rendering that open must-fix 7 forbids; render NOT-TESTED or import the ADMISSION vocabulary into section 1. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T153144Z-eef7#10` | `/home/lab/.sibyl/spaces/sibyl-20261031T153144Z-eef7/CASPER.md` | QUOTE-VERBATIM |
| sibyl-20261031T153144Z-eef7 | 11 | 4. Section 0: 'fails if this page's bytes no longer match the receipt that cites it' and 're-runs every state shown below, section 2 and section 3 included' overstate the chain — the manifest's sha is never compared to gate.txt's manifest_sha256 at read time (open must-fix 8), every link lives in git-untracked .omo, and section 2/3 membership and stored verdict fields are write-time snapshots not re-derived from the store; amend to 'stored rows only' and print the manifest-pin comparison command in section 0. | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T153144Z-eef7#11` | `/home/lab/.sibyl/spaces/sibyl-20261031T153144Z-eef7/CASPER.md` | QUOTE-VERBATIM |
| sibyl-20261031T153144Z-eef7 | 12 | 1. Remove the self-exemption or the paraphrase in G-bundle-face: 'this row does not paraphrase that note' is falsified by the same row's 'calls itself a decorative index rather than a compliance witness' (demand 5, unfixed in nomination_manifest.py:417-421) | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T153144Z-eef7#12` | `/home/lab/.sibyl/spaces/sibyl-20261031T153144Z-eef7/MELCHIOR.md` | QUOTE-VERBATIM |
| sibyl-20261031T153144Z-eef7 | 13 | 2. Fix the QUOTE-VERBATIM evidence path: the state is defined against 'the ballot file it was taken from' but the displayed pointer only reaches mustfix.json; display the per-item source ballot path (e.g. /home/lab/.sibyl/spaces/sibyl-20261031T152240Z-f609/BALTHASAR.md) beside each row | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T153144Z-eef7#13` | `/home/lab/.sibyl/spaces/sibyl-20261031T153144Z-eef7/MELCHIOR.md` | QUOTE-VERBATIM |
| sibyl-20261031T153144Z-eef7 | 14 | 3. Render 'G67.canaries_killed' state as NOT-TESTED (or ADMISSION) in section 1, not 'PASS' — its probe kind is 'admission' which the code defines as 'checks nothing', contradicting section 4's 'State is PASS only when the row's own probe passes' | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T153144Z-eef7#14` | `/home/lab/.sibyl/spaces/sibyl-20261031T153144Z-eef7/MELCHIOR.md` | QUOTE-VERBATIM |
| sibyl-20261031T153144Z-eef7 | 15 | 4. Disclose in section 0 that 'the receipt that cites it' (probes-last.json) and the manifest sha pin (gate.txt) are themselves untracked, co-located files with no external anchor, so the integrity chain is machine-local | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T153144Z-eef7#15` | `/home/lab/.sibyl/spaces/sibyl-20261031T153144Z-eef7/MELCHIOR.md` | QUOTE-VERBATIM |
| sibyl-20261031T153144Z-eef7 | 16 | 5. Name the bound behind G-store-cap's 'the engine run store is bounded in practice' or point at the store-cap constant; an unnamed bound is an unprobed count the record's own no-values carve-out admits would pass unnoticed | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T153144Z-eef7#16` | `/home/lab/.sibyl/spaces/sibyl-20261031T153144Z-eef7/MELCHIOR.md` | QUOTE-VERBATIM |
| sibyl-20261031T153144Z-eef7 | 17 | 6. State G-array-count's actual predicate ('counts the literal token "must_fix" in the ballot files') in the row text so its vacuous-pass mode is not hidden behind 'counts the must_fix arrays still present' | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T153144Z-eef7#17` | `/home/lab/.sibyl/spaces/sibyl-20261031T153144Z-eef7/MELCHIOR.md` | QUOTE-VERBATIM |
| sibyl-20261031T153144Z-eef7 | 18 | 7. Add a state or note in section 2 that 'RESOLVES' certifies existence only; the record at /home/lab/.sibyl/runs.json#sibyl-20261031T152240Z-f609 marks the sole listed audit REJECT 0A/3R | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#sibyl-20261031T153144Z-eef7#18` | `/home/lab/.sibyl/spaces/sibyl-20261031T153144Z-eef7/MELCHIOR.md` | QUOTE-VERBATIM |

## 4. Gaps (enumerated, not curated)

State is PASS only when the row's own probe passes. Rows marked ADMISSION state a
limit of this record and check nothing; they are labelled so they cannot be read
as a verification.

| id | text | pointer | state |
| --- | --- | --- | --- |
| G-git | most of the archive, the ledger and the gate receipts live under .omo, and only a few of those files are tracked by git; the probe recomputes the tracked-versus-total comparison and the counts are not restated here | `/home/lab/workspace/harness/Abathur/.gitignore#file` | PASS |
| G-manifest | no git-tracked evidence manifest for this generation | `/home/lab/workspace/harness/Abathur/docs/evidence-manifests#dir` | PASS |
| G-gate | gate receipts live under .omo, which git does not track: they survive on this machine only | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/gate.txt#file` | PASS |
| G-stamp-1 | a permanent disclosure stamp is recorded in the bundle (its text is at the pointer, not restated here) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#stamps.0` | PASS |
| G-stamp-2 | a permanent disclosure stamp is recorded in the bundle (its text is at the pointer, not restated here) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#stamps.1` | PASS |
| G-stamp-3 | a permanent disclosure stamp is recorded in the bundle (its text is at the pointer, not restated here) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#stamps.2` | PASS |
| G-disposition | no demand on this page is marked satisfied or unsatisfied: disposition is a judgement over the artifact, and this generator cannot make it from disk; section 3 therefore reports quote fidelity only | `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/mustfix.json#items` | ADMISSION |
| G-bundle-face | section 1 points into bundle.json, whose face_note describes itself as a decorative index rather than a compliance witness; that note is DATA, not a witness, and the pinned-code witnesses it defers to live in each item's verdict file, not on this page | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#face_note` | PASS |
| G-array-count-sibyl-20261031T152240Z-f609 | section 3 rows and their quote probes come from one extraction pass; this row is the independent count check for that audit -- it decodes every JSON array in the ballot files, counts those whose objects carry the must_fix key, and fails when that number exceeds the rows taken from them | `/home/lab/.sibyl/spaces/sibyl-20261031T152240Z-f609/BALTHASAR.md#file` | PASS |
| G-array-count-sibyl-20261031T153144Z-eef7 | section 3 rows and their quote probes come from one extraction pass; this row is the independent count check for that audit -- it decodes every JSON array in the ballot files, counts those whose objects carry the must_fix key, and fails when that number exceeds the rows taken from them | `/home/lab/.sibyl/spaces/sibyl-20261031T153144Z-eef7/BALTHASAR.md#file` | PASS |
| G-anomaly-G67-SR4-64 | judge-recorded anomaly for G67/SR4-64 (adverse fact; text is at the pointer, not restated here) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#items.0.judge_verdict.anomalies` | PASS |
| G-anomaly-G67-SR4-69 | judge-recorded anomaly for G67/SR4-69 (adverse fact; text is at the pointer, not restated here) | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive/G67/bundle.json#items.1.judge_verdict.anomalies` | PASS |
| G-no-bells | no bell archive exists for this generation, so the judge was not exercised against a planted paper here; emptiness is what the directory scan saw and cannot be told apart from a lost directory | `/home/lab/workspace/harness/Abathur/.omo/evidence/loop-archive#dir` | PASS |
| G-ballot-repair-1 | a ballot needed a read-only parser repair (invalid-escape \') before its demands could be read; the file on disk was not rewritten | `/home/lab/.sibyl/spaces/sibyl-20261031T153144Z-eef7/BALTHASAR.md#offset 1098` | PASS |
| G-gate-append | the gate receipt is appended rather than rewritten; this row pins the append call in this generator's own source | `/home/lab/workspace/harness/Abathur/loop/nomination_manifest.py#file` | PASS |
| G-membership-stale | section 2 and section 3 membership is a write-time snapshot: the read-only pass re-runs the stored rows but does not re-derive membership from the engine run store, so a run recorded after generation is not listed until the page is regenerated | `/home/lab/.sibyl/runs.json#file` | ADMISSION |
| G-store-cap | the engine rewrites its run store in place and this page declares and checks no capacity for it; an audit that the engine drops disappears with no trace here, so an empty audit table cannot be read as evidence that no audit existed | `/home/lab/.sibyl/runs.json#file` | ADMISSION |

## 5. Receipts

The read-only pass above writes nothing. The write-time pass leaves two files next to this generation's manifest:

- `/home/lab/workspace/harness/Abathur/.omo/evidence/nomination-history/G67/probes-last.json` -- this page's sha plus every probe result (sections 2 and 3 included)
- `{}` -- one line per write-time run, appended by the generator (the append call
  is pinned by a gap row's probe on this generator's source), with coverage counts
