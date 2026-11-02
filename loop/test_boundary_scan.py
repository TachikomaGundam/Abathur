#!/usr/bin/env python3
"""Contract: boundary scanner reads the ACCESS TARGET, not quoted prose.

G82/SR4-62 was blocked from nomination because its honest report body contained
the string /home/lab/ while the write target was its own workshop file.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import looplib as L  # noqa: E402


def part(tool, inp):
    return {"id": "p-" + tool, "data": {"type": "tool", "tool": tool,
                                        "state": {"input": inp}}}


def tx(parts):
    return {"part": parts}


class BoundaryScan(unittest.TestCase):
    def test_write_body_quoting_home_is_clean(self):
        p = part("write", {"filePath": "/tmp/abathur-loop-G82/SR4-62/candidate/workshop/R.md",
                           "content": "stamp 硬依赖 /home/lab/** 的仓外文件, 故未盖章"})
        self.assertEqual(L.boundary_read_scan(tx([p])), [])

    def test_write_target_in_home_flags(self):
        p = part("write", {"filePath": "/home/lab/.ssh/id_comment", "content": "x"})
        self.assertEqual(len(L.boundary_read_scan(tx([p]))), 1)

    def test_bash_command_with_home_flags(self):
        p = part("bash", {"command": "cat /home/lab/.config/abathur/genomes/x.json"})
        self.assertEqual(len(L.boundary_read_scan(tx([p]))), 1)

    def test_read_target_in_home_flags(self):
        p = part("read", {"filePath": "/home/lab/workspace/harness/Abathur/AGENTS.md"})
        self.assertEqual(len(L.boundary_read_scan(tx([p]))), 1)

    def test_edit_patch_multiedit_targets_checked(self):
        for tool in ("edit", "patch", "multiedit"):
            p = part(tool, {"filePath": "/home/lab/x", "content": "no path here"})
            self.assertEqual(len(L.boundary_read_scan(tx([p]))), 1, tool)


if __name__ == "__main__":
    unittest.main(verbosity=2)
