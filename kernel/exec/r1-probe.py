#!/usr/bin/env python3
"""R1 in-jail probe. PID-1 entrypoint; starts the target, streams artifacts.

This file runs *inside* bubblewrap. It does not trust the target and it does
not trust paths: artifact symlinks are refused, and mounts other than the
artifact tmpfs are not walked.
"""
import ctypes
import hashlib
import json
import os
import resource
import signal
import stat
import sys

REQUEST = "/run/warden/request.json"
ARTIFACT_FD = 3
FRAME_LIMIT = 256 * 1024 * 1024

PR_SET_PDEATHSIG = 1
PR_SET_DUMPABLE = 4
PR_SET_NO_NEW_PRIVS = 38
LINUX_CAPABILITY_VERSION_3 = 0x20080522


def fail(code, detail, exit_code=111, stream=True):
    if stream:
        try:
            header = json.dumps({"type": "error", "code": code, "detail": str(detail)[:500]}, separators=(",", ":")).encode() + b"\n"
            os.write(ARTIFACT_FD, header)
        except OSError:
            pass
    sys.stderr.write("%s: %s\n" % (code, detail))
    raise SystemExit(exit_code)


def prctl(option, arg2=0):
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(option, ctypes.c_ulong(arg2), 0, 0, 0) != 0:
        err = ctypes.get_errno()
        fail("R1-PROBE-PRCTL", "prctl(%d) failed: %s" % (option, os.strerror(err)), 112, stream=False)


def clear_caps():
    class Header(ctypes.Structure):
        _fields_ = [("version", ctypes.c_uint32), ("pid", ctypes.c_int)]

    class Data(ctypes.Structure):
        _fields_ = [("effective", ctypes.c_uint32), ("permitted", ctypes.c_uint32), ("inheritable", ctypes.c_uint32)]

    libc = ctypes.CDLL(None, use_errno=True)
    header = Header(LINUX_CAPABILITY_VERSION_3, 0)
    data = (Data * 2)()
    if libc.capset(ctypes.byref(header), ctypes.byref(data)) != 0:
        err = ctypes.get_errno()
        fail("R1-PROBE-CAPSET", "capset failed: %s" % os.strerror(err), 112, stream=False)


def status_field(name):
    try:
        with open("/proc/self/status", encoding="ascii") as handle:
            for line in handle:
                if line.startswith(name + ":"):
                    return line.split(":", 1)[1].strip()
    except OSError:
        return None
    return None


def self_check():
    problems = []
    if os.getpid() != 1:
        problems.append("probe is not PID 1")
    if not os.path.isdir("/proc/1"):
        problems.append("/proc/1 missing")
    try:
        if os.stat("/home").st_dev == os.stat("/").st_dev:
            problems.append("/home is not a separate tmpfs")
    except OSError as error:
        problems.append("/home check failed: %s" % error)
    if status_field("NoNewPrivs") != "1":
        problems.append("NoNewPrivs is not 1")
    if status_field("CapEff") not in ("0000000000000000", "0"):
        problems.append("CapEff is not empty")
    try:
        with open("/proc/net/dev", encoding="ascii") as handle:
            interfaces = [line.split(":", 1)[0].strip() for line in handle if ":" in line][1:]
        extra = [name for name in interfaces if name != "lo"]
        if extra:
            problems.append("network interfaces present: %s" % ",".join(extra))
    except OSError:
        pass
    return problems


def frame_stream():
    cap = 0
    digest = hashlib.sha256()

    def send(obj, data=b""):
        nonlocal cap
        header = json.dumps(obj, separators=(",", ":")).encode() + b"\n"
        cap += len(header) + len(data)
        if cap > FRAME_LIMIT:
            fail("R1-ARTIFACT-CAP", "artifact stream exceeded cap", 113)
        digest.update(header)
        os.write(ARTIFACT_FD, header)
        if data:
            digest.update(data)
            os.write(ARTIFACT_FD, data)

    def finish(exit_code, signal_no):
        send({"type": "summary", "exit": exit_code, "signal": signal_no})
        # The terminator covers every byte before it; the controller re-hashes.
        term = json.dumps({"type": "terminator", "sha256": digest.hexdigest()}, separators=(",", ":")).encode() + b"\n"
        os.write(ARTIFACT_FD, term)

    return send, finish


def collect(send, output):
    root = os.path.realpath(output)
    if not os.path.isdir(root):
        return
    root_dev = os.stat(root).st_dev
    for current, dirs, files in os.walk(root, topdown=True, followlinks=False):
        try:
            if os.stat(current).st_dev != root_dev:
                dirs[:] = []
                continue
        except OSError:
            dirs[:] = []
            continue
        dirs[:] = sorted(name for name in dirs if not os.path.islink(os.path.join(current, name)))
        for name in sorted(files):
            path = os.path.join(current, name)
            try:
                info = os.lstat(path)
            except OSError as error:
                fail("R1-ARTIFACT-REFUSED", "lstat %s: %s" % (path, error), 114)
            if stat.S_ISLNK(info.st_mode):
                fail("R1-ARTIFACT-REFUSED", "symlink in artifacts: %s" % path, 114)
            if not stat.S_ISREG(info.st_mode):
                continue
            rel = os.path.relpath(path, root)
            if rel == ".." or rel.startswith("../") or os.path.isabs(rel):
                fail("R1-ARTIFACT-REFUSED", "artifact escaped root: %s" % path, 114)
            try:
                with open(path, "rb") as handle:
                    data = handle.read()
            except OSError as error:
                fail("R1-ARTIFACT-REFUSED", "read %s: %s" % (path, error), 114)
            send({"type": "file", "path": rel, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}, data)


def main():
    global ARTIFACT_FD
    request_path = sys.argv[1] if len(sys.argv) > 1 else REQUEST
    cwd = sys.argv[2] if len(sys.argv) > 2 else "/run/warden/artifacts"
    output = sys.argv[3] if len(sys.argv) > 3 else "/run/warden/artifacts"
    artifact_fd = int(sys.argv[4]) if len(sys.argv) > 4 else ARTIFACT_FD

    ARTIFACT_FD = artifact_fd
    prctl(PR_SET_PDEATHSIG, signal.SIGKILL)
    prctl(PR_SET_DUMPABLE, 0)
    prctl(PR_SET_NO_NEW_PRIVS, 1)
    clear_caps()

    problems = self_check()
    if problems:
        fail("R1-PROBE-SELFCHECK", "; ".join(problems), 115)

    try:
        with open(request_path, encoding="utf-8") as handle:
            request = json.load(handle)
    except (OSError, ValueError) as error:
        fail("R1-REQUEST-INVALID", error, 116, stream=False)
    argv = request.get("argv")
    env = request.get("env") or {}
    if not isinstance(argv, list) or not argv or any(not isinstance(arg, str) for arg in argv):
        fail("R1-ARGV-INVALID", "argv must be a non-empty string array", 116, stream=False)
    if not isinstance(env, dict):
        fail("R1-ENV-INVALID", "env must be an object", 116, stream=False)
    os.makedirs(cwd, exist_ok=True)
    os.makedirs(output, exist_ok=True)

    send, finish = frame_stream()
    pid = os.fork()
    if pid == 0:
        try:
            clear_caps()
            prctl(PR_SET_DUMPABLE, 0)
            limit = 8 * 1024 * 1024 * 1024
            resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
            os.close(ARTIFACT_FD)
            os.execvpe(argv[0], argv, env)
        except BaseException as error:
            sys.stderr.write("R1-EXEC-FAILED: %s\n" % error)
            os._exit(127)

    _, status = os.waitpid(pid, 0)
    exit_code = os.waitstatus_to_exitcode(status)
    signal_no = 0
    if os.WIFSIGNALED(status):
        signal_no = os.WTERMSIG(status)
    collect(send, output)
    finish(exit_code, signal_no)
    if signal_no:
        os.kill(os.getpid(), signal_no)
    raise SystemExit(exit_code if exit_code >= 0 else 1)


if __name__ == "__main__":
    main()
