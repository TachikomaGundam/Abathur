// `abathur self-eval` — REPORT ONLY (plan todo 11c): grade abathur-self
// candidates by the snapshot-overlay bench (candidate src under the incumbent's
// trusted tests + golden toy-replay) and print verdicts. It grants NO promote
// authority — the operator-side `abathur promote` stays the only merge path
// (structural test in src/test/friction.test.ts forbids importing promote from
// here), it writes NO ledger rows (reads the ledger raw, status.ts pattern),
// and its only persistent output is one self-eval friction record appended to
// the global queue. Single-shot like graft: crash → re-run, nothing to resume.
//
// Kernel audit FIRST (same gate order as `run`): a tampered seal means the
// trusted tree itself is untrustworthy, so scoring refuses with exit 1 BEFORE
// any snapshot, spawn, or state exists.

import { resolveConfigDir } from "../config.js";
import { readRegistry } from "../core/genome.js";
import { auditKernel } from "../core/kernel.js";
import { ledgerPath, ledgerRecordSchema } from "../core/ledger.js";
import { existsSync, readFileSync } from "node:fs";
import { asReplicates } from "../core/evolve/run-bench.js";
import { decodeGenerationRecord, type GenerationRowData } from "../core/evolve/run-rows.js";
import { runExitCode } from "../core/evolve/run-loop.js";
import { appendRunFriction, scrub, type FrictionUnitEvidence, type RunFrictionInput } from "../core/evolve/friction.js";
import { selfBench, selfGuardVerdict, type SelfBenchResult } from "../core/evolve/self-snapshot.js";
import { effectiveRepoPath, isEnvRepoLiteral } from "../core/spec.js";
import { clampReps, evaluate, type BudgetCaps, type BudgetCounters, type Verdict } from "../core/stats.js";
import { blocked, cannotAnswer, type ExitCode } from "../exit.js";
import { genId, fingerprint } from "../core/ids.js";
import { openGenome } from "../core/worktree.js";
import type { CommandContext, CommandSpec } from "../cli.js";
import { writeStdout } from "../out.js";
import { resolveUniqueEntry } from "./run.js";

const USAGE = "usage: abathur self-eval [--genome abathur-self] [--gen <genId>]... [--reps N]";

interface SelfEvalFlags {
  readonly label: string;
  readonly gens: readonly string[];
  readonly reps: number | null;
}

function parseFlags(args: readonly string[]): SelfEvalFlags {
  let label = "abathur-self";
  const gens: string[] = [];
  let reps: number | null = null;
  let index = 0;
  const next = (flag: string): string => {
    index += 1;
    const raw = args[index];
    if (raw === undefined || raw.length === 0 || raw.startsWith("--")) cannotAnswer(`self-eval: ${flag} requires a value`, USAGE);
    return raw;
  };
  while (index < args.length) {
    const arg = args[index];
    if (arg === undefined) break;
    switch (arg) {
      case "--genome":
        label = next(arg);
        break;
      case "--gen":
        gens.push(next(arg));
        break;
      case "--reps": {
        const value = Number(next(arg));
        if (!Number.isInteger(value) || value < 1) cannotAnswer("self-eval: --reps expects a positive integer", USAGE);
        reps = value;
        break;
      }
      default:
        cannotAnswer(`self-eval: unknown flag ${arg}`, USAGE);
    }
    index += 1;
  }
  return { label, gens, reps };
}

/** Raw ledger read (NEVER Ledger.open — its ctor mkdirs .state/); bad line ⇒ exit 2. */
interface CandidateRow {
  readonly genId: string;
  readonly commit: string;
  readonly data: GenerationRowData;
}

function candidateRows(genomeRepo: string): CandidateRow[] {
  const file = ledgerPath(genomeRepo);
  if (!existsSync(file)) return [];
  const out: CandidateRow[] = [];
  const lines = readFileSync(file, "utf8").split("\n");
  if (lines.at(-1) === "") lines.pop();
  lines.forEach((line, index) => {
    const value: unknown = JSON.parse(line);
    const parsed = ledgerRecordSchema.safeParse(value);
    if (!parsed.success) {
      cannotAnswer(`self-eval: ${file}: line ${String(index + 1)} failed ledger schema validation: ${parsed.error.message}`, "the ledger is append-only truth — repair by hand");
    }
    const record = parsed.data;
    if (record.kind !== "generation_complete" || record.genId === undefined) return;
    const data = decodeGenerationRecord(record);
    if (data.source === "candidate" && data.commitSha !== undefined) out.push({ genId: record.genId, commit: data.commitSha, data });
  });
  return out;
}

function suiteText(res: SelfBenchResult): string {
  if (res.suiteRuns.length === 0) return `suite ${res.buildStatus === "timeout" ? "BUILD TIMEOUT" : res.buildStatus === "failed" ? "BUILD FAILED" : "no samples"}`;
  return `suite ${res.suiteRuns.map((r) => `${String(r.pass)}/${String(r.tests)}`).join(" ")}`;
}

function unitEvidence(res: SelfBenchResult, into: Map<string, FrictionUnitEvidence>): void {
  for (const row of res.units) {
    const prior = into.get(row.unitId);
    into.set(row.unitId, {
      unitId: row.unitId,
      split: row.split,
      scores: prior === undefined ? [...row.scores] : [...prior.scores, ...row.scores],
      failures: prior === undefined ? [...row.failures] : [...prior.failures, ...row.failures],
    });
  }
}

async function selfEvalHandler(context: CommandContext): Promise<ExitCode> {
  const flags = parseFlags(context.args);
  const configDir = resolveConfigDir();
  for (const warning of readRegistry(configDir).warnings) writeStdout(`warning: ${warning}`);
  const entry = resolveUniqueEntry(configDir, flags.label, "self-eval");
  if (!isEnvRepoLiteral(entry.spec.repoPath)) {
    cannotAnswer(`self-eval: '${entry.spec.label}' is not a self genome — repoPath must be the \${ABATHUR_SELF_REPO} literal`, "self-eval grades the harness against its own sealed kernel; see genomes/abathur-self.jsonc");
  }
  const audit = auditKernel(entry, configDir);
  if (!audit.ok) {
    const listed = audit.drifted.map((d) => `${d.path} (${d.kind})`);
    blocked(
      `self-eval refused: kernel drift for '${entry.spec.label}' (${entry.fingerprint}): ${listed.slice(0, 10).join(", ")}${listed.length > 10 ? ` (+${String(listed.length - 10)} more)` : ""}`,
      "restore the sealed files or resolve drift via 'abathur kernel' — self-eval never reseals and never scores on a tampered trusted tree",
    );
  }
  const spec = entry.spec;
  const genomeRepo = effectiveRepoPath(spec.repoPath);
  const opened = await openGenome(genomeRepo, [], {});
  const recorded = candidateRows(genomeRepo);
  const byGen = new Map<string, CandidateRow>();
  for (const row of recorded) byGen.set(row.genId, row); // latest row per genId wins (append order)
  let picked = [...byGen.values()];
  if (flags.gens.length > 0) {
    const wanted = new Set(flags.gens);
    const missing = flags.gens.filter((g) => !byGen.has(g));
    if (missing.length > 0) blocked(`self-eval: no candidate generation rows for ${missing.map((m) => `'${m}'`).join(", ")} in '${entry.spec.label}'`, `known candidates: ${[...byGen.keys()].join(", ") || "(none)"}`);
    picked = picked.filter((row) => wanted.has(row.genId));
  }
  if (picked.length === 0) {
    cannotAnswer(`self-eval: no candidate generations recorded for '${entry.spec.label}' — run evolution first`, `abathur run --genome ${entry.spec.label} --mutator <template>`);
  }
  const reps = clampReps(flags.reps ?? undefined, spec.bench.stats.nReps);
  const caps: BudgetCaps = {
    maxCandidates: spec.budget.maxCandidates,
    maxModelCalls: spec.budget.maxModelCalls,
    maxTokens: spec.budget.maxTokens,
    maxWallS: spec.budget.maxWallS,
  };
  const invRunId = genId(fingerprint({ selfEval: opened.headCommit, at: Date.now() }));

  writeStdout(`self-eval ${entry.spec.label} fp ${entry.fingerprint} incumbent ${opened.headCommit.slice(0, 12)} reps ${String(reps)}`);
  const incumbent = await selfBench({
    spec,
    genomeRepo,
    genomeFp: entry.fingerprint,
    incumbentCommit: opened.headCommit,
    candidateCommit: null,
    genId: `${invRunId}-base`,
    reps,
    env: process.env,
  });
  writeStdout(`  baseline: ${suiteText(incumbent)}, replay observed ${incumbent.replayDigest ?? "n/a"} expected ${incumbent.replayExpected}`);

  const evidence = new Map<string, FrictionUnitEvidence>();
  unitEvidence(incumbent, evidence);
  let counters: BudgetCounters = { candidates: 0, modelCalls: 0, tokens: 0, wallS: incumbent.spent.wallS };
  const verdicts: Verdict[] = [];
  const reasons: string[] = [];
  for (const row of picked) {
    const res = await selfBench({
      spec,
      genomeRepo,
      genomeFp: entry.fingerprint,
      incumbentCommit: opened.headCommit,
      candidateCommit: row.commit,
      genId: row.genId,
      reps,
      env: process.env,
    });
    unitEvidence(res, evidence);
    counters = { ...counters, candidates: counters.candidates + 1, wallS: counters.wallS + res.spent.wallS };
    const gate = evaluate({
      candidate: { runId: invRunId, units: asReplicates(res.units), counters },
      incumbent: { units: asReplicates(incumbent.units) },
      stats: spec.bench.stats,
      budgetCaps: caps,
      nPairs: Math.max(1, picked.length),
    });
    const verdict = selfGuardVerdict(res.failures, gate.verdict);
    verdicts.push(verdict);
    const gain = gate.gain === null || !Number.isFinite(gate.gain) ? "n/a" : gate.gain.toFixed(4);
    writeStdout(
      `candidate ${row.data.candidateId ?? row.genId} [gen ${row.genId} tree ${(row.data.treeSha ?? "").slice(0, 12)}]: verdict ${verdict} (gain ${gain}, ${suiteText(res)}, replay observed ${res.replayDigest ?? "n/a"} expected ${res.replayExpected}, overlay ${String(res.overlaid.length)} files, dropped ${String(res.dropped.length)})`,
    );
    if (res.buildStatus !== "ok") writeStdout(`  build ${res.buildStatus}: ${scrub(res.buildNote, 200)}`);
    if (res.overlaid.length > 0) {
      const shown = res.overlaid.slice(0, 10).join(", ");
      writeStdout(`  overlay: ${shown}${res.overlaid.length > 10 ? ` (+${String(res.overlaid.length - 10)} more)` : ""}`);
    }
    for (const reason of ["sealed", "trusted-tests"] as const) {
      const dropped = res.dropped.filter((d) => d.reason === reason);
      if (dropped.length > 0) writeStdout(`  dropped (${reason}): ${dropped.map((d) => d.path).join(", ")}`);
    }
    for (const failure of gate.failures) writeStdout(`  gate: ${failure}`);
    if (verdict !== gate.verdict) writeStdout(`  guard: self-bench downgraded ${gate.verdict} -> ${verdict} (see overlay-empty/build-timeout rule)`);
    for (const note of res.failures) if (note.startsWith("self-bench:")) reasons.push(`${row.data.candidateId ?? row.genId}: ${scrub(note, 200)}`);
  }

  const exit = runExitCode(verdicts);
  const timeouts = [...evidence.values()].reduce(
    (n, u) => n + u.failures.filter((f) => f.includes(": run timeout") || f.includes("build timeout")).length,
    0,
  );
  const input: RunFrictionInput = {
    genomeFp: entry.fingerprint,
    cause: "self-eval",
    exit,
    complete: incumbent.complete && verdicts.every((v) => v !== "inconclusive"),
    counts: {
      applied: 0,
      rejected: 0,
      benched: picked.length + 1,
      inconclusive: verdicts.filter((v) => v === "inconclusive").length,
      nominated: verdicts.filter((v) => v === "nominated").length,
      timeouts,
      reaped: 0,
    },
    rejected: [],
    units: [...evidence.values()],
    reasons: [`self-eval ${entry.spec.label}: ${String(picked.length)} candidate(s) over snapshot-overlay bench`, ...reasons],
    stall: { budgetTruncated: !incumbent.complete, orphanGroups: 0 },
  };
  try {
    appendRunFriction(configDir, input);
  } catch (error) {
    writeStdout(`friction: append failed: ${error instanceof Error ? scrub(error.message, 200) : String(error)}`);
  }
  return exit;
}

export const selfEvalCommand: CommandSpec = {
  name: "self-eval",
  summary: "evaluate the harness itself (abathur-self genome)",
  run: (context) => selfEvalHandler(context),
};
