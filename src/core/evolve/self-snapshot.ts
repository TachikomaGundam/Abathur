// Snapshot-overlay self-bench (plan todo 11c): score = candidate src UNDER the
// incumbent-pinned test suite + golden toy-replay, both executed inside a
// private clone of the frozen incumbent snapshot. Pure incumbent-vs-incumbent
// is the forbidden degenerate case, so the incumbent bench doubles as the
// baseline for exactly that suite; every candidate bench re-runs it against the
// overlaid build. Nothing here loads candidate code into this process, touches
// the operator's real repo worktree (snapshots come from COMMITS only), or
// references promote — `self-eval` reports fitness; humans merge.
//
// Timeout caps (documented): build 180s (a candidate that makes tsc hang is
// killed => inconclusive), suite 900s (spec.bench.timeoutS semantics), replay
// 120s. All steps are argv runChild children tracked by the caller's
// ChildTracker, so a killed run leaves no orphans.

import { mkdtempSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { BenchProvenance, ChildHandle } from "../../bench/adapter.js";
import { cannotAnswer } from "../../exit.js";
import { runId } from "../ids.js";
import { genomeDir, type WorktreeEnv } from "../genome-paths.js";
import type { GenomeSpec } from "../spec.js";
import type { BudgetCounters } from "../stats.js";
import { round3, unitMatrixRowSchema, type GenerationVerdict, type UnitMatrixRow } from "./run-rows.js";
import {
  candidateSrcFiles,
  cloneSnapshot,
  incumbentSnapshot,
  parseReplayDigest,
  parseTapSummary,
  planOverlay,
  readExpectedDigest,
  removeBuildDir,
  runBuild,
  runReplay,
  runSuite,
  writeOverlay,
  type BuildStatus,
  type OverlayDropReason,
  type TapSummary,
} from "./self-overlay.js";

export const DEFAULT_BUILD_TIMEOUT_S = 180;
export const DEFAULT_TEST_TIMEOUT_S = 900;
export const DEFAULT_REPLAY_TIMEOUT_S = 120;

export const SELF_OVERLAY_EMPTY = "self-bench: overlay empty";
export const SELF_BUILD_TIMEOUT = "self-bench: build timeout";

const HARNESS_ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

interface MutableUnitRow {
  readonly unitId: string;
  readonly split: "train" | "val";
  readonly scores: number[];
  readonly runIds: string[];
  readonly failures: string[];
}

export interface SelfBenchRequest {
  readonly spec: GenomeSpec;
  readonly genomeRepo: string;
  readonly genomeFp: string;
  readonly incumbentCommit: string;
  readonly candidateCommit: string | null;
  readonly genId: string;
  readonly reps: number;
  readonly env: WorktreeEnv;
  readonly buildTimeoutS?: number | undefined;
  readonly testTimeoutS?: number | undefined;
  readonly replayTimeoutS?: number | undefined;
  readonly onChild?: ((handle: ChildHandle) => void) | undefined;
}

export interface SelfBenchResult {
  readonly units: readonly UnitMatrixRow[];
  readonly spent: BudgetCounters;
  readonly provenance: BenchProvenance;
  readonly complete: boolean;
  readonly failures: readonly string[];
  readonly overlaid: readonly string[];
  readonly dropped: readonly { readonly path: string; readonly reason: OverlayDropReason }[];
  readonly buildStatus: BuildStatus;
  readonly buildNote: string;
  readonly suiteRuns: readonly TapSummary[];
  readonly replayDigest: string | null;
  readonly replayExpected: string;
  readonly snapshotPath: string;
  readonly buildDir: string;
}

function specUnits(spec: GenomeSpec): { readonly trainId: string; readonly valId: string } {
  const train = spec.bench.units.find((u) => u.split === "train");
  const val = spec.bench.units.find((u) => u.split === "val");
  if (train === undefined || val === undefined) {
    cannotAnswer("self-snapshot: the self genome spec needs one train (suite) and one val (replay) unit");
  }
  return { trainId: train.id, valId: val.id };
}

function tscVersion(nodeModules: string): string {
  try {
    const parsed = JSON.parse(readFileSync(path.join(nodeModules, "typescript", "package.json"), "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "unknown";
  } catch {
    return "unknown";
  }
}

export async function selfBench(req: SelfBenchRequest): Promise<SelfBenchResult> {
  const started = Date.now();
  const { trainId, valId } = specUnits(req.spec);
  const baseSnapshot = await incumbentSnapshot(req.genomeRepo, req.genomeFp, req.incumbentCommit, req.env);
  const replayExpected = readExpectedDigest(baseSnapshot);

  const decision =
    req.candidateCommit === null
      ? { overlay: [], dropped: [] }
      : planOverlay(candidateSrcFiles(baseSnapshot), candidateSrcFiles(await incumbentSnapshot(req.genomeRepo, req.genomeFp, req.candidateCommit, req.env)), req.spec);

  const buildDir = mkdtempSync(path.join(genomeDir(req.env, { repoPath: req.genomeRepo, genomeFp: req.genomeFp }), `selfbench-${req.genId}-`));
  const suiteRow: MutableUnitRow = { unitId: trainId, split: "train", scores: [], runIds: [], failures: [] };
  const replayRow: MutableUnitRow = { unitId: valId, split: "val", scores: [], runIds: [], failures: [] };
  let buildStatus: BuildStatus = "ok";
  let buildNote = "";
  let complete = true;
  const suiteRuns: TapSummary[] = [];
  let replayDigest: string | null = null;
  const nodeModules = path.join(HARNESS_ROOT, "node_modules");

  try {
    await cloneSnapshot(baseSnapshot, buildDir, nodeModules);
    writeOverlay(buildDir, decision);
    const buildTimeoutS = req.buildTimeoutS ?? DEFAULT_BUILD_TIMEOUT_S;
    const build = await runBuild(buildDir, buildTimeoutS, req.onChild);
    buildStatus = build.status;
    buildNote = build.note;

    if (build.status === "timeout") {
      complete = false;
      suiteRow.failures.push(`${SELF_BUILD_TIMEOUT}: tsc killed after ${String(buildTimeoutS)}s (hung build is cannot-answer, never a zero)`);
    } else if (build.status === "failed") {
      for (let rep = 0; rep < req.reps; rep += 1) {
        suiteRow.scores.push(0);
        suiteRow.runIds.push(runId(req.genId, trainId, rep));
        suiteRow.failures.push(`${trainId} rep ${String(rep)}: run build_failed: tsc exit ${String(build.exit ?? "spawn")}`);
        replayRow.scores.push(0);
        replayRow.runIds.push(runId(req.genId, valId, rep));
        replayRow.failures.push(`${valId} rep ${String(rep)}: run build_failed: replay skipped (build broken)`);
      }
    } else {
      const testTimeoutS = req.testTimeoutS ?? DEFAULT_TEST_TIMEOUT_S;
      const replayTimeoutS = req.replayTimeoutS ?? DEFAULT_REPLAY_TIMEOUT_S;
      for (let rep = 0; rep < req.reps; rep += 1) {
        const suite = await runSuite(buildDir, testTimeoutS, req.onChild);
        if (suite.kind !== "exited") {
          complete = false;
          suiteRow.failures.push(`${trainId} rep ${String(rep)}: run ${suite.kind === "timeout" ? "timeout" : "infra_failed"}: ${suite.reason}`);
        } else {
          const summary = parseTapSummary(suite.stdout);
          if (summary === null || summary.tests === 0) {
            suiteRow.failures.push(`${trainId} rep ${String(rep)}: grader inconclusive: no usable TAP summary from node --test`);
          } else {
            suiteRuns.push(summary);
            suiteRow.scores.push(summary.fail === 0 ? 1 : summary.pass / summary.tests);
            suiteRow.runIds.push(runId(req.genId, trainId, rep));
            if (summary.fail > 0) suiteRow.failures.push(`${trainId} rep ${String(rep)}: scored ${(summary.pass / summary.tests).toFixed(4)} (${String(summary.fail)} failing trusted tests, not passing)`);
          }
        }
        const replay = await runReplay(buildDir, replayTimeoutS, req.onChild);
        if (replay.kind !== "exited") {
          complete = false;
          replayRow.failures.push(`${valId} rep ${String(rep)}: run ${replay.kind === "timeout" ? "timeout" : "infra_failed"}: ${replay.reason}`);
        } else {
          const digest = parseReplayDigest(replay.stdout);
          if (digest === null) {
            replayRow.failures.push(`${valId} rep ${String(rep)}: grader inconclusive: replay printed no 64-hex digest (exit ${String(replay.exitCode)})`);
          } else {
            replayDigest ??= digest;
            replayRow.scores.push(digest === replayExpected ? 1 : 0);
            replayRow.runIds.push(runId(req.genId, valId, rep));
            if (digest !== replayExpected) replayRow.failures.push(`${valId} rep ${String(rep)}: scored 0 (golden-replay digest mismatch — behavior moved)`);
          }
        }
      }
      if (req.candidateCommit !== null && decision.overlay.length === 0 && decision.dropped.length > 0) {
        suiteRow.failures.push(`${SELF_OVERLAY_EMPTY}: every candidate src change matched a seal or the trusted-test rule — score equals the incumbent by construction, no nomination without scored change`);
      }
    }
  } finally {
    removeBuildDir(buildDir);
  }

  const failures = [...suiteRow.failures, ...replayRow.failures];
  return {
    units: [unitMatrixRowSchema.parse(suiteRow), unitMatrixRowSchema.parse(replayRow)],
    spent: { candidates: req.candidateCommit === null ? 0 : 1, modelCalls: 0, tokens: 0, wallS: round3((Date.now() - started) / 1000) },
    provenance: {
      benchType: req.spec.bench.type,
      versions: [
        { bin: "node", version: process.version },
        { bin: "tsc", version: tscVersion(nodeModules) },
      ],
    },
    complete,
    failures,
    overlaid: decision.overlay.map((f) => f.path),
    dropped: decision.dropped,
    buildStatus,
    buildNote,
    suiteRuns,
    replayDigest,
    replayExpected,
    snapshotPath: baseSnapshot,
    buildDir,
  };
}

/**
 * Self-bench verdict guards (plan AC-4 / hung_commands): a killed step (build
 * timeout, hung/crashed suite or replay child) can never answer — inconclusive;
 * a candidate whose entire overlay was dropped never changed scored bytes, so a
 * (degenerate) nomination downgrades to indeterminate. Everything else passes
 * through to evaluate's verdict.
 */
export function selfGuardVerdict(failures: readonly string[], base: GenerationVerdict): GenerationVerdict {
  if (failures.some((f) => f.startsWith(SELF_BUILD_TIMEOUT) || f.includes(": run timeout") || f.includes(": run infra_failed"))) {
    return "inconclusive";
  }
  if (failures.some((f) => f.startsWith(SELF_OVERLAY_EMPTY)) && base === "nominated") return "indeterminate";
  return base;
}
