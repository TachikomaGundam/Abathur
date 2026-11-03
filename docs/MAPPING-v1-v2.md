# v1 -> v2 mapping

Generated: 2026-11-03T06:46:34.987Z

- v1 root: `/home/lab/workspace/harness/Abathur`
- v2 root: `/home/lab/workspace/harness/Abathur-v2`
- tracked v1 rows (after named exclusions): **730**
- rewrite: **130**
- discard: **600**
- carry: **0** (cap: 3 entries and 10% of v2 file count; every carry needs an independent audit receipt)

| v1 path | destination | reason |
|---|---|---|
| `.github/workflows/ci.yml` | discard | not part of the v2 runtime or evidence surface |
| `.github/workflows/publish.yml` | discard | not part of the v2 runtime or evidence surface |
| `.gitignore` | rewrite | v2 .gitignore |
| `.omo/evidence/TICKET-CLAUSE7-DETERMINISM-20261017.md` | discard | not part of the v2 runtime or evidence surface |
| `.omo/evidence/ticket-clause7/regression-corpus.json` | discard | not part of the v2 runtime or evidence surface |
| `.omo/evidence/ticket-clause7/regression-inventory.json` | discard | not part of the v2 runtime or evidence surface |
| `.opencode/plugins/abathur-exam-runner.js` | discard | host plugin not part of the v2 runtime |
| `.opencode/plugins/sandbox-bash.js` | discard | host plugin not part of the v2 runtime |
| `AGENTS.md` | discard | v1 project rules remain in the main tree; v2 authority is rules/registry.yaml |
| `CHANGELOG.md` | discard | not part of the v2 runtime or evidence surface |
| `LICENSE` | discard | not part of the v2 runtime or evidence surface |
| `README.md` | discard | v1 README replaced by v2 README.md |
| `config/abathur.jsonc` | discard | not part of the v2 runtime or evidence surface |
| `config/env-contract.jsonc` | discard | not part of the v2 runtime or evidence surface |
| `config/genome-paths.jsonc` | discard | not part of the v2 runtime or evidence surface |
| `config/genomes/historian.example.jsonc` | discard | not part of the v2 runtime or evidence surface |
| `docs/AGENTISM.md` | discard | v1 documentation; v2 docs rewritten from scratch |
| `docs/AUDIT-PROMOTIONS-20261103.md` | discard | v1 documentation; v2 docs rewritten from scratch |
| `docs/BORDER-EVIDENCE-PUBLICATION-v3.md` | discard | v1 documentation; v2 docs rewritten from scratch |
| `docs/EXTERNAL-SUPERVISION-CASE.md` | discard | v1 documentation; v2 docs rewritten from scratch |
| `docs/INCIDENT-20261103-FOREIGN-COMMITS-ADJUDICATION.md` | discard | v1 documentation; v2 docs rewritten from scratch |
| `docs/INCIDENT-20261103-foreign-commits.md` | discard | v1 documentation; v2 docs rewritten from scratch |
| `docs/PLAN-TEMPLATE.md` | discard | v1 documentation; v2 docs rewritten from scratch |
| `docs/PROMOTION-DECISION-MEMO-20261101.md` | discard | v1 documentation; v2 docs rewritten from scratch |
| `docs/REPAIR-PLAN-20261031.md` | discard | v1 documentation; v2 docs rewritten from scratch |
| `docs/REPORT-20261103-OWNER.md` | discard | v1 documentation; v2 docs rewritten from scratch |
| `docs/border-rule-defects-20261101.md` | discard | v1 documentation; v2 docs rewritten from scratch |
| `docs/claims/G71-SR4-68-item-defect-claim.md` | discard | v1 documentation; v2 docs rewritten from scratch |
| `docs/claims/evidence/G71-SR4-68-prefix-s3.txt` | discard | v1 documentation; v2 docs rewritten from scratch |
| `docs/federation.md` | discard | v1 documentation; v2 docs rewritten from scratch |
| `docs/immutable-kernel.md` | discard | v1 documentation; v2 docs rewritten from scratch |
| `docs/release/CHECKLIST.md` | discard | v1 documentation; v2 docs rewritten from scratch |
| `docs/release/README.md` | discard | v1 documentation; v2 docs rewritten from scratch |
| `docs/release/TEMPLATE.md` | discard | v1 documentation; v2 docs rewritten from scratch |
| `docs/release/v0.2.7.md` | discard | v1 documentation; v2 docs rewritten from scratch |
| `docs/release/v0.2.8.md` | discard | v1 documentation; v2 docs rewritten from scratch |
| `docs/release/v0.3.0.md` | discard | v1 documentation; v2 docs rewritten from scratch |
| `docs/release/v0.4.0.md` | discard | v1 documentation; v2 docs rewritten from scratch |
| `docs/release/v0.4.1.md` | discard | v1 documentation; v2 docs rewritten from scratch |
| `evidence/G65/ARCHIVE-MANIFEST.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G65/BUNDLE.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G65/NOMINATION.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G65/SHA256SUMS` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G65/SR4-64/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G65/SR4-64/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G65/SR4-64/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G65/SR4-64/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G65/SR4-69/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G65/SR4-69/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G65/SR4-69/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G65/SR4-69/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G65/bundle.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/ARCHIVE-MANIFEST.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/BUNDLE.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/NOMINATION.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/SHA256SUMS` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/SR4-64/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/SR4-64/judge-work/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/SR4-64/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/SR4-64/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/SR4-64/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.handwritten-2026-10-31T083133Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T083319Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T083645Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T083756Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T120400Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T121211Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T121252Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T121318Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T121351Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T122723Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T122756Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T122836Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T122928Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T123613Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T123628Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T124404Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T124443Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T124507Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T124532Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T124603Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T125240Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T125321Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T130117Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T130148Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T130217Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T133647Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T133727Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T134803Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T134845Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T135859Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/NOMINATION.previous-2026-10-31T144134Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/dispositions.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/facts.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/gate.txt` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/mustfix.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/_nomination/probes-last.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G66/bundle.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G67/APPROVAL.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G67/ARCHIVE-MANIFEST.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G67/BUNDLE.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G67/NOMINATION.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G67/SHA256SUMS` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G67/SR4-64/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G67/SR4-64/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G67/SR4-64/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G67/SR4-64/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G67/SR4-69/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G67/SR4-69/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G67/SR4-69/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G67/SR4-69/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G67/_nomination/NOMINATION.previous-2026-10-31T153123Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G67/_nomination/NOMINATION.previous-2026-10-31T154159Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G67/_nomination/NOMINATION.previous-2026-10-31T155326Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G67/_nomination/NOMINATION.previous-2026-10-31T161150Z.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G67/_nomination/gate.txt` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G67/_nomination/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G67/_nomination/mustfix.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G67/_nomination/probes-last.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G67/bundle.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G67/zerotrust/SR4-64.compare.crossfamily.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G67/zerotrust/SR4-64.compare.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G67/zerotrust/SR4-69.compare.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G68/APPROVAL.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G68/ARCHIVE-MANIFEST.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G68/BUNDLE.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G68/SHA256SUMS` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G68/SR4-65/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G68/SR4-65/judge-work/session.txt` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G68/SR4-65/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G68/SR4-65/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G68/SR4-65/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G68/SR4-70/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G68/SR4-70/judge-work/session.txt` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G68/SR4-70/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G68/SR4-70/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G68/SR4-70/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G68/bundle.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G71/ARCHIVE-MANIFEST.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G71/BUNDLE.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G71/SHA256SUMS` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G71/SR4-52/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G71/SR4-52/judge-work/session.txt` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G71/SR4-52/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G71/SR4-52/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G71/SR4-52/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G71/SR4-68/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G71/SR4-68/judge-work/session.txt` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G71/SR4-68/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G71/SR4-68/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G71/SR4-68/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G71/bundle.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G72/APPROVAL.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G72/ARCHIVE-MANIFEST.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G72/BUNDLE.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G72/SHA256SUMS` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G72/SR4-52/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G72/SR4-52/judge-work/session.txt` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G72/SR4-52/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G72/SR4-52/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G72/SR4-52/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G72/SR4-68/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G72/SR4-68/judge-work/session.txt` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G72/SR4-68/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G72/SR4-68/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G72/SR4-68/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G72/bundle.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G73/ARCHIVE-MANIFEST.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G73/BUNDLE.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G73/MANIFEST.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G73/SHA256SUMS` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G73/SR4-56/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G73/SR4-56/judge-work/session.txt` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G73/SR4-56/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G73/SR4-56/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G73/SR4-56/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G73/SR4-68/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G73/SR4-68/judge-work/session.txt` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G73/SR4-68/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G73/SR4-68/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G73/SR4-68/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G73/bundle.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G75/ARCHIVE-MANIFEST.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G75/BUNDLE.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G75/MANIFEST.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G75/SHA256SUMS` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G75/SR4-64/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G75/SR4-64/judge-work/session.txt` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G75/SR4-64/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G75/SR4-64/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G75/SR4-64/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G75/SR4-69/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G75/SR4-69/judge-work/session.txt` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G75/SR4-69/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G75/SR4-69/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G75/SR4-69/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G75/bundle.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G77/ARCHIVE-MANIFEST.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G77/BUNDLE.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G77/MANIFEST.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G77/SHA256SUMS` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G77/SR4-64/candidate_state.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G77/SR4-64/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G77/SR4-64/judge-work/session.txt` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G77/SR4-64/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G77/SR4-64/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G77/SR4-64/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G77/SR4-69/candidate_state.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G77/SR4-69/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G77/SR4-69/judge-work/session.txt` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G77/SR4-69/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G77/SR4-69/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G77/SR4-69/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G77/bundle.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G78/ARCHIVE-MANIFEST.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G78/BUNDLE.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G78/MANIFEST.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G78/SHA256SUMS` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G78/SR4-64/candidate_state.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G78/SR4-64/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G78/SR4-64/judge-work/session.txt` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G78/SR4-64/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G78/SR4-64/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G78/SR4-64/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G78/SR4-69/candidate_state.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G78/SR4-69/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G78/SR4-69/judge-work/session.txt` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G78/SR4-69/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G78/SR4-69/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G78/SR4-69/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G78/bundle.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G79/ARCHIVE-MANIFEST.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G79/BUNDLE.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G79/MANIFEST.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G79/SHA256SUMS` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G79/SR4-52/candidate_state.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G79/SR4-52/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G79/SR4-52/judge-work/session.txt` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G79/SR4-52/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G79/SR4-52/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G79/SR4-52/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G79/SR4-64/candidate_state.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G79/SR4-64/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G79/SR4-64/judge-work/session.txt` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G79/SR4-64/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G79/SR4-64/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G79/SR4-64/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G79/bundle.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G80/ARCHIVE-MANIFEST.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G80/BUNDLE.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G80/MANIFEST.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G80/SHA256SUMS` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G80/SR4-56/candidate_state.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G80/SR4-56/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G80/SR4-56/judge-work/session.txt` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G80/SR4-56/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G80/SR4-56/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G80/SR4-56/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G80/SR4-64/candidate_state.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G80/SR4-64/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G80/SR4-64/judge-work/session.txt` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G80/SR4-64/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G80/SR4-64/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G80/SR4-64/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G80/bundle.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G81/ARCHIVE-MANIFEST.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G81/BUNDLE.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G81/MANIFEST.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G81/SHA256SUMS` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G81/SR4-65/candidate_state.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G81/SR4-65/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G81/SR4-65/judge-work/session.txt` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G81/SR4-65/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G81/SR4-65/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G81/SR4-65/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G81/SR4-68/candidate_state.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G81/SR4-68/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G81/SR4-68/judge-work/session.txt` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G81/SR4-68/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G81/SR4-68/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G81/SR4-68/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G81/bundle.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G82/ARCHIVE-MANIFEST.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G82/BUNDLE.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G82/MANIFEST.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G82/SHA256SUMS` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G82/SR4-62/candidate_state.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G82/SR4-62/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G82/SR4-62/judge-work/session.txt` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G82/SR4-62/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G82/SR4-62/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G82/SR4-62/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G82/SR4-63/candidate_state.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G82/SR4-63/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G82/SR4-63/judge-work/session.txt` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G82/SR4-63/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G82/SR4-63/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G82/SR4-63/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G82/bundle.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G83/ARCHIVE-MANIFEST.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G83/BUNDLE.md` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G83/MANIFEST.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G83/SHA256SUMS` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G83/SR4-62/candidate_state.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G83/SR4-62/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G83/SR4-62/judge-work/session.txt` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G83/SR4-62/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G83/SR4-62/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G83/SR4-62/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G83/SR4-64/candidate_state.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G83/SR4-64/disk_probe.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G83/SR4-64/judge-work/session.txt` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G83/SR4-64/manifest.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G83/SR4-64/transcript.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G83/SR4-64/verdict.json` | discard | not part of the v2 runtime or evidence surface |
| `evidence/G83/bundle.json` | discard | not part of the v2 runtime or evidence surface |
| `genomes/abathur-self.jsonc` | discard | not part of the v2 runtime or evidence surface |
| `genomes/toy-smoke/genome.jsonc` | discard | not part of the v2 runtime or evidence surface |
| `genomes/toy-smoke/grader.mjs` | discard | not part of the v2 runtime or evidence surface |
| `genomes/toy-smoke/init.mjs` | discard | not part of the v2 runtime or evidence surface |
| `genomes/toy-smoke/units/add.mjs` | discard | not part of the v2 runtime or evidence surface |
| `genomes/toy-smoke/units/explode.mjs` | discard | not part of the v2 runtime or evidence surface |
| `genomes/toy-smoke/units/hang.mjs` | discard | not part of the v2 runtime or evidence surface |
| `genomes/toy-smoke/units/mul.mjs` | discard | not part of the v2 runtime or evidence surface |
| `genomes/toy-smoke/units/mutate.mjs` | discard | not part of the v2 runtime or evidence surface |
| `genomes/toy-smoke/units/sub.mjs` | discard | not part of the v2 runtime or evidence surface |
| `handoffs/ABATHUR-DEFECT-post-mutation-readback-20261004.md` | discard | not part of the v2 runtime or evidence surface |
| `handoffs/GRADERS-MIGRATION-pcb-agent.md` | discard | not part of the v2 runtime or evidence surface |
| `handoffs/HANDOFF-20261004-window-close.md` | discard | not part of the v2 runtime or evidence surface |
| `handoffs/HANDOFF-20261016-session-close.md` | discard | not part of the v2 runtime or evidence surface |
| `handoffs/HANDOFF-20261019-env-law-and-evolution.md` | discard | not part of the v2 runtime or evidence surface |
| `handoffs/HANDOFF-20261023-session-close.md` | discard | not part of the v2 runtime or evidence surface |
| `handoffs/HANDOFF-20261028-session-close.md` | discard | not part of the v2 runtime or evidence surface |
| `handoffs/HANDOFF-20261103-session-residual.md` | discard | not part of the v2 runtime or evidence surface |
| `handoffs/HANDOFF-BORDER-20261101-rule-class3-false-positives.md` | discard | not part of the v2 runtime or evidence surface |
| `handoffs/INFRA-anchor-evidence-per-generation-20261103.md` | discard | not part of the v2 runtime or evidence surface |
| `loop/HYGIENE.md` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/_rebuild_status.md` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/anchor_law.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/assertions.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/bank.py` | rewrite | exam/bank.mjs |
| `loop/bell_anchor_kill.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/bell_hgf_five.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/bell_sr4_65.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/bell_sr4_66.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/bell_sr4_68.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/budget.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/bundle_close.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/canary_of_canary.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/clean_run.py` | rewrite | exam/spawn.mjs + kernel/hygiene |
| `loop/constitution_g1.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g10.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g11.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g12.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g13.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g14.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g15.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g16.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g17.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g18.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g19.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g2.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g20.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g21.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g22.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g23.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g24.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g25.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g26.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g27.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g28.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g29.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g30.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g4.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g5.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g6.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g8.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/constitution_g9.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/coverage.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/draw.py` | rewrite | exam/draw.mjs |
| `loop/engine_receipts.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/fixtures/anchor/chainlib.sh` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/fixtures/anchor/stamp.sh` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/g12b-instruments-draft.md` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/git_identity_check.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/harvest_gen.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/instrument_defects.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/item_defects.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/ledger_audit.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/ledger_job.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/looplib.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/next_id.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/nominate.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/nomination_manifest.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/plan_check.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/plant_sr4_64_can.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/plant_sr4_67_can.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/plant_sr4_69_can.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/plant_sr4_70_can.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/prescribe.sh` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/probes/double_run_gatecheck.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/probes/double_run_report_check.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/promotion_record.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/proposals/ai-uid-separation-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/ai-uid-separation-v10-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/ai-uid-separation-v11-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/ai-uid-separation-v12-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/ai-uid-separation-v13-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/ai-uid-separation-v14-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/ai-uid-separation-v15-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/ai-uid-separation-v16-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/ai-uid-separation-v17-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/ai-uid-separation-v2-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/ai-uid-separation-v3-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/ai-uid-separation-v4-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/ai-uid-separation-v5-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/ai-uid-separation-v6-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/ai-uid-separation-v7-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/ai-uid-separation-v8-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/ai-uid-separation-v9-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/charter-amendment-20261004-v2.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/charter-amendment-20261004-v3.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/charter-amendment-20261004.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/charter-disposition-table.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/coupling-triage-and-capability-coverage-20261019.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/engine-engines-decision-20261023.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/engine-ops-incident-units-20261022.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/env-boundary-evolution-20260925.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/env-segregation-law-draft.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/exam-queue-substrate-20261031.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/four-isolation-law-draft.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/g10-exam-packet.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/g10-memory-diff.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/g11-memory-diff.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/g12-consolidated.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/g12-memory-diff.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/g12-nomination.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/g12-pcr.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/g12b-instruments-draft.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/g15-obligations-draft.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/g19-KNOWLEDGE-FROZEN.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/g19-ledger-first-diff.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/g2-memory-diff.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/g20-exam-diff.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/g28-memory-diff.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/g30-memory-diff.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/g38-memory-diff.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/g39-memory-diff.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/g4-memory-diff.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/g40-memory-diff.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/g41-memory-diff.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/g47-memory-diff.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/g5-memory-diff.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/g6-memory-diff.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/g65-clause-draft.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/g8-memory-diff.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/g9-memory-diff.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/handoff-gate-self-service-20261002.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/incident-scope-containment-20261030.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/instrument-defect-channel-20261102-v2.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/instrument-defect-channel-20261102.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/instrument-defects-legacy-audit-20261102-v2.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/instrument-defects-legacy-audit-20261102-v3.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/instrument-defects-legacy-audit-20261102.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/mcp-residual-options-20261030.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/next-round-scope-20260925.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/per-project-sandbox-20261030.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/planning-capability-design-20261022.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/plugin-tier1-design-20261020.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/portable-sandbox-tiering-20261030.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/readme-workflow-standard-draft-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/receipt-fragmentation-review-20261030.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/release-tree-isolation-diff.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/sandbox-rebuild-plan-20261030.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/sandbox-rebuild-plan-v10-20261030.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/sandbox-rebuild-plan-v11-20261030.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/sandbox-rebuild-plan-v12-20261030.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/sandbox-rebuild-plan-v15-20261030.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/sandbox-rebuild-plan-v2-20261030.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/sandbox-rebuild-plan-v3-20261030.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/sandbox-rebuild-plan-v4-20261030.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/sandbox-rebuild-plan-v5-20261030.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/sandbox-rebuild-plan-v6-20261030.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/sandbox-rebuild-plan-v7-20261030.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/sandbox-rebuild-plan-v8-20261030.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/sandbox-rebuild-plan-v9-20261030.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/self-evolution-subject-doctrine-20261030.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/spawn-completion-receipt-design-20261023.md` | rewrite | exam/spawn.mjs + kernel/hygiene |
| `loop/proposals/spawn-completion-receipt-plan-20261023.md` | rewrite | exam/spawn.mjs + kernel/hygiene |
| `loop/proposals/sr4-47-draft.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/sr4-50-live-plainness-audit.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/sr4-51-cross-seat-handoff-executability.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/sr4-59-handoff-contract-preflight.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/sr4-62-ledger-quoting-hygiene.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/sr4-64-66-supervision-trio.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/ste100-historian-diff.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/tool-surface-sandbox-d-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/tool-surface-sandbox-d-v10-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/tool-surface-sandbox-d-v11-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/tool-surface-sandbox-d-v12-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/tool-surface-sandbox-d-v2-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/tool-surface-sandbox-d-v3-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/tool-surface-sandbox-d-v4-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/tool-surface-sandbox-d-v5-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/tool-surface-sandbox-d-v6-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/tool-surface-sandbox-d-v7-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/tool-surface-sandbox-d-v8-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/tool-surface-sandbox-d-v9-20261024.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/toolkit-testing-design-v2-20261023.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/toolkit-testing-design-v3-20261023.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/toolkit-testing-design-v4-20261023.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/toolkit-testing-design-v5-20261023.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/toolkit-testing-design-v6-20261023.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/toolkit-testing-design-v7-20261023.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/toolkit-testing-design-v8-20261023.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/toolkit-testing-design-v9-final-20261023.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/proposals/toolkit-testing-research-brief-20261023.md` | discard | v1 exam governance history; v2 rules/registry.yaml is the authority |
| `loop/query_state.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/recompute_sr465_backlog.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/recurrence.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/recurrence_classes.json` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/report_check.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/rerun_zero_trust.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/run_candidate.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/run_check.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/run_judge.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/run_registry.py` | rewrite | exam/spawn.mjs + kernel/hygiene |
| `loop/seat_ledger.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/seed_item.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/sweep.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/test_bank_contract.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/test_boundary_scan.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/test_clean_run.py` | rewrite | exam/spawn.mjs + kernel/hygiene |
| `loop/test_instrument_defects.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/test_item_defects.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/test_jail_tmp.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/test_recurrence.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `loop/verify_nomination_literals.py` | discard | v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence |
| `package.json` | rewrite | v2 package metadata (zero runtime dependencies) |
| `plugin/abathur-command.md` | discard | not part of the v2 runtime or evidence surface |
| `plugin/abathur.ts` | discard | not part of the v2 runtime or evidence surface |
| `release/notes/RELEASE-NOTES.md` | discard | not part of the v2 runtime or evidence surface |
| `scripts/anchor-head-check.sh` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/audit-promotions.py` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/audit-rounds.py` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/backtest-acceptance.mjs` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/border-findings-agg.py` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/c-face-smoke.sh` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/cage-selfcheck.sh` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/check-citations.py` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/check-engine-version.sh` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/check-foreign-commits.py` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/check-frozen-a.sh` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/check-mcp-integrity.sh` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/check-sandbox-binding.sh` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/check-strict-install.sh` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/copy-assets.mjs` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/copy-similarity.py` | discard | W0 instrument stays in the main tree and is dispatched by path, not copied |
| `scripts/discover-tools.mjs` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/exam-queue.py` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/fixtures/copy-similarity/comments-strings-rewritten/v1/a.js` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/fixtures/copy-similarity/comments-strings-rewritten/v2/b.js` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/fixtures/copy-similarity/control-rewrite/v1/a.py` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/fixtures/copy-similarity/control-rewrite/v2/a.py` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/fixtures/copy-similarity/prepended-unrelated/v1/a.py` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/fixtures/copy-similarity/prepended-unrelated/v2/a.py` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/fixtures/copy-similarity/renamed-reordered/v1/alpha.py` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/fixtures/copy-similarity/renamed-reordered/v2/beta.py` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/fixtures/copy-similarity/same-content-different-path/v1/lib/alpha.py` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/fixtures/copy-similarity/same-content-different-path/v2/src/beta.py` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/gen-engine-registry.mjs` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/gen-foreign-adjudication.py` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/git-hooks/pre-commit` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/git-hooks/pre-push` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/install-isolation.sh` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/install-sandbox.sh` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/launcher` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/longrun.sh` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/pack-gate.sh` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/plain-watch.py` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/plugins/cage-lifecycle.mjs` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/plugins/cage-lifecycle.test.mjs` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/plugins/sandbox-bash.js` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/plugins/sandbox-policy.json` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/plugins/sandbox-tools.js` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/port-exec-audit.sh` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/probe.sh` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/promotion-inventory.py` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/publish-evidence.py` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/publish-precheck.sh` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/release-lease.sh` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/release-prep.sh` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/sandbox-blast-radius.mjs` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/sandbox-exec` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/scan-hardlinks.sh` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/scan-machine-names.py` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/systemd/abathur-exam-queue.service` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/test_rule2_fixtures.py` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/toolkit-exec.sh` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/toolkit-test.py` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `scripts/verify-all.sh` | discard | v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline) |
| `selfbench/expected.json` | discard | not part of the v2 runtime or evidence surface |
| `selfbench/replay.mjs` | discard | not part of the v2 runtime or evidence surface |
| `skills/abathur-loop/SKILL.md` | discard | v1 skill manuals replaced by v2 README + docs |
| `skills/abathur-plan/SKILL.md` | discard | v1 skill manuals replaced by v2 README + docs |
| `skills/abathur-plan/plan-seg-check.mjs` | discard | v1 skill manuals replaced by v2 README + docs |
| `src/bench/adapter.ts` | rewrite | exam/ adapters (candidate/judge channels) |
| `src/bench/fixture-probe.ts` | rewrite | exam/ adapters (candidate/judge channels) |
| `src/bench/fixture-support.ts` | rewrite | exam/ adapters (candidate/judge channels) |
| `src/bench/fixture.ts` | rewrite | exam/ adapters (candidate/judge channels) |
| `src/bench/toy.ts` | rewrite | exam/ adapters (candidate/judge channels) |
| `src/cli.ts` | rewrite | kernel/ or cli/ interface |
| `src/commands/bundle.ts` | rewrite | cli/abathur-v2.mjs |
| `src/commands/genome.ts` | rewrite | cli/abathur-v2.mjs |
| `src/commands/graft.ts` | rewrite | cli/abathur-v2.mjs |
| `src/commands/init.ts` | rewrite | cli/abathur-v2.mjs |
| `src/commands/kernel.ts` | rewrite | cli/abathur-v2.mjs |
| `src/commands/opencode.ts` | rewrite | cli/abathur-v2.mjs |
| `src/commands/promote.ts` | rewrite | cli/abathur-v2.mjs |
| `src/commands/readjudicate.ts` | rewrite | cli/abathur-v2.mjs |
| `src/commands/retract.ts` | rewrite | cli/abathur-v2.mjs |
| `src/commands/run.ts` | rewrite | cli/abathur-v2.mjs |
| `src/commands/self-eval.ts` | rewrite | cli/abathur-v2.mjs |
| `src/commands/status.ts` | rewrite | cli/abathur-v2.mjs |
| `src/commands/tombstone.ts` | rewrite | cli/abathur-v2.mjs |
| `src/config.ts` | rewrite | kernel/ or cli/ interface |
| `src/core/bundle-common.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/bundle-export.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/bundle-inspect.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/bundle-manifest.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/bundle-mask.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/bundle-tar.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/bundle.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/campaign-lock.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/evolve/brief.ts` | rewrite | kernel/planning/ (plan lifecycle) |
| `src/core/evolve/candidate.ts` | rewrite | kernel/planning/ (plan lifecycle) |
| `src/core/evolve/child-track.ts` | rewrite | kernel/planning/ (plan lifecycle) |
| `src/core/evolve/friction.ts` | rewrite | kernel/planning/ (plan lifecycle) |
| `src/core/evolve/reflect.ts` | rewrite | kernel/planning/ (plan lifecycle) |
| `src/core/evolve/run-bench.ts` | rewrite | kernel/planning/ (plan lifecycle) |
| `src/core/evolve/run-friction.ts` | rewrite | kernel/planning/ (plan lifecycle) |
| `src/core/evolve/run-loop.ts` | rewrite | kernel/planning/ (plan lifecycle) |
| `src/core/evolve/run-plan.ts` | rewrite | kernel/planning/ (plan lifecycle) |
| `src/core/evolve/run-rows.ts` | rewrite | kernel/planning/ (plan lifecycle) |
| `src/core/evolve/score-bank.ts` | rewrite | kernel/planning/ (plan lifecycle) |
| `src/core/evolve/self-overlay.ts` | rewrite | kernel/planning/ (plan lifecycle) |
| `src/core/evolve/self-snapshot.ts` | rewrite | kernel/planning/ (plan lifecycle) |
| `src/core/evolve/stub-mutators.d.mts` | rewrite | kernel/planning/ (plan lifecycle) |
| `src/core/evolve/stub-mutators.mjs` | rewrite | kernel/planning/ (plan lifecycle) |
| `src/core/evolve/udiff.ts` | rewrite | kernel/planning/ (plan lifecycle) |
| `src/core/genome-paths.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/genome.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/glob.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/graft-gates.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/graft-rebench.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/graft-support.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/graft.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/ids.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/incumbent.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/install-probe.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/kernel.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/ledger.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/locks.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/promote.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/readjudicate.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/retract.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/snapshot.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/spec.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/stats-math.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/stats-pareto.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/stats.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/surfaces.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/core/worktree.ts` | rewrite | kernel/ modules by concern (identity, evidence, judge, gate, surface, lane) |
| `src/exit.ts` | rewrite | kernel/ or cli/ interface |
| `src/jsonc.ts` | rewrite | kernel/ or cli/ interface |
| `src/out.ts` | rewrite | kernel/ or cli/ interface |
| `src/test/bench-adapter.test.ts` | rewrite | test/*.test.mjs |
| `src/test/bench-fixture.test.ts` | rewrite | test/*.test.mjs |
| `src/test/bench-reporoot.test.ts` | rewrite | test/*.test.mjs |
| `src/test/bench-toy.test.ts` | rewrite | test/*.test.mjs |
| `src/test/bundle.test.ts` | rewrite | test/*.test.mjs |
| `src/test/campaign-lock.test.ts` | rewrite | test/*.test.mjs |
| `src/test/config.test.ts` | rewrite | test/*.test.mjs |
| `src/test/d7-gate.test.ts` | rewrite | test/*.test.mjs |
| `src/test/docs-currency.test.ts` | rewrite | test/*.test.mjs |
| `src/test/engine-registry.test.ts` | rewrite | test/*.test.mjs |
| `src/test/fixture-loop.test.ts` | rewrite | test/*.test.mjs |
| `src/test/fixtures-historian.js` | rewrite | test/*.test.mjs |
| `src/test/fixtures-self.ts` | rewrite | test/*.test.mjs |
| `src/test/fixtures-wt.ts` | rewrite | test/*.test.mjs |
| `src/test/fixtures/friction-writer.ts` | rewrite | test/*.test.mjs |
| `src/test/friction.test.ts` | rewrite | test/*.test.mjs |
| `src/test/genome.test.ts` | rewrite | test/*.test.mjs |
| `src/test/git.test.ts` | rewrite | test/*.test.mjs |
| `src/test/graft.test.ts` | rewrite | test/*.test.mjs |
| `src/test/historian-genome.test.ts` | rewrite | test/*.test.mjs |
| `src/test/ids.test.ts` | rewrite | test/*.test.mjs |
| `src/test/include-val.test.ts` | rewrite | test/*.test.mjs |
| `src/test/init-and-probe.test.ts` | rewrite | test/*.test.mjs |
| `src/test/install-contracts.test.ts` | rewrite | test/*.test.mjs |
| `src/test/ledger-lock.test.ts` | rewrite | test/*.test.mjs |
| `src/test/ledger.test.ts` | rewrite | test/*.test.mjs |
| `src/test/opencode.test.ts` | rewrite | test/*.test.mjs |
| `src/test/plan-skill.test.ts` | rewrite | test/*.test.mjs |
| `src/test/plugin-tier1.test.ts` | rewrite | test/*.test.mjs |
| `src/test/promote.test.ts` | rewrite | test/*.test.mjs |
| `src/test/readjudicate.test.ts` | rewrite | test/*.test.mjs |
| `src/test/reflect.test.ts` | rewrite | test/*.test.mjs |
| `src/test/release-contracts.test.ts` | rewrite | test/*.test.mjs |
| `src/test/repopath-seams.test.ts` | rewrite | test/*.test.mjs |
| `src/test/resume-scope.test.ts` | rewrite | test/*.test.mjs |
| `src/test/run-loop.test.ts` | rewrite | test/*.test.mjs |
| `src/test/score-bank.test.ts` | rewrite | test/*.test.mjs |
| `src/test/seam-gates.test.ts` | rewrite | test/*.test.mjs |
| `src/test/self-snapshot.test.ts` | rewrite | test/*.test.mjs |
| `src/test/selfmode-literal.test.ts` | rewrite | test/*.test.mjs |
| `src/test/snapshot.test.ts` | rewrite | test/*.test.mjs |
| `src/test/stats-acceptance.test.ts` | rewrite | test/*.test.mjs |
| `src/test/stats.test.ts` | rewrite | test/*.test.mjs |
| `src/test/status-repo.test.ts` | rewrite | test/*.test.mjs |
| `src/test/stub-mutators.test.ts` | rewrite | test/*.test.mjs |
| `src/test/testutil.ts` | rewrite | test/*.test.mjs |
| `src/test/version.test.ts` | rewrite | test/*.test.mjs |
| `src/test/worktree.test.ts` | rewrite | test/*.test.mjs |
| `src/util/freeze.ts` | rewrite | shared helpers inlined into the owning kernel module |
| `src/util/git.ts` | rewrite | shared helpers inlined into the owning kernel module |
| `src/version.ts` | rewrite | kernel/ or cli/ interface |
| `tsconfig.json` | discard | not part of the v2 runtime or evidence surface |
| `tsconfig.plugin.json` | discard | not part of the v2 runtime or evidence surface |
