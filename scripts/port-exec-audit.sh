#!/usr/bin/env bash
# 开 host 档前的端口执行能力闸门：有「可执行」端口在用 = 禁止开 host 档。
# 判定依据固定表；未取证端口记 unknown（只告警，不阻断）。
set -u
EXEC_PORTS="22 3389 5432 5433"      # sshd / RDP / postgres(COPY PROGRAM)
PARTIAL_PORTS="2019"                # Caddy admin：可改写配置
list=$(ss -tlnH 2>/dev/null | awk '{print $4}' | sed 's/.*://' | grep -E '^[0-9]+$' | sort -un)
[ -n "$list" ] || { echo "AUDIT: cannot read listeners"; exit 2; }
blocked=0; partial=0; unknown=0; total=0
for p in $list; do
  total=$((total+1))
  case " $EXEC_PORTS " in *" $p "*) echo "PORT $p EXEC"; blocked=$((blocked+1)); continue;; esac
  case " $PARTIAL_PORTS " in *" $p "*) echo "PORT $p PARTIAL"; partial=$((partial+1)); continue;; esac
  case "$p" in 3000|8000|8010) echo "PORT $p NO";; *) echo "PORT $p UNKNOWN"; unknown=$((unknown+1));; esac
done
echo "SUMMARY total=$total exec=$blocked partial=$partial unknown=$unknown"
if [ "$blocked" -gt 0 ]; then echo "VERDICT BLOCKED"; exit 1; fi
echo "VERDICT OK"; exit 0
