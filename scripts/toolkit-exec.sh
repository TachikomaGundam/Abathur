#!/usr/bin/env bash
# toolkit-exec.sh — 工具包测试沙箱执行器（v9 附录 A：bwrap 白名单挂载首日钉死）
# 用法: toolkit-exec.sh <dest> <cmd> [args...]（dest=沙箱内写面，自动 --bind）
# 不变量: 净断网(--unshare-net 无 --share-net 形)/文件级 1-bind/--tmpfs /home(剪断宿主 home)/主调进程外零写面/收尸 --unshare-pid --die-with-parent
set -euo pipefail
die() { echo "TOOLKIT-EXEC-ERROR: $*" >&2; exit 1; }
(( $# >= 2 )) || die "usage: toolkit-exec.sh <dest> <cmd> [args...]"
DEST=$1; shift
command -v bwrap >/dev/null 2>&1 || die "bwrap absent"
# —— 硬闸 0: 装配自证——生成的 CONF 中 --die-with-parent 恰出现一次（收尸语义防回插）——
# —— 硬闸 1: 调用方禁再传挂载/网络选项（全由本脚本注入）；执行参数绝对路径须存在于宿主 ——
CMD=""; i=0
for a in "$@"; do i=$((i+1)); case "$a" in --*) die "mount/net option passthrough forbidden: $a";; *) if [[ -z "$CMD" ]]; then CMD=$a; else [[ "$a" == /* && ! -e "$a" ]] && die "abs arg absent on host: $a"; fi;; esac; done
# —— 硬闸 2: 净断网终态闸（拒绝含 --share-net 形状的 CONF，含 --chdir 相对路径穿越）——
CONF=$(mktemp); trap 'rm -f "$CONF"' EXIT
{
  printf '%s\n' '--unshare-all' '--die-with-parent' '--new-session'
  printf '%s\n' '--ro-bind' '/' '/'
  printf '%s\n' '--tmpfs' '/dev/shm'
  printf '%s\n' '--tmpfs' '/home'
  printf '%s\n' '--tmpfs' '/tmp'
  printf '%s\n' '--bind' "$DEST" "$DEST"
  printf '%s\n' '--chdir' "$DEST"
  printf '%s\n' '--setenv' 'TMPDIR' "$DEST"
  printf '%s\n' '--' "$@"
} > "$CONF"
[[ $(grep -c '^--die-with-parent$' "$CONF") -eq 1 ]] || die "assembly self-check: --die-with-parent count != 1"
while IFS= read -r line; do
  case "$line" in *--share-net*|*--bind\ /home*|*--chdir\ ..*) die "conf closure violation: $line";; esac
done < "$CONF"
# —— 文件级 1-bind 注入: <max 组件数的绝对路径操作数 --bind 自身>（symlink 逃逸判据=realpath 后组件数>dest；两侧均须先 realpath 再比组件数，否则 src-dir 为 symlink 时误报缺 1-bind）——
OPTS=(); max=0
while IFS= read -r norm; do
  n=$(awk -v p="$norm" 'BEGIN{gsub("[^/]","",p);print length(p)}'); (( n > max )) && max=$n
done < <(for p in "$@"; do [[ "$p" == /* ]] || continue; LC_ALL=C realpath -m -- "$p" 2>/dev/null || true; done | LC_ALL=C sort -u)
if [[ $max -eq 0 ]]; then
  true
else
for p in "$@"; do [[ "$p" == /* ]] || continue
  norm=$(LC_ALL=C realpath -m -- "$p" 2>/dev/null) || continue
  np=$(awk -v p="$norm" 'BEGIN{gsub("[^/]","",p);print length(p)}')
  if [[ "$np" -lt "$max" ]]; then
    dest_norm=$(LC_ALL=C realpath -m -- "$DEST" 2>/dev/null) || dest_norm=$DEST
    nd=$(awk -v p="$dest_norm" 'BEGIN{gsub("[^/]","",p);print length(p)}')
    (( nd >= np )) || die "operand $norm lacks --bind (depth $np vs dest $nd)"
  fi
done
fi
# 最深的 1 个（=max 组件数）文件级 bind；与 dest 同深的由 dest 目录 bind 覆盖
deepest=""
while IFS= read -r norm; do
  n=$(awk -v p="$norm" 'BEGIN{gsub("[^/]","",p);print length(p)}')
  if [[ "$n" -eq "$max" ]]; then deepest=$norm; fi
done < <(for p in "$@"; do [[ "$p" == /* ]] || continue; LC_ALL=C realpath -m -- "$p" 2>/dev/null || true; done | LC_ALL=C sort -u)
if [[ -n "$deepest" && "$deepest" != "$DEST" ]]; then
  case "$deepest" in /home/*|/tmp/*|/dev/shm/*) OPTS+=(--dir "$(dirname "$deepest")");; esac
  OPTS+=(--bind "$deepest" "$deepest")
fi
# —— 装配执行（CONF 仅供闸校验；实际 argv 显式书写）——
exec bwrap --unshare-all --die-with-parent --new-session \
  --ro-bind / / --tmpfs /dev/shm --tmpfs /home --tmpfs /tmp \
  --bind "$DEST" "$DEST" \
  ${OPTS[@]+"${OPTS[@]}"} \
  --chdir "$DEST" --setenv TMPDIR "$DEST" \
  -- "$@"
