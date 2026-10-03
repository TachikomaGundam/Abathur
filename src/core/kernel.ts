// Kernel manifest (todo 4): sha256 seal of every working-tree file matching the
// genome's immutableGlobs, stored out-of-tree at <configDir>/kernels/<fp16>.json.
// This module is READ-ONLY by design — resealing belongs exclusively to promote
// (todo 10): the oracle Critical #2 rule that tampering can never be laundered by
// a plain re-add. auditKernel() is the reuse seam for todos 9/10.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import { cannotAnswer } from "../exit.js";
import type { RegistryEntry } from "./genome.js";
import { compileGlob, listFiles } from "./glob.js";
import { effectiveRepoPath, errorText } from "./spec.js";

export const manifestEntrySchema = z.strictObject({
  glob: z.string().min(1),
  /** Repo-root-relative POSIX path. */
  path: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "expected 64-char lowercase sha256 hex"),
});
export type ManifestEntry = z.infer<typeof manifestEntrySchema>;

const manifestFileSchema = z.strictObject({ entries: z.array(manifestEntrySchema) });

export type DriftKind = "modified" | "missing" | "added";

export interface DriftedFile {
  readonly path: string;
  readonly kind: DriftKind;
  readonly glob: string;
}

export interface KernelAudit {
  readonly ok: boolean;
  readonly drifted: readonly DriftedFile[];
}

export function kernelsDirOf(configDir: string): string {
  return path.join(configDir, "kernels");
}

export function manifestPathFor(configDir: string, fingerprint16: string): string {
  return path.join(kernelsDirOf(configDir), `${fingerprint16}.json`);
}

function sha256File(absPath: string): string {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

/**
 * One entry per sealed file; `glob` attributes the FIRST matching pattern in
 * declaration order (spec fingerprint pins that order, so bytes are stable per
 * fingerprint). listFiles() is sorted ⇒ entries are sorted by path.
 */
export function buildManifest(repoRoot: string, globs: readonly string[]): ManifestEntry[] {
  const matchers = globs.map((glob) => ({ glob, re: compileGlob(glob) }));
  const entries: ManifestEntry[] = [];
  for (const rel of listFiles(repoRoot)) {
    const hit = matchers.find((matcher) => matcher.re.test(rel));
    if (hit !== undefined) {
      entries.push({ glob: hit.glob, path: rel, sha256: sha256File(path.join(repoRoot, rel)) });
    }
  }
  return entries;
}

/** Deterministic manifest bytes: key order fixed by the type, entries sorted by path. */
export function serializeManifest(entries: readonly ManifestEntry[]): string {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return `${JSON.stringify({ entries: sorted })}\n`;
}

/** Parse stored manifest text; throws a plain Error (callers map to exit codes). */
export function parseManifestText(text: string, origin: string): ManifestEntry[] {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (cause) {
    throw new Error(`malformed kernel manifest in ${origin}: ${errorText(cause)}`);
  }
  const result = manifestFileSchema.safeParse(document);
  if (!result.success) {
    throw new Error(`kernel manifest rejected in ${origin}: ${result.error.issues[0]?.message ?? "schema"}`);
  }
  return result.data.entries;
}

export function readManifestFile(filePath: string): ManifestEntry[] {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    throw new Error(`kernel manifest is missing: ${filePath}`);
  }
  return parseManifestText(text, filePath);
}

/** Set-diff of two manifests → deterministic drift list (sorted by path, then kind). */
export function compareManifest(
  saved: readonly ManifestEntry[],
  fresh: readonly ManifestEntry[],
): DriftedFile[] {
  const savedByPath = new Map(saved.map((entry) => [entry.path, entry]));
  const freshByPath = new Map(fresh.map((entry) => [entry.path, entry]));
  const drifted: DriftedFile[] = [];
  for (const [entryPath, entry] of savedByPath) {
    const now = freshByPath.get(entryPath);
    if (now === undefined) drifted.push({ path: entryPath, kind: "missing", glob: entry.glob });
    else if (now.sha256 !== entry.sha256) {
      drifted.push({ path: entryPath, kind: "modified", glob: entry.glob });
    }
  }
  for (const [entryPath, entry] of freshByPath) {
    if (!savedByPath.has(entryPath)) {
      drifted.push({ path: entryPath, kind: "added", glob: entry.glob });
    }
  }
  return drifted.sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind));
}

/**
 * Re-seal the genome's repo in memory and diff against the stored manifest.
 * Missing/corrupt manifest ⇒ exit 2 (cannot answer); any drift ⇒ ok:false with
 * every affected file named — consumed by `kernel audit` now, todos 9/10 later.
 */
export function auditKernel(entry: RegistryEntry, configDir: string): KernelAudit {
  const filePath = manifestPathFor(configDir, entry.fingerprint);
  let saved: ManifestEntry[];
  try {
    saved = readManifestFile(filePath);
  } catch (cause) {
    return cannotAnswer(
      `kernel audit: ${errorText(cause)} — genome '${entry.spec.label}' (${entry.fingerprint})`,
    );
  }
  const fresh = buildManifest(effectiveRepoPath(entry.spec.repoPath), entry.spec.kernel.immutableGlobs);
  const drifted = compareManifest(saved, fresh);
  return { ok: drifted.length === 0, drifted };
}
