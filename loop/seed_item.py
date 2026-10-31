#!/usr/bin/env python3
"""seed_item.py <gen> <item-id> — create /tmp/abathur-loop-<gen>/<item>/ per handoff §1."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import looplib as L
from bank import ITEMS


def _flatten_ground_truth(gt) -> dict:
    """One-level flatten: keep string leaves at depth 1 and 2, drop everything else.

    Depth 2 exists because some setups return `{"ground_truth": {...}, "planted": ...}`
    rather than the flat table. Nothing deeper has ever carried a fixture path, and a
    deep walk would start pinning unrelated scalars, so the bound is deliberate.
    """
    out = {}
    for key, value in gt.items():
        if isinstance(value, str):
            out[key] = value
        elif isinstance(value, dict):
            for sub_key, sub_value in value.items():
                if isinstance(sub_value, str):
                    out[f"{key}.{sub_key}"] = sub_value
    return out


def pin_fixtures(cand_root, hd, manifest) -> int:
    """Copy seeded fixture bytes into harness/fixtures/ so an archived run stays replayable.

    Why: manifest.json records sha256 only. When a fixture is generated at seed time
    rather than tracked in git (e.g. SR4-64's post-seal-ops.sh), a hash cannot
    reconstruct the bytes, so /tmp dying destroys the ability to replay A3/A4/A5.
    harness/ sits outside the candidate-visible roots, so nothing leaks into the exam.

    Two sources, because they live on opposite sides:
      1. manifest["files"] -> candidate-visible seeded files (relative to cand_root).
      2. ground_truth string values that resolve to an existing file under harness/
         (e.g. SR4-64's ops_script). Some setups nest the real table one level deeper
         (`{"ground_truth": {...}, "planted": ...}`), so dict values are walked one
         level down before giving up. Predicate stays narrow: only strings that are
         real files under this item's harness dir are copied.
    """
    dest_root = hd / "fixtures"
    count = 0
    for rel in manifest.get("files", {}):
        src = cand_root / rel
        if src.is_symlink() or not src.is_file():
            continue
        dest = dest_root / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(src.read_bytes())
        count += 1
    gt_pinned, skipped = 0, []
    for key, value in _flatten_ground_truth(manifest.get("ground_truth", {})).items():
        src = Path(value)
        if not src.is_file():
            skipped.append(f"{key}:not-a-file")
            continue
        try:
            rel = src.relative_to(hd)
        except ValueError:
            skipped.append(f"{key}:outside-harness")
            continue
        dest = dest_root / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(src.read_bytes())
        gt_pinned += 1
    return count, gt_pinned, skipped


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
    n_cand, n_gt, skipped = pin_fixtures(L.cand_root(gen, item_id), L.harness_dir(gen, item_id), manifest)
    turns = {"item": item_id, "turns": item["turns"]}
    (L.harness_dir(gen, item_id) / "turns.json").write_text(json.dumps(turns, indent=2, ensure_ascii=False))
    print(f"seeded {gen}/{item_id}: {len(manifest['files'])} files, {len(manifest['symlinks'])} symlinks")
    print(f"  pinned fixtures: {n_cand} candidate + {n_gt} harness-side -> {L.harness_dir(gen, item_id) / 'fixtures'}")
    if skipped:
        print(f"  pin skipped: {', '.join(skipped)}")
    print(f"  run dir: {rd}")
    print(f"  manifest: {L.harness_dir(gen, item_id) / 'manifest.json'}")


if __name__ == "__main__":
    main()
