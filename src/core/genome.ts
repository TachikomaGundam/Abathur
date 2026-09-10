// Genome registry (todo 4): <configDir>/genomes/<fingerprint16>.jsonc + kernel
// manifests under <configDir>/kernels/<fingerprint16>.json — structurally outside
// every genome repo tree, so evolution can never mutate its own identity store.
// Identity is ONLY the content fingerprint (sha256 of canonical spec JSON via
// todo 2's ids.ts); labels are free and may repeat across distinct genomes.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { blocked, cannotAnswer } from "../exit.js";
import { parseJsonc } from "../jsonc.js";
import { canonicalJson, fingerprint } from "./ids.js";
import { filesMatching } from "./glob.js";
import {
  buildManifest,
  compareManifest,
  manifestPathFor,
  parseManifestText,
  readManifestFile,
  serializeManifest,
  type ManifestEntry,
} from "./kernel.js";
import {
  effectiveRepoPath,
  errorText,
  formatZodIssues,
  genomeSpecSchema,
  loadGenomeSpecFile,
  type GenomeSpec,
} from "./spec.js";

export interface RegistryEntry {
  /** 16 hex chars: filename stem for BOTH the registry .jsonc and the kernel .json. */
  readonly fingerprint: string;
  readonly label: string;
  readonly spec: GenomeSpec;
  readonly registryFile: string;
  readonly storedText: string;
}

export interface RegistryScan {
  readonly entries: readonly RegistryEntry[];
  readonly warnings: readonly string[];
}

export interface RegisterResult {
  readonly kind: "registered" | "already-sealed";
  readonly fingerprint: string;
  readonly label: string;
}

export function registryDirOf(configDir: string): string {
  return path.join(configDir, "genomes");
}

/** Stable 16-char content fingerprint of a parsed spec (ids.ts sha256, truncated). */
export function fingerprint16(spec: GenomeSpec): string {
  return fingerprint(spec).slice(0, 16);
}

function requireRepoPath(spec: GenomeSpec): string {
  const root = effectiveRepoPath(spec.repoPath);
  let isDirectory = false;
  try {
    isDirectory = statSync(root).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) {
    cannotAnswer(`genome: repoPath '${spec.repoPath}' is not a readable directory`);
  }
  return root;
}

/** Fail-closed: a seal pattern covering zero existing files is a spec error (exit 2). */
function requireSealedCoverage(repoRoot: string, spec: GenomeSpec): void {
  for (const glob of spec.kernel.immutableGlobs) {
    if (filesMatching(repoRoot, [glob]).length === 0) {
      cannotAnswer(
        `genome: kernel.immutableGlobs pattern '${glob}' matches no existing file under ${repoRoot} — ` +
          "fail-closed: every seal pattern must cover at least one file",
      );
    }
  }
}

/**
 * Superset rule (plan round-2 #2). EXACT semantics: for every registered genome whose
 * repoPath resolves to the same directory (any label, any fingerprint except this
 * one), every file that each of its existing globs matches IN THE CURRENT WORKING
 * TREE must be matched by at least one glob of the incoming spec. Resolved-pattern
 * comparison means vacuous/stale patterns (matching nothing now) pass trivially, and
 * equivalence is judged by file coverage, not string equality.
 */
function enforceGlobSuperset(configDir: string, spec: GenomeSpec, repoRoot: string): void {
  const incoming = new Set(filesMatching(repoRoot, spec.kernel.immutableGlobs));
  const self = fingerprint16(spec);
  const weakened: string[] = [];
  for (const entry of readRegistry(configDir).entries) {
    if (entry.fingerprint === self) continue; // same-fp re-add ⇒ manifest byte-compare
    if (effectiveRepoPath(entry.spec.repoPath) !== repoRoot) continue;
    for (const existing of entry.spec.kernel.immutableGlobs) {
      const uncovered = filesMatching(repoRoot, [existing]).filter((f) => !incoming.has(f));
      if (uncovered.length > 0 && !weakened.some((w) => w.startsWith(`'${existing}'`))) {
        weakened.push(`'${existing}' (no longer seals e.g. ${uncovered.slice(0, 3).join(", ")})`);
      }
    }
  }
  if (weakened.length > 0) {
    blocked(
      `genome add refused: incoming kernel.immutableGlobs weaken existing seals for ${repoRoot}: ` +
        `${weakened.join("; ")} — sealed globs may only grow until a promote reseals`,
    );
  }
}

/**
 * Re-add of an EXISTING fingerprint: byte-compare the recomputed kernel manifest
 * against the stored one. Equal ⇒ clean no-op; anything else ⇒ exit 1. This path
 * NEVER writes — tampering is resolved only at promote (todo 10), never by
 * resealing through `genome add`.
 */
function refuseReseal(
  configDir: string,
  fp: string,
  spec: GenomeSpec,
  freshManifestText: string,
): void {
  const filePath = manifestPathFor(configDir, fp);
  let saved: ManifestEntry[];
  try {
    saved = readManifestFile(filePath);
  } catch (cause) {
    blocked(
      `genome add refused: ${errorText(cause)} — refusing to reseal '${spec.label}' (${fp}); ` +
        "kernel resealing happens only at promote",
    );
  }
  const drifted = compareManifest(saved, parseManifestText(freshManifestText, filePath));
  if (drifted.length > 0) {
    const listed = drifted.map((d) => `${d.path} (${d.kind})`);
    const more = listed.length > 10 ? ` (+${String(listed.length - 10)} more)` : "";
    blocked(
      `genome add refused: kernel drifted for '${spec.label}' (${fp}): ` +
        `${listed.slice(0, 10).join(", ")}${more} — re-add never reseals; ` +
        "restore the tampered files or resolve drift at promote",
    );
  }
}

export function registerGenome(configDir: string, specFilePath: string): RegisterResult {
  const spec = loadGenomeSpecFile(specFilePath);
  const repoRoot = requireRepoPath(spec);
  requireSealedCoverage(repoRoot, spec);
  enforceGlobSuperset(configDir, spec, repoRoot);

  const fp = fingerprint16(spec);
  const registryFile = path.join(registryDirOf(configDir), `${fp}.jsonc`);
  const manifestText = serializeManifest(buildManifest(repoRoot, spec.kernel.immutableGlobs));
  if (existsSync(registryFile)) {
    refuseReseal(configDir, fp, spec, manifestText);
    return { kind: "already-sealed", fingerprint: fp, label: spec.label };
  }
  mkdirSync(registryDirOf(configDir), { recursive: true });
  mkdirSync(path.dirname(manifestPathFor(configDir, fp)), { recursive: true });
  writeFileSync(registryFile, `${canonicalJson(spec)}\n`, "utf8");
  writeFileSync(manifestPathFor(configDir, fp), manifestText, "utf8");
  return { kind: "registered", fingerprint: fp, label: spec.label };
}

/** Parse one registry file into an entry, or return the warning describing why not. */
function scanRegistryFile(filePath: string, fp: string): RegistryEntry | string {
  let text: string;
  let document: unknown;
  try {
    text = readFileSync(filePath, "utf8");
    document = parseJsonc(text);
  } catch (cause) {
    return `malformed JSONC (${errorText(cause)})`;
  }
  const result = genomeSpecSchema.safeParse(document);
  if (!result.success) {
    return `does not validate as GenomeSpec: ${formatZodIssues(result.error.issues).join("; ")}`;
  }
  if (fingerprint16(result.data) !== fp) {
    return "content does not match its filename fingerprint (registry edited out-of-band)";
  }
  return {
    fingerprint: fp,
    label: result.data.label,
    spec: result.data,
    registryFile: filePath,
    storedText: text,
  };
}

/**
 * Read every registry entry. Corrupt / foreign entries degrade to warnings — stale
 * or meddled state must never crash `list`/`show`/`audit`.
 */
export function readRegistry(configDir: string): RegistryScan {
  const dir = registryDirOf(configDir);
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((name) => name.endsWith(".jsonc"))
      .sort();
  } catch {
    return { entries: [], warnings: [] }; // no registry yet = empty, not an error
  }
  const entries: RegistryEntry[] = [];
  const warnings: string[] = [];
  for (const name of names) {
    const scanned = scanRegistryFile(path.join(dir, name), name.slice(0, -".jsonc".length));
    if (typeof scanned === "string") warnings.push(`${name}: ${scanned}`);
    else entries.push(scanned);
  }
  return { entries, warnings };
}

/** Labels are non-unique: returns EVERY genome registered under `label`, exit 2 if none. */
export function requireGenomesByLabel(configDir: string, label: string): RegistryScan {
  const scan = readRegistry(configDir);
  const matches = scan.entries.filter((entry) => entry.label === label);
  if (matches.length === 0) {
    cannotAnswer(
      `genome: no registered genome with label '${label}'`,
      "check 'abathur genome list'; if the registry was deleted out-of-band, re-add the spec",
    );
  }
  return { entries: matches, warnings: scan.warnings };
}
