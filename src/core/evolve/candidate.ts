// Candidate validation for the mutator session (todo 8, plan lines 133-140).
// Everything is pure: zod schema for the child's output contract, the central
// ARTIFACT_GLOBS policy, gitignore → glob translation, and validateCandidate
// which turns one raw candidate into parsed FileChanges or a staged rejection.
// WHOLE-CANDIDATE REJECTION is the rule: any single violating path rejects the
// entire candidate — there is no partial-apply path through this module.

import { z } from "zod";
import path from "node:path";

import { compileGlob } from "../glob.js";
import { formatZodIssues } from "../spec.js";
import { parseUnifiedDiff, type FileChange } from "./udiff.js";

/**
 * Build/hidden state that evolution must never write. Plan wording:
 * ".gitignore'd outputs, dist/**, node_modules/**, .state/**, *.local.jsonc".
 * `.state/**` doubles as the ledger-seal surface — mutating it from a candidate
 * is self-tampering. Deep variants cover nested installs; the repo's own
 * .gitignore is folded in via artifactGlobsFromGitignore at session time.
 */
export const ARTIFACT_GLOBS: readonly string[] = Object.freeze([
  "dist/**",
  "**/dist/**",
  "node_modules/**",
  "**/node_modules/**",
  ".state/**",
  "**/.state/**",
  "*.local.jsonc",
  "**/*.local.jsonc",
]);

/** Translate .gitignore lines into our glob language (fail-closed broadening). */
export function artifactGlobsFromGitignore(text: string): string[] {
  const globs: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("!")) continue;
    const dirStyle = line.endsWith("/");
    const body = dirStyle ? line.slice(0, -1) : line;
    const core = body.startsWith("/") ? body.slice(1) : body;
    if (core === "") continue;
    if (dirStyle) {
      globs.push(`${core}/**`);
      if (!core.includes("/")) globs.push(`**/${core}/**`);
    } else if (!core.includes("/")) {
      globs.push(core, `**/${core}`);
    } else {
      globs.push(core);
    }
  }
  return globs;
}

/** One mutator candidate: unified diff chunks + a rationale string (plan contract). */
export const candidateSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)
    .optional(),
  rationale: z.string().min(1).max(4000),
  diffs: z.array(z.string().min(1)).min(1),
});

/** Top level of the child's stdout; elements are schema-checked per candidate. */
export const mutatorOutputSchema = z.strictObject({
  candidates: z.array(z.unknown()).min(1),
});

export interface PathPolicy {
  readonly immutableGlobs: readonly string[];
  readonly artifactGlobs: readonly string[];
}

export type RejectionStage = "schema" | "syntax" | "path";

export type CandidateValidation =
  | { readonly ok: true; readonly candidateId: string; readonly rationale: string; readonly changes: readonly FileChange[] }
  | { readonly ok: false; readonly stage: RejectionStage; readonly reason: string };

/** Candidate ids are attacker-influenced; the fallback keeps ledger rows stable. */
export function candidateIdOf(raw: unknown, index: number): string {
  if (typeof raw === "object" && raw !== null && "id" in raw) {
    const id = raw.id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return `candidate-${String(index + 1)}`;
}

/** Reject absolute / traversal / VCS / control-char paths before any glob runs. */
function unsafePathReason(p: string): string | null {
  if (p.length === 0) return "empty path";
  if (p.startsWith("/") || p.includes("\\")) return "absolute or drive-style path";
  if (p.includes("\0") || p.includes("\n") || p.includes("\r")) return "control characters";
  if (p.endsWith("/")) return "directory path";
  const segments = p.split("/");
  if (segments.some((s) => s === "..")) return "directory traversal";
  if (segments.some((s) => s === ".git")) return "VCS metadata path";
  if (path.posix.normalize(p) !== p) return "non-canonical path";
  return null;
}

function policyHit(p: string, globs: readonly string[]): string | null {
  for (const g of globs) {
    if (compileGlob(g).test(p)) return g;
  }
  return null;
}

/**
 * Validate one raw candidate against the schema, diff syntax, and the sealed
 * paths (kernel.immutableGlobs + artifact globs). Returns the parsed changes
 * ONLY when every file of the candidate passes — a single violation rejects
 * the whole candidate with the stage and reason the session logs to the ledger.
 */
export function validateCandidate(raw: unknown, policy: PathPolicy, fallbackId = "candidate"): CandidateValidation {
  const parsed = candidateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, stage: "schema", reason: formatZodIssues(parsed.error.issues).join("; ") };
  }
  const changes: FileChange[] = [];
  for (const diff of parsed.data.diffs) {
    const p = parseUnifiedDiff(diff);
    if (!p.ok) return { ok: false, stage: "syntax", reason: p.error };
    for (const c of p.changes) {
      if (changes.some((e) => e.path === c.path)) {
        return { ok: false, stage: "syntax", reason: `duplicate file section across diff chunks: ${c.path}` };
      }
      changes.push(c);
    }
  }
  for (const c of changes) {
    const unsafe = unsafePathReason(c.path);
    if (unsafe !== null) return { ok: false, stage: "path", reason: `refused path (${unsafe}): ${c.path}` };
    const sealed = policyHit(c.path, policy.immutableGlobs);
    if (sealed !== null) {
      return { ok: false, stage: "path", reason: `path '${c.path}' touches kernel-immutable glob '${sealed}' — whole candidate rejected` };
    }
    const artifact = policyHit(c.path, policy.artifactGlobs);
    if (artifact !== null) {
      return { ok: false, stage: "path", reason: `path '${c.path}' touches artifact glob '${artifact}' — whole candidate rejected` };
    }
  }
  return { ok: true, candidateId: parsed.data.id ?? fallbackId, rationale: parsed.data.rationale, changes };
}
