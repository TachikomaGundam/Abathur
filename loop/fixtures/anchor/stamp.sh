#!/usr/bin/env bash
# 外锚盖章器(P17①③/A6): 追加式哈希链账本, 锚定门配置/宪法/权威面摘要。远端只收 append, 禁 force-push。
# v2 (2026-10-05): 修复 prev 断链伤——v1 读最新条目的 `prev:` 字段(恒为 GENESIS), 链从未接上。
#   v2: prev = 上一枚 body 的重算 self(经 chainlib, 头行缺失也成立); body 打 `schema: v2` 界行;
#   预检四输入文件(缺失 exit 2 且零写入); tmp 带 trap 清理; 头/体共用同一 date 实读时刻。
#   v1 旧条目原样留在盘上(append-only 不毁史), 链接强制只从 v2 界起, verify 如实报 legacy。
set -euo pipefail

# ---- v3 (2026-10-12, owner ruling 『做』): ledger-append subcommand ----------------
# 落账唯一正确路径: 草稿先成文仵, 工具按字节流追加, 内容不经 shell 展开。
# 占位符 TIMESTAMP_NOW 由工具填系统时钟; 写后读回末行 + 前后哈希(flock 串行化)。
if [ "${1:-}" = "ledger-append" ]; then
  cd "$(dirname "$0")"
  TEXT_FILE=""
  while [ $# -gt 1 ]; do
    case "$2" in --text-file) TEXT_FILE="$3"; shift 2;; *) shift;; esac
  done
  [ -n "$TEXT_FILE" ] && [ -f "$TEXT_FILE" ] || { echo "LEDGER-APPEND(2): 缺 --text-file 或文件不在"; exit 2; }
  LED="${ANCHOR_LEDGER:?LEDGER-APPEND(2): 须显式设置 ANCHOR_LEDGER（落账目标绝对路径，跨仓不猜）}"
  [ -f "$LED" ] || { echo "LEDGER-APPEND(2): 账本不在 $LED"; exit 2; }
  TS=$(date -u +%FT%TZ)
  TMPD="entry.$$"
  trap 'rm -f "$TMPD"' EXIT
  sed "s/TIMESTAMP_NOW/$TS/" "$TEXT_FILE" > "$TMPD"
  [ -s "$LED" ] && printf '\n' >> "$TMPD"
  BEFORE=$(sha256sum "$LED" | cut -d' ' -f1)
  BEFORE_BYTES=$(wc -c < "$LED")
  exec 9>>"$LED"
  flock -x 9
  cat "$TMPD" >&9
  sync 9 2>/dev/null || true
  exec 9>&-
  AFTER=$(sha256sum "$LED" | cut -d' ' -f1)
  # 回执走不可截断通道: 追加 .g82-receipts.jsonl 到 <账本目录>/.g82-receipts.jsonl(同行文件系, ANCHOR_LEDGER 变则随迁)
  TARGET=$(tail -c +"$((BEFORE_BYTES + 1))" "$LED" | sha256sum | cut -d' ' -f1)
  PAYLOAD=$(sha256sum "$TMPD" | cut -d' ' -f1)
  AFTER_BYTES=$(wc -c < "$LED")
  { printf '{"ts":"%s","before":"%s","after":"%s","before_bytes":%s,"after_bytes":%s,"target_sha256":"%s","payload_sha256":"%s"}\n' "$TS" "$BEFORE" "$AFTER" "$BEFORE_BYTES" "$AFTER_BYTES" "$TARGET" "$PAYLOAD"; } >> "$(dirname "$LED")/.g82-receipts.jsonl"
  LASTLINE=$(tail -n 1 "$LED")
  FIRSTLINE=$(tail -n 1 "$TMPD")
  case "$FIRSTLINE" in
    *"$LASTLINE"*|"$LASTLINE"*) ;;
    *) echo "LEDGER-APPEND(1): 读回不匹配 — last: $LASTLINE"; exit 1;;
  esac
  echo "LEDGER-APPEND-OK ts=$TS before=${BEFORE:0:12} after=${AFTER:0:12} lines=$(wc -l < "$TMPD")"
  exit 0
fi
# ----------------------------------------------------------------------------------------------
# 部署家（XDG 数据家约定；首跑自建=新设备部署语义；跨平台名称见部署注记）
ANCHOR_HOME_DIR="${ANCHOR_HOME:-${ABATHUR_HOME:-$HOME/.local/share/abathur}/anchor}"
mkdir -p "$ANCHOR_HOME_DIR"
# shellcheck source=chainlib.sh
source "$(dirname "$0")/chainlib.sh"

BORDER_F="${ANCHOR_BORDER:-/home/lab/workspace/harness/Abathur/.omo/border.yaml}"
AGENTS_F="${ANCHOR_AGENTS:-/home/lab/.config/opencode/AGENTS.md}"
LEDGER_F="${ANCHOR_LEDGER:-/home/lab/workspace/harness/Abathur/.omo/evidence/INTENT-LEDGER.md}"
CHARTER_F="${ANCHOR_CHARTER:-/home/lab/workspace/harness/Abathur/loop/proposals/charter-amendment-20261004-v3.md}"

for f in "$BORDER_F" "$AGENTS_F" "$LEDGER_F" "$CHARTER_F"; do
  [ -f "$f" ] || { echo "PREFLIGHT-RED(2): 输入缺失: $f"; exit 2; }
done

F="$ANCHOR_HOME_DIR/chain.md"
PREV=""
if [ -s "$F" ]; then PREV=$(chain_self_at "$F" 0 || true); fi
[ -n "$PREV" ] || PREV=GENESIS
TS=$(date -u +%FT%TZ)
B=$(sha256sum "$BORDER_F" | cut -d' ' -f1)
A=$(sha256sum "$AGENTS_F" | cut -d' ' -f1)
L=$(tail -c 65536 "$LEDGER_F" | sha256sum | cut -d' ' -f1)
V=$(sha256sum "$CHARTER_F" | cut -d' ' -f1)
BODY="ts: $TS
prev: $PREV
schema: v2
border.yaml: $B
AGENTS.md: $A
ledger-tail: $L
charter-v3: $V"
NEW=$(printf '%s' "$BODY" | sha256sum | cut -d' ' -f1)

TMPF="tmp.$$"
trap 'rm -f "$TMPF"' EXIT
{ echo "## stamp $TS self: $NEW"; echo "$BODY"; echo; } > "$TMPF"
# 链文件=最新戳记头+全部历史(append-only 段追加在下方); 历史尾倒序展示(newest-first)
test -f $F.history || touch $F.history
{ cat "$TMPF"; chain_blocks_reversed "$F.history"; } > "$F"
echo "$BODY" >> $F.history
echo "STAMPED prev=$PREV self=$NEW"
