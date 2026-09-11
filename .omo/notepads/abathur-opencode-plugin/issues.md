
## 2026-09-11 orchestrator finding: internal main vs public branch IDENTITY DRIFT
- package.json on main: name "abathur" v0.1.0→0.2.0; the scoped rename (57724ff), 0.1.1 bump + README scoped-path fix (482cd82) and CHANGELOG 0.1.1 block exist ONLY on branch public.
- Hazards: (a) naive main→public sync reverts npm name to unscoped `abathur` → publish would target the disputed bare name; (b) README quickstart on main still `$(npm root -g)/abathur`; (c) CHANGELOG missing 0.1.1 on main.
- Resolution adopted: task 2 worker FIRST aligns identity on main (scoped name + 0.1.1 retro block + README scoped paths, verified commit on main), THEN syncs → public. From now on main is the single source of truth for package.json identity fields.

## 2026-09-11 task-2 receipt: 0.2.0 RELEASED — drift eliminated, dual-branch pipeline closed
- Step 0 (main, default identity): commit 426b121 — package.json name @tachikomagundam/abathur (+author/repository/bugs/homepage adopted from public so main is single source of truth for identity fields; version kept 0.2.0, files list kept [...,plugin]), README en+zh quick-start mirrors 482cd82 exactly (registry line, tachikomagundam-abathur-0.1.0.tgz, scoped ABATHUR_PKG x2), CHANGELOG 0.1.1 block backfilled verbatim from 482cd82. Build+test 305/305 green on main.
- Step 1: worktree /tmp/abathur-release-020 from branch public; sync = git archive of ALL main tracked top-level entries except .omo (public's .github/ workflows preserved — CI infra exists only on public by design); commit 71a27ec, author+committer TachikomaGundam via env vars. Tracked-tree proof: ls-tree -r blob hashes main∖.omo == public∖.github byte-identical.
- Step 2 leak gate: 0 hits for wiki@sumteclab|sumteclab|\.omo (content + git ls-tree + pack --dry-run; the 3 'omo' pack grep hits = prom-O-MO-te substrings). '/home/lab' hits are ONLY the pre-existing D7 forbidden-needle fixtures src/test/d7-gate.test.ts (shipped public since 8cf71eb) + README's gate-doc regex quote + worktree .git gitdir pointer file; new src/test/opencode.test.ts:26 is the same sanctioned needle category. Judgment: proceed — no NEW leak; gate-as-written can never be empty on this codebase (documented deviation).
- Step 3: push origin public:main fast-forward 482cd82..71a27ec; CI run 34584591276 completed/success (~2 min, no bench flake).
- Step 4: annotated tag v0.2.0 on 71a27ec, tagger TachikomaGundam (env vars); pushed. Publish run 34584835010 completed/success — npm publish --provenance via OIDC, + @tachikomagundam/abathur@0.2.0, shasum c8225d8fe452cd2d77207c53e8af7728d1151304, Sigstore logIndex 2792113608. No ENEEDAUTH.
- Step 5 registry: pre-publish 404 confirmed (npm#8544 risk cleared); version doc 200 w/ dist.tarball; abbreviated meta dist-tags.latest=0.2.0 AND versions['0.2.0'].dist.attestations present (slsa provenance/v1); tarball HEAD 200.
- Cleanup: worktree removed+pruned, probe dirs deleted, v0.1.1 tag untouched. Remaining public history: 8cf71eb → 57724ff → 482cd82 → 71a27ec (v0.2.0). Next: task 3 hands-on acceptance (global upgrade 0.2.0 + plugin load proof), task 4 wiki card flip.

## 2026-09-11 task-5 CODE receipt: 0.2.1 remediation landed on main (release pending)
- Scope done: allowlist 8 (promote/tombstone terminal-only, description-states-bash-privilege honestly),
  run-timeout note re detached children, command.md says refused-by-tool + terminal-only,
  installer: assets-hoisted-before-validation, write-loop foreign re-check (TOCTOU), shared lstat
  dir/symlink refusal (exit 2, named). Marker + package.json bumped to 0.2.1 together; CHANGELOG
  0.2.1 block framed as F1 outcome; README en+zh rewritten to eight commands + honest privilege sentence.
- Proof: build+tsc green; node --test 307/307 pass 0 fail (305 + 2 new guard tests: directory-dest,
  symlink-dest); grep plugin/abathur.ts shows promote/tombstone only in prose; scratch plugin
  typecheck clean (skipLibCheck); D7 needles clean in src/ (outside test fixtures) + plugin/;
  real ~/.config/opencode untouched — still the 0.2.0 marker (upgrade = release step, not this worker).
- NOT done (by design): no push, no tag v0.2.1, no publish, branch public untouched. Next worker:
  release pipeline public-sync → CI → tag → OIDC publish.

## 2026-09-11 receipt: 0.2.1 RELEASED (pipeline second pass, zero deviations)
- Pre-check: main 47dec32, pkg 0.2.1 scoped, marker v0.2.1; registry 0.2.1=404, latest=0.2.0.
- Step 1: worktree /tmp/abathur-release-021 from public(71a27ec); archive-sync of main except .omo, .github/ preserved; commit fe38691 A/C=TachikomaGundam 'release: 0.2.1 — human gates terminal-only, installer hardening'; ls-tree blob-hash proof main∖.omo == public∖.github OK.
- Step 2: leak gate vs established baseline — zero NEW hits (only sanctioned FORBIDDEN_NEEDLES in opencode.test.ts:26 + d7-gate.test.ts + README gate-regex quotes + worktree .git pointer); zero sumteclab/.omo paths (content, tree, pack). npm ci+build+test 307/307; pack = tachikomagundam-abathur-0.2.1.tgz with plugin/abathur.ts + plugin/abathur-command.md, zero .omo.
- Step 3: push FF 71a27ec..fe38691; CI run 34589048752 completed/success (~2 min, no bench flake, no re-run).
- Step 4: tag v0.2.1 = 7575920038af411132dafdeb0cbdac004d694969 on fe38691, tagger TachikomaGundam; Publish run 34589265687 completed/success — shasum 330b7dcc40db14f3406562b3102d27d932f32816, Sigstore logIndex 2792485022, no ENEEDAUTH.
- Step 5: version doc 200 (shasum matches CI); abbreviated latest=0.2.1 + attestations slsa provenance/v1 non-empty; tarball HEAD 200.
- Cleanup: worktree removed+pruned. Public history: 8cf71eb → 57724ff → 482cd82 → 71a27ec (v0.2.0) → fe38691 (v0.2.1).
