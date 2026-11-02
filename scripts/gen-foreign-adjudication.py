#!/usr/bin/env python3
"""Generate the per-commit adjudication table for INCIDENT-20261103.

Reads the acknowledged ledger, enumerates the same foreign commits the gate sees,
and emits a markdown table with the facts a human needs to sign each line:
sha, date, subject, files touched, whether it touches the engine (src/), the
exam lane (loop/), governance (AGENTS.md/config), or the foreign graders dir.

Sign-off column is intentionally empty: the seat cannot adjudicate its own line.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ACK = REPO / "docs/evidence-manifests/ACKNOWLEDGED-FOREIGN-COMMITS.txt"
OUT = REPO / "docs/INCIDENT-20261103-FOREIGN-COMMITS-ADJUDICATION.md"


def git(*args: str) -> str:
    p = subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True)
    if p.returncode != 0:
        raise SystemExit(f"cannot answer: git {' '.join(args)} failed: {p.stderr.strip()}")
    return p.stdout


def main() -> int:
    shas = [
        line.split("#", 1)[0].strip()
        for line in ACK.read_text().splitlines()
        if line.split("#", 1)[0].strip()
    ]
    rows = []
    for sha in shas:
        date = git("show", "-s", "--format=%ad", "--date=iso-strict", sha).strip()
        subject = git("show", "-s", "--format=%s", sha).strip().replace("|", "\\|")[:96]
        files = git("show", "--name-only", "--format=", sha).split()
        n_src = sum(1 for f in files if f.startswith("src/"))
        n_loop = sum(1 for f in files if f.startswith("loop/"))
        n_gov = sum(1 for f in files if f in ("AGENTS.md", "package.json") or f.startswith("config/"))
        n_graders = sum(1 for f in files if f.startswith("graders/"))
        tags = []
        if n_src:
            tags.append(f"src×{n_src}")
        if n_loop:
            tags.append(f"loop×{n_loop}")
        if n_gov:
            tags.append(f"gov×{n_gov}")
        if n_graders:
            tags.append(f"graders×{n_graders}")
        rows.append((sha, date, subject, " ".join(tags) or "—", len(files)))

    body = [
        "# 外线提交逐笔裁定表（INCIDENT-20261103）",
        "",
        "生成器：`/home/lab/workspace/harness/Abathur/scripts/gen-foreign-adjudication.py`（复算命令：`python3 scripts/gen-foreign-adjudication.py`）。",
        "数据源：`/home/lab/workspace/harness/Abathur/docs/evidence-manifests/ACKNOWLEDGED-FOREIGN-COMMITS.txt` 的 44 枚 sha，逐笔读 `git show`。",
        "",
        "**这张表不能由本席裁定。** 每一行的「裁定」列必须由具名人类签认（台账人类条目），",
        "或由 `sibyl_audit`（`independence=INDEPENDENT`，审计会话可在引擎库对账）出意见后仍由人类签认。",
        "在签认前，闸保持 `FAIL-PENDING` 红灯是**正确状态**。",
        "",
        "| # | sha | 日期 | 主题 | 触及面 | 文件数 | 裁定（人类签认） |",
        "|---|---|---|---|---|---|---|",
    ]
    for i, (sha, date, subject, tags, nfiles) in enumerate(rows, 1):
        body.append(f"| {i} | `{sha[:12]}` | {date[:19]} | {subject} | {tags} | {nfiles} | ☐ |")

    src_rows = [r for r in rows if "src×" in r[3]]
    body += [
        "",
        f"合计 {len(rows)} 笔；其中触及 `src/` 的 {len(src_rows)} 笔（对引擎面有效，须优先裁定）；"
        "其余为 `graders/pcb-agent/**` 与发布说明。",
        "",
        "裁定口径建议（供人类参考，非裁决）：",
        "",
        "1. **触及 `src/` 的 10 笔**：需逐笔判断「是否接受该改动进入证据基线」。它们已经在 HEAD 谱系里，且 `release/0.4.0` 与所有 tag 均不包含——即发布面干净、工作树脏。",
        "2. **`graders/pcb-agent/**` 的 34 笔**：属他线器材长期寄放（迁移工单 `handoffs/GRADERS-MIGRATION-pcb-agent.md` 在册）。裁定应附带迁移判据，而不是逐笔豁免。",
        "3. **任何一行**：签认后把该行改为 `<sha> PENDING` 也不解除红灯——红灯解除的唯一条件是 `ACKNOWLEDGED-FOREIGN-COMMITS.txt` 为空或闸改判；本表签认的作用是**记录人类已知情**，不改变闸的判败语义。",
    ]
    OUT.write_text("\n".join(body) + "\n")
    print(f"wrote {OUT.relative_to(REPO)} rows={len(rows)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
