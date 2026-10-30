#!/usr/bin/env python3
"""query_state.py — read-only exam state reporter (no writes, no queue mutation).

Prints the mechanical regression duty per loop/draw.py, the class map for the two
duty-bearing classes, and a one-line summary of the most recent archived bundles.
Precedent: the council asked for mechanical proof of guard state rather than prose.
Exit 0 = reported.
"""
import json
import sys
from pathlib import Path

LOOP_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(LOOP_DIR))

import draw  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
ARCH = REPO / ".omo/evidence/loop-archive"


def main() -> int:
    print(f"passes_to_clear={draw.PASSES_TO_CLEAR}")
    print(f"regression_duty={draw.regression_duty()}")

    for cls in sorted(set(draw.CLASS_OF.values())):
        members = sorted(i for i, c in draw.CLASS_OF.items() if c == cls)
        if len(members) == 1:
            print(f"single_item_class {cls}: {members[0]}")

    bundles = sorted(ARCH.glob("G*/bundle.json"))
    for p in bundles[-6:]:
        try:
            j = json.loads(p.read_text())
        except Exception as exc:  # noqa: BLE001
            print(f"{p.parent.name}: unreadable {exc}")
            continue
        rows = [(i["item"], i.get("verdict")) for i in j.get("items", [])]
        print(f"{j.get('gen')}: state={j.get('terminal_state')} "
              f"nominatable={j.get('nominatable')} killed={j.get('canaries_killed')} items={rows}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
