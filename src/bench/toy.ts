// Toy bench adapter (plan todo 5): the deterministic, model-free evolution
// substrate. Units are tiny source files of the genome repo itself; the grader is
// the repo's own `node grader.mjs {unit.path}`. The toy path never requires
// opencode, network, or absolute machine paths (D7 generality proof): every binary
// is a PATH name, every file reference is genome-relative, sandboxes are caller-chosen.
//
// Sandbox model: reset = wipe+recreate (determinism substrate), seed = copy the
// genome working tree (minus .git/.state) into the sandbox. score() has no sandbox
// parameter by iface contract, so the adapter remembers the last sandbox passed to
// reset/seed/run and grades the unit copy inside it.

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cannotAnswer } from "../exit.js";
import { walkTree } from "../core/ids.js";
import type { BenchUnit, GenomeSpec } from "../core/spec.js";
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
  type BenchProvenance,
  type ChildHandle,
  type RunMetrics,
  type RunResult,
  type ScoreOutcome,
} from "./adapter.js";

/** Model-free token heuristic pinned by the grader too: 1 token ~ 4 source bytes. */
const BYTES_PER_TOKEN = 4;
const HOOK_TIMEOUT_S = 60;

export interface ToyAdapterOptions {
  /** Receives a handle for every child the adapter spawns (todo 9 reaper). */
  readonly onChild?: ((handle: ChildHandle) => void) | undefined;
}

export class ToyBenchAdapter implements BenchAdapter {
  private readonly repoRoot: string;
  private activeSandbox: string | null = null;

  constructor(
    private readonly spec: GenomeSpec,
    private readonly opts: ToyAdapterOptions = {},
  ) {
    const root = path.resolve(spec.repoPath);
    if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
      cannotAnswer(`toy: repoPath '${spec.repoPath}' is not a readable directory`);
    }
    this.repoRoot = root;
  }

  async reset(sandboxDir: string): Promise<void> {
    rmSync(sandboxDir, { recursive: true, force: true });
    mkdirSync(sandboxDir, { recursive: true });
    this.activeSandbox = sandboxDir;
    await this.hook(this.spec.bench.resetCommand, sandboxDir, "resetCommand");
  }

  async seed(sandboxDir: string): Promise<void> {
    mkdirSync(sandboxDir, { recursive: true });
    for (const file of walkTree(this.repoRoot)) {
      const top = file.path.split("/")[0];
      if (top === ".git" || top === ".state") continue;
      const target = path.join(sandboxDir, file.path);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, file.content);
    }
    this.activeSandbox = sandboxDir;
    await this.hook(this.spec.bench.seedCommand, sandboxDir, "seedCommand");
  }

  async run(unit: BenchUnit, sandboxDir: string, timeoutS: number): Promise<RunResult> {
    this.activeSandbox = sandboxDir;
    const outcome = await runChild({
      argv: renderCommand(this.spec.bench.runCommand, unitVars(unit, sandboxDir, this.repoRoot)),
      cwd: sandboxDir,
      timeoutS,
      ...(this.opts.onChild === undefined ? {} : { onChild: this.opts.onChild }),
    });
    const status = childStatus(outcome.kind);
    return {
      unitId: unit.id,
      status,
      metrics: status === "ok" ? this.runMetrics(unit, sandboxDir) : ZERO_METRICS,
      benchProvenance: this.provenance(),
      exitCode: outcome.exitCode,
      // clean ok runs stay note-less; non-zero unit exits record the plain reason
      note: status === "ok" && outcome.exitCode === 0 ? undefined : outcome.reason,
    };
  }

  async score(unit: BenchUnit): Promise<ScoreOutcome> {
    const sandbox = this.activeSandbox;
    if (sandbox === null) {
      cannotAnswer(
        "toy adapter: score() called before any reset()/seed()/run() — no sandbox yet",
        "drive the adapter in reset→seed→run→score order",
      );
    }
    const outcome = await runChild({
      argv: renderCommand(this.spec.bench.graderCommand, unitVars(unit, sandbox, this.repoRoot)),
      cwd: sandbox,
      timeoutS: this.spec.bench.timeoutS,
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

  private runMetrics(unit: BenchUnit, sandboxDir: string): RunMetrics {
    try {
      const bytes = readFileSync(path.join(sandboxDir, unit.path)).length;
      return { tokensEst: Math.ceil(bytes / BYTES_PER_TOKEN), turns: 1 };
    } catch {
      return { tokensEst: 0, turns: 1 }; // unit vanished mid-run: still one measured turn
    }
  }

  private provenance(): BenchProvenance {
    return { benchType: "toy", versions: [{ bin: "node", version: process.version }] };
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
      ...(this.opts.onChild === undefined ? {} : { onChild: this.opts.onChild }),
    });
    if (outcome.kind !== "exited" || outcome.exitCode !== 0) {
      cannotAnswer(
        `toy ${label} failed (${outcome.reason}): ${firstLine(outcome.stderr) || "no output"}`,
      );
    }
  }
}

// ------------------------------------------------------- fixture self-init

/** Locates genomes/toy-smoke beside the compiled module (repo source or dist copy). */
export function toyTemplateDir(): string {
  for (const rel of ["../../genomes/toy-smoke/", "../genomes/toy-smoke/"]) {
    const dir = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(path.join(dir, "genome.jsonc"))) return dir;
  }
  cannotAnswer(
    "toy fixture: genomes/toy-smoke not found beside dist/bench/toy.js",
    "npm run build ships it to dist/genomes/toy-smoke via copy-assets",
  );
}

/**
 * Materialize an independent toy genome repo (git-initialized, repoPath rewritten)
 * by running the fixture's own init.mjs — one implementation, shell-usable too.
 */
export async function prepareToyGenome(
  destDir: string,
  templateDir: string = toyTemplateDir(),
): Promise<string> {
  const dest = path.resolve(destDir);
  // init.mjs runs with cwd = parent of dest; a missing cwd surfaces as a
  // misleading `spawn <bin> ENOENT`, so materialize the parent first.
  mkdirSync(path.dirname(dest), { recursive: true });
  const outcome = await runChild({
    argv: [process.execPath, path.join(templateDir, "init.mjs"), dest],
    cwd: path.dirname(dest),
    timeoutS: HOOK_TIMEOUT_S,
  });
  if (outcome.kind !== "exited" || outcome.exitCode !== 0) {
    cannotAnswer(
      `toy fixture init failed (${outcome.reason}): ${firstLine(outcome.stderr) || "no output"}`,
    );
  }
  return dest;
}

// --------------------------------------------------------------- grader JSON
// parseGraderLine + the score contract live in adapter.ts (shared with todo 6).
