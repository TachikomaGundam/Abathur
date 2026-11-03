import os
import sys
from pathlib import Path


def unrelated_report(path):
    p = Path(path)
    return p.name


def scale(xs, factor):
    return [x * factor for x in xs]
