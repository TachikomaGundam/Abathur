import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

/**
 * Fixed roots are the only authority for destructive targets. Nothing here
 * accepts a caller-supplied root: the CLI supplies the operation, not the
 * boundary.
 */
export function findRepoRoot(start = process.cwd()) {
  let cursor = resolve(start);
  for (;;) {
    if (existsSync(join(cursor, ".git"))) return cursor;
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

const DETECTED_ROOT = findRepoRoot();
/** E1 is the repository around the working directory, never the package dir. */
export const REPO_ROOT = DETECTED_ROOT ?? process.cwd();
export const IN_REPO = DETECTED_ROOT !== null;

const HOME = process.env.HOME ?? "/tmp";

/** User state directory. Created on first use; no install step. */
export function stateDir() {
  return resolve(process.env.ABATHUR_STATE_DIR ?? join(HOME, ".local", "state", "abathur"));
}

export function tempRoot() {
  return join(stateDir(), "tmp");
}

export function evidenceRoots() {
  return [join(REPO_ROOT, ".omo", "evidence"), join(stateDir(), "evidence")];
}

export function ensureDir(path, mode = 0o700) {
  mkdirSync(path, { recursive: true, mode });
}

/**
 * Resolve a path to its real location, including non-existent tails. This is
 * what makes `..` and symlinked parents fail closed instead of escaping.
 */
export function canonical(target) {
  if (typeof target !== "string" || !isAbsolute(target)) {
    return null;
  }
  let cursor = resolve(target);
  const tail = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    tail.unshift(cursor.slice(parent.length + 1));
    cursor = parent;
  }
  let real;
  try {
    real = realpathSync(cursor);
  } catch {
    real = cursor;
  }
  return resolve(real, ...tail);
}

export function inside(root, target) {
  const realRoot = canonical(root);
  const realTarget = canonical(target);
  if (!realRoot || !realTarget) return false;
  return realTarget === realRoot || realTarget.startsWith(`${realRoot}${sep}`);
}

/**
 * @param {string} target
 * @param {string[]} roots
 * @returns {{ok:boolean, code:string, target:string|null, roots:string[]}}
 */
export function checkInside(target, roots) {
  const real = canonical(target);
  if (!real) return { ok: false, code: "BAD-PATH", target: null, roots };
  for (const root of roots) {
    if (inside(root, real)) return { ok: true, code: "CONTAINED", target: real, roots };
  }
  return { ok: false, code: "OUTSIDE-ROOT", target: real, roots };
}

export function deny(op, target, roots) {
  const path = join(stateDir(), "denials.jsonl");
  ensureDir(stateDir());
  let prev = "0".repeat(64);
  if (existsSync(path)) {
    const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
    if (lines.length) prev = JSON.parse(lines[lines.length - 1]).hash;
  }
  const body = {
    ts: new Date().toISOString(),
    op,
    target,
    roots,
    code: "OUTSIDE-ROOT",
  };
  const hash = createHash("sha256").update(`${prev}\n${JSON.stringify(body)}`).digest("hex");
  appendFileSync(path, `${JSON.stringify({ ...body, prev, hash })}\n`);
  return { rc: 2, code: "OUTSIDE-ROOT", detail: `${target} is outside the allowed roots`, hash };
}

export function isSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
