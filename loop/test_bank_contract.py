#!/usr/bin/env python3
"""Contract test: every bank item is runnable by the pipeline that consumes it.

seed_item.py calls item["setup"](gen, item_id); draw.py requires exactly one canary
per generation. Both invariants were prose until G63, where setup_sr4_69(ws) shipped
with the wrong arity and the failure surfaced only as a crashed seed job.
"""
import inspect
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bank import ITEMS  # noqa: E402


def positional_arity(fn) -> int:
    sig = inspect.signature(fn)
    kinds = (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
    return sum(1 for p in sig.parameters.values() if p.kind in kinds)


class BankContract(unittest.TestCase):
    def test_setup_arity_matches_seed_item(self):
        bad = sorted(i for i, it in ITEMS.items()
                     if not callable(it.get("setup")) or positional_arity(it["setup"]) != 2)
        self.assertEqual(bad, [], f"setups must take exactly (gen, item): {bad}")

    def test_turns_present_for_seed_and_candidate(self):
        bad = sorted(i for i, it in ITEMS.items()
                     if not isinstance(it.get("turns"), list) or not it["turns"])
        self.assertEqual(bad, [], f"items need a non-empty turns list: {bad}")

    def test_canary_flag_is_boolean(self):
        bad = sorted(i for i, it in ITEMS.items() if not isinstance(it.get("canary", False), bool))
        self.assertEqual(bad, [], f"canary must be a bool: {bad}")

    def test_class_map_points_at_real_items(self):
        import draw
        bad = sorted(i for i in draw.CLASS_OF if i not in ITEMS)
        self.assertEqual(bad, [], f"CLASS_OF names unknown items: {bad}")

    def test_setups_never_read_mutable_omo_surface(self):
        # G82 seed crash: setup_sr4_62 read .omo/anchor/stamp.sh, which the
        # 2026-10-22 anchor migration removed. Fixture bytes belong to the repo face.
        import ast

        def reads_omo(fn) -> bool:
            tree = ast.parse(inspect.getsource(fn))
            return any(isinstance(n, ast.Constant) and isinstance(n.value, str)
                       and ".omo" in n.value for n in ast.walk(tree))

        bad = sorted(i for i, it in ITEMS.items()
                     if callable(it.get("setup")) and reads_omo(it["setup"]))
        self.assertEqual(bad, [], f"setups must read repo fixtures, not .omo: {bad}")

    def test_pinned_anchor_fixtures_present(self):
        root = Path(__file__).resolve().parent / "fixtures" / "anchor"
        missing = [f for f in ("stamp.sh", "chainlib.sh") if not (root / f).is_file()]
        self.assertEqual(missing, [], f"pinned gate fixtures missing: {missing}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
