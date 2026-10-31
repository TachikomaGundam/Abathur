#!/usr/bin/env python3
"""assertions.py — 准入断言运行器（L-ASSERTIONS-OVER-PROSE 的执行面）。

为什么存在：提名记录过去是叙述文本，审计者是 LLM，可以对着文字无限提意见，于是同一份
记录被否了十一轮，而机器事实一次也没被推翻。本模块把「准入声明」变成可执行断言：
每条断言是一行 JSON，带一个可重跑的探测器；`check` 一次跑完全部并给退出码。
文档只引用断言 id，不再复述数值。

用法：
    python3 loop/assertions.py list  <gen>
    python3 loop/assertions.py check <gen> [--quiet]

规格文件：.omo/evidence/assertions/<gen>.json
    {"gen": "G67", "assertions": [
        {"id": "...", "claim": "人读的一句话", "kind": "json_selector",
         "path": "loop-archive/G67/bundle.json", "selector": "items.0.verdict",
         "expect": "PASS"},
        {"id": "...", "kind": "cmd", "argv": ["python3", "loop/test_bank_contract.py"]},
        ...
    ]}

支持的 kind：file_exists / dir_exists / json_selector / json_equals / sha256_equals
/ nonempty_list / cmd。未知 kind 一律判失败（fail-closed）。
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
EVIDENCE = REPO / ".omo" / "evidence"
SPEC_DIR = EVIDENCE / "assertions"

RUNNER_SCHEMA = 1
SPEC_KEYS = {"gen", "schema", "assertions"}
COMMON_KEYS = {"id", "claim", "kind"}
KIND_KEYS = {
    "file_exists": {"path"},
    "dir_exists": {"path"},
    "json_selector": {"path", "selector"},
    "json_equals": {"path", "selector", "expect"},
    "nonempty_list": {"path", "selector"},
    "sha256_equals": {"path", "expect"},
    "cmd": {"argv", "expect_rc", "timeout_s"},
}


def validate(spec: dict) -> list[str]:
    """Schema gate: an unknown field is refused, not ignored.

    A silently ignored field is how a spec drifts from what its author meant while still
    reporting OK; refusing unknown keys keeps the spec and the runner in one contract.
    """
    errs = []
    extra = set(spec) - SPEC_KEYS
    if extra:
        errs.append(f"unknown top-level keys {sorted(extra)}")
    if spec.get("schema") != RUNNER_SCHEMA:
        errs.append(f"schema {spec.get('schema')!r} != runner {RUNNER_SCHEMA}")
    seen = set()
    for i, a in enumerate(spec.get("assertions") or []):
        if not isinstance(a, dict):
            errs.append(f"assertion[{i}] is not an object")
            continue
        aid = a.get("id")
        if not aid:
            errs.append(f"assertion[{i}] has no id")
        elif aid in seen:
            errs.append(f"duplicate id {aid!r}")
        else:
            seen.add(aid)
        kind = a.get("kind")
        if kind not in KIND_KEYS:
            errs.append(f"assertion[{i}] unknown kind {kind!r}")
            continue
        missing = (COMMON_KEYS | KIND_KEYS[kind]) - set(a)
        if missing:
            errs.append(f"assertion[{i}] ({aid}) missing {sorted(missing)}")
        extra_k = set(a) - COMMON_KEYS - KIND_KEYS[kind]
        if extra_k:
            errs.append(f"assertion[{i}] ({aid}) unknown keys {sorted(extra_k)}")
        rel = a.get("path")
        if rel is not None:
            target = (EVIDENCE / rel).resolve()
            if EVIDENCE.resolve() not in target.parents and target != EVIDENCE.resolve():
                errs.append(f"assertion[{i}] ({aid}) path escapes evidence root: {rel}")
    return errs


def _load(gen: str) -> dict:
    spec = SPEC_DIR / f"{gen}.json"
    if not spec.is_file():
        raise SystemExit(f"ASSERTIONS: no spec at {spec}")
    return json.loads(spec.read_text(encoding="utf-8"))


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _dig(obj, selector: str):
    cur = obj
    for part in [p for p in selector.split(".") if p]:
        if isinstance(cur, list):
            cur = cur[int(part)]
        elif isinstance(cur, dict):
            if part not in cur:
                raise KeyError(part)
            cur = cur[part]
        else:
            raise KeyError(part)
    return cur


def run_one(a: dict) -> tuple[bool, str]:
    kind = a.get("kind", "")
    rel = a.get("path")
    path = (EVIDENCE / rel) if rel else None
    try:
        if kind == "file_exists":
            return (path is not None and path.is_file()), f"file={rel}"
        if kind == "dir_exists":
            return (path is not None and path.is_dir()), f"dir={rel}"
        if kind in {"json_selector", "json_equals", "nonempty_list"}:
            if path is None or not path.is_file():
                return False, f"missing {rel}"
            data = json.loads(path.read_text(encoding="utf-8"))
            value = _dig(data, a.get("selector", ""))
            if kind == "nonempty_list":
                return bool(isinstance(value, list) and value), f"len={len(value) if isinstance(value, list) else 'n/a'}"
            if kind == "json_equals":
                want = a.get("expect")
                return value == want, f"value={value!r} expect={want!r}"
            return value is not None, f"value={value!r}"
        if kind == "sha256_equals":
            want = a.get("expect", "")
            if path is None or not path.is_file():
                return False, f"missing {rel}"
            got = _sha256(path)
            if len(want) == 64:
                return got == want, f"sha256={got[:16]}… expect={want[:16]}…"
            return got.startswith(want), f"sha256={got[:16]}… prefix={want[:16]}"
        if kind == "cmd":
            argv = a.get("argv") or []
            if not argv:
                return False, "empty argv"
            proc = subprocess.run(argv, cwd=str(REPO), capture_output=True, text=True, timeout=a.get("timeout_s", 300))
            detail = (proc.stdout or proc.stderr).strip().splitlines()
            tail = detail[-1] if detail else ""
            return proc.returncode == a.get("expect_rc", 0), f"rc={proc.returncode} {tail[:120]}"
    except Exception as exc:  # noqa: BLE001 - any probe error is a failed assertion, not a pass
        return False, f"error {type(exc).__name__}: {exc}"
    return False, f"unknown kind {kind!r}"


def main(argv: list[str]) -> int:
    if len(argv) < 3 or argv[1] not in {"list", "check"}:
        print(__doc__.strip().splitlines()[0])
        return 2
    action, gen = argv[1], argv[2]
    quiet = "--quiet" in argv
    spec = _load(gen)
    errs = validate(spec)
    if errs:
        print(f"ASSERTIONS {gen}: SPEC-REFUSED")
        for e in errs:
            print(f"  {e}")
        return 2
    rows = spec.get("assertions") or []
    if not rows:
        print(f"ASSERTIONS {gen}: spec has no assertions")
        return 1
    if action == "list":
        by_kind: dict[str, int] = {}
        for a in rows:
            by_kind[a.get("kind", "?")] = by_kind.get(a.get("kind", "?"), 0) + 1
        print(f"ASSERTIONS {gen} count={len(rows)} kinds={json.dumps(by_kind, sort_keys=True)}")
        for a in rows:
            print(f"  {a.get('id','<no-id>')}  [{a.get('kind','?')}]  {a.get('claim','')}")
        return 0

    failed = 0
    for a in rows:
        ok, detail = run_one(a)
        if not ok:
            failed += 1
        if not quiet or not ok:
            print(f"{'OK  ' if ok else 'FAIL'} {a.get('id','<no-id>')} {detail}")
    total = len(rows)
    receipt = {
        "gen": gen, "schema": RUNNER_SCHEMA, "ran": total, "failed": failed,
        "runner_sha256": _sha256(Path(__file__).resolve()),
        "spec_sha256": _sha256(SPEC_DIR / f"{gen}.json"),
    }
    print(f"ASSERTIONS {gen}: ran={total} failed={failed} "
          f"runner={receipt['runner_sha256'][:12]} spec={receipt['spec_sha256'][:12]}")
    log = SPEC_DIR / f"{gen}.receipts.jsonl"
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(receipt) + "\n")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
