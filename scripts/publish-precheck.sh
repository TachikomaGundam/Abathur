#!/bin/sh
# publish-precheck.sh —— 发布前检查的第一顺位：调度本机门检工具，不自造检查。
#
# 依据：AGENTS.md「L-DISPATCH-BEFORE-BUILD」与「L-MACHINE-LOCAL」。
# 本脚本不写死任何机具名称或路径：机具完全由环境变量提供，缺省即 fail-closed。
#   ABATHUR_GATE_CMD     门检工具可执行入口（必需，绝对路径）
#   ABATHUR_GATE_ARGS    入口前的参数（可选，按空白分词，如 "dist/index.js"）
#   ABATHUR_GATE_CONFIG  该机具的配置（可选；给出时作为 --config 传入）
#
# 退出码：0 = 门检通过；1 = 门检拒绝或报错；2 = 无法调度（机具/配置缺失或路径非法）
set -u

REPO=$(cd "$(dirname "$0")/.." && pwd)
GATE_CMD="${ABATHUR_GATE_CMD:-}"
GATE_ARGS="${ABATHUR_GATE_ARGS:-}"
GATE_CONFIG="${ABATHUR_GATE_CONFIG:-}"

if [ -z "$GATE_CMD" ]; then
  echo "PRECHECK UNDISPATCHABLE reason=no-gate-tool-configured"
  echo "PRECHECK NOTE=ABATHUR_GATE_CMD is unset; this script refuses to invent a check"
  if [ -f "$REPO/scripts/discover-tools.mjs" ] && command -v node >/dev/null 2>&1; then
    echo "PRECHECK DISCOVERY candidates (not auto-selected; a human must register one):"
    node "$REPO/scripts/discover-tools.mjs" --capability gate.publish 2>&1 | sed 's/^/  discover| /'
  fi
  exit 2
fi

case "$GATE_CMD" in
  /*) ;;
  *) echo "PRECHECK UNDISPATCHABLE reason=gate-tool-not-absolute got=$GATE_CMD"; exit 2 ;;
esac

if [ ! -e "$GATE_CMD" ]; then
  echo "PRECHECK UNDISPATCHABLE reason=gate-tool-missing path=$GATE_CMD"
  echo "PRECHECK QUESTION=本机门检工具不可用；请裁定：修复/安装，还是另建新制？"
  exit 2
fi

if [ -n "$GATE_CONFIG" ] && [ ! -f "$GATE_CONFIG" ]; then
  echo "PRECHECK UNDISPATCHABLE reason=gate-config-missing path=$GATE_CONFIG"
  echo "PRECHECK QUESTION=机具存在但配置缺失；请裁定：以哪份配置为准（绝对路径），还是另建新制？"
  exit 2
fi

OUT=$(mktemp /tmp/publish-precheck.XXXXXX)
# shellcheck disable=SC2086
(cd "$REPO" && "$GATE_CMD" $GATE_ARGS check ${GATE_CONFIG:+--config "$GATE_CONFIG"}) >"$OUT" 2>&1
RC=$?
echo "PRECHECK-DISPATCHED tool=$GATE_CMD args=${GATE_ARGS:-<none>} config=${GATE_CONFIG:-<none>} rc=$RC"
tail -n 20 "$OUT"
rm -f "$OUT"
if [ "$RC" -ne 0 ]; then exit 1; fi
exit 0
