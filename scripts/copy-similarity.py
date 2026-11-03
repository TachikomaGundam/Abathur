#!/usr/bin/env python3
"""copy-similarity.py — 反整拷机械闸（W0 交付；必须在宿主通道运行）。

为什么必须宿主运行：v2 工作副本 `/home/lab/workspace/harness/Abathur-v2` 不在座席沙箱
的可见面内。本工具在 v2 不可见/不是 git 仓库/文件集为空时一律输出 rc=2（cannot-answer），
**绝不以空集当通过**。

判定面：
  1. 逐对相似度（主判据）：对每个 v1 文本文件，取它在全部 v2 文本文件中最大的
     unigram 多重集 Jaccard 相似度；≥ 阈值（默认 0.80）且无有效 CARRY-OVERRIDES 条目 → 失败。
  2. 字节同一（硬判据）：v1 文件 git blob 哈希出现在 v2 集合中，且无有效 override →
     失败（即使标注为「重写」）。
  3. 前缀/包装拷贝（辅助硬判据）：v1 文件的有序 5-gram 多重集被单个 v2 文件覆盖 ≥ 0.80
     （且 v1 token 数 ≥ 15）且无 override → 失败；该判据抓「无关代码前置 + 原函数整体搬运」。
  4. CARRY-OVERRIDES 配额：条目 ≤ 3 且 ≤ v2 文件数的 10%；每条须含独立审回执
     （`APPROVE` + `INDEPENDENT` + `sibyl-<ts>-<hex>` 或 `ses_<id>`）与条目文本 sha256。

归一化政策（与交接件 §2 步骤 2 第 2 条对齐，并记录一处尺伤修正）：
  - 代码文件（.py/.js/.mjs/.cjs/.ts/.tsx/.jsx/.sh/.go/.rs）：剥离 `#`、`//`、`/* */`
    注释与字符串字面量；标识符归一为单一标记 `ID`；保留数字与标点。
  - 散文/数据文件（.md/.txt/.json/.yaml/.yml/.toml）：不剥注释、不做 ID 归一；
    取小写词 token（保持语义，避免「任意两篇英文」都被判成拷贝）。
  - 尺伤记录：交接件字面的「v1 文件对 v2 全部文件并集算 containment」在本机实测
    对任意两篇不同代码也接近 1.0（并集覆盖了所有通用标点与 `ID`），无法判别；
    故主判据改为逐对最大 Jaccard，并以有序 5-gram 包含度补抓前缀/包装拷贝。
    四枚必拦夹具 + 一枚对照夹具是本工具的行为权威判据（`--selftest`）。

CARRY-OVERRIDES 条目格式（写在 v2 的 docs/CARRY-OVERRIDES.md）：
  - `<v1 相对路径>` | reason: <为何不是重写> | receipt: sibyl-<ts>-<hex> APPROVE INDEPENDENT | text_sha256: <hex>
  行内必须同时出现 APPROVE、INDEPENDENT、一个 sibyl 运行号或引擎会话号、以及条目文本哈希。

用法：
  python3 scripts/copy-similarity.py [--v1 DIR] [--v2 DIR] [--overrides FILE]
                                     [--threshold 0.80] [--allow-plain] [--selftest]

退出码：0 通过；1 有违禁拷贝；2 无法回答（环境不满足）。
"""

from __future__ import annotations

import argparse
import hashlib
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

CODE_EXTS = {".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".sh", ".go", ".rs"}
SKIP_NAMES = {"package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"}
SKIP_DIR_PARTS = {".git", "node_modules", "dist", "build", ".omo", "__pycache__", ".venv", "venv"}
BINARY_EXTS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".tgz",
    ".tar", ".woff", ".woff2", ".ttf", ".otf", ".mp4", ".mp3", ".wav", ".wasm", ".node",
}
TOKEN_RE = re.compile(r"[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*|\d+(?:\.\d+)?|\S")
WORD_RE = re.compile(r"[a-z0-9_]+|[^\sA-Za-z0-9_]")


def strip_code_noise(text: str) -> str:
    out: list[str] = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            j = text.find("\n", i)
            i = n if j < 0 else j
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if c == "#":
            j = text.find("\n", i)
            i = n if j < 0 else j
            continue
        if c in {'"', "'", "`"}:
            q = c
            i += 1
            while i < n:
                if text[i] == "\\":
                    i += 2
                    continue
                if text[i] == q:
                    i += 1
                    break
                i += 1
            out.append(" ")
            continue
        out.append(c)
        i += 1
    return "".join(out)


def tokens_for(path_rel: str, text: str) -> list[str]:
    ext = Path(path_rel).suffix.lower()
    if ext in CODE_EXTS:
        stripped = strip_code_noise(text)
        toks = []
        for tok in TOKEN_RE.findall(stripped):
            toks.append("ID" if re.match(r"^[A-Za-z_\u4e00-\u9fff]", tok) else tok)
        return toks
    return WORD_RE.findall(text.lower())


def git_blob_sha(data: bytes) -> str:
    h = hashlib.sha1()
    h.update(f"blob {len(data)}\0".encode())
    h.update(data)
    return h.hexdigest()


def list_files(root: Path, allow_plain: bool) -> list[str]:
    if (root / ".git").exists():
        proc = subprocess.run(
            ["git", "-C", str(root), "ls-files", "-z"],
            capture_output=True,
        )
        if proc.returncode != 0:
            raise SystemExit(f"COPY-GATE ERROR: git ls-files 失败于 {root}: rc={proc.returncode}")
        files = [p for p in proc.stdout.decode("utf-8", "surrogateescape").split("\0") if p]
    elif allow_plain:
        files = []
        for p in sorted(root.rglob("*")):
            if p.is_file():
                rel = p.relative_to(root)
                if any(part in SKIP_DIR_PARTS for part in rel.parts):
                    continue
                files.append(str(rel))
    else:
        raise SystemExit(
            f"COPY-GATE ERROR: {root} 不是 git 仓库且未给 --allow-plain（fail-closed rc=2）"
        )
    keep = []
    for rel in files:
        p = Path(rel)
        if p.name in SKIP_NAMES:
            continue
        if any(part in SKIP_DIR_PARTS for part in p.parts):
            continue
        if p.suffix.lower() in BINARY_EXTS:
            continue
        keep.append(rel)
    return keep


def load_set(root: Path, rels: list[str]) -> tuple[dict[str, list[str]], dict[str, str], list[str]]:
    tokens_map: dict[str, list[str]] = {}
    blobs: dict[str, str] = {}
    skipped: list[str] = []
    for rel in rels:
        path = root / rel
        try:
            data = path.read_bytes()
        except OSError:
            skipped.append(f"{rel} (unreadable)")
            continue
        if b"\0" in data[:4096]:
            skipped.append(f"{rel} (binary)")
            continue
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            skipped.append(f"{rel} (non-utf8)")
            continue
        tokens_map[rel] = tokens_for(rel, text)
        blobs[rel] = git_blob_sha(data)
    return tokens_map, blobs, skipped


def ngrams(tokens: list[str], n: int = 5) -> Counter:
    return Counter(tuple(tokens[i : i + n]) for i in range(max(0, len(tokens) - n + 1)))


def jaccard(a: Counter, b: Counter) -> float:
    if not a and not b:
        return 1.0
    keys = set(a) | set(b)
    inter = sum(min(a[k], b.get(k, 0)) for k in keys if k in a and k in b)
    union = sum(max(a.get(k, 0), b.get(k, 0)) for k in keys)
    return inter / union if union else 0.0


def containment(a: Counter, b: Counter) -> float:
    total = sum(a.values())
    if total == 0:
        return 1.0 if sum(b.values()) == 0 else 0.0
    inter = sum(min(a[k], b.get(k, 0)) for k in a)
    return inter / total


def parse_overrides(path: Path, v2_count: int) -> tuple[dict[str, dict], list[str]]:
    errors: list[str] = []
    entries: dict[str, dict] = {}
    if not path.exists():
        return entries, errors
    for line in path.read_text(encoding="utf-8").splitlines():
        backticked = re.findall(r"`([^`]+)`", line)
        candidates = [p.lstrip("./") for p in backticked if "." in Path(p).name]
        if not candidates:
            continue
        has_receipt = (
            "APPROVE" in line
            and "INDEPENDENT" in line
            and re.search(r"(sibyl-\d{8}T\d{6}Z-[0-9a-f]{4,}|ses_[A-Za-z0-9]+)", line)
        )
        text_sha = re.search(r"text_sha256:\s*([0-9a-f]{16,64})", line)
        for cand in candidates:
            entries[cand] = {
                "line": line,
                "receipt_ok": bool(has_receipt),
                "text_sha_ok": bool(text_sha),
            }
    if len(entries) > 3:
        errors.append(f"CARRY-OVERRIDES 条目超上限：{len(entries)} > 3")
    if v2_count and len(entries) > 0.10 * v2_count:
        errors.append(f"CARRY-OVERRIDES 比例超上限：{len(entries)} > 10% × {v2_count}")
    for key, meta in entries.items():
        if not meta["receipt_ok"]:
            errors.append(f"CARRY-OVERRIDES 条目缺独立审回执（APPROVE+INDEPENDENT+运行号）：{key}")
        if not meta["text_sha_ok"]:
            errors.append(f"CARRY-OVERRIDES 条目缺 text_sha256：{key}")
    return entries, errors


def evaluate(v1: Path, v2: Path, overrides_path: Path, threshold: float, allow_plain: bool) -> int:
    if not v1.is_dir():
        print(f"COPY-GATE ERROR: v1 不存在: {v1}")
        return 2
    if not v2.is_dir():
        print(f"COPY-GATE ERROR: v2 不存在（可见性/路径）：{v2} —— fail-closed rc=2")
        return 2
    v1_rels = list_files(v1, True)
    try:
        v2_rels = list_files(v2, allow_plain)
    except SystemExit as exc:
        print(str(exc))
        return 2
    if not v2_rels:
        print(f"COPY-GATE ERROR: v2 文件集为空: {v2} —— 空集不得当通过，rc=2")
        return 2
    v1_tokens_map, v1_blobs, v1_skipped = load_set(v1, v1_rels)
    v2_tokens_map, v2_blobs, v2_skipped = load_set(v2, v2_rels)
    if not v2_tokens_map:
        print(f"COPY-GATE ERROR: v2 无可用文本文件: {v2} —— rc=2")
        return 2
    v1_counters = {rel: Counter(toks) for rel, toks in v1_tokens_map.items()}
    v2_counters = {rel: Counter(toks) for rel, toks in v2_tokens_map.items()}
    v2_ngrams = {rel: ngrams(toks) for rel, toks in v2_tokens_map.items()}

    overrides, errors = parse_overrides(overrides_path, len(v2_counters))
    failures: list[str] = list(errors)
    v2_blob_set = set(v2_blobs.values())
    best_rows: list[tuple[float, str, str]] = []

    for rel, counter in v1_counters.items():
        best_j, best_path = 0.0, "-"
        best_c, best_c_path = 0.0, "-"
        v1_ng = ngrams(v1_tokens_map[rel])
        for v2_rel, v2_counter in v2_counters.items():
            j = jaccard(counter, v2_counter)
            if j > best_j:
                best_j, best_path = j, v2_rel
            c = containment(v1_ng, v2_ngrams[v2_rel])
            if c > best_c:
                best_c, best_c_path = c, v2_rel
        best_rows.append((best_j, rel, best_path))
        if best_j >= threshold and rel not in overrides:
            failures.append(f"相似度 {best_j:.2f} ≥ {threshold:.2f}：`{rel}` ≈ `{best_path}`")
        if len(v1_tokens_map[rel]) >= 15 and best_c >= 0.80 and rel not in overrides:
            failures.append(
                f"5-gram 包含度 {best_c:.2f} ≥ 0.80：`{rel}` 整体被 `{best_c_path}` 包含（前缀/包装拷贝）"
            )
        if v1_blobs.get(rel) in v2_blob_set and rel not in overrides:
            failures.append(f"字节同一（git blob）：`{rel}` 在 v2 中存在同内容文件")

    v1_total = sum(sum(c.values()) for c in v1_counters.values())
    v2_total = sum(sum(c.values()) for c in v2_counters.values())
    union_v2: Counter = Counter()
    for counter in v2_counters.values():
        union_v2.update(counter)
    union_cov = 0.0
    if v1_total:
        merged: Counter = Counter()
        for counter in v1_counters.values():
            merged.update(counter)
        union_cov = containment(merged, union_v2)

    print(f"COPY-GATE: v1={len(v1_counters)} v2={len(v2_counters)} threshold={threshold:.2f}")
    print(f"COPY-GATE: union_coverage={union_cov:.3f} v1_tokens={v1_total} v2_tokens={v2_total}")
    for j, rel, other in sorted(best_rows, reverse=True)[:5]:
        print(f"  top: {j:.3f} `{rel}` ≈ `{other}`")
    if v1_skipped:
        print(f"  skipped v1: {', '.join(v1_skipped[:5])}{' …' if len(v1_skipped) > 5 else ''}")
    if v2_skipped:
        print(f"  skipped v2: {', '.join(v2_skipped[:5])}{' …' if len(v2_skipped) > 5 else ''}")
    if failures:
        for f in failures:
            print(f"COPY-GATE FAIL: {f}")
        print(f"COPY-GATE FAIL n={len(failures)} rc=1")
        return 1
    print("COPY-GATE OK rc=0")
    return 0


def selftest(fixtures: Path) -> int:
    cases = [
        ("same-content-different-path", 1),
        ("renamed-reordered", 1),
        ("comments-strings-rewritten", 1),
        ("prepended-unrelated", 1),
        ("control-rewrite", 0),
    ]
    failures = 0
    for name, want in cases:
        root = fixtures / name
        print(f"--- fixture {name} ---")
        code = evaluate(
            root / "v1", root / "v2", root / "CARRY-OVERRIDES.md", 0.80, allow_plain=True
        )
        status = "ok" if code == want else "MISMATCH"
        if code != want:
            failures += 1
        print(f"SELFTEST {name}: rc={code} want={want} {status}")
    print(f"SELFTEST {'OK' if failures == 0 else 'FAIL'} failures={failures}")
    return 0 if failures == 0 else 1


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--v1", default="/home/lab/workspace/harness/Abathur")
    ap.add_argument("--v2", default="/home/lab/workspace/harness/Abathur-v2")
    ap.add_argument("--overrides", default=None)
    ap.add_argument("--threshold", type=float, default=0.80)
    ap.add_argument("--allow-plain", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args(argv[1:])

    if args.selftest:
        here = Path(__file__).resolve().parent
        return selftest(here / "fixtures" / "copy-similarity")

    v2 = Path(args.v2)
    overrides = Path(args.overrides) if args.overrides else v2 / "docs" / "CARRY-OVERRIDES.md"
    return evaluate(Path(args.v1), v2, overrides, args.threshold, args.allow_plain)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
