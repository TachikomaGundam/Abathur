#!/bin/sh
# longrun.sh —— 把长任务放到后台并留下可查的状态面；调用方立即返回，不做等待。
#
# 用法：scripts/longrun.sh <名字> -- <命令...>
# 状态面：${ABATHUR_LONGRUN_DIR:-.omo/longrun}/<名字>/
#   state.json    {name,pid,status,rc,started_at,ended_at,elapsed_s}
#   child.pid     被监督进程自己的 pid（由子进程首行写入，不依赖 setsid 的返回值）
#   heartbeat     每 5 秒覆盖写：<epoch> alive|gone
#   out.log       子进程 stdout/stderr
#   rc            子进程退出码（存在即已结束）
#
# 本脚本自身在 1 秒内返回；心跳由独立循环维护。观察者只读状态面。
set -u

NAME="${1:-}"
[ "$NAME" = "" ] && { echo "usage: longrun.sh <name> -- <cmd...>" >&2; exit 2; }
[ "${2:-}" = "--" ] || { echo "longrun.sh: expected '--' before the command" >&2; exit 2; }
shift 2
[ "$#" -gt 0 ] || { echo "longrun.sh: empty command" >&2; exit 2; }

ROOT="${ABATHUR_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
DIR="${ABATHUR_LONGRUN_DIR:-$ROOT/.omo/longrun}/$NAME"
mkdir -p "$DIR"
OUT="$DIR/out.log"
STATE="$DIR/state.json"
HB="$DIR/heartbeat"
PIDF="$DIR/child.pid"
RCF="$DIR/rc"
rm -f "$PIDF" "$RCF" "$HB"

: > "$OUT"
START=$(date +%s)
CMD_JSON=$(printf '%s' "$*" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/')
printf '{"name":"%s","started_at":"%s","pid":0,"cmd":%s,"status":"starting","rc":null,"ended_at":null,"elapsed_s":null}\n' \
  "$NAME" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$CMD_JSON" > "$STATE"

LR_OUT="$OUT" LR_RCF="$RCF" LR_PIDF="$PIDF" \
  setsid sh -c 'echo $$ > "$LR_PIDF"; "$@" >> "$LR_OUT" 2>&1; echo $? > "$LR_RCF"' sh "$@" &
echo "LONGRUN-STARTED name=$NAME state=$STATE"

(
  gone=0
  while [ ! -f "$RCF" ]; do
    if [ -f "$PIDF" ] && [ -d "/proc/$(cat "$PIDF" 2>/dev/null)" ]; then
      printf '%s alive\n' "$(date +%s)" > "$HB"
      gone=0
    else
      printf '%s gone\n' "$(date +%s)" > "$HB"
      gone=$((gone + 1))
      if [ "$gone" -ge 6 ]; then
        printf 'LONGRUN-NO-EXIT-CODE child vanished without writing rc\n' >&2
        echo 1 > "$RCF"
        break
      fi
    fi
    sleep 5
  done
  RC=$(cat "$RCF" 2>/dev/null || echo 1)
  END=$(date +%s)
  printf '%s gone\n' "$END" > "$HB"
  printf '{"name":"%s","started_at":null,"pid":%s,"cmd":%s,"status":"%s","rc":%s,"ended_at":"%s","elapsed_s":%s}\n' \
    "$NAME" "$(cat "$PIDF" 2>/dev/null || echo 0)" "$CMD_JSON" \
    "$([ "$RC" -eq 0 ] && echo done || echo failed)" "$RC" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$((END - START))" > "$STATE"
) >/dev/null 2>&1 &
echo "LONGRUN-WATCHER pid=$!"
exit 0
