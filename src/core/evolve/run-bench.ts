// Budgeted bench execution for the run-loop (todo 9): adapter factory +
// reset→seed→run→score matrix driver. Row schemas / resume readers: run-rows.ts.

import path from "node:path";

import { cannotAnswer } from "../../exit.js";
import { runId } from "../ids.js";
import { buildManifest, type ManifestEntry } from "../kernel.js";
import type { GenomeSpec } from "../spec.js";
import { budgetExhausted, type BudgetCaps, type BudgetCounters, type UnitReplicates } from "../stats.js";
import { ToyBenchAdapter } from "../../bench/toy.js";
import { FixtureScenariosAdapter } from "../../bench/fixture.js";
import type { BenchAdapter, BenchProvenance, ChildHandle } from "../../bench/adapter.js";
import type { ChildTracker } from "./child-track.js";
import type { ConfigEnv } from "../../config.js";
import type { WorktreeEnv } from "../genome-paths.js";
import { round3, unitMatrixRowSchema, type GenerationRowData, type UnitMatrixRow } from "./run-rows.js";
import { selfBench } from "./self-snapshot.js";

export function cloneMatrixRow(u: UnitMatrixRow): UnitMatrixRow {
  return { unitId: u.unitId, split: u.split, scores: [...u.scores], runIds: [...u.runIds], failures: [...u.failures] };
}

type BenchProvenanceLike = GenerationRowData["benchProvenance"] | {
  readonly benchType: "toy" | "opencode-fixture-scenarios";
  readonly versions: readonly { readonly bin: string; readonly version: string }[];
};

export function copyProvenance(p: BenchProvenanceLike): GenerationRowData["benchProvenance"] {
  return { benchType: p.benchType, versions: p.versions.map((v) => ({ bin: v.bin, version: v.version })) };
}

// Unscored units (run timeout/infra_failed, inconclusive grader, budget cut) must be
// excluded before stats.evaluate — empty replicate lists poison aggregateScore with NaN.
export function asReplicates(rows: readonly UnitMatrixRow[]): UnitReplicates[] {
  return rows.filter((u) => u.scores.length > 0).map((u) => ({ unitId: u.unitId, split: u.split, scores: u.scores }));
}

export * from "./run-rows.js";


// ------------------------------------------------------------ adapter factory

export interface BenchAdapterBundle {
  readonly adapter: BenchAdapter;
  /** ALWAYS called in a finally — the fixture single-flight lock lives here. */
  release(): void;
}

export interface OpenAdapterOptions {
  readonly configDir: string;
  readonly env?: ConfigEnv | undefined;
  readonly opencodeBin?: string | undefined;
  readonly onChild?: ((handle: ChildHandle) => void) | undefined;
  /**
   * Operator val EXPOSURE gate (CLI --include-val): val ids/paths surface in
   * the sandbox manifest, and direct consumers additionally gain the right to
   * run val units. Default false keeps val hidden.
   */
  readonly includeVal?: boolean | undefined;
  /**
   * Selection-gate benching authority for loop drivers (benchTarget passes
   * LOOP_VAL_AUTHORITY): run/score val replicates WITHOUT path exposure.
   * Internal wiring only — never sourced from a CLI flag.
   */
  readonly loopValAuthority?: boolean | undefined;
}

/** toy ⇒ stateless adapter; fixture ⇒ ctor acquires the fingerprint lock immediately. */
export function openBenchAdapter(spec: GenomeSpec, opts: OpenAdapterOptions): BenchAdapterBundle {
  const childOpts = opts.onChild === undefined ? {} : { onChild: opts.onChild };
  const envOpts = opts.env === undefined ? {} : { env: opts.env };
  const binOpts = opts.opencodeBin === undefined ? {} : { opencodeBin: opts.opencodeBin };
  switch (spec.bench.type) {
    case "toy":
      return { adapter: new ToyBenchAdapter(spec, { ...childOpts }), release: () => {} };
    case "opencode-fixture-scenarios": {
      const adapter = new FixtureScenariosAdapter(spec, {
        configDir: opts.configDir,
        // plan line 118: val paths surface in the manifest ONLY when the
        // operator passed --include-val; authority to BENCH them is separate.
        includeVal: opts.includeVal === true,
        loopValAuthority: opts.loopValAuthority === true,
        ...envOpts,
        ...binOpts,
        ...childOpts,
      });
      return { adapter, release: () => adapter.release() };
    }
    default: {
      const exhaust: never = spec.bench.type;
      return cannotAnswer(`bench: unsupported bench type '${String(exhaust)}'`);
    }
  }
}

// ------------------------------------------------------------- bench runner

/**
 * benchTarget is the evolution loop's bench driver, and the selection gate is
 * its consumer: nomination REQUIRES val replicates (plan lines 125-132) and
 * SC4 benches the shipped fixture genome train+val (plan line 214) — so the loop
 * ALWAYS benches val units, with or without the operator flag. Commit 3c6bbf9
 * conflated this with `--include-val` and every default `abathur run` on a
 * val-bearing fixture genome crashed (exit 2) at the first val unit, mid-bench,
 * before any generation row; src/test/fixture-loop.test.ts pins the fix.
 * Exposure of val ids/paths (adapter manifest) remains the operator's
 * includeVal alone. Do NOT gate loop benching on the operator flag again.
 */
const LOOP_VAL_AUTHORITY = true;

export interface BenchTargetOptions {
  readonly spec: GenomeSpec;
  readonly genId: string;
  readonly reps: number;
  readonly caps: BudgetCaps;
  readonly countersBefore: BudgetCounters;
  readonly sandboxRoot: string;
  readonly source: "candidate" | "incumbent";
  readonly tracker: ChildTracker;
  readonly configDir: string;
  readonly env?: ConfigEnv | undefined;
  readonly opencodeBin?: string | undefined;
  /**
   * Operator val EXPOSURE gate forwarded from the run loop (CLI --include-val).
   * Val units are benched regardless (LOOP_VAL_AUTHORITY); this flag alone
   * decides whether val ids/paths surface in this run's sandbox manifest.
   */
  readonly includeVal?: boolean | undefined;
  /**
   * Snapshot-overlay mode (todo 11 self genome): when present the bench runs
   * selfBench against the harness snapshots instead of any bench adapter —
   * the candidate is scored ONLY through the trusted overlay build, so the
   * adapter's sandbox paths and the literal repoPath never touch a child.
   */
  readonly selfBench?: {
    readonly genomeRepo: string;
    readonly genomeFp: string;
    readonly incumbentCommit: string;
    readonly candidateCommit: string | null;
    readonly env: WorktreeEnv;
  } | undefined;
}

export interface BenchTargetOutcome {
  readonly units: readonly UnitMatrixRow[];
  /** This bench's spend — persisted verbatim on the generation row. */
  readonly spent: BudgetCounters;
  readonly provenance: BenchProvenance;
  readonly complete: boolean;
  readonly manifest: readonly ManifestEntry[];
  readonly failures: readonly string[];
}

/**
 * Drive reset→seed→run→score over EVERY unit (train AND val: the nomination gate
 * needs val replicates) `reps` times, checking the budget before each replicate.
 * A budget stop ends the pass with complete:false; timeout/infra_failed runs and
 * inconclusive graders are recorded as failure notes and carry NO score sample
 * (excluded from distributions per the hr discipline, never zeroed).
 */
export async function benchTarget(o: BenchTargetOptions): Promise<BenchTargetOutcome> {
  if (o.selfBench !== undefined) {
    const res = await selfBench({
      spec: o.spec,
      genomeRepo: o.selfBench.genomeRepo,
      genomeFp: o.selfBench.genomeFp,
      incumbentCommit: o.selfBench.incumbentCommit,
      candidateCommit: o.selfBench.candidateCommit,
      genId: o.genId,
      reps: o.reps,
      env: o.selfBench.env,
      onChild: o.tracker.onChild,
    });
    return {
      units: res.units,
      spent: res.spent,
      provenance: res.provenance,
      complete: res.complete,
      manifest: buildManifest(o.selfBench.genomeRepo, o.spec.kernel.immutableGlobs),
      failures: res.failures,
    };
  }
  const rows = new Map<string, { unitId: string; split: "train" | "val"; scores: number[]; runIds: string[]; failures: string[] }>();
  for (const unit of o.spec.bench.units) {
    rows.set(unit.id, { unitId: unit.id, split: unit.split, scores: [], runIds: [], failures: [] });
  }
  let tokens = 0;
  let wallS = 0;
  let provenance: BenchProvenance | null = null;
  let complete = true;
  const bundle = openBenchAdapter(o.spec, {
    configDir: o.configDir,
    loopValAuthority: LOOP_VAL_AUTHORITY,
    ...(o.includeVal === true ? { includeVal: true } : {}),
    ...(o.env === undefined ? {} : { env: o.env }),
    ...(o.opencodeBin === undefined ? {} : { opencodeBin: o.opencodeBin }),
    onChild: o.tracker.onChild,
  });
  try {
    o.tracker.phase(o.genId, `${o.source}-bench`);
    outer: for (const unit of o.spec.bench.units) {
      for (let rep = 0; rep < o.reps; rep += 1) {
        const running: BudgetCounters = {
          candidates: o.countersBefore.candidates,
          modelCalls: o.countersBefore.modelCalls,
          tokens: o.countersBefore.tokens + tokens,
          wallS: round3(o.countersBefore.wallS + wallS),
        };
        if (budgetExhausted(running, o.caps)) {
          complete = false;
          break outer;
        }
        const sandbox = path.join(o.sandboxRoot, `${unit.id}-${String(rep)}`);
        await bundle.adapter.reset(sandbox);
        await bundle.adapter.seed(sandbox);
        const started = Date.now();
        const run = await bundle.adapter.run(unit, sandbox, o.spec.bench.timeoutS);
        wallS += (Date.now() - started) / 1000;
        provenance ??= run.benchProvenance;
        tokens += run.metrics.tokensEst;
        const row = rows.get(unit.id);
        if (row === undefined) cannotAnswer(`bench: unknown unit '${unit.id}' returned from spec`);
        if (run.status !== "ok") {
          row.failures.push(`${unit.id} rep ${String(rep)}: run ${run.status}: ${run.note ?? run.status}`);
          continue;
        }
        const score = await bundle.adapter.score(unit);
        if (score.kind === "scored") {
          row.scores.push(score.result.score);
          row.runIds.push(runId(o.genId, unit.id, rep));
          if (!score.result.pass) {
            row.failures.push(`${unit.id} rep ${String(rep)}: scored ${String(score.result.score)} (not passing)`);
          }
        } else {
          row.failures.push(`${unit.id} rep ${String(rep)}: grader inconclusive: ${score.reason}`);
        }
      }
    }
  } finally {
    bundle.release();
  }
  const spent: BudgetCounters = {
    candidates: o.source === "candidate" ? 1 : 0,
    modelCalls: 0,
    tokens,
    wallS: round3(wallS),
  };
  const failures = [...rows.values()].flatMap((r) => r.failures);
  return {
    units: [...rows.values()].map((r) => unitMatrixRowSchema.parse(r)),
    spent,
    provenance: provenance ?? { benchType: o.spec.bench.type, versions: [] },
    complete,
    manifest: buildManifest(path.resolve(o.spec.repoPath), o.spec.kernel.immutableGlobs),
    failures,
  };
}
