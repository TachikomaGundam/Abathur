#!/usr/bin/env python3
"""plan_check.py — 计划工件机械校验器（W0 交付；唯一归属=主树）。

模板权威：docs/PLAN-TEMPLATE.md（八节标题逐字、顺序固定）。
本工具只判「计划是否可执行」，不判「计划内容是否正确」；正确性归独立审。

判定面（任一失败 rc=1，逐条具名）：
  1. 八节标题齐备、各一次、顺序固定。
  2. `## Scope` 下 `### Must NOT have` 存在且至少一条非占位条目。
  3. `## Todos` 至少一条任务；任务行顶格 `- [ ] <编号>. <标题>`。
  4. 每条任务含十字段：Class / Clause / Wave / Depends / What to do / References /
     Acceptance / Evidence / QA / Commit，且值非占位。
  5. Class 取值属于 A–H 或 P；全计划并集覆盖 A–H 与 P（八类 + 规划类）。
  6. 波次连续（1..max）；依赖任务存在、不得自依赖、且严格位于更早波次（无环）。
  7. Acceptance 含期望 rc/exit 数值；Evidence 含路径分隔符。
  8. 全文无占位符（`<fill ...>`、`<...>`、TBD、待定）。

用法：
  python3 loop/plan_check.py <计划文件>
  python3 loop/plan_check.py --selftest

退出码：0 通过；1 有违规；2 用法或环境错误。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

HEADINGS = [
    "## TL;DR (For humans)",
    "## Scope",
    "## Verification strategy",
    "## Execution strategy",
    "## Todos",
    "## Final verification wave",
    "## Commit strategy",
    "## Success criteria",
]

CLASSES = ["A", "B", "C", "D", "E", "F", "G", "H", "P"]

FIELD_ALIASES = {
    "class": "Class",
    "clause": "Clause",
    "wave": "Wave",
    "depends": "Depends",
    "what to do / must not do": "What",
    "what to do": "What",
    "references": "References",
    "acceptance": "Acceptance",
    "acceptance criteria": "Acceptance",
    "evidence": "Evidence",
    "qa": "QA",
    "qa scenarios": "QA",
    "commit": "Commit",
}
REQUIRED_FIELDS = [
    "Class",
    "Clause",
    "Wave",
    "Depends",
    "What",
    "References",
    "Acceptance",
    "Evidence",
    "QA",
    "Commit",
]

PLACEHOLDER_RE = re.compile(r"(<fill\b|<\s*\.\.\.\s*>|<\s*[A-Za-z\u4e00-\u9fff][^<>]{0,40}?>|\bTBD\b|\bTODO\b|待定|占位)")
TASK_RE = re.compile(r"^- \[ \] (\d+)\.\s+(\S.*)$")
INDENTED_TASK_RE = re.compile(r"^\s+- \[ \] \d+\.")
FIELD_RE = re.compile(r"^\s+([A-Za-z][A-Za-z0-9 /()-]*?)\s*:\s*(.*)$")
FIELD_BOLD_RE = re.compile(r"^\s*(?:[-*]\s+)?\*\*([^*]+?)\*\*\s*:?\s*(.*)$")
ACCEPTANCE_RC_RE = re.compile(r"(?:rc|exit)\s*=?\s*-?\d", re.IGNORECASE)


class Violations:
    def __init__(self) -> None:
        self.items: list[str] = []

    def add(self, msg: str) -> None:
        self.items.append(msg)

    def ok(self) -> bool:
        return not self.items


def split_sections(text: str) -> dict[str, list[str]]:
    """Return {heading: body lines}. Only `## ` headings split sections."""
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for line in text.splitlines():
        if line.startswith("## "):
            current = line.rstrip()
            sections.setdefault(current, [])
            continue
        if current is not None:
            sections[current].append(line)
    return sections


def check_headings(text: str, v: Violations) -> None:
    lines = [ln.rstrip() for ln in text.splitlines()]
    positions: list[int] = []
    for heading in HEADINGS:
        hits = [i for i, ln in enumerate(lines) if ln == heading]
        if not hits:
            v.add(f"缺少节标题：{heading}")
            continue
        if len(hits) > 1:
            v.add(f"节标题重复 {len(hits)} 次：{heading}（行 {[h + 1 for h in hits]}）")
        positions.append(hits[0])
    if len(positions) == len(HEADINGS) and positions != sorted(positions):
        v.add(f"节标题顺序错误：实际行序 {[p + 1 for p in positions]}")


def check_must_not_have(sections: dict[str, list[str]], v: Violations) -> None:
    body = sections.get("## Scope", [])
    start = None
    for i, line in enumerate(body):
        if line.strip().lower().startswith("### must not have"):
            start = i
            break
    if start is None:
        v.add("`## Scope` 缺少 `### Must NOT have` 子节")
        return
    bullets: list[str] = []
    for line in body[start + 1 :]:
        stripped = line.strip()
        if stripped.startswith("### ") or stripped.startswith("## "):
            break
        bullet = re.match(r"^(?:[-*]|\d+\.)\s+(.+)$", stripped)
        if bullet:
            bullets.append(bullet.group(1).strip())
    real = [b for b in bullets if b and not PLACEHOLDER_RE.search(b)]
    if not real:
        v.add("`### Must NOT have` 无非占位条目（至少一条禁令）")


def parse_tasks(body: list[str], v: Violations) -> list[dict]:
    tasks: dict[int, dict] = {}
    order: list[int] = []
    current: dict | None = None
    for raw in body:
        if INDENTED_TASK_RE.match(raw):
            v.add(f"任务行必须顶格（列 0）：{raw.strip()[:60]}")
            continue
        m = TASK_RE.match(raw)
        if m:
            num = int(m.group(1))
            if num in tasks:
                v.add(f"任务编号重复：{num}")
            current = {"num": num, "title": m.group(2).strip(), "fields": {}, "line": raw}
            tasks[num] = current
            order.append(num)
            continue
        if current is None:
            continue
        fm = FIELD_RE.match(raw)
        bold = FIELD_BOLD_RE.match(raw)
        if bold:
            key = FIELD_ALIASES.get(bold.group(1).strip().rstrip(":").strip().lower())
            if key:
                if key in current["fields"]:
                    v.add(f"任务 {current['num']} 字段重复：{key}")
                current["fields"][key] = bold.group(2).strip()
        elif fm:
            key = FIELD_ALIASES.get(fm.group(1).strip().lower())
            if key:
                if key in current["fields"]:
                    v.add(f"任务 {current['num']} 字段重复：{key}")
                current["fields"][key] = fm.group(2).strip()

    for num in order:
        t = tasks[num]
        fields = t["fields"]
        for key in REQUIRED_FIELDS:
            if key not in fields:
                v.add(f"任务 {num} 缺字段：{key}")
                continue
            val = fields[key]
            if not val or PLACEHOLDER_RE.search(val):
                v.add(f"任务 {num} 字段 {key} 为空或含占位符：{val[:40]!r}")
        if "Class" in fields:
            vals = [c.strip() for c in re.split(r"[/,，、\s]+", fields["Class"]) if c.strip()]
            bad = [c for c in vals if c not in CLASSES]
            if not vals:
                v.add(f"任务 {num} Class 为空")
            elif bad:
                v.add(f"任务 {num} Class 取值非法：{bad}（允许 {CLASSES}）")
            t["classes"] = vals
        if "Wave" in fields and fields["Wave"].strip().isdigit():
            t["wave"] = int(fields["Wave"].strip())
            if t["wave"] < 1:
                v.add(f"任务 {num} Wave 必须 ≥1")
        elif "Wave" in fields:
            v.add(f"任务 {num} Wave 不是整数：{fields['Wave']!r}")
        dep_val = fields.get("Depends", "")
        if dep_val:
            if dep_val.strip() in {"—", "-", "无", "none", "None"}:
                t["depends"] = []
            else:
                nums = [x for x in re.split(r"[,\s，]+", dep_val.strip()) if x]
                parsed = []
                for x in nums:
                    if not x.isdigit():
                        v.add(f"任务 {num} Depends 非编号：{x!r}")
                    else:
                        parsed.append(int(x))
                t["depends"] = parsed
        acc = fields.get("Acceptance", "")
        if acc and not ACCEPTANCE_RC_RE.search(acc):
            v.add(f"任务 {num} Acceptance 缺期望 rc/exit 数值：{acc[:60]!r}")
        ev = fields.get("Evidence", "")
        if ev and "/" not in ev:
            v.add(f"任务 {num} Evidence 不是路径：{ev!r}")
    return [tasks[n] for n in order]


def check_dag(tasks: list[dict], v: Violations) -> None:
    if not tasks:
        v.add("`## Todos` 没有任何任务行（顶格 `- [ ] N. 标题`）")
        return
    by_num = {t["num"]: t for t in tasks}
    waves = sorted({t["wave"] for t in tasks if "wave" in t})
    if waves and waves != list(range(1, max(waves) + 1)):
        v.add(f"波次不连续：实际 {waves}，要求 1..{max(waves)}")
    graph: dict[int, list[int]] = {}
    for t in tasks:
        deps: list[int] = []
        for dep in t.get("depends", []):
            if dep == t["num"]:
                v.add(f"任务 {t['num']} 自依赖")
                continue
            other = by_num.get(dep)
            if other is None:
                v.add(f"任务 {t['num']} 依赖不存在的任务 {dep}")
                continue
            if "wave" in other and "wave" in t and other["wave"] > t["wave"]:
                v.add(
                    f"任务 {t['num']}(Wave {t['wave']}) 依赖任务 {dep}(Wave {other['wave']})："
                    "依赖不得指向更晚波次"
                )
                continue
            deps.append(dep)
        graph[t["num"]] = deps

    WHITE, GRAY, BLACK = 0, 1, 2
    color = {n: WHITE for n in graph}
    stack: list[int] = []

    def visit(node: int) -> bool:
        color[node] = GRAY
        stack.append(node)
        for nxt in graph.get(node, []):
            if color.get(nxt, WHITE) == GRAY:
                cycle_start = stack.index(nxt)
                v.add(f"依赖成环：{' -> '.join(str(x) for x in stack[cycle_start:] + [nxt])}")
                return False
            if color.get(nxt, WHITE) == WHITE and not visit(nxt):
                return False
        stack.pop()
        color[node] = BLACK
        return True

    for n in list(graph):
        if color[n] == WHITE:
            visit(n)


def check_class_coverage(tasks: list[dict], v: Violations) -> None:
    seen: set[str] = set()
    for t in tasks:
        seen.update(t.get("classes", []))
    missing = [c for c in CLASSES if c not in seen]
    if missing:
        v.add(f"类覆盖不足，缺：{','.join(missing)}（八类 A–H + 规划类 P 均须至少一条任务声明）")


def run(path: Path) -> int:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"PLAN-CHECK ERROR: 无法读取 {path}: {exc}")
        return 2
    v = Violations()
    check_headings(text, v)
    sections = split_sections(text)
    check_must_not_have(sections, v)
    tasks = parse_tasks(sections.get("## Todos", []), v)
    check_dag(tasks, v)
    check_class_coverage(tasks, v)
    for line_no, line in enumerate(text.splitlines(), 1):
        for m in PLACEHOLDER_RE.finditer(line):
            v.add(f"第 {line_no} 行含占位符：{m.group(0)!r}")
    if not v.ok():
        for item in v.items:
            print(f"PLAN-CHECK FAIL: {item}")
        print(f"PLAN-CHECK FAIL n={len(tasks)} violations={len(v.items)} rc=1")
        return 1
    classes = sorted({c for t in tasks for c in t.get("classes", [])})
    print(f"PLAN-CHECK OK n={len(tasks)} classes={''.join(classes)} rc=0")
    return 0


def _good_plan() -> str:
    tasks = []
    for i, cls in enumerate(CLASSES, 1):
        tasks.append(
            f"""- [ ] {i}. 任务 {cls}
  Class: {cls}
  Clause: {cls}1
  Wave: 1
  Depends: —
  What to do / Must NOT do: 做 {cls} 类的事；不复制旧码
  References: docs/PLAN-TEMPLATE.md:1
  Acceptance: python3 loop/plan_check.py x.md; expected rc=0
  Evidence: .omo/evidence/demo/{cls}.log
  QA: 快乐路径运行一次；失败路径删字段须 rc=1
  Commit: Y | docs(demo): {cls}"""
        )
    return """# demo - Work Plan
## TL;DR (For humans)
交付一个演示。
> TL;DR (machine): Small · Low · demo
## Scope
### Must have
- 一个判据
### Must NOT have (guardrails, anti-slop, scope boundaries)
- 不复制旧码
## Verification strategy
- 判据：命令 + rc
## Execution strategy
### Parallel execution waves
Wave 1
### Dependency matrix
| 任务 | 依赖 |
## Todos
""" + "\n".join(tasks) + """
## Final verification wave
- [ ] F1. 计划合规审计
## Commit strategy
每波一提交。
## Success criteria
- rc=0
"""


GOOD = _good_plan()


def selftest() -> int:
    import tempfile

    same_wave = GOOD.replace(
        "Clause: B1\n  Wave: 1\n  Depends: —",
        "Clause: B1\n  Wave: 1\n  Depends: 1",
        1,
    )
    cyclic = GOOD.replace(
        "Clause: A1\n  Wave: 1\n  Depends: —",
        "Clause: A1\n  Wave: 1\n  Depends: 2",
        1,
    ).replace(
        "Clause: B1\n  Wave: 1\n  Depends: —",
        "Clause: B1\n  Wave: 1\n  Depends: 1",
        1,
    )
    bold = GOOD.replace("  Class: A\n", "  - **Class:** A\n", 1)
    cases = [
        ("good", GOOD, 0),
        ("indent-task", GOOD.replace("- [ ] 1. 任务 A", "  - [ ] 1. 任务 A"), 1),
        ("no-must-not", GOOD.replace("- 不复制旧码\n", ""), 1),
        ("same-wave-dep", same_wave, 0),
        ("dependency-cycle", cyclic, 1),
        ("bold-fields", bold, 0),
    ]
    failures = 0
    for name, body, want in cases:
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8") as fh:
            fh.write(body)
            path = Path(fh.name)
        code = run(path)
        path.unlink()
        status = "ok" if code == want else "MISMATCH"
        if code != want:
            failures += 1
        print(f"SELFTEST {name}: rc={code} want={want} {status}")
    print(f"SELFTEST {'OK' if failures == 0 else 'FAIL'} failures={failures}")
    return 0 if failures == 0 else 1


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[1] == "--selftest":
        return selftest()
    if len(argv) != 2:
        print("usage: python3 loop/plan_check.py <plan.md> | --selftest")
        return 2
    return run(Path(argv[1]))


if __name__ == "__main__":
    sys.exit(main(sys.argv))
