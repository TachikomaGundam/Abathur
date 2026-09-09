// Canonical fingerprints + id construction (plan todo 2, AC a).
// Digest discipline mirrors hr/bench/manifest.py: sha256 over JSON with
// recursively sorted keys and no whitespace, so two producers of the same
// logical value always agree byte-for-byte.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function encode(value: unknown, top: boolean): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      // JSON.stringify would silently map non-finite to null: a digest
      // collision we refuse instead of trusting callers to pre-filter.
      if (!Number.isFinite(value)) {
        throw new TypeError(`canonicalJson: non-finite number ${String(value)}`);
      }
      return JSON.stringify(value);
    case "undefined":
      if (top) throw new TypeError("canonicalJson: undefined has no canonical encoding");
      return "null"; // JSON.stringify parity inside arrays; object props are dropped
    case "function":
    case "symbol":
    case "bigint":
      throw new TypeError(`canonicalJson: unsupported ${typeof value}`);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((el) => encode(el, false)).join(",")}]`;
      const proto: unknown = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new TypeError("canonicalJson: only plain JSON objects are accepted (convert Date etc. first)");
      }
      const parts: string[] = [];
      for (const key of Object.keys(value).sort()) {
        const child = (value as Record<string, unknown>)[key];
        if (child === undefined) continue;
        parts.push(`${JSON.stringify(key)}:${encode(child, false)}`);
      }
      return `{${parts.join(",")}}`;
    }
  }
  throw new TypeError(`canonicalJson: unsupported input of type ${typeof value}`);
}

/** Sorted-key, whitespace-free JSON — the canonical form every fingerprint hashes. */
export function canonicalJson(value: unknown): string {
  return encode(value, true);
}

export function fingerprint(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export interface TreeFile {
  readonly path: string;
  readonly content: Uint8Array | string;
}

/**
 * Content-only tree digest: sha256 over [{path, sha256(content)}] sorted by
 * path. Modes/mtimes/ownership are excluded BY CONSTRUCTION (never read), so
 * clone, checkout and chmod can never change the digest — only bytes can.
 */
export function fileTreeDigest(files: readonly TreeFile[]): string {
  const seen = new Set<string>();
  const rows: { path: string; sha256: string }[] = [];
  for (const { path: filePath, content } of files) {
    if (seen.has(filePath)) throw new Error(`fileTreeDigest: duplicate path '${filePath}'`);
    seen.add(filePath);
    rows.push({ path: filePath, sha256: sha256Hex(content) });
  }
  rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sha256Hex(canonicalJson(rows));
}

/** Regular files only (symlinks/dirs excluded), forward-slash paths relative to root. */
export function walkTree(root: string): TreeFile[] {
  const out: TreeFile[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) {
        out.push({
          path: path.relative(root, full).split(path.sep).join("/"),
          content: readFileSync(full),
        });
      }
    }
  };
  visit(root);
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

export function treeDigestAt(root: string): string {
  return fileTreeDigest(walkTree(root));
}

/** Compact path-safe UTC stamp: 2026-09-09T14:25:30.000Z -> 20260909T142530Z. */
export function compactUtc(at: Date): string {
  return at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Generation id: g-<ulctime>-<first8 of the generation content fingerprint>. */
export function genId(contentFingerprint: string, at?: Date): string {
  if (contentFingerprint.length === 0) {
    throw new TypeError("genId: fingerprint seed must be a non-empty string");
  }
  return `g-${compactUtc(at ?? new Date())}-${contentFingerprint.slice(0, 8)}`;
}

/** Run id: r-<genId>-<unitId>-<repIdx> — one benchmark repeat of one unit. */
export function runId(genId: string, unitId: string, repIdx: number): string {
  if (genId.length === 0) throw new TypeError("runId: genId must be non-empty");
  if (unitId.length === 0) throw new TypeError("runId: unitId must be non-empty");
  if (!Number.isInteger(repIdx) || repIdx < 0) {
    throw new TypeError(`runId: repIdx must be an integer >= 0, got ${String(repIdx)}`);
  }
  return `r-${genId}-${unitId}-${repIdx}`;
}

/**
 * Version of the BenchAdapter interface contract (todo 5 `src/bench/adapter.ts`:
 * reset/seed/run/score + RunResult/ScoreOutcome shapes). The todo 5 toy adapter and
 * todo 6 fixture adapter both implement this iface; any breaking change to that
 * surface must bump this constant so benchDigest values stop comparing across
 * incompatible adapter generations.
 */
export const ADAPTER_IFACE_VERSION = "abathur-bench-adapter-v1";

export interface BenchDigestUnit {
  readonly unitId: string;
  readonly content: Uint8Array | string;
}

export interface BenchDigestScript {
  readonly path: string;
  readonly content: Uint8Array | string;
}

/** Everything that can move a score, per plan oracle Major #6 (todo 12). */
export interface BenchDigestInput {
  readonly units: readonly BenchDigestUnit[];
  /** FILE CONTENTS of grader/seed/reset scripts (absent command ⇒ absent entry). */
  readonly scripts: readonly BenchDigestScript[];
  readonly graderCommand: string;
  readonly runCommand: string;
  readonly judgeCommand?: string | undefined;
  readonly agentModel?: string | undefined;
  readonly judgeModel?: string | undefined;
  readonly timeoutS: number;
}

function sha256Of(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Deterministic bench-configuration digest: sha256 over canonical JSON of the
 * unit list (sorted by unitId), script contents (sorted by path), the command
 * templates, models, timeout and the adapter iface version. Reordering units or
 * scripts never moves it; any content or config change always does.
 */
export function benchDigest(input: BenchDigestInput): string {
  return fingerprint({
    adapterIface: ADAPTER_IFACE_VERSION,
    agentModel: input.agentModel ?? null,
    graderCommand: input.graderCommand,
    judgeCommand: input.judgeCommand ?? null,
    judgeModel: input.judgeModel ?? null,
    runCommand: input.runCommand,
    scripts: [...input.scripts]
      .sort((a, b) => (a.path < b.path ? -1 : 1))
      .map((s) => ({ path: s.path, sha256: sha256Of(s.content) })),
    timeoutS: input.timeoutS,
    units: [...input.units]
      .sort((a, b) => (a.unitId < b.unitId ? -1 : 1))
      .map((u) => ({ unitId: u.unitId, sha256: sha256Of(u.content) })),
  });
}
