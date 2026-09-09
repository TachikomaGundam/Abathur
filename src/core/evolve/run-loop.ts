// Run-loop orchestrator (plan todo 9): generate → bench → select, resumable.
//
// Startup gate ORDER IS LOAD-BEARING (AC e): kernel audit first — drift refuses
// the run before any state exists; then the dry-run plan; then ledger open +
// resume read; then the genome lock (single flight); only THEN the orphan reap
// (so a concurrent live run's children can never be reaped); then openGenome
// (dirty bench-target paths refuse before anything spawns).
//
// Evolution loop: reflection brief from the incumbent's bench evidence →
// runMutatorSession (todo 8) applies candidates into sealed throwaway worktrees
// → each candidate tree is benched (all units, train AND val, `reps` replicates
// within budget) → stats.evaluate nominates/culls → one generation_complete
// row per candidate. The mutator driver never writes generation_complete; this
// module owns it.
//
// Resume/exactly-once: incumbent rows dedup by headCommit, candidates by
// content treeSha (stable across reseals, unlike commit shas). A reused row is
// never re-benched, so score samples and budget counters survive a SIGKILL
// without doubling. Row schema: run-bench.ts.

import path from "node:path";

import { EXIT_BLOCKED, EXIT_CANNOT_ANSWER, EXIT_OK, blocked, cannotAnswer, type ExitCode } from "../../exit.js";
import type { ConfigEnv } from "../../config.js";
import { fingerprint16, type RegistryEntry } from "../genome.js";
import { auditKernel } from "../kernel.js";
import { compactUtc, fingerprint, genId } from "../ids.js";
import { LEDGER_KIND_GENERATION_COMPLETE, acquireGenomeLock, Ledger } from "../ledger.js";
import type { WorktreeEnv } from "../genome-paths.js";
import { openGenome } from "../worktree.js";
import { clampReps, evaluate, type BudgetCaps, type BudgetCounters } from "../stats.js";
import { ChildTracker, reapOrphans } from "./child-track.js";
import { buildBrief } from "./brief.js";
import { runMutatorSession } from "./reflect.js";
import { asReplicates, benchTarget, cloneMatrixRow, copyProvenance } from "./run-bench.js";
import { effectiveCaps, planLines } from "./run-plan.js";
import {
  addCounters,
  readResume,
  type GenerationRowData,
  type GenerationVerdict,
  type UnitMatrixRow,
} from "./run-rows.js";

export interface RunLoopOptions {
  readonly entry: RegistryEntry;
  readonly configDir: string;
  /** Candidate generator command template ({worktree}+{brief}); absent = a real run exits 2. */
  readonly mutatorCommand?: string | undefined;
  readonly reps?: number | undefined;
  readonly maxCandidates?: number | undefined;
  readonly dryRun?: boolean | undefined;
  readonly opencodeBin?: string | null | undefined;
  readonly env?: WorktreeEnv | undefined;
  readonly sandboxRoot?: string | undefined;
  readonly now?: (() => Date) | undefined;
}

export interface RunLoopOutcome {
  readonly exitCode: ExitCode;
  readonly lines: readonly string[];
}


/** Run exit over candidate verdicts: any nomination wins; else inconclusive ⇒ 2, else 1. */
export function runExitCode(verdicts: readonly GenerationVerdict[]): ExitCode {
  if (verdicts.includes("nominated")) return EXIT_OK;
  if (verdicts.includes("inconclusive")) return EXIT_CANNOT_ANSWER;
  return verdicts.length > 0 ? EXIT_BLOCKED : EXIT_OK;
}

export async function runEvolution(opts: RunLoopOptions): Promise<RunLoopOutcome> {
  const spec = opts.entry.spec;
  const now = opts.now ?? (() => new Date());
  const env = opts.env ?? process.env;
  const caps = effectiveCaps(spec, opts.maxCandidates);
  const reps = clampReps(opts.reps, spec.bench.stats.nReps);

  // ---- startup gate: kernel audit FIRST, before any state or spawn exists.
  const audit = auditKernel(opts.entry, opts.configDir);
  if (!audit.ok) {
    const listed = audit.drifted.map((d) => `${d.path} (${d.kind})`);
    const more = listed.length > 10 ? ` (+${String(listed.length - 10)} more)` : "";
    blocked(
      `run refused: kernel drift for '${spec.label}' (${opts.entry.fingerprint}): ${listed.slice(0, 10).join(", ")}${more}`,
      "restore the sealed files or resolve drift via 'abathur kernel' — the run-loop never reseals",
    );
  }
  if (opts.dryRun === true) {
    return { exitCode: EXIT_OK, lines: planLines({ entry: opts.entry, caps, reps, mutatorCommand: opts.mutatorCommand ?? null }) };
  }
  const mutatorCommand = opts.mutatorCommand;
  if (mutatorCommand === undefined) {
    cannotAnswer(
      "run: --mutator <command template> is required — it is the only candidate source ({worktree} and {brief} placeholders)",
      "use --dry-run to inspect the full plan without a mutator",
    );
  }

  const ledger = Ledger.open(spec.repoPath, { now });
  const lease = acquireGenomeLock({
    ledger,
    configDir: opts.configDir,
    genomeFp: fingerprint16(spec),
    now,
  });
  try {
    return await evolve(opts, mutatorCommand, ledger, caps, reps, env, now);
  } finally {
    lease.release();
  }
}

async function evolve(
  opts: RunLoopOptions,
  mutatorCommand: string,
  ledger: Ledger,
  caps: BudgetCaps,
  reps: number,
  env: WorktreeEnv,
  now: () => Date,
): Promise<RunLoopOutcome> {
  const spec = opts.entry.spec;
  const lines: string[] = [];

  // Reap only under the genome lock: every remaining log entry belongs to a dead run.
  const reap = reapOrphans(spec.repoPath);
  if (reap.reaped.length > 0 || reap.skipped.length > 0 || reap.malformed > 0) {
    const killed = reap.reaped.filter((r) => r.alive).length;
    lines.push(
      `reap: ${String(reap.reaped.length)} recorded group(s), ${String(killed)} alive killed` +
        (reap.skipped.length > 0 ? `; skipped: ${reap.skipped.join("; ")}` : "") +
        (reap.malformed > 0 ? `; ${String(reap.malformed)} malformed line(s) dropped` : ""),
    );
  }

  const opened = await openGenome(spec.repoPath, spec.bench.units.map((u) => u.path), { env });
  const resume = readResume(ledger);
  const genomeFp = fingerprint16(spec);
  const invId = `a-${compactUtc(now())}-${genomeFp.slice(0, 8)}`;
  const tracker = new ChildTracker(spec.repoPath);
  const sandboxBase = path.join(opts.sandboxRoot ?? path.join(opts.configDir, "bench-sandboxes"), invId);
  const configEnv: ConfigEnv | undefined = env;
  let counters: BudgetCounters = resume.counters;

  // ---- incumbent baseline (resume identity: source + headCommit)
  const storedInc = resume.incumbentByHead.get(opened.headCommit);
  let incUnits: readonly UnitMatrixRow[];
  if (storedInc !== undefined) {
    incUnits = storedInc.units;
    lines.push(`resume: incumbent baseline @ ${opened.headCommit.slice(0, 8)} already benched — reusing ${String(incUnits.length)} unit rows`);
  } else {
    const gen = genId(fingerprint({ incumbent: opened.headCommit, at: now().getTime() }), now());
    const out = await benchTarget({
      spec,
      genId: gen,
      reps,
      caps,
      countersBefore: counters,
      sandboxRoot: path.join(sandboxBase, "incumbent"),
      source: "incumbent",
      tracker,
      configDir: opts.configDir,
      ...(configEnv === undefined ? {} : { env: configEnv }),
    });
    counters = addCounters(counters, out.spent);
    const data: GenerationRowData = {
      source: "incumbent",
      headCommit: opened.headCommit,
      complete: out.complete,
      reps,
      units: out.units.map(cloneMatrixRow),
      counters: out.spent,
      manifest: out.manifest.map((m) => ({ glob: m.glob, path: m.path, sha256: m.sha256 })),
      benchProvenance: copyProvenance(out.provenance),
      ...(opened.dirtyWorktree.length === 0 ? {} : { dirtyWorktree: opened.dirtyWorktree.map((d) => ({ xy: d.xy, file: d.file })) }),
    };
    ledger.append({ kind: LEDGER_KIND_GENERATION_COMPLETE, genId: gen, runId: invId, data });
    incUnits = out.units;
    lines.push(`incumbent baseline: ${String(out.units.length)} units x ${String(reps)} reps${out.complete ? "" : " (BUDGET-TRUNCATED)"}`);
  }

  // ---- candidate generation session
  const remaining = caps.maxCandidates - counters.candidates;
  const considered: GenerationVerdict[] = [];
  if (remaining <= 0) {
    lines.push(`budget: candidate cap ${String(caps.maxCandidates)} already spent — resume reports stored verdicts, no new candidates`);
    for (const row of resume.candidatesByTree.values()) {
      if (row.headCommit !== opened.headCommit) continue; // verdicts for other heads are history, not this run's outcome
      if (row.verdict !== undefined) considered.push(row.verdict);
    }
  } else {
    const evidence = spec.bench.units.map((unit) => {
      const row = incUnits.find((u) => u.unitId === unit.id);
      return { unit, scores: row?.scores ?? [], failures: row?.failures ?? [] };
    });
    const brief = buildBrief(spec, evidence, counters);
    tracker.phase(`mutator-${invId}`, "mutator-session");
    const session = await runMutatorSession({
      spec,
      brief,
      mutatorCommand,
      ...(opts.opencodeBin === undefined ? {} : { opencodeBin: opts.opencodeBin }),
      env,
      maxCandidates: remaining,
      ledger,
      now,
      onChild: tracker.onChild,
    });
    for (const r of session.rejected) lines.push(`candidate ${r.candidateId} rejected (${r.stage}): ${r.reason}`);
    if (session.applied.length === 0 && session.rejected.length === 0) lines.push("mutator session produced no candidates");
    const nPairs = Math.max(1, session.applied.length);
    // Trees this session re-delivered; anything recorded earlier against this
    // head that the slice could NOT re-deliver (remaining < batch size on a
    // resume) still counts for the exit status — the ledger verdict stands.
    const reported = new Set<string>();

    for (const c of session.applied) {
      const prior = resume.candidatesByTree.get(c.treeSha);
      if (prior !== undefined) {
        const verdict: GenerationVerdict = prior.verdict ?? "indeterminate";
        considered.push(verdict);
        reported.add(c.treeSha);
        lines.push(`candidate ${c.candidateId}: tree ${c.treeSha.slice(0, 12)} already in ledger — resume reuses verdict '${verdict}', no re-bench, no double spend`);
        continue;
      }
      const out = await benchTarget({
        spec: { ...spec, repoPath: c.worktreePath },
        genId: c.genId,
        reps,
        caps,
        countersBefore: counters,
        sandboxRoot: path.join(sandboxBase, c.genId),
        source: "candidate",
        tracker,
        configDir: opts.configDir,
        ...(configEnv === undefined ? {} : { env: configEnv }),
      });
      counters = addCounters(counters, out.spent);
      // The candidate's own slot is already committed by the session clamp; it
      // must not self-trip the cap inside evaluate (that would make the Nth
      // candidate of a full-budget run permanently inconclusive).
      const evalCounters: BudgetCounters = { ...counters, candidates: counters.candidates - out.spent.candidates };
      const verdict = evaluate({
        candidate: { runId: invId, units: asReplicates(out.units), counters: evalCounters },
        incumbent: { units: asReplicates(incUnits) },
        stats: spec.bench.stats,
        budgetCaps: caps,
        nPairs,
      });
      considered.push(verdict.verdict);
      const data: GenerationRowData = {
        source: "candidate",
        candidateId: c.candidateId,
        rationale: c.rationale,
        headCommit: opened.headCommit,
        commitSha: c.commitSha,
        treeSha: c.treeSha,
        complete: out.complete,
        reps,
        units: out.units.map(cloneMatrixRow),
        counters: out.spent,
        manifest: out.manifest.map((m) => ({ glob: m.glob, path: m.path, sha256: m.sha256 })),
        verdict: verdict.verdict,
        exitCode: verdict.exitCode,
        gain: Number.isFinite(verdict.gain) ? verdict.gain : null,
        gateFailures: [...verdict.failures],
        benchProvenance: copyProvenance(out.provenance),
      };
      ledger.append({ kind: LEDGER_KIND_GENERATION_COMPLETE, genId: c.genId, runId: invId, data });
      reported.add(c.treeSha);
      const gain = verdict.gain === null ? "n/a (truncated)" : verdict.gain.toFixed(4);
      lines.push(`candidate ${c.candidateId} [tree ${c.treeSha.slice(0, 12)}]: ${verdict.verdict} (gain ${gain}, reps ${String(reps)}${out.complete ? "" : ", BUDGET-TRUNCATED"})`);
      for (const f of verdict.failures) lines.push(`  gate: ${f}`);
    }

    for (const [tree, row] of resume.candidatesByTree) {
      if (reported.has(tree) || row.headCommit !== opened.headCommit || row.verdict === undefined) continue;
      considered.push(row.verdict);
      lines.push(`candidate ${row.candidateId ?? tree.slice(0, 12)}: recorded earlier against this head — verdict '${row.verdict}' carried into this run's exit status`);
    }
  }

  await tracker.drain();
  lines.push(
    `budget spent: candidates=${String(counters.candidates)} tokens=${String(counters.tokens)} wallS=${String(counters.wallS)} (caps candidates=${String(caps.maxCandidates)} tokens=${String(caps.maxTokens)} wallS=${String(caps.maxWallS)})`,
  );
  return { exitCode: runExitCode(considered), lines };
}

