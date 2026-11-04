import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { ensureDir, stateDir } from "./containment.mjs";

export const RUN_TTL_MS = 60 * 60 * 1000;

export function runsDir() {
  return join(stateDir(), "runs");
}

/**
 * Issue a run record. The launcher owns this call; a direct CLI invocation
 * does not create one and falls back to the repository surface.
 * @param {{surface?:string, root:string, origin?:string, ttlMs?:number}} options
 */
export function createRunRecord({ surface = "E1", root, origin = "launcher", ttlMs = RUN_TTL_MS }) {
  if (!isAbsolute(root)) throw new Error("run root must be absolute");
  const id = `run-${Date.now()}-${randomBytes(8).toString("hex")}`;
  const now = Date.now();
  const record = {
    id,
    surface,
    root: resolve(root),
    origin,
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttlMs).toISOString(),
  };
  ensureDir(runsDir());
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
  if (env.ABATHUR_RUN_ID && env.ABATHUR_RUN_ID !== record.id) {
    return { ok: false, code: "RUN-RECORD-MISMATCH", detail: "run id does not match the record" };
  }
  if (Date.parse(record.expires_at) <= Date.now()) {
    return { ok: false, code: "RUN-RECORD-EXPIRED", detail: record.expires_at };
  }
  return { ok: true, record };
}

/** Remove records older than the ttl. Best effort; called on launcher/CLI start. */
export function pruneRuns(maxAgeMs = RUN_TTL_MS) {
  const dir = runsDir();
  if (!existsSync(dir)) return 0;
  let removed = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    try {
      if (Date.now() - statSync(path).mtimeMs > maxAgeMs) {
        rmSync(path, { force: true });
        removed += 1;
      }
    } catch {
      // A record that cannot be statted is left for the reconciler.
    }
  }
  return removed;
}
