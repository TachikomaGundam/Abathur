#!/usr/bin/env bash
# flight-watch: 主动回报守护（治"机主要不停回来查进度"）
# 职责: 1) 每分钟扫引擎飞行日志, DONE 即写一行带完整UTC时间戳的判词到 INBOX
#       2) 维护 STATUS.md (当前飞行/阶段/心跳), 机主随时 cat 一眼即知
#       3) 有 notify-send 且 DISPLAY 在场时补桌面通知
# 读法: cat /home/lab/workspace/harness/PCB-Agent/.omo/reports/STATUS.md
INBOX=/home/lab/workspace/harness/PCB-Agent/.omo/reports/INBOX.log
STATUS=/home/lab/workspace/harness/PCB-Agent/.omo/reports/STATUS.md
mkdir -p "$(dirname "$INBOX")"
seen=""
last_beat=0
while true; do
  for L in /tmp/engine-run-f*.log; do
    [ -f "$L" ] || continue
    if tail -2 "$L" 2>/dev/null | grep -q DONE; then
      key="$L:$(stat -c %Y "$L")"
      case " $seen " in *" $key "*) ;; *)
        seen="$seen $key"
        ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
        verdict=$(grep -oE "(nominated|culled|inconclusive|indeterminate)[^~]{0,40}" "$L" | tail -1)
        echo "[$ts] FLIGHT DONE: $(basename "$L") — ${verdict:-见日志}" >> "$INBOX"
        [ -n "$DISPLAY" ] && command -v notify-send >/dev/null && notify-send "PCB进化" "$(basename "$L") 收线: ${verdict:-done}" 2>/dev/null
        ;;
      esac
    fi
  done
  now=$(date +%s)
  if [ $(( now - last_beat )) -ge 600 ]; then
    last_beat=$now
    ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    live=$(ps -eo etime,args | grep "[a]bathur run" | head -1 | awk '{print $1}')
    arena=$(ls -dt /tmp/r20-arena-* 2>/dev/null | head -1 | sed 's/.*arena-//;s/r20-arena-//')
    curlog=$(ls -t /tmp/engine-run-f*.log 2>/dev/null | head -1)
    gen=$(ls -dt /home/lab/.cache/abathur/worktrees/*/g-* 2>/dev/null | head -1 | xargs -r basename)
    {
      echo "# PCB 进化飞行状态 (自动生成, 每10分钟心跳)"
      echo "- 更新: $ts"
      echo "- 引擎进程: ${live:-无(收线或未飞)}"
      echo "- 当前日志: ${curlog:-无}"
      echo "- 活跃考场: ${arena:-无}"
      echo "- 最新世代: ${gen:-无}"
      echo "- 最近判词: $(tail -1 "$INBOX" 2>/dev/null)"
    } > "$STATUS"
  fi
  sleep 60
done
