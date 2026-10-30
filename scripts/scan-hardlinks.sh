#!/usr/bin/env bash
# 扫描工作区内指向家目录秘密文件的硬链接（R-3 缓解，具名限制：只覆盖家目录已知秘密文件）
set -u
WS="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
SECRETS=".ssh .gnupg .npmrc .Xauthority .config/gh .local/share/keyrings"
tmp=$(mktemp); trap 'rm -f "$tmp"' EXIT
for s in $SECRETS; do
  [ -e "$HOME/$s" ] || continue
  find "$HOME/$s" -type f -print0 2>/dev/null | xargs -0 -r stat -c '%i' 2>/dev/null
done | sort -u > "$tmp"
[ -s "$tmp" ] || { echo "NO_SECRETS_FOUND"; exit 0; }
hits=$(find "$WS" -xdev -type f -links +1 -print0 2>/dev/null | xargs -0 -r stat -c '%i %n' 2>/dev/null | awk 'NR==FNR{a[$1];next} ($1 in a){print $2}')
if [ -n "$hits" ]; then echo "HARDLINK_HITS:"; echo "$hits"; exit 1; fi
echo "CLEAN"
