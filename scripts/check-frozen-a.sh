#!/bin/bash
# check-frozen-a.sh — R-ISO 落地项 1：A 面冻结比对
# 语义：装机树包体文件与黄金 manifest 逐文件比对 + 依赖闭包聚合值比对 + 脚本自哈希对账。
# 出口：0=一致；1=漂移/缺件/自哈希失配（fail-closed）。
# 黄金 manifest 现状=advisory 级（座席可写面，人类带外《发布底价 v1》建立前不称硬锚）。
set -u
PKG_ROOT="${1:-$HOME/.npm-global/lib/node_modules/@tachikomagundam/abathur}"
MANIFEST="${2:-/home/lab/workspace/harness/Abathur/.omo/evidence/golden-manifest-0.4.0.txt}"
SELF_ANCHOR="${3:-/home/lab/workspace/harness/Abathur/.omo/evidence/check-frozen-a.sha256}"
export LC_ALL=C
FIND=/usr/bin/find; SORT=/usr/bin/sort; XARGS=/usr/bin/xargs; SHA=/usr/bin/sha256sum; GREP=/usr/bin/grep

fail() { echo "CHECK-FROZEN-A FAIL: $1" >&2; exit 1; }

# 0. 自哈希对账（A⑥ 验收闭环：脚本自身被改→非零退出）
[ -f "$SELF_ANCHOR" ] || fail "self-anchor absent: $SELF_ANCHOR"
SELF_ACTUAL=$($SHA "$0" | /usr/bin/awk '{print $1}')
SELF_EXPECT=$(/usr/bin/awk '{print $1}' "$SELF_ANCHOR")
[ "$SELF_ACTUAL" = "$SELF_EXPECT" ] || fail "self-hash mismatch (actual=$SELF_ACTUAL expect=$SELF_EXPECT)"

# 1. manifest 存在性
[ -f "$MANIFEST" ] || fail "golden manifest absent: $MANIFEST"
[ -d "$PKG_ROOT" ] || fail "package root absent: $PKG_ROOT"

# 2. 依赖闭包聚合比对
EXPECT_AGG=$($GREP '^DEP-TREE-AGGREGATE ' "$MANIFEST" | /usr/bin/awk '{print $2}')
[ -n "$EXPECT_AGG" ] || fail "manifest lacks DEP-TREE-AGGREGATE"
ACTUAL_AGG=$(cd "$PKG_ROOT" && $FIND ./node_modules -type f -print0 | $SORT -z | $XARGS -0 $SHA | $SHA | /usr/bin/awk '{print $1}')
[ "$ACTUAL_AGG" = "$EXPECT_AGG" ] || fail "dep-tree aggregate drift (actual=$ACTUAL_AGG expect=$EXPECT_AGG)"

# 3. 包体逐文件比对
$GREP -E '^[0-9a-f]{64}  \./' "$MANIFEST" > /tmp/.check-frozen-a-expect.$$ || fail "manifest parse"
EXPECT_N=$(/usr/bin/wc -l < /tmp/.check-frozen-a-expect.$$)
(cd "$PKG_ROOT" && $FIND . -type f -not -path './node_modules/*' -print0 | $SORT -z | $XARGS -0 $SHA) > /tmp/.check-frozen-a-actual.$$ \
  || { /usr/bin/rm -f /tmp/.check-frozen-a-expect.$$ /tmp/.check-frozen-a-actual.$$; fail "walk package root"; }
/usr/bin/diff /tmp/.check-frozen-a-expect.$$ /tmp/.check-frozen-a-actual.$$ > /tmp/.check-frozen-a-diff.$$ \
  || { echo "CHECK-FROZEN-A FAIL: package-file drift ($EXPECT_N expected):" >&2; /usr/bin/head -20 /tmp/.check-frozen-a-diff.$$ >&2; /usr/bin/rm -f /tmp/.check-frozen-a-*.$$; exit 1; }
/usr/bin/rm -f /tmp/.check-frozen-a-expect.$$ /tmp/.check-frozen-a-actual.$$ /tmp/.check-frozen-a-diff.$$
echo "CHECK-FROZEN-A PASS: pkg-files=$EXPECT_N dep-agg=$ACTUAL_AGG"
exit 0
