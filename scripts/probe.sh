#!/bin/sh
# probe.sh —— 对 longrun.sh 起的任务做一次短探针；必在 2 秒内返回，从不等待任务本身。
#
# 用法：scripts/probe.sh <名字>
# 退出码：0 运行中 / 10 成功结束 / 11 失败结束 / 12 找不到该任务 / 13 状态面损坏
#         14 僵死（进程已灭或心跳过期而状态仍为 running/starting）
#
# 两个独立信号（缺一不判活）：
#   hb_age_s        心跳年龄（包装器每 5 秒覆盖写）
#   progress_age_s  out.log 最近改动年龄（被监督进程是否还在产出）
# 「包装进程还在、子进程已死」这类静默僵尸，由 hb_age 超阈 + pid 检查一起判。
set -u

NAME="${1:-}"
[ "$NAME" = "" ] && { echo "usage: probe.sh <name>" >&2; exit 2; }
ROOT="${ABATHUR_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
DIR="${ABATHUR_LONGRUN_DIR:-$ROOT/.omo/longrun}/$NAME"
STATE="$DIR/state.json"
HB="$DIR/heartbeat"
OUT="$DIR/out.log"
STALE_S="${ABATHUR_STALE_S:-30}"

[ -f "$STATE" ] || { echo "PROBE name=$NAME status=unknown reason=no-state dir=$DIR"; exit 12; }

STATUS=$(sed -n 's/.*"status":"\([a-z]*\)".*/\1/p' "$STATE" | head -1)
PID=$(cat "$DIR/child.pid" 2>/dev/null || echo "")
[ -n "$PID" ] || PID=$(sed -n 's/.*"pid":\([0-9]*\).*/\1/p' "$STATE" | head -1)
[ -n "$STATUS" ] || { echo "PROBE name=$NAME status=unknown reason=bad-state"; exit 13; }

age_of() {
  f="$1"
  [ -f "$f" ] || { echo "none"; return; }
  ts=$(date -r "$f" +%s 2>/dev/null || echo "")
  case "$ts" in ''|*[!0-9]*) echo "none" ;; *) echo $(( $(date +%s) - ts )) ;; esac
}

HB_AGE="none"
if [ -f "$HB" ]; then
  HB_TS=$(cut -d' ' -f1 "$HB" 2>/dev/null)
  case "$HB_TS" in
    ''|*[!0-9]*) HB_AGE="none" ;;
    *) HB_AGE=$(( $(date +%s) - HB_TS )) ;;
  esac
fi
PROG_AGE=$(age_of "$OUT")
PID_ALIVE=no
case "$PID" in
  ''|*[!0-9]*) PID_ALIVE=no ;;
  *) [ -d "/proc/$PID" ] && PID_ALIVE=yes ;;
esac

echo "PROBE name=$NAME status=$STATUS pid=$PID pid_alive=$PID_ALIVE hb_age_s=$HB_AGE progress_age_s=$PROG_AGE state=$STATE"

case "$STATUS" in
  done) [ -f "$OUT" ] && tail -n 3 "$OUT" | sed 's/^/  out| /'; exit 10 ;;
  failed) [ -f "$OUT" ] && tail -n 3 "$OUT" | sed 's/^/  out| /'; exit 11 ;;
  starting|running)
    if [ "$PID_ALIVE" = "no" ] || { [ "$HB_AGE" != "none" ] && [ "$HB_AGE" -gt "$STALE_S" ]; }; then
      echo "  VERDICT=STALE pid_alive=$PID_ALIVE hb_age_s=$HB_AGE stale_after_s=$STALE_S"
      exit 14
    fi
    [ -f "$OUT" ] && tail -n 3 "$OUT" | sed 's/^/  out| /'
    exit 0 ;;
  *) exit 13 ;;
esac
