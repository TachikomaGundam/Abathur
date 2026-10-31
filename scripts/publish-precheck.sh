#!/bin/sh
# publish-precheck.sh —— 发布前检查的第一顺位：调度本机边检（border），不自造检查。
#
# 依据：AGENTS.md「L-DISPATCH-BEFORE-BUILD」。有既有机具而亲自动手 = 越权代办；
# 无机具或无机具配置时，必须问机主，不得自行发明一套"差不多"的检查。
#
# 退出码：0 = 边检通过；1 = 边检拒绝（附输出）；2 = 无法调度（缺机具或缺配置）
set -u

REPO=$(cd "$(dirname "$0")/.." && pwd)
BORDER=/home/lab/workspace/harness/border/dist/index.js
CONFIG="${ABATHUR_BORDER_CONFIG:-}"

if [ -z "$CONFIG" ]; then
  for cand in "$REPO/.border.jsonc" "$REPO/.border.json" "$HOME/.config/border/config.jsonc"; do
    if [ -f "$cand" ]; then CONFIG="$cand"; break; fi
  done
fi

if [ ! -f "$BORDER" ]; then
  echo "PRECHECK UNDISPATCHABLE reason=no-border-binary expected=$BORDER"
  echo "PRECHECK QUESTION=本机边检不可用；请裁定：安装/修复边检，还是另建新制？"
  exit 2
fi

if [ -z "$CONFIG" ] || [ ! -f "$CONFIG" ]; then
  echo "PRECHECK UNDISPATCHABLE reason=no-border-config looked=$REPO/.border.jsonc,$HOME/.config/border/config.jsonc"
  echo "PRECHECK QUESTION=边检存在但本仓无配置；请裁定：以哪份 config 为准（给出绝对路径），还是另建新制？"
  exit 2
fi

OUT=$(mktemp /tmp/publish-precheck.XXXXXX)
node "$BORDER" check --config "$CONFIG" >"$OUT" 2>&1
RC=$?
echo "PRECHECK-DISPATCHED tool=border config=$CONFIG rc=$RC"
tail -n 6 "$OUT"
rm -f "$OUT"
exit "$RC"
