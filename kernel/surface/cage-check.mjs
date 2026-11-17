// cage-check.mjs — R1 remediation for wound W-2026-11-17-E (engine v2.3.0 silently
// killed the sandbox hook; the seat discovered it only by an accidental differential
// probe). Invariant restored: every "inside E1 cage" claim must have a same-shift
// mechanical re-check. This module answers, from inside the current process:
// "am I actually inside the bwrap cage, did the hook die, or can I not tell?"
//
// Signals mirror buildArgv() in .opencode/plugins/sandbox-bash.js (single source of
// cage shape): --setenv CAGE_BORN_AT/LAUNCHER_STARTED_AT, --unshare-pid, --proc,
// tmpfs over HOST_HOME, and the CAGE heartbeat line the wrapper appends per shell.
// Zero-dependency stdlib; readers injectable for tests. Never claims "live" on
// partial evidence — mixed signals return DISPUTED for human ruling.

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";

export const DEFAULT_LOG = "/tmp/opencode/abathur-sandbox.log";

function parseNspid(statusText) {
  const m = /^NSpid:\s+(.+)$/m.exec(statusText);
  if (!m) return null;
  return m[1].trim().split(/\s+/).length; // >=2 => nested pid namespace
}

export function checkCagePresence({
  env = process.env,
  logPath = DEFAULT_LOG,
  hostHome = homedir(),
  now = Date.now(),
  freshMs = 15_000,
  read = (p) => readFileSync(p, "utf8"),
  exists = (p) => existsSync(p),
} = {}) {
  const checks = {};

  // 1) cage environment signature (injected by buildArgv --setenv)
  checks.envSig = Boolean(env.CAGE_BORN_AT && env.LAUNCHER_STARTED_AT);
  checks.runRecord = env.ABATHUR_RUN_ID ? exists("/abathur-run.json") : null;

  // 2) pid namespace (cage uses --unshare-pid)
  let nspid = null;
  try {
    nspid = parseNspid(read("/proc/self/status"));
  } catch {
    nspid = null;
  }
  checks.pidNs = nspid === null ? null : nspid >= 2;

  // 3) tmpfs shadow over HOST_HOME (cage uses --tmpfs HOST_HOME)
  let homeTmpfs = null;
  try {
    const mounts = read("/proc/mounts");
    homeTmpfs = mounts
      .split("\n")
      .some((l) => l.startsWith(`tmpfs ${hostHome} tmpfs`));
  } catch {
    homeTmpfs = null;
  }
  checks.homeTmpfs = homeTmpfs;

  // 4) hook heartbeat: the wrapper appends one CAGE line per wrapped shell;
  //    a live hook logs THIS very check command, so a fresh line is expected.
  let heartbeat = null;
  try {
    const log = read(logPath);
    const lines = log.trimEnd().split("\n");
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 50; i--) {
      const m = /CAGE seq=\d+ born=(\S+)/.exec(lines[i]);
      if (m) {
        const born = Date.parse(m[1]);
        heartbeat = Number.isFinite(born) && now - born <= freshMs;
        break;
      }
    }
    if (heartbeat === null && lines.length) heartbeat = false;
  } catch {
    heartbeat = null; // log unreadable: cannot-answer on this signal only
  }
  checks.hookHeartbeat = heartbeat;

  // verdict: fail-closed toward honesty, never "live" on partials.
  // env vars alone cannot prove cage (host can export them); kernel signals
  // (pid ns, tmpfs mount) require a real cage, so LIVE needs envSig + one kernel.
  const kernelCage = checks.pidNs === true || checks.homeTmpfs === true;
  let verdict;
  if (checks.envSig && kernelCage && checks.pidNs !== false && checks.homeTmpfs !== false) {
    verdict = checks.hookHeartbeat === false ? "DISPUTED" : "LIVE";
  } else if (!checks.envSig && checks.pidNs === false && checks.homeTmpfs === false) {
    // full host picture: env absent is conclusive only if both kernel signals
    // confirm host namespace AND no fresh heartbeat contradicts
    verdict = checks.hookHeartbeat === true ? "DISPUTED" : "DEAD";
  } else {
    verdict = "DISPUTED";
  }
  return { verdict, checks, ts: new Date(now).toISOString() };
}

export const EXIT = { LIVE: 0, DEAD: 1, DISPUTED: 2 };
