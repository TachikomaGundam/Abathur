#!/bin/sh
# check-mcp-integrity.sh —— MCP 服务器字节对账（方案 D 的具名残余 R-D24 的检测闸）
# MCP 服务器由 oh-my-openagent 插件在 opencode 宿主进程内拉起，不走 bash 沙箱也不走 D1 策略。
# 这个脚本不改隔离，只保证「它们没被悄悄换掉」：基线写 /usr/local/lib/abathur/mcp.sha256。
# 用法：check-mcp-integrity.sh [--update]
set -u
PKG=${MCP_PKG:-/home/lab/.cache/opencode/packages/oh-my-openagent@latest/node_modules/oh-my-openagent}
BASE=${MCP_BASELINE:-/usr/local/lib/abathur/mcp.sha256}
[ -d "$PKG" ] || { echo "FAIL: 插件目录不存在：$PKG"; exit 2; }
TMP=$(mktemp /tmp/opencode/mcp-sha.XXXXXX) || exit 2
trap 'rm -f "$TMP"' EXIT INT TERM

# 只钉与 MCP 有关的文件：分发目录 + 打包入口 + 包版本
find "$PKG/dist/mcp" "$PKG/packages/lsp-tools-mcp/dist" "$PKG/packages/git-bash-mcp/dist" \
     -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' \) 2>/dev/null | LC_ALL=C sort | xargs -r sha256sum > "$TMP"
sha256sum "$PKG/package.json" >> "$TMP"

if [ "${1:-}" = "--update" ]; then
  install -m 644 "$TMP" "$BASE" 2>/dev/null || { echo "FAIL: 写不了基线 $BASE（根属主，需人类执行）"; exit 2; }
  echo "OK: 基线已更新 → $BASE（$(wc -l < "$BASE") 行）"
  exit 0
fi

[ -f "$BASE" ] || { echo "FAIL: 没有基线 $BASE（先由人类跑 --update）"; exit 2; }
if diff -q "$BASE" "$TMP" > /dev/null; then
  echo "OK: MCP 分发字节与基线一致（$(wc -l < "$TMP") 行）"
  exit 0
fi
echo "FAIL: MCP 分发字节与基线不一致 —— 下列差异："
diff "$BASE" "$TMP" | head -40
exit 1
