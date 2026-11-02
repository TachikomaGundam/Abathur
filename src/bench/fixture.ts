// Opencode-fixture-scenarios bench adapter (plan todo 6, lines 117-124): the
// real-surface path the evolution loop (todo 9) drives when bench.type is
// "opencode-fixture-scenarios". Reuses the todo-5 plumbing verbatim (renderCommand
// templates, runChild process-group discipline, grader JSON contract) and adds:
//   - startup probes: `<opencodeBin> --version` enforced against
//     spec.opencodeBinVersion.minVersion and every spec.requires[] binary probed via
//     PATH (argv spawn, never shell); any failure is exit 2 BEFORE a unit runs, and
//     the observed version strings land in EVERY RunResult.benchProvenance.
//   - per-unit lifecycle reset → seed → run under a fingerprint-keyed
//     single-flight genome lock (src/core/locks via acquireGenomeLock).
//   - sandbox HOME discipline: ONLY .opencode/{plugin,skills,node_modules} is
//     mirrored from the real HOME and the opencode config is copied-then-mutated
//     per scenario (never symlinked, real HOME untouched).
//   - train/val by SPLIT FIELD ONLY, with two INDEPENDENT axes (plan lines
//     117-124 + 125-132): BENCHING authority — the loop's bench driver runs val
//     replicates under loopValAuthority (the selection gate needs them), while a
//     direct adapter consumer must pass includeVal; and EXPOSURE — val ids/paths
//     enter the sandbox manifest only under includeVal, reachable ONLY via the
//     operator CLI switch `abathur run --include-val`. Without it the manifest
//     keeps val entries as opaque aliases, even while those units are benched.
// Scenario content stays opaque — no harness-specific parsing anywhere here.
//
// Pure-LOC documented exception (F2 review, 2026-09-10): 253 pure LOC, above the
// 250 ceiling — the LOOP_VAL_AUTHORITY benching seam must live in-fixture beside
// the exposure axis it is deliberately independent from (F1-fix2 pins both through
// this module's surface; a minimal seam was mandated over splitting). Accepted
// exception: do not grow this file; split at the next real feature.

import { existsSync, mkdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { cannotAnswer, ExitSignal } from "../exit.js";
import { resolveConfigDir, type ConfigEnv } from "../config.js";
import { fingerprint } from "../core/ids.js";
import { acquireGenomeLock, Ledger } from "../core/ledger.js";
import type { LockLease } from "../core/locks.js";
import { effectiveRepoPath, type BenchUnit, type GenomeSpec } from "../core/spec.js";
import {
  childStatus,
  firstLine,
  inconclusive,
  parseGraderLine,
  renderCommand,
  runChild,
  sandboxVars,
  unitVars,
  ZERO_METRICS,
  type BenchAdapter,
  type ChildHandle,
  type ProvenanceVersion,
  type RunResult,
  type ScoreOutcome,
} from "./adapter.js";
import {
  buildManifest,
  gateVal,
  mirrorSandboxHome,
  parseRunMeta,
  sandboxHomeDir,
  transcriptPathFor,
  writeManifest,
  type ScenarioEntry,
} from "./fixture-support.js";
import { probeEngines, resolveOpencodeBin } from "./fixture-probe.js";

export {
  buildManifest,
  compareSemver,
  manifestPathFor,
  mirrorSandboxHome,
  parseSemver,
  sandboxHomeDir,
  transcriptPathFor,
  writeManifest,
  type ScenarioEntry,
  type SemverVersion,
} from "./fixture-support.js";
export { probeEngines, resolveOpencodeBin } from "./fixture-probe.js";

export interface FixtureAdapterOptions {
  /** Env surface for config/HOME resolution; defaults to process.env. */
  readonly env?: ConfigEnv | undefined;
  /** Lock home; defaults to resolveConfigDir(env). */
  readonly configDir?: string | undefined;
  /** Overrides config opencodeBin (which itself defaults to PATH "opencode"). */
  readonly opencodeBin?: string | undefined;
  /** Receives a handle for every child the adapter spawns, probes included. */
  readonly onChild?: ((handle: ChildHandle) => void) | undefined;
  /** Real HOME to mirror; defaults to env.HOME else os.homedir(). */
  readonly home?: string | undefined;
  /**
   * Operator EXPOSURE gate (CLI `abathur run --include-val`): runs val-split
   * units AND lists their ids/paths in the sandbox manifest. Direct adapter
   * consumers must pass it to run a val unit at all (todo-6 invariant).
   */
  readonly includeVal?: boolean | undefined;
  /**
   * Selection-gate BENCHING authority (plan lines 125-132): lets the loop's
   * bench driver run/score val replicates WITHOUT exposing val paths — the
   * manifest stays gated by includeVal alone. Set only by run-bench.ts
   * benchTarget (LOOP_VAL_AUTHORITY); never wired to any CLI flag.
   */
  readonly loopValAuthority?: boolean | undefined;
  /** Genome-lock patience; 0 (default) makes contention an immediate exit 2. */
  readonly lockWaitMs?: number | undefined;
}

const HOOK_TIMEOUT_S = 60;

export class FixtureScenariosAdapter implements BenchAdapter {
  private readonly repoRoot: string;
  private lease: LockLease | null = null;
  private started: Promise<void> | null = null;
  private versions: readonly ProvenanceVersion[] = [];
  private activeSandbox: string | null = null;

  constructor(
    private readonly spec: GenomeSpec,
    private readonly opts: FixtureAdapterOptions = {},
  ) {
    if (spec.bench.type !== "opencode-fixture-scenarios") {
      cannotAnswer(
        `fixture adapter: bench.type '${spec.bench.type}' is not "opencode-fixture-scenarios"`,
        "use ToyBenchAdapter for bench.type 'toy'",
      );
    }
    // Active-tree resolution follows the run-loop notion (run-loop.ts:142): a
    // concrete repoPath resolves exactly as before; a `${VAR}` env literal
    // resolves at THIS fs boundary or exits 2 naming the variable.
    const root = effectiveRepoPath(spec.repoPath);
    if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
      cannotAnswer(`fixture: repoPath '${spec.repoPath}' is not a readable directory`);
    }
    this.repoRoot = root;
  }

  async reset(sandboxDir: string): Promise<void> {
    await this.ensureStarted();
    this.activeSandbox = sandboxDir;
    mkdirSync(sandboxDir, { recursive: true });
    await this.hook(this.spec.bench.resetCommand, sandboxDir, "resetCommand");
    // the reset script owns scenario teardown and may replace the dir wholesale
    mkdirSync(sandboxDir, { recursive: true });
    mirrorSandboxHome(this.homeDir(), sandboxDir, this.agentModel());
  }

  async seed(sandboxDir: string): Promise<void> {
    await this.ensureStarted();
    this.activeSandbox = sandboxDir;
    mkdirSync(sandboxDir, { recursive: true });
    if (!existsSync(sandboxHomeDir(sandboxDir))) mirrorSandboxHome(this.homeDir(), sandboxDir, this.agentModel());
    writeManifest(sandboxDir, this.scenarioManifest());
    await this.hook(this.spec.bench.seedCommand, sandboxDir, "seedCommand");
  }

  async run(unit: BenchUnit, sandboxDir: string, timeoutS: number): Promise<RunResult> {
    await this.ensureStarted();
    gateVal(unit, this.valRunAllowed());
    this.activeSandbox = sandboxDir;
    mkdirSync(sandboxDir, { recursive: true });
    const transcript = transcriptPathFor(sandboxDir, unit.id);
    mkdirSync(path.dirname(transcript), { recursive: true });
    const outcome = await runChild({
      argv: renderCommand(this.spec.bench.runCommand, unitVars(unit, sandboxDir, this.repoRoot)),
      cwd: sandboxDir,
      timeoutS,
      env: this.sandboxEnv(sandboxDir, unit),
      ...(this.opts.onChild === undefined ? {} : { onChild: this.opts.onChild }),
    });
    const status = childStatus(outcome.kind);
    return {
      unitId: unit.id,
      status,
      metrics: status === "ok" ? parseRunMeta(outcome.stdout) : ZERO_METRICS,
      benchProvenance: { benchType: "opencode-fixture-scenarios", versions: this.versions },
      exitCode: outcome.exitCode,
      note: status === "ok" && outcome.exitCode === 0 ? undefined : outcome.reason,
      transcriptPath: status === "ok" && existsSync(transcript) ? transcript : undefined,
    };
  }

  async score(unit: BenchUnit): Promise<ScoreOutcome> {
    await this.ensureStarted();
    gateVal(unit, this.valRunAllowed());
    const sandbox = this.activeSandbox;
    if (sandbox === null) {
      cannotAnswer(
        "fixture adapter: score() called before any reset()/seed()/run() — no sandbox yet",
        "drive the adapter in reset→seed→run→score order",
      );
    }
    const outcome = await runChild({
      argv: renderCommand(this.spec.bench.graderCommand, unitVars(unit, sandbox, this.repoRoot)),
      cwd: sandbox,
      timeoutS: this.spec.bench.timeoutS,
      env: this.sandboxEnv(sandbox),
      ...(this.opts.onChild === undefined ? {} : { onChild: this.opts.onChild }),
    });
    if (outcome.kind !== "exited") {
      return inconclusive(unit.id, `grader ${outcome.kind}: ${outcome.reason}`);
    }
    if (outcome.exitCode !== 0) {
      return inconclusive(
        unit.id,
        `grader exited ${String(outcome.exitCode)}: ${firstLine(outcome.stderr) || firstLine(outcome.stdout) || "no output"}`,
      );
    }
    const parsed = parseGraderLine(outcome.stdout);
    if (parsed === null) {
      return inconclusive(
        unit.id,
        `grader stdout is not a score JSON line: ${firstLine(outcome.stdout) || "no output"}`,
      );
    }
    return { kind: "scored", result: { unitId: unit.id, ...parsed } };
  }

  /**
   * Val units may be RUN/SCORED when the operator opened exposure (includeVal)
   * OR the loop holds benching authority (loopValAuthority, F1-fix2); either
   * way this never decides what the manifest EXPOSES.
   */
  private valRunAllowed(): boolean {
    return this.opts.includeVal === true || this.opts.loopValAuthority === true;
  }

  /**
   * Sandbox view of the scenarios: val ids/paths surface only under operator
   * includeVal. loopValAuthority deliberately does NOT open this — the loop may
   * bench val units while their paths stay opaque aliases (plan line 118).
   */
  scenarioManifest(): readonly ScenarioEntry[] {
    return buildManifest(this.spec.bench.units, this.opts.includeVal === true);
  }

  /** Free the single-flight lease (todo 9 calls this when the bench run ends). */
  release(): void {
    this.lease?.release();
    this.lease = null;
    this.started = null;
    this.versions = [];
  }

  // ------------------------------------------------------- startup + locking

  private ensureStarted(): Promise<void> {
    if (this.started === null) {
      this.started = this.startProbes().catch((cause: unknown) => {
        this.started = null;
        throw cause;
      });
    }
    return this.started;
  }

  private async startProbes(): Promise<void> {
    this.acquireFlight();
    try {
      this.versions = await probeEngines(this.spec, this.opencodeBinName(), this.repoRoot, {
        ...(this.opts.onChild === undefined ? {} : { onChild: this.opts.onChild }),
      });
    } catch (cause) {
      this.release();
      throw cause;
    }
  }

  private acquireFlight(): void {
    if (this.lease !== null) return;
    const configDir = this.opts.configDir ?? resolveConfigDir(this.opts.env ?? process.env);
    const fp = fingerprint(this.spec);
    const ledger = Ledger.open(this.repoRoot);
    try {
      this.lease = acquireGenomeLock({
        ledger,
        configDir,
        genomeFp: fp,
        waitMs: this.opts.lockWaitMs ?? 0,
      });
    } catch (cause) {
      if (cause instanceof ExitSignal) {
        cannotAnswer(
          `fixture: another bench active for genome '${fp.slice(0, 16)}'`,
          cause.hint ?? cause.message,
        );
      }
      throw cause;
    }
  }

  // ----------------------------------------------------------------- sandbox

  private sandboxEnv(sandboxDir: string, unit?: BenchUnit): Record<string, string> {
    const env: Record<string, string> = {
      HOME: sandboxHomeDir(sandboxDir),
      ABATHUR_AGENT_MODEL: this.agentModel(),
    };
    const judge = this.spec.bench.judgeModel;
    if (judge !== undefined) env["ABATHUR_JUDGE_MODEL"] = judge;
    if (unit !== undefined) env["ABATHUR_TRANSCRIPT"] = transcriptPathFor(sandboxDir, unit.id);
    return env;
  }

  /** seed/reset hooks are infrastructure: a failing hook is a tool error (exit 2). */
  private async hook(
    template: string | undefined,
    sandboxDir: string,
    label: string,
  ): Promise<void> {
    if (template === undefined) return;
    const outcome = await runChild({
      argv: renderCommand(template, sandboxVars(sandboxDir, this.repoRoot)),
      cwd: sandboxDir,
      timeoutS: HOOK_TIMEOUT_S,
      env: this.sandboxEnv(sandboxDir),
      ...(this.opts.onChild === undefined ? {} : { onChild: this.opts.onChild }),
    });
    if (outcome.kind !== "exited" || outcome.exitCode !== 0) {
      cannotAnswer(
        `fixture ${label} failed (${outcome.reason}): ${firstLine(outcome.stderr) || "no output"}`,
      );
    }
  }

  private agentModel(): string {
    return this.spec.bench.agentModel ?? cannotAnswer("fixture: bench.agentModel is required");
  }

  private opencodeBinName(): string {
    return resolveOpencodeBin(this.opts);
  }

  private homeDir(): string {
    if (this.opts.home !== undefined) return this.opts.home;
    const envHome = (this.opts.env ?? process.env).HOME;
    return envHome === undefined || envHome.length === 0 ? os.homedir() : envHome;
  }
}
