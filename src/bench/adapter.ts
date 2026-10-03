// Bench adapter contract (plan todo 5). The iface (incl. reset) is DEFINED HERE and
// reused verbatim by the opencode-fixture adapter (todo 6) and the evolution loop
// (todo 9). Shared plumbing also lives here so both adapters get identical argv
// discipline — mirrors src/util/git.ts: argv arrays only, no shell, process-group
// SIGKILL on timeout — and identical status semantics:
//   ok            run completed under bench control (exitCode may still be != 0:
//                 a failing UNIT is a measurement result, not an infra failure)
//   timeout       killed after timeoutS via kill(-pid) — recorded, never rethrown
//   infra_failed  the bench itself could not run (binary missing, spawn refused);
//                 excluded from score distributions (hr discipline), not zeroed.

import { spawn } from "node:child_process";

import { cannotAnswer } from "../exit.js";
import type { BenchSpec, BenchUnit } from "../core/spec.js";

export interface RunMetrics {
  readonly tokensEst: number;
  readonly turns: number;
}

export type RunStatus = "ok" | "timeout" | "infra_failed";

export interface ProvenanceVersion {
  readonly bin: string;
  readonly version: string;
}

/** Version provenance stamped into every RunResult (plan §todo6 wording). */
export interface BenchProvenance {
  readonly benchType: BenchSpec["type"];
  readonly versions: readonly ProvenanceVersion[];
}

export interface RunResult {
  readonly unitId: string;
  readonly status: RunStatus;
  readonly metrics: RunMetrics;
  readonly benchProvenance: BenchProvenance;
  /** Child exit code; null for timeout / infra_failed. */
  readonly exitCode: number | null;
  /** Recorded reason for timeout / infra_failed; absent for clean ok runs. */
  readonly note?: string | undefined;
  /** Adapter-convention path where the run's transcript was captured, if any. */
  readonly transcriptPath?: string | undefined;
}

export interface ScoreResult {
  readonly unitId: string;
  /** Normalized unit score, 0..1. */
  readonly score: number;
  readonly pass: boolean;
  readonly metrics: RunMetrics;
}

/** Per-unit score outcome; a broken grader is INCONCLUSIVE for that unit, never a crash. */
export type ScoreOutcome =
  | { readonly kind: "scored"; readonly result: ScoreResult }
  | { readonly kind: "inconclusive"; readonly unitId: string; readonly reason: string };

export interface BenchAdapter {
  /** Put the sandbox back to a pristine starting state (toy: wipe + recreate). */
  reset(sandboxDir: string): Promise<void>;
  /** Materialize deterministic starting state (toy: copy genome repo units). */
  seed(sandboxDir: string): Promise<void>;
  /** Execute one unit in the sandbox, hard-capped at timeoutS seconds. */
  run(unit: BenchUnit, sandboxDir: string, timeoutS: number): Promise<RunResult>;
  /** Grade one unit via bench.graderCommand (toy: node grader.mjs {unit.path}). */
  score(unit: BenchUnit): Promise<ScoreOutcome>;
}

// ------------------------------------------------------- command template engine

/** Placeholder values available to runCommand / graderCommand / seed/reset hooks. */
export type CommandVars = Readonly<Record<string, string>>;

/**
 * `{repoRoot}` = the bench's ACTIVE TREE: the genome repoPath for the incumbent,
 * the sealed candidate worktree for a candidate (run-loop.ts swaps spec.repoPath
 * per target; adapters resolve it through effectiveRepoPath at construction).
 * Omitting repoRoot keeps `{repoRoot}` an UNKNOWN placeholder — fail-closed
 * exit 2, never a silently half-substituted command.
 */
export function unitVars(unit: BenchUnit, sandboxDir: string, repoRoot?: string | undefined): CommandVars {
  const vars: Record<string, string> = {
    "unit.path": unit.path,
    "unit.id": unit.id,
    sandbox: sandboxDir,
    workdir: sandboxDir,
  };
  if (repoRoot !== undefined) vars["repoRoot"] = repoRoot;
  return vars;
}

export function sandboxVars(sandboxDir: string, repoRoot?: string | undefined): CommandVars {
  const vars: Record<string, string> = { sandbox: sandboxDir, workdir: sandboxDir };
  if (repoRoot !== undefined) vars["repoRoot"] = repoRoot;
  return vars;
}

const PLACEHOLDER = /\{([A-Za-z0-9_.]+)\}/g;

/**
 * Render a bench command template into argv: quote-aware tokenization (single and
 * double quotes group, are stripped), then {placeholder} substitution against vars.
 * Unknown placeholders and unbalanced quotes are config errors -> exit 2 (fail-closed,
 * never a silently half-substituted command).
 */
export function renderCommand(template: string, vars: CommandVars): string[] {
  const argv = tokenize(template);
  if (argv.length === 0) cannotAnswer(`bench command template is empty: '${template}'`);
  return argv.map((token) =>
    token.replace(PLACEHOLDER, (whole: string, key: string) => {
      const value = vars[key];
      if (value === undefined) {
        cannotAnswer(`bench command '${template}': unknown placeholder '${whole}'`);
      }
      return value;
    }),
  );
}

function tokenize(source: string): string[] {
  const out: string[] = [];
  let current = "";
  let started = false;
  let quote: '"' | "'" | null = null;
  for (const ch of source) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (started) {
        out.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += ch;
    started = true;
  }
  if (quote !== null) cannotAnswer(`unbalanced quote in bench command: '${source}'`);
  if (started) out.push(current);
  return out;
}

// ------------------------------------------------------------- child execution

export type ChildKind = "exited" | "timeout" | "spawn_failed";

export interface ChildOutcome {
  readonly kind: ChildKind;
  /** Exit code when kind === "exited"; null when killed or never spawned. */
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Stable human-readable reason (used verbatim inside RunResult.note). */
  readonly reason: string;
}

/**
 * Synchronous handle reported to ChildOptions.onChild the instant a child is
 * spawned (todo 9's reaper needs the pid BEFORE exec becomes observable). The
 * child is detached, so pid === pgid: killing -pid kills its whole group.
 * `exited` resolves on 'close' (same event that settles the ChildOutcome).
 */
export interface ChildHandle {
  readonly pid: number;
  readonly exited: Promise<void>;
}

export interface ChildOptions {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly timeoutS: number;
  /**
   * Extra env overlaid on process.env (sandbox HOME etc.); LC_ALL=C always
   * wins. A key explicitly set to undefined is REMOVED from the child env
   * (spawn omits undefined values) — required to clear NODE_TEST_CONTEXT when
   * self-bench nests `node --test` inside an outer test runner.
   */
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  /** Invoked synchronously post-spawn with the child handle, before any await. */
  readonly onChild?: ((handle: ChildHandle) => void) | undefined;
}

const STREAM_CAP_BYTES = 1024 * 1024;

/** SIGKILL the whole process group; ESRCH means everyone already exited. */
export function killGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // group already gone — the close handler still resolves the outcome.
  }
}

/**
 * Run argv (no shell) in a detached process group and hard-kill the GROUP after
 * timeoutS, so children of the unit (sh -c sleep, opencode spawns) cannot outlive
 * the bench. Resolves exactly once; never rejects — timeouts and spawn failures
 * are recorded outcomes, matching the RunStatus trichotomy above.
 */
export function runChild(opts: ChildOptions): Promise<ChildOutcome> {
  if (!Number.isFinite(opts.timeoutS) || opts.timeoutS <= 0) {
    throw new TypeError(`runChild: timeoutS must be a positive number, got ${String(opts.timeoutS)}`);
  }
  const [bin, ...rest] = opts.argv;
  if (bin === undefined || bin.length === 0) {
    throw new TypeError("runChild: argv must start with a binary path/name");
  }
  return new Promise<ChildOutcome>((resolve) => {
    const child = spawn(bin, rest, {
      cwd: opts.cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env:
        opts.env === undefined
          ? { ...process.env, LC_ALL: "C" }
          : { ...process.env, ...opts.env, LC_ALL: "C" },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let spawnError: string | null = null;
    let notifyExit: () => void = () => {};
    const exited = new Promise<void>((resolve) => {
      notifyExit = resolve;
    });
    if (opts.onChild !== undefined && child.pid !== undefined) {
      opts.onChild({ pid: child.pid, exited }); // record BEFORE anything can wait on it
    }
    const cap = (buffer: string, chunk: Buffer): string =>
      buffer.length >= STREAM_CAP_BYTES ? buffer : buffer + String(chunk);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = cap(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = cap(stderr, chunk);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid);
    }, Math.round(opts.timeoutS * 1000));
    // Node emits 'close' after a failed spawn too (code null), so one resolve site.
    child.on("error", (cause: NodeJS.ErrnoException) => {
      spawnError = cause.message;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      notifyExit();
      const kind: ChildKind =
        spawnError !== null ? "spawn_failed" : timedOut ? "timeout" : "exited";
      const reason =
        spawnError !== null
          ? `spawn failed: ${spawnError}`
          : timedOut
            ? `killed after ${String(opts.timeoutS)}s: process group SIGKILL`
            : `exit code ${String(code)}`;
      resolve({ kind, exitCode: kind === "exited" ? code : null, stdout, stderr, reason });
    });
  });
}

// ------------------------------------------------- shared adapter plumbing

/** Metrics for a run that produced no measurement (timeout / infra_failed). */
export const ZERO_METRICS: RunMetrics = { tokensEst: 0, turns: 0 };

export function childStatus(kind: ChildKind): RunStatus {
  switch (kind) {
    case "exited":
      return "ok";
    case "timeout":
      return "timeout";
    case "spawn_failed":
      return "infra_failed";
  }
}

export function inconclusive(unitId: string, reason: string): ScoreOutcome {
  return { kind: "inconclusive", unitId, reason };
}

export function firstLine(text: string): string {
  return (text.split("\n", 1)[0] ?? "").trim();
}

export type ParsedScore = Pick<ScoreResult, "score" | "pass" | "metrics">;

/** Grader contract (toy + fixture): the LAST stdout line parses to {unit, score 0..1, pass, metrics}. */
export function parseGraderLine(stdoutText: string): ParsedScore | null {
  const last = stdoutText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .at(-1);
  if (last === undefined) return null;
  let doc: unknown;
  try {
    doc = JSON.parse(last);
  } catch {
    return null;
  }
  if (!isRecord(doc) || typeof doc.unit !== "string") return null;
  if (!isFiniteNumber(doc.score) || doc.score < 0 || doc.score > 1) return null;
  if (typeof doc.pass !== "boolean") return null;
  const metrics = doc.metrics;
  if (!isRecord(metrics) || !isCount(metrics.tokensEst) || !isCount(metrics.turns)) return null;
  return { score: doc.score, pass: doc.pass, metrics: { tokensEst: metrics.tokensEst, turns: metrics.turns } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCount(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}
