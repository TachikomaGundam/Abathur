#!/usr/bin/env python3
"""Review-state adapter.

The independent-review implementation is machine-local. Code must not name it:
the operator injects the state root with ABATHUR_REVIEW_HOME. When the variable
is unset the neutral XDG data location is used, so a fresh deployment works
without any review product installed.
"""
import os
from pathlib import Path

HOME_ENV = "ABATHUR_REVIEW_HOME"


def review_home() -> Path:
    raw = os.environ.get(HOME_ENV, "")
    if raw:
        return Path(raw)
    data = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(data) / "abathur" / "review"


def review_runs_path() -> Path:
    return review_home() / "runs.json"


def review_spaces_dir() -> Path:
    return review_home() / "spaces"
