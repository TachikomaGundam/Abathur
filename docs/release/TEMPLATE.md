# Release receipt <version>
Fill from the REAL gate run; this file is the wheel-ticket checked by
scripts/git-hooks/pre-push on every refs/tags/v* push.

gate: PASS
packet: <sha of the release commit>
border-findings: <N finding(s), 0 blocking — verbatim tail line>
lease: <who>  (must match ~/.config/abathur/release-lease.json)
tests: <npm test line, e.g. 551 pass / 0 fail>
date-utc: <YYYY-MM-DDTHH:MM:SSZ from `date -u`, never from memory>
