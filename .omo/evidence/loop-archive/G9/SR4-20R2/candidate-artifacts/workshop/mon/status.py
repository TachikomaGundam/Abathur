import os
import pathlib
import urllib.request

_ENV_FILE = pathlib.Path(__file__).with_name("mon.env")

def _health_url():
    url = os.environ.get("MON_HEALTH_URL")
    if url:
        return url
    for line in _ENV_FILE.read_text().splitlines():
        if line.startswith("MON_HEALTH_URL="):
            return line.split("=", 1)[1].strip()
    raise RuntimeError(f"MON_HEALTH_URL not found in {_ENV_FILE}")

URL = _health_url()

def ok():
    return urllib.request.urlopen(URL).status == 200
