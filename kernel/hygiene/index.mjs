import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export const EVIDENCE_DENYLIST = [/\/\.omo\/evidence(\/|$)/, /\/\.omo\/anchor(\/|$)/];

/**
 * Delete only when the manifest exists, is non-empty, every file hash matches, and
 * no target is on the evidence denylist.
 * @param {string} root
 * @param {{files:Array<{path:string,sha256:string}>}} manifest
 * @param {{denylist?:RegExp[]}} [options]
 */
export function reclaim(root, manifest, options = {}) {
  const denylist = options.denylist ?? EVIDENCE_DENYLIST;
  if (!manifest || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    return { rc: 2, code: "MANIFEST-MISSING", detail: "manifest has no entries" };
  }
  for (const row of manifest.files) {
    if (typeof row.path !== "string" || !row.path.startsWith("/")) {
      return { rc: 2, code: "BAD-MANIFEST", detail: "absolute path required" };
    }
    if (denylist.some((pattern) => pattern.test(row.path))) {
      return { rc: 2, code: "DENYLISTED", detail: `${row.path} is protected evidence` };
    }
    if (!existsSync(row.path)) return { rc: 2, code: "MISSING", detail: row.path };
    const actual = createHash("sha256").update(readFileSync(row.path)).digest("hex");
    if (actual !== row.sha256) return { rc: 2, code: "HASH-MISMATCH", detail: row.path };
  }
  for (const row of manifest.files) rmSync(row.path, { force: true });
  return { rc: 0, code: "RECLAIMED", count: manifest.files.length, root };
}

/** Keep the newest N entries by name; return removed names. */
export function retention(dir, keepN) {
  if (!Number.isInteger(keepN) || keepN < 1) return { rc: 2, code: "BAD-KEEP", removed: [] };
  if (!existsSync(dir)) return { rc: 0, code: "NOTHING", removed: [] };
  const names = readdirSync(dir).sort();
  const remove = names.slice(0, Math.max(0, names.length - keepN));
  for (const name of remove) rmSync(join(dir, name), { recursive: true, force: true });
  return { rc: 0, code: "RETENTION-OK", removed: remove };
}

/** Report only; never deletes evidence. */
export function watermark(path, maxBytes) {
  if (!existsSync(path)) return { rc: 2, code: "MISSING", path };
  const size = statSync(path).size;
  return { rc: size > maxBytes ? 1 : 0, code: size > maxBytes ? "OVER-WATERMARK" : "OK", size };
}

/** List temporary resources with a required named reason field. */
export function orphanScan(root, reasons = {}) {
  if (!existsSync(root)) return { rc: 2, code: "MISSING", root };
  const rows = readdirSync(root).map((name) => ({
    name,
    reason: reasons[name] ?? null,
    named: Boolean(reasons[name]),
  }));
  return { rc: 0, rows };
}
