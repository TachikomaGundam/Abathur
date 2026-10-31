#!/bin/sh
# cage-selfcheck.sh —— 在笼子内部跑，输出可机器判定的笼子身份（2026-10-31）
#
# 用途：伤单验收（「向该会话发一条 grep -c : /proc/net/dev 返回 >1 且
# ssh REDACTED-SSH-TARGET echo ok 通」）之前，先证明「自己在哪个笼子里」。
# 它不修任何东西：只把出生证据打出来，交给 cage-lifecycle.mjs 判定。
set -u

echo "cage_selfcheck_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "IFACES=$(grep -c ':' /proc/net/dev 2>/dev/null || echo 0)"
echo "UID_MAP_LINES=$(wc -l < /proc/self/uid_map 2>/dev/null || echo 0)"
echo "UID_MAP=$(tr '\n' ';' < /proc/self/uid_map 2>/dev/null || echo unknown)"
echo "SHELL_PID=$$"
echo "PID1=$(cat /proc/1/comm 2>/dev/null || echo unknown)"
echo "PPID_OF_SHELL=$(awk '{print $4}' /proc/$$/stat 2>/dev/null || echo unknown)"
echo "HOSTNAME=$(hostname 2>/dev/null || echo unknown)"
echo "MOUNTS_FINGERPRINT=$(awk '$3 ~ /abathur/ {print $2}' /proc/self/mountinfo 2>/dev/null | sed 's#/[^/]*$##' | sort -u | tr '\n' ';')"
CAGE="${CAGE_BORN_AT:-}"
LAUNCHER="${LAUNCHER_STARTED_AT:-}"
echo "CAGE_BORN_AT=${CAGE:-unset}"
echo "LAUNCHER_STARTED_AT=${LAUNCHER:-unset}"

# 判定（与 cage-lifecycle.mjs 同规则；此处给出人能直接读的一行）
if [ -z "$CAGE" ] || [ -z "$LAUNCHER" ]; then
  echo "VERDICT=UNKNOWN reason=missing_birth_time action=REBUILD"
  exit 1
fi
if [ "$CAGE" \< "$LAUNCHER" ]; then
  echo "VERDICT=DISCARDED reason=cage_born_before_launcher action=REBUILD"
  exit 1
fi
echo "VERDICT=FRESH action=REUSE"
exit 0
