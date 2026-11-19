// cage-check.mjs — R1 remediation for wound W-2026-11-17-E (sandbox hook was
// dead for a full shift before an accidental differential probe noticed).
// Invariant restored: every "inside E1 cage" claim must have a same-shift
// mechanical re-check. This module answers, from inside the current process:
// "am I actually inside the bwrap cage, is the hook dead, did the check fail
// to run, or can I not tell?"
//
// Schema v1 (2026-11-20, per council 3794 must_fix on clause-2): vocabulary
// ALIVE/DEAD/DISPUTED/NOT-RUN pinned by contract "aw-cagecheck/1" / schema
// "cage-verdict/1"; NOT-RUN = core evidence unreadable (≠ DEAD — absence of
// evidence is not evidence of absence); receipts bind the cage instance
// (run/born) so heartbeats from OTHER cage instances never prove this one's
// hook alive (cross-instance void).
//
// Signals mirror buildArgv() in .opencode/plugins/sandbox-bash.js (single source of
// cage shape): --setenv CAGE_BORN_AT/LAUNCHER_STARTED_AT, --unshare-pid, --proc,
// tmpfs over HOST_HOME, and the CAGE heartbeat line the wrapper appends per shell.
// Zero-dependency stdlib; readers injectable for tests. Never claims alive on
// partial evidence — mixed signals return DISPUTED for human ruling.

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const CONTRACT = "aw-cagecheck/1";
export const SCHEMA = "cage-verdict/1";
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

  // 4) hook heartbeat: the wrapper appends one CAGE line per wrapped shell.
  //    Schema v1 binds heartbeats to THIS cage instance: a line counts as own
  //    only when born === env.CAGE_BORN_AT. Fresh lines from other instances
  //    are recorded (crossInstance flag: their presence while ours is missing
  //    is a contradiction, not proof) but never certify this instance.
  let heartbeat = null;
  let crossInstance = false;
  try {
    const log = read(logPath);
    const lines = log.trimEnd().split("\n");
    const ownBorn = env.CAGE_BORN_AT ?? null;
    let freshAny = false;
    let freshOwn = false;
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 50; i--) {
      const m = /CAGE seq=\d+ born=(\S+)/.exec(lines[i]);
      if (!m) continue;
      const born = Date.parse(m[1]);
      if (!Number.isFinite(born) || now - born > freshMs) continue;
      freshAny = true;
      if (ownBorn === null || m[1] === ownBorn) freshOwn = true;
      else crossInstance = true;
      if (freshOwn) break;
    }
    if (lines.length) heartbeat = ownBorn === null ? freshAny : freshOwn;
  } catch {
    heartbeat = null; // log unreadable: cannot-answer on this signal only
  }
  checks.hookHeartbeat = heartbeat;
  checks.hookHeartbeatCrossInstance = crossInstance;

  // verdict: fail-closed toward honesty, never "alive" on partials.
  // NOT-RUN (schema v1): both kernel views unreadable → the check itself
  // could not run against core evidence; that is NOT death, it is no verdict.
  if (checks.pidNs === null && checks.homeTmpfs === null) {
    return finish("NOT-RUN", checks, now, env);
  }
  // D-1 (2026-11-19): from INSIDE the cage the kernel masks the NSpid chain
  // (multi-value NSpid is only visible to the PARENT namespace), so a real
  // caged self-check always sees pidNs=false. ALIVE therefore keys on
  // envSig + tmpfs-over-home (visible in own mounts) + one strong signal
  // (run record file at cage root / externally-observed pid ns / fresh
  // own-instance heartbeat). env forgery alone still can never produce ALIVE.
  const kernelCage = checks.homeTmpfs === true || checks.pidNs === true;
  const strong = checks.pidNs === true || checks.runRecord === true || checks.hookHeartbeat === true;
  let verdict;
  if (checks.envSig && checks.homeTmpfs === true) {
    verdict = checks.hookHeartbeat === false ? "DISPUTED" : strong ? "ALIVE" : "DISPUTED";
  } else if (checks.envSig && kernelCage && checks.pidNs === true) {
    // external-observer picture (sees nested pid ns, no home mount view)
    verdict = checks.hookHeartbeat === false ? "DISPUTED" : strong ? "ALIVE" : "DISPUTED";
  } else if (!checks.envSig && checks.pidNs === false && checks.homeTmpfs === false) {
    // full host picture: env absent is conclusive only if both kernel signals
    // confirm host namespace AND no fresh heartbeat contradicts
    verdict = checks.hookHeartbeat === true ? "DISPUTED" : "DEAD";
  } else {
    verdict = "DISPUTED";
  }
  return finish(verdict, checks, now, env);
}

function finish(verdict, checks, now, env) {
  let scriptSha = null;
  try {
    scriptSha = createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex");
  } catch {
    scriptSha = null; // hash is an attestation field, never a gate
  }
  return {
    contract: CONTRACT,
    schema: SCHEMA,
    verdict,
    checks,
    cage_instance: {
      run: env.ABATHUR_RUN_ID ?? null,
      born: env.CAGE_BORN_AT ?? null,
    },
    script_sha256: scriptSha,
    ts: new Date(now).toISOString(),
  };
}

export const EXIT = { ALIVE: 0, DEAD: 1, DISPUTED: 2, "NOT-RUN": 3 };
