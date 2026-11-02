#!/usr/bin/env bash
# chainlib.sh — 哈希链条目解析/重算的唯一权威来源(L-SINGLE-SOURCE), stamp.sh/verify.sh 共同 source。
# 条目体(body)= 以 `ts: ` 行起始、到下一个 `ts: ` 前的连续行; self 哈希 = sha256(printf '%s' body去尾部换行)。
# v1(无 schema 行, 6 行)与 v2(schema: v2, 7 行)body 均可精确重算——已用真实链上数据验证。

# 输出全部 body 块, 块间以单个 \x02 分隔(跳过 `## stamp` 头行——头不入哈希)。
chain_bodies() {
  [ -s "$1" ] || return 0
  awk '
    BEGIN { first = 1 }
    /^## stamp / { next }
    /^ts: / { if (!first) printf "\002"; first = 0; printf "%s\n", $0; next }
    !first { printf "%s\n", $0 }
  ' "$1"
}

chain_body_count() {
  chain_bodies "$1" | awk 'BEGIN { RS="\002" } NF { n++ } END { print n + 0 }'
}

# $2=索引(0=最新)。命令替换自动剥尾部换行 → 规范 body 文本。
chain_body_at() {
  chain_bodies "$1" | awk -v i="$2" 'BEGIN { RS="\002" } NR == i + 1 { printf "%s", $0 }'
}

chain_self_at() {
  printf '%s' "$(chain_body_at "$1" "$2")" | sha256sum | cut -d' ' -f1
}

# history 按时间先后追加(oldest-first), 而 chain.md 展示需 newest-first——重建历史尾时倒序输出。
# (v2 修复中发现的兄弟伤: v1 的 `cat 新条目 history` 在 ≥2 条历史时顺序颠倒, 真链首盖当场暴露。)
chain_blocks_reversed() {
  chain_bodies "$1" | awk 'BEGIN { RS="\002" } NF { a[++n] = $0 } END { for (i = n; i >= 1; i--) printf "%s\n", a[i] }'
}
