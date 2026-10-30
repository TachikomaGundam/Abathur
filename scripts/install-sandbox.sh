#!/bin/sh
# install-sandbox.sh [--apply] [--with-xdg]
# 在任意设备上部署工具执行沙箱：sandbox-exec + launcher + 入口 + 配置目录。
# 默认只打印计划；--apply 才写。可重复执行（幂等）。
set -u
APPLY=0; WITHXDG=0
for a in "$@"; do case "$a" in --apply) APPLY=1;; --with-xdg) WITHXDG=1;; *) echo "未知参数 $a"; exit 2;; esac; done
SRC=$(cd "$(dirname "$0")" && pwd)
PREFIX=${ABATHUR_PREFIX:-/usr/local/lib/abathur}
ETC=${ABATHUR_ETC:-/etc/abathur}
BIN=/usr/local/bin/abathur-ai
OPENCODE=$(command -v opencode 2>/dev/null || true)
echo "计划："
echo "  沙箱执行器  $PREFIX/sandbox-exec         ← $SRC/sandbox-exec"
echo "  启动器      $PREFIX/launcher             ← $SRC/launcher"
echo "  命令入口    $BIN → $PREFIX/launcher"
echo "  配置目录    $ETC/{log-units.conf,opencode.sha256}"
[ "$WITHXDG" = 1 ] && echo "  配置快照    $PREFIX/xdg/opencode        ← ~/.config/opencode"
[ -n "$OPENCODE" ] && echo "  opencode    $OPENCODE（钉定其字节）"
echo
if [ "$APPLY" != 1 ]; then echo "这是预演。加 --apply 执行。"; exit 0; fi
[ "$(id -u)" -eq 0 ] || { echo "需要 root：sudo $0 $*"; exit 2; }
install -d -m 755 "$PREFIX" || exit 2
install -m 755 "$SRC/sandbox-exec" "$PREFIX/sandbox-exec" || exit 2
install -m 755 "$SRC/launcher" "$PREFIX/launcher" || exit 2
ln -sf "$PREFIX/launcher" "$BIN" || exit 2
install -d -m 755 "$ETC" || exit 2
if [ ! -f "$ETC/log-units.conf" ]; then
  printf "%s\n" dsv4-control.service qwen38-control.service llm-monitor.service gpu-fan-control.service > "$ETC/log-units.conf"
  chmod 644 "$ETC/log-units.conf"
fi
if [ -n "$OPENCODE" ]; then
  readlink -f "$OPENCODE" | xargs sha256sum | cut -d" " -f1 > "$ETC/opencode.sha256"
  chmod 644 "$ETC/opencode.sha256"
fi
if [ "$WITHXDG" = 1 ] && [ -d "$HOME/.config/opencode" ]; then
  install -d -m 755 "$PREFIX/xdg" || exit 2
  rm -rf "$PREFIX/xdg/opencode.new"; cp -a "$HOME/.config/opencode" "$PREFIX/xdg/opencode.new" || exit 2
  rm -rf "$PREFIX/xdg/opencode"; mv "$PREFIX/xdg/opencode.new" "$PREFIX/xdg/opencode"
  chown -R root:root "$PREFIX/xdg/opencode"; chmod -R a-w "$PREFIX/xdg/opencode"
fi
echo "完成。校验："
sha256sum "$PREFIX/sandbox-exec" "$PREFIX/launcher"
ls -l "$BIN"
