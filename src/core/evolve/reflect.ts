// Reflection-driven mutator session driver (todo 8, plan lines 133-140).
//
// runMutatorSession launches the candidate generator as a runCommand-template child
// (opencode or a stub script) whose --dir points at a throwaway worktree snapshotted
// from the incumbent head (todo-3 store). The child's stdout must be
// { candidates: [{ id?, rationale, diffs: [unified diff strings] } ] } (zod-checked).
// Each candidate is validated (candidate.ts) and applied ONLY inside its own throwaway
// worktree — the real repo worktree is never touched — then sealed (a real commit) or
// discarded. EVERY rejection (schema/syntax/path/apply/parse) is booked in the genome
// ledger as kind "candidate_rejected". A missing mutator binary exits 2 BEFORE spawning.
//
// The brief policy lives in brief.ts. This module re-exports the whole todo-9 surface:
// buildBrief / runMutatorSession / validateCandidate + ARTIFACT_GLOBS.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import path from "node:path";

import { blocked, cannotAnswer } from "../../exit.js";
import { renderCommand, runChild, type ChildHandle } from "../../bench/adapter.js";
import { fingerprint, genId } from "../ids.js";
import { Ledger } from "../ledger.js";
import { fingerprint16 } from "../genome.js";
import { newGeneration, openGenome, sealGeneration } from "../worktree.js";
import type { GenomeRef, WorktreeEnv } from "../genome-paths.js";
import { formatZodIssues, type GenomeSpec } from "../spec.js";
import {
  ARTIFACT_GLOBS,
  artifactGlobsFromGitignore,
  candidateIdOf,
  mutatorOutputSchema,
  validateCandidate,
} from "./candidate.js";
import { applyChanges } from "./udiff.js";

export { buildBrief, type BriefUnitEvidence } from "./brief.js";
export {
  ARTIFACT_GLOBS,
  artifactGlobsFromGitignore,
  candidateSchema,
  mutatorOutputSchema,
  validateCandidate,
  type CandidateValidation,
  type PathPolicy,
  type RejectionStage,
} from "./candidate.js";
export { parseUnifiedDiff, applyChanges, type FileChange, type ParseOutcome, type ApplyOutcome } from "./udiff.js";

export interface MutatorSessionOptions {
  readonly spec: GenomeSpec;
  readonly brief: string;
  /** runCommand-style template; placeholders {worktree} (throwaway dir) and {brief}. */
  readonly mutatorCommand: string;
  /** Resolved config opencodeBin; null/undefined = PATH lookup when the template says `opencode`. */
  readonly opencodeBin?: string | null;
  readonly env?: WorktreeEnv;
  readonly timeoutS?: number;
  readonly maxCandidates?: number;
  readonly ledger?: Ledger;
  readonly now?: () => Date;
  /** Receives a handle for the mutator child so the caller can record it pre-exec. */
  readonly onChild?: ((handle: ChildHandle) => void) | undefined;
}

export interface AppliedCandidate {
  readonly candidateId: string;
  readonly rationale: string;
  readonly genId: string;
  readonly worktreePath: string;
  readonly parentCommit: string;
  readonly commitSha: string;
  readonly treeSha: string;
  readonly touchedFiles: readonly string[];
}

export interface RejectedCandidate {
  readonly candidateId: string;
  readonly stage: "schema" | "syntax" | "path" | "apply" | "parse";
  readonly reason: string;
}

export interface MutatorSessionResult {
  /** Launch worktree's generation id — discarded at session end, never sealable. */
  readonly launchGenId: string;
  readonly applied: readonly AppliedCandidate[];
  readonly rejected: readonly RejectedCandidate[];
}

function isExecutableFile(p: string): boolean {
  try {
    const st = statSync(p);
    return st.isFile() && (st.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/** Fail-closed bin resolution BEFORE any spawn (no raw ENOENT, plan: exit 2). */
function resolveBin(name: string, opencodeBin: string | null): string {
  if (name === "opencode" && opencodeBin !== null) {
    if (isExecutableFile(opencodeBin)) return opencodeBin;
    cannotAnswer(
      `mutator: configured opencodeBin is not executable: ${opencodeBin}`,
      "set opencodeBin in the abathur config to a working opencode binary",
    );
  }
  if (name.includes("/")) {
    const resolved = path.resolve(name);
    if (isExecutableFile(resolved)) return resolved;
    cannotAnswer(`mutator: command binary not found or not executable: ${name}`);
  }
  for (const dir of (process.env["PATH"] ?? "").split(path.delimiter)) {
    if (dir === "") continue;
    const candidate = path.join(dir, name);
    if (isExecutableFile(candidate)) return candidate;
  }
  const detail = name === "opencode" ? " (opencodeBin unset and opencode not on PATH)" : "";
  cannotAnswer(
    `mutator: binary '${name}' not found${detail}`,
    "install the mutator CLI or set opencodeBin in the config",
  );
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/[\r\n\t]+/g, " ");
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function sealMessage(candidateId: string, rationale: string): string {
  const safe = rationale.replace(/[^ -~]/g, " ");
  return `abathur: mutator candidate ${candidateId} — ${oneLine(safe, 80)}`;
}

function readIfText(filePath: string): string | null {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : null;
}

/** Parse the child's stdout contract; a broken batch is a clean fatal error AFTER ledger booking. */
function parseStdout(
  stdout: string,
  reject: (candidateId: string, stage: RejectedCandidate["stage"], reason: string) => void,
): { readonly candidates: readonly unknown[] } {
  let doc: unknown;
  try {
    doc = JSON.parse(stdout);
  } catch {
    const preview = oneLine(stdout, 200);
    reject("mutator-stdout", "parse", `stdout is not JSON: ${preview}`);
    blocked(`mutator: stdout is not JSON — cannot use this candidate batch (preview: ${preview})`);
  }
  const parsed = mutatorOutputSchema.safeParse(doc);
  if (!parsed.success) {
    const reason = `expected an object with a non-empty 'candidates' array: ${formatZodIssues(parsed.error.issues).join("; ")}`;
    reject("mutator-stdout", "schema", reason);
    blocked(`mutator: output schema rejected — ${reason}`);
  }
  return parsed.data;
}

export async function runMutatorSession(opts: MutatorSessionOptions): Promise<MutatorSessionResult> {
  const { spec } = opts;
  const env = opts.env ?? process.env;
  const now = opts.now ?? (() => new Date());
  const timeoutS = opts.timeoutS ?? spec.bench.timeoutS;
  const maxCandidates = opts.maxCandidates ?? spec.budget.maxCandidates;

  const probeArgv = renderCommand(opts.mutatorCommand, { worktree: "", brief: "" });
  const bin = resolveBin(probeArgv[0] ?? "", opts.opencodeBin ?? null);

  const opened = await openGenome(spec.repoPath, [], { env });
  const genome: GenomeRef = { repoPath: spec.repoPath, genomeFp: fingerprint16(spec) };
  const ledger = opts.ledger ?? Ledger.open(spec.repoPath);
  const gitignoreText = readIfText(path.join(spec.repoPath, ".gitignore"));
  const artifactGlobs: readonly string[] =
    gitignoreText === null ? ARTIFACT_GLOBS : [...ARTIFACT_GLOBS, ...artifactGlobsFromGitignore(gitignoreText)];
  const policy = { immutableGlobs: spec.kernel.immutableGlobs, artifactGlobs };

  const briefDir = mkdtempSync(path.join(os.tmpdir(), "abathur-brief-"));
  const briefFile = path.join(briefDir, "brief.md");
  writeFileSync(briefFile, opts.brief, "utf8");

  const applied: AppliedCandidate[] = [];
  const rejected: RejectedCandidate[] = [];
  const reject = (candidateId: string, stage: RejectedCandidate["stage"], reason: string, genIdValue?: string): void => {
    rejected.push({ candidateId, stage, reason });
    ledger.append({
      kind: "candidate_rejected",
      ...(genIdValue === undefined ? {} : { genId: genIdValue }),
      data: { candidateId, stage, reason },
    });
  };

  let launchGenId = "";
  try {
    launchGenId = genId(fingerprint({ abathur: "mutator-launch", head: opened.headCommit, at: now().getTime() }), now());
    const launch = await newGeneration(genome, opened.headCommit, launchGenId, { env });
    try {
      const argv = renderCommand(opts.mutatorCommand, { worktree: launch.worktreePath, brief: briefFile });
      const child = await runChild({
        argv: [bin, ...argv.slice(1)],
        cwd: launch.worktreePath,
        timeoutS,
        ...(opts.onChild === undefined ? {} : { onChild: opts.onChild }),
      });
      if (child.kind !== "exited") {
        blocked(`mutator: child ${child.kind}: ${child.reason}`);
      }
      const doc = parseStdout(child.stdout, reject);
      const raws = doc.candidates.slice(0, maxCandidates);
      for (const [index, raw] of raws.entries()) {
        const id = candidateIdOf(raw, index);
        const v = validateCandidate(raw, policy, id);
        if (!v.ok) {
          reject(id, v.stage, v.reason);
          continue;
        }
        const gen = genId(
          fingerprint({ parent: opened.headCommit, candidateId: v.candidateId, changes: v.changes, at: now().getTime(), index }),
          now(),
        );
        const wt = await newGeneration(genome, opened.headCommit, gen, { env });
        let sealedOk = false;
        try {
          const changes = applyChanges(v.changes, (rel) => readIfText(path.join(wt.worktreePath, rel)));
          if (!changes.ok) {
            reject(v.candidateId, "apply", changes.reason, gen);
            continue;
          }
          let wrote = 0;
          for (const [rel, content] of changes.files) {
            if (content === readIfText(path.join(wt.worktreePath, rel))) continue;
            const target = path.join(wt.worktreePath, rel);
            mkdirSync(path.dirname(target), { recursive: true });
            writeFileSync(target, content, "utf8");
            wrote += 1;
          }
          if (wrote === 0) {
            reject(v.candidateId, "apply", "candidate changes nothing (incumbent content already matches)", gen);
            continue;
          }
          const sealed = await sealGeneration(genome, gen, sealMessage(v.candidateId, v.rationale), { env });
          sealedOk = true;
          applied.push({
            candidateId: v.candidateId,
            rationale: v.rationale,
            genId: gen,
            worktreePath: wt.worktreePath,
            parentCommit: opened.headCommit,
            commitSha: sealed.commitSha,
            treeSha: sealed.treeSha,
            touchedFiles: changes.touched,
          });
        } finally {
          if (!sealedOk) rmSync(wt.worktreePath, { recursive: true, force: true });
        }
      }
    } finally {
      rmSync(launch.worktreePath, { recursive: true, force: true });
    }
  } finally {
    rmSync(briefDir, { recursive: true, force: true });
  }
  return { launchGenId, applied, rejected };
}
