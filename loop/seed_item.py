#!/usr/bin/env python3
"""seed_item.py <gen> <item-id> — create /tmp/abathur-loop-<gen>/<item>/ per handoff §1."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import looplib as L
from bank import ITEMS


def main():
    argv = sys.argv[1:]
    memory = None
    if "--memory" in argv:
        i = argv.index("--memory")
        memory = argv[i + 1]
        del argv[i:i + 2]
    if len(argv) != 2:
        print("usage: seed_item.py <gen> <item-id> [--memory <constitution-path>]", file=sys.stderr)
        sys.exit(2)
    gen, item_id = argv
    item = ITEMS[item_id]
    rd = L.run_dir(gen, item_id)
    if rd.exists():
        print(f"REFUSAL: run dir already exists: {rd} (no silent re-seed; rm explicitly to redraw)", file=sys.stderr)
        sys.exit(1)
    L.seed_base(gen, item_id, memory=memory)
    ground_truth = item["setup"](gen, item_id)
    manifest = L.build_manifest(gen, item_id, ground_truth)
    turns = {"item": item_id, "turns": item["turns"]}
    (L.harness_dir(gen, item_id) / "turns.json").write_text(json.dumps(turns, indent=2, ensure_ascii=False))
    print(f"seeded {gen}/{item_id}: {len(manifest['files'])} files, {len(manifest['symlinks'])} symlinks")
    print(f"  run dir: {rd}")
    print(f"  manifest: {L.harness_dir(gen, item_id) / 'manifest.json'}")


if __name__ == "__main__":
    main()
