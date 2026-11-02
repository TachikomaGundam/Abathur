#!/bin/sh
# anchor-head-check.sh — compare the local anchor-chain head with the hourly
# recon record (out-of-band witness in the nightly log). Read-only.
#
# WHY: the chain file lives in the seat's own uid space, so "the head is what I
# say it is" proves nothing on its own. The hourly cron job records the head it
# read (after reconciling the published page) in nightly.log. This probe
# compares the two places.
#
# Comparison semantics: nightly RECON lines store the head as a TRUNCATED
# prefix (e.g. "self=451ef5d3b10f…"), so this is a prefix match.
#
#   rc=0  ANCHOR-HEAD OK        recon prefix matches chain head prefix
#   rc=1  ANCHOR-HEAD MISMATCH  differs (copy/tamper detector for 1-byte edits)
#   rc=2  ANCHOR-HEAD UNKNOWN   file unreadable / field missing
#
# Usage (HOST shell — the anchor dir is not visible inside the bwrap cage):
#   sh scripts/anchor-head-check.sh
#   ABATHUR_ANCHOR_CHAIN=/tmp/copy.md sh scripts/anchor-head-check.sh   # negative test
#
# RESIDUAL RISK (disclosed, not closed): chain, log and wiki page are all
# reachable by the same uid. This catches drift and naive tampering; it is not a
# defence against an adversary holding same-uid write plus wiki write.
set -u

CHAIN="${ABATHUR_ANCHOR_CHAIN:-$HOME/.local/share/abathur/anchor/chain.md}"
LOG="${ABATHUR_ANCHOR_LOG:-$HOME/.local/share/abathur/anchor/nightly.log}"

[ -r "$CHAIN" ] || { echo "ANCHOR-HEAD UNKNOWN chain-unreadable=$CHAIN"; exit 2; }
[ -r "$LOG" ] || { echo "ANCHOR-HEAD UNKNOWN log-unreadable=$LOG"; exit 2; }

head_self=$(grep -m1 -o 'self: [0-9a-f][0-9a-f]*' "$CHAIN" | sed 's/^self: //')
recon_self=$(grep 'RECON-OK' "$LOG" | tail -1 | grep -o 'self=[0-9a-f][0-9a-f]*' | tail -1 | sed 's/^self=//')

[ -n "$head_self" ] || { echo "ANCHOR-HEAD UNKNOWN no-self-in-chain"; exit 2; }
[ -n "$recon_self" ] || { echo "ANCHOR-HEAD UNKNOWN no-recon-ok-line"; exit 2; }

case "$head_self" in
  "$recon_self"*)
    echo "ANCHOR-HEAD OK head=$head_self recon-prefix=$recon_self"
    exit 0
    ;;
esac

echo "ANCHOR-HEAD MISMATCH head=$head_self recon-prefix=$recon_self"
exit 1
