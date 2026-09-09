// Graft re-bench (todo 13): the all-green path. Apply the bundle's contained
// primary tree as byte-truth into a FRESH todo-3 worktree off the local
// incumbent HEAD, seal with the harness-fixed identity, then run the LOCAL
// bench at LOCAL reps/thresholds through the same adapter + bench-sandbox root
// the run-loop uses (<configDir>/bench-sandboxes/<invId>/..., so todo-12
// evidence export walks graft transcripts too). todo-7 stats decide; the
// bundle's numbers never touch this file.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { cannotAnswer } from "../exit.js";
import type { ConfigEnv } from "../config.js";
import { compactUtc, fingerprint, genId } from "./ids.js";
import { LEDGER_KIND_GENERATION_COMPLETE, type Ledger } from "./ledger.js";
import type { GenomeRef } from "./genome-paths.js";
import { newGeneration, openGenome, sealGeneration, snapshotCommit } from "./worktree.js";
import { git, tryGit } from "../util/git.js";
import { asReplicates, benchTarget, cloneMatrixRow, copyProvenance } from "./evolve/run-bench.js";
import { addCounters, readResume, type GenerationRowData, type UnitMatrixRow } from "./evolve/run-rows.js";
import { ChildTracker, reapOrphans } from "./evolve/child-track.js";
import { clampReps, evaluate, VERDICT_EXIT, type BudgetCaps, type BudgetCounters, type Verdict } from "./stats.js";
import type { BundleManifest } from "./bundle-manifest.js";
import type { GenomeSpec } from "./spec.js";
import { echo, sha12 } from "./graft-support.js";
import type { GraftOutcome, GraftRequest } from "./graft-gates.js";

export interface RebenchContext {
  readonly ledger: Ledger;
  readonly spec: GenomeSpec;
  readonly genomeFp: string;
  readonly manifest: BundleManifest;
  readonly tree: Map<string, Uint8Array>;
  readonly bundleSha256: string;
  readonly recordDecision: (
    decision: Verdict,
    reason: string,
    sealed: { readonly graftGenId: string; readonly commitSha: string; readonly treeSha: string },
  ) => void;
}

export async function graftAndBench(req: GraftRequest, ctx: RebenchContext): Promise<GraftOutcome> {
  const { ledger, spec, manifest, tree, bundleSha256, now, env } = withClock(req, ctx);
  const lines: string[] = [];
  // reap only under the genome lock (todo-9 discipline): leftovers are dead-run children
  reapOrphans(spec.repoPath);
  const opened = await openGenome(spec.repoPath, [], { env });
  if (opened.dirtyWorktree.length > 0) {
    lines.push(`notice: ${String(opened.dirtyWorktree.length)} unrelated dirty path(s) in the genome repo — graft benches the SEALED bundle tree only`);
  }
  const genome: GenomeRef = { repoPath: spec.repoPath, genomeFp: ctx.genomeFp };
  const graftGenId = genId(fingerprint({ graft: bundleSha256, sourceGenome: manifest.genome.fingerprint, parent: opened.headCommit }), now());
  const gen = await newGeneration(genome, opened.headCommit, graftGenId, { env });
  await applyBundleTree(gen.worktreePath, tree);
  const sealed = await sealGraftedTree(genome, graftGenId, gen.worktreePath, opened.headCommit, bundleSha256, env);
  lines.push(`graft applied: bundle ${sha12(bundleSha256)} → fresh worktree ${graftGenId} (commit ${sealed.commitSha.slice(0, 12)}, tree ${sealed.treeSha.slice(0, 12)})`);

  const reps = clampReps(undefined, spec.bench.stats.nReps); // LOCAL initial — bundle reps are peerClaim only
  const caps: BudgetCaps = {
    maxCandidates: spec.budget.maxCandidates,
    maxModelCalls: spec.budget.maxModelCalls,
    maxTokens: spec.budget.maxTokens,
    maxWallS: spec.budget.maxWallS,
  };
  const resume = readResume(ledger);
  const invId = `graft-${compactUtc(now())}-${bundleSha256.slice(0, 8)}`;
  const sandboxBase = path.join(req.configDir, "bench-sandboxes", invId);
  const tracker = new ChildTracker(spec.repoPath);
  const configEnv: ConfigEnv = env;
  let counters: BudgetCounters = resume.counters;

  const storedInc = resume.incumbentByHead.get(opened.headCommit);
  let incUnits: readonly UnitMatrixRow[];
  if (storedInc !== undefined) {
    incUnits = storedInc.units;
    lines.push(`incumbent baseline @ ${opened.headCommit.slice(0, 12)} already benched — reusing ${String(incUnits.length)} unit rows`);
  } else {
    // committed bytes of the incumbent HEAD, never the possibly-dirty worktree
    const snap = await snapshotCommit(genome, opened.headCommit, { env });
    const incGen = genId(fingerprint({ graftIncumbent: opened.headCommit, at: now().getTime() }), now());
    const out = await benchTarget({
      spec: { ...spec, repoPath: snap.snapshotPath },
      genId: incGen,
      reps,
      caps,
      countersBefore: counters,
      sandboxRoot: path.join(sandboxBase, "incumbent"),
      source: "incumbent",
      tracker,
      configDir: req.configDir,
      env: configEnv,
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
    ledger.append({ kind: LEDGER_KIND_GENERATION_COMPLETE, genId: incGen, data });
    incUnits = out.units;
  }

  const out = await benchTarget({
    spec: { ...spec, repoPath: gen.worktreePath },
    genId: graftGenId,
    reps,
    caps,
    countersBefore: counters,
    sandboxRoot: path.join(sandboxBase, graftGenId),
    source: "candidate",
    tracker,
    configDir: req.configDir,
    ...(configEnv === undefined ? {} : { env: configEnv }),
  });
  counters = addCounters(counters, out.spent);
  // the candidate's own slot must not self-trip the cap inside evaluate (todo-9 rule)
  const evalCounters: BudgetCounters = { ...counters, candidates: counters.candidates - out.spent.candidates };
  const gate = evaluate({
    candidate: { runId: invId, units: asReplicates(out.units), counters: evalCounters },
    incumbent: { units: asReplicates(incUnits) },
    stats: spec.bench.stats,
    budgetCaps: caps,
    nPairs: 1,
  });

  // EXACTLY ONE graft_import decision row lands BEFORE any further writes.
  ctx.recordDecision(gate.verdict, localScoreReason(gate, manifest, reps), { graftGenId, ...sealed });

  const data: GenerationRowData = {
    source: "candidate",
    candidateId: `graft-${bundleSha256.slice(0, 12)}`,
    rationale: `graft of bundle ${sha12(bundleSha256)} from source genome ${manifest.genome.fingerprint.slice(0, 16)}… (peer claim: ${manifest.stats.verdict ?? "n/a"})`,
    headCommit: opened.headCommit,
    commitSha: sealed.commitSha,
    treeSha: sealed.treeSha,
    complete: out.complete,
    reps,
    units: out.units.map(cloneMatrixRow),
    counters: out.spent,
    manifest: out.manifest.map((m) => ({ glob: m.glob, path: m.path, sha256: m.sha256 })),
    verdict: gate.verdict,
    exitCode: gate.exitCode,
    gain: Number.isFinite(gate.gain) ? gate.gain : null,
    gateFailures: [...gate.failures],
    benchProvenance: copyProvenance(out.provenance),
  };
  ledger.append({ kind: LEDGER_KIND_GENERATION_COMPLETE, genId: graftGenId, data });
  await tracker.drain();

  const gain = gate.gain === null ? "n/a (truncated)" : gate.gain.toFixed(4);
  lines.push(`graft ${gate.verdict}: local score is authoritative (gain ${gain}, reps ${String(reps)}, LOCAL thresholds) — peer claimed ${manifest.stats.verdict ?? "n/a"} @ nRepeats ${String(manifest.benchProvenance.nRepeats ?? "?")}; imported:true + source ${manifest.genome.fingerprint.slice(0, 16)}… booked`);
  for (const failure of gate.failures) lines.push(`  gate: ${echo(failure)}`);
  if (gate.verdict === "nominated") {
    lines.push(`  human gate: 'abathur promote ${echo(req.genomeLabel, 80)} ${graftGenId}' — graft itself never promotes`);
  }
  return { exitCode: VERDICT_EXIT[gate.verdict], lines };
}

function localScoreReason(gate: ReturnType<typeof evaluate>, manifest: BundleManifest, reps: number): string {
  return `local re-bench: verdict ${gate.verdict}, gain ${gate.gain === null ? "n/a" : gate.gain.toFixed(4)}, reps ${String(reps)} (LOCAL spec) — peer claimed ${manifest.stats.verdict ?? "n/a"} @ nRepeats ${String(manifest.benchProvenance.nRepeats ?? "?")}`;
}

function withClock(req: GraftRequest, ctx: RebenchContext): RebenchContext & { readonly now: () => Date; readonly env: NodeJS.ProcessEnv } {
  return {
    ...ctx,
    now: req.now ?? (() => new Date()),
    env: req.env ?? process.env,
  };
}

/** Tree bytes are the byte-truth: overwrite every member, remove tracked files the bundle lacks. */
async function applyBundleTree(worktreePath: string, tree: Map<string, Uint8Array>): Promise<void> {
  const wt = path.resolve(worktreePath);
  const listed = await tryGit(["ls-tree", "-r", "--name-only", "-z", "HEAD"], { cwd: wt });
  if (!listed.ok) cannotAnswer(`graft: cannot list the incumbent tree in ${wt}: ${echo(listed.error.stderr, 160)}`);
  for (const rel of listed.stdout.split("\0").filter((entry) => entry.length > 0)) {
    if (!tree.has(rel)) rmSync(safeJoin(wt, rel), { force: true });
  }
  for (const [rel, content] of tree) {
    const abs = safeJoin(wt, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

/** readTar refused traversal/absolute names already; this is the write-side belt. */
function safeJoin(root: string, rel: string): string {
  const bad = (): never => cannotAnswer(`graft: unsafe bundle member path '${echo(rel, 80)}'`);
  if (rel.length === 0 || path.isAbsolute(rel) || rel.includes("\\") || rel.includes("\0")) bad();
  for (const segment of rel.split("/")) {
    if (segment === ".." || segment === "") bad();
  }
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(`${root}${path.sep}`) || abs === path.join(root, ".git")) bad();
  return abs;
}

async function sealGraftedTree(
  genome: GenomeRef,
  graftGenId: string,
  worktreePath: string,
  headCommit: string,
  bundleSha256: string,
  env: NodeJS.ProcessEnv,
): Promise<{ commitSha: string; treeSha: string }> {
  const porcelain = await git(["status", "--porcelain", "--untracked-files=all"], { cwd: worktreePath });
  if (porcelain.stdout.trim().length === 0) {
    // bundle tree == incumbent HEAD content: the graft generation IS this commit
    const tree = await git(["rev-parse", "HEAD^{tree}"], { cwd: worktreePath });
    return { commitSha: headCommit, treeSha: tree.stdout.trim() };
  }
  // harness-authored message + fixed committer identity (todo-3 sealGeneration)
  return sealGeneration(genome, graftGenId, `graft: import crystallization from bundle ${sha12(bundleSha256)} (see docs/federation.md)`, { env });
}
