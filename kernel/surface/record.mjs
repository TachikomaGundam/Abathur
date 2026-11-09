import { randomBytes, createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { ensureDir, inside, stateDir, tempRoot } from "./containment.mjs";

export const RUN_TTL_MS = 60 * 60 * 1000;

export function runsDir() {
  return join(stateDir(), "runs");
}

/**
 * Issue a run record. The launcher owns this call; a direct CLI invocation
 * does not create one and falls back to the repository surface.
 * @param {{surface?:string, root:string, origin?:string, ttlMs?:number, pid?:number, leases?:string[]}} options
 */
export function createRunRecord({ surface = "E1", root, origin = "launcher", ttlMs = RUN_TTL_MS, pid = process.pid, leases = [] }) {
  if (!isAbsolute(root)) throw new Error("run root must be absolute");
  for (const lease of leases) {
    if (!isAbsolute(lease) || !inside(tempRoot(), lease)) {
      throw new Error("run leases must be inside the state temp root");
    }
  }
  const id = `run-${Date.now()}-${randomBytes(8).toString("hex")}`;
  const now = Date.now();
  const record = {
    id,
    surface,
    root: resolve(root),
    origin,
    pid,
    leases: leases.map((lease) => resolve(lease)),
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttlMs).toISOString(),
  };
  ensureDir(runsDir());
  reconcileRuns({ now });
  const path = join(runsDir(), `${id}.json`);
  writeFileSync(path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  return { path, record };
}

/**
 * @param {string|undefined} recordPath
 * @param {Record<string,string|undefined>} [env]
 * @returns {{ok:true, record:object}|{ok:false, code:string, detail:string}}
 */
export function readRunRecord(recordPath, env = process.env) {
  if (!recordPath) return { ok: false, code: "RUN-RECORD-MISSING", detail: "no record path" };
  if (!existsSync(recordPath)) return { ok: false, code: "RUN-RECORD-MISSING", detail: recordPath };
  let record;
  try {
    record = JSON.parse(readFileSync(recordPath, "utf8"));
  } catch (error) {
    return { ok: false, code: "RUN-RECORD-MALFORMED", detail: error.message };
  }
  for (const field of ["id", "surface", "root", "origin", "issued_at", "expires_at"]) {
    if (typeof record[field] !== "string" || record[field].length === 0) {
      return { ok: false, code: "RUN-RECORD-MALFORMED", detail: `missing ${field}` };
    }
  }
  if (!isAbsolute(record.root)) return { ok: false, code: "RUN-RECORD-MALFORMED", detail: "root must be absolute" };
  const resolvedPath = resolve(recordPath);
  const bindPath = resolvedPath === "/abathur-run.json";
  const inRuns = inside(runsDir(), resolvedPath) && basename(resolvedPath) === `${record.id}.json`;
  if (!bindPath && !inRuns) {
    return { ok: false, code: "RUN-RECORD-UNTRUSTED", detail: "record path is outside the state runs directory" };
  }
  if (record.origin !== "launcher") {
    return { ok: false, code: "RUN-RECORD-UNTRUSTED", detail: "record origin must be launcher" };
  }
  if (!env.ABATHUR_RUN_ID) {
    return { ok: false, code: "RUN-RECORD-MISMATCH", detail: "run id is required" };
  }
  if (env.ABATHUR_RUN_ID !== record.id) {
    return { ok: false, code: "RUN-RECORD-MISMATCH", detail: "run id does not match the record" };
  }
  if (typeof record.pid === "number" && !defaultIsAlive(record.pid)) {
    return { ok: false, code: "RUN-RECORD-EXPIRED", detail: "issuing process is gone" };
  }
  if (Date.parse(record.expires_at) <= Date.now()) {
    return { ok: false, code: "RUN-RECORD-EXPIRED", detail: record.expires_at };
  }
  return { ok: true, record };
}

function defaultIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/**
 * Close runs that can no longer be alive: the record expired and its process is
 * gone. Only leases inside the state temp root may be removed. Runs without a
 * record are reported, never deleted.
 */
export function reconcileRuns({ now = Date.now(), isAlive = defaultIsAlive } = {}) {
  const dir = runsDir();
  const report = { closed: 0, kept: 0, malformed: 0, removed_leases: 0, refused_leases: 0, orphans: [] };
  if (!existsSync(dir)) return report;
  const known = new Set();
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    let record;
    try {
      record = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      report.malformed += 1;
      continue;
    }
    if (typeof record.id === "string") known.add(record.id);
    const expired = Date.parse(record.expires_at) <= now;
    const alive = typeof record.pid === "number" ? isAlive(record.pid) : true;
    if (!expired || alive) {
      report.kept += 1;
      continue;
    }
    const removed = [];
    const refused = [];
    for (const lease of Array.isArray(record.leases) ? record.leases : []) {
      if (typeof lease !== "string" || !inside(tempRoot(), lease)) {
        refused.push(lease);
        report.refused_leases += 1;
        continue;
      }
      if (existsSync(lease)) {
        rmSync(lease, { recursive: true, force: true });
        removed.push(lease);
        report.removed_leases += 1;
      }
    }
    const recordSha = createHash("sha256").update(JSON.stringify(record)).digest("hex");
    appendFileSync(
      join(dir, "closed.jsonl"),
      `${JSON.stringify({
        id: record.id,
        closed_at: new Date(now).toISOString(),
        reason: "expired-and-dead",
        pid: record.pid ?? null,
        removed,
        refused,
        record_sha256: recordSha,
      })}\n`,
    );
    rmSync(path, { force: true });
    report.closed += 1;
  }
  const root = tempRoot();
  if (existsSync(root)) {
    for (const name of readdirSync(root)) {
      if (name.startsWith("run-") && !known.has(name)) report.orphans.push(join(root, name));
    }
  }
  return report;
}

/** Backwards-compatible name: the sweep is now the reconciler. */
export function pruneRuns() {
  return reconcileRuns().closed;
}
