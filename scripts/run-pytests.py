#!/usr/bin/env python3
"""Run the python test suites here, with or without pytest installed.

Gate contract (AGENTS.md): `python3 scripts/run-pytests.py <dir> [<dir>...]`.
Prefers the real pytest module when present; otherwise falls back to an
equivalent discovery shim: finds test_* functions, injects tmp_path, runs
every test, exits nonzero on any failure. Fail-closed: an import error in a
test file is a failure, not a skip.
"""
import importlib.util
import inspect
import os
import pathlib
import sys
import tempfile
import traceback
import types

try:
    import pytest  # noqa: F401
    sys.exit(pytest.main(sys.argv[1:]))
except ImportError:
    pass

if "pytest" not in sys.modules:
    sys.modules["pytest"] = types.ModuleType("pytest")  # bare-import compatibility


def load(path):
    spec = importlib.util.spec_from_file_location(path.replace("/", "_")[:-3], path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def collect_files(args):
    files = []
    for a in args:
        if a.startswith("-"):
            continue
        if os.path.isdir(a):
            for root, _dirs, names in sorted(os.walk(a)):
                files.extend(os.path.join(root, n) for n in sorted(names)
                             if n.startswith("test_") and n.endswith(".py"))
        elif os.path.isfile(a):
            files.append(a)
        else:
            print("ERROR: no such file or dir: %s" % a)
            return None
    return files


def main(argv):
    files = collect_files(argv)
    if files is None:
        return 2
    if not files:
        print("ERROR: no test files found under %s" % " ".join(argv))
        return 2
    passed = failed = 0
    for f in files:
        try:
            mod = load(os.path.abspath(f))
        except Exception:
            failed += 1
            print("FAIL %s (import)" % f)
            traceback.print_exc()
            continue
        for name, fn in sorted(vars(mod).items()):
            if not (name.startswith("test_") and callable(fn)):
                continue
            kw = {}
            if "tmp_path" in inspect.signature(fn).parameters:
                kw["tmp_path"] = pathlib.Path(tempfile.mkdtemp(prefix="pytest-mini-"))
            try:
                fn(**kw)
                passed += 1
                print("PASS %s::%s" % (os.path.basename(f), name))
            except Exception:
                failed += 1
                print("FAIL %s::%s" % (os.path.basename(f), name))
                traceback.print_exc()
    print("== %d passed, %d failed ==" % (passed, failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
