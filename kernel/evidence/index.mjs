import { appendFileSync, closeSync, existsSync, fsyncSync, openSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export const GENESIS = "0".repeat(64);

export function stable(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
}

/**
 * @param {string} prev
 * @param {unknown} body
 * @param {string} writer
 * @param {string} ts
 */
export function entryHash(prev, body, writer, ts) {
  return createHash("sha256").update(`${prev}\n${stable(body)}\n${writer}\n${ts}`).digest("hex");
}

/** Read the last valid entry, or null. */
export function lastEntry(path) {
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  if (lines.length === 0) return null;
  return JSON.parse(lines[lines.length - 1]);
}

/**
 * Single-writer append with fsync. Returns the written entry.
 * @param {string} path
 * @param {unknown} body
 * @param {{writer?:string, ts?:string, now?:()=>string}} [options]
 */
export function appendEntry(path, body, options = {}) {
  const writer = options.writer ?? "unknown";
  const ts = options.ts ?? (options.now ? options.now() : new Date().toISOString());
  const prev = lastEntry(path)?.hash ?? GENESIS;
  const entry = { seq: (lastEntry(path)?.seq ?? 0) + 1, ts, writer, body: body ?? null, prev };
  entry.hash = entryHash(entry.prev, entry.body, entry.writer, entry.ts);
  const fd = openSync(path, "a");
  try {
    appendFileSync(fd, `${JSON.stringify(entry)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return entry;
}

/**
 * Recompute the whole chain. Returns named problems (empty = valid).
 * @param {string} path
 */
export function verifyChain(path) {
  if (!existsSync(path)) return ["ledger does not exist"];
  const raw = readFileSync(path, "utf8");
  const problems = [];
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length === 0) return ["ledger is empty"];
  let prev = GENESIS;
  let expectedSeq = 1;
  for (const [index, line] of lines.entries()) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      problems.push(`line ${index + 1}: invalid JSON`);
      prev = "INVALID";
      continue;
    }
    if (entry.seq !== expectedSeq) problems.push(`line ${index + 1}: seq ${entry.seq} expected ${expectedSeq}`);
    if (entry.prev !== prev) problems.push(`line ${index + 1}: prev mismatch`);
    const want = entryHash(entry.prev, entry.body, entry.writer, entry.ts);
    if (entry.hash !== want) problems.push(`line ${index + 1}: hash mismatch`);
    prev = entry.hash;
    expectedSeq += 1;
  }
  return problems;
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * @param {string} path
 * @param {{cmd:string, rc:number, stdoutPath:string, stderrPath:string, writer?:string}} receipt
 */
export function writeReceipt(path, receipt) {
  return appendEntry(path, {
    cmd: receipt.cmd,
    rc: receipt.rc,
    stdout: { path: receipt.stdoutPath, sha256: sha256File(receipt.stdoutPath) },
    stderr: { path: receipt.stderrPath, sha256: sha256File(receipt.stderrPath) },
  }, { writer: receipt.writer ?? "abathur-v2" });
}
