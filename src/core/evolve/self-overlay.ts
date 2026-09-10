// Low-level pieces of the snapshot-overlay self-bench (plan 157-164): clone a
// frozen incumbent snapshot into a mutable build dir, decide + write the
// candidate overlay, and run the three pinned-toolchain steps (build / suite /
// replay) as argv children via runChild. NO promote authority, NO dynamic
// imports — the candidate's code is only ever executed by CHILD processes inside
// the snapshot; trusted files (sealed globs, src/test/**, selfbench/**) always
// come from the incumbent snapshot, never from the candidate tree.

import {
  cpSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { runChild, type ChildHandle, type ChildOutcome } from "../../bench/adapter.js";
import { cannotAnswer } from "../../exit.js";
import { thawTree } from "../../util/freeze.js";
import { snapshotCommit } from "../worktree.js";
import { compileGlob } from "../glob.js";
import type { WorktreeEnv } from "../genome-paths.js";
import type { GenomeSpec } from "../spec.js";

export type OverlayDropReason = "sealed" | "trusted-tests";

export interface OverlayDecision {
  readonly overlay: readonly { readonly path: string; readonly content: string }[];
  readonly dropped: readonly { readonly path: string; readonly reason: OverlayDropReason }[];
}

const OVERLAY_PREFIX = "src/";
const TRUSTED_TEST_PREFIX = "src/test/";

/** Relative posix paths of a tree (regular files only, symlinks skipped), sorted. */
export function treePaths(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const abs = path.join(dir, entry);
      const relPath = rel === "" ? entry : `${rel}/${entry}`;
      const stat = lstatSync(abs);
      if (stat.isDirectory()) walk(abs, relPath);
      else if (stat.isFile()) out.push(relPath);
    }
  };
  walk(root, "");
  return out;
}

/**
 * Overlay law (plan 11c): ONLY candidate src/** files matching no immutableGlob
 * and not under src/test/** are copied over the snapshot. Candidate edits to
 * src/test/** are DROPPED (the trusted suite scores every candidate); deletions
 * are unrepresentable in a copy-only overlay (matching udiff v1's
 * modify/create-only contract). Everything outside src/** is ignored.
 */
export function planOverlay(
  baseFiles: ReadonlyMap<string, string>,
  candidateFiles: ReadonlyMap<string, string>,
  spec: GenomeSpec,
): OverlayDecision {
  const globs = spec.kernel.immutableGlobs.map((glob) => compileGlob(glob));
  const overlay: { path: string; content: string }[] = [];
  const dropped: { path: string; reason: OverlayDropReason }[] = [];
  for (const [relPath, content] of candidateFiles) {
    if (!relPath.startsWith(OVERLAY_PREFIX)) continue;
    if (baseFiles.get(relPath) === content) continue; // unchanged bytes ride in the base clone
    if (relPath.startsWith(TRUSTED_TEST_PREFIX)) {
      dropped.push({ path: relPath, reason: "trusted-tests" });
      continue;
    }
    if (globs.some((re) => re.test(relPath))) {
      dropped.push({ path: relPath, reason: "sealed" });
      continue;
    }
    overlay.push({ path: relPath, content });
  }
  for (const relPath of baseFiles.keys()) {
    if (!relPath.startsWith(OVERLAY_PREFIX) || candidateFiles.has(relPath)) continue;
    // The candidate DELETED a base file: trusted paths must survive (report the
    // drop); unsealed deletions are unrepresentable in a copy-only v1 overlay.
    if (relPath.startsWith(TRUSTED_TEST_PREFIX)) dropped.push({ path: relPath, reason: "trusted-tests" });
    else if (globs.some((re) => re.test(relPath))) dropped.push({ path: relPath, reason: "sealed" });
  }
  return { overlay, dropped };
}

/**
 * Mutable clone of a frozen snapshot (minus .git): cpSync preserves the 0444/
 * 0555 freeze modes, so the clone is thawed before anything overlays onto it;
 * the harness's own node_modules is SYMLINKED (pinned toolchain — never copied,
 * never npm ci, never candidate-supplied build scripts).
 */
export async function cloneSnapshot(snapshotPath: string, buildDir: string, nodeModules: string): Promise<void> {
  mkdirSync(path.dirname(buildDir), { recursive: true });
  cpSync(snapshotPath, buildDir, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(snapshotPath, src);
      return rel !== ".git" && !rel.startsWith(`.git${path.sep}`);
    },
  });
  await thawTree(buildDir);
  symlinkSync(nodeModules, path.join(buildDir, "node_modules"), "dir");
}

export function writeOverlay(buildDir: string, decision: OverlayDecision): void {
  for (const file of decision.overlay) {
    const abs = path.join(buildDir, file.path);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, file.content, "utf8");
  }
}

export type BuildStatus = "ok" | "failed" | "timeout";

export interface BuildOutcome {
  readonly status: BuildStatus;
  readonly exit: number | null;
  readonly note: string;
}

/**
 * The repo's OWN build recipe under the HARNESS-PINNED toolchain reached
 * through the node_modules symlink: `tsc -p tsconfig.json` then
 * `node scripts/copy-assets.mjs` (the two steps npm run build runs — never
 * npm, never candidate-supplied scripts; copy-assets is itself sealed).
 * timeoutS bounds BOTH steps together.
 */
export async function runBuild(buildDir: string, timeoutS: number, onChild?: (h: ChildHandle) => void): Promise<BuildOutcome> {
  const started = Date.now();
  const remaining = (): number => Math.max(5, timeoutS - Math.round((Date.now() - started) / 1000));
  const steps: { readonly label: string; readonly argv: readonly string[] }[] = [
    { label: "tsc", argv: [process.execPath, path.join(buildDir, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"] },
    { label: "copy-assets", argv: [process.execPath, "scripts/copy-assets.mjs"] },
  ];
  for (const stepDef of steps) {
    const outcome = await step({ argv: stepDef.argv, cwd: buildDir, timeoutS: remaining() }, onChild);
    if (outcome.kind === "timeout") return { status: "timeout", exit: null, note: `${stepDef.label}: ${outcome.reason}` };
    if (outcome.kind === "spawn_failed") return { status: "failed", exit: null, note: `${stepDef.label}: ${outcome.reason}` };
    if (outcome.exitCode !== 0) {
      const first = outcome.stdout.trim().split("\n").find((l) => l.length > 0) ?? outcome.stderr.trim().split("\n")[0] ?? "no output";
      return { status: "failed", exit: outcome.exitCode, note: `${stepDef.label}: ${first}` };
    }
  }
  return { status: "ok", exit: 0, note: "" };
}

export interface TapSummary {
  readonly tests: number;
  readonly pass: number;
  readonly fail: number;
}

/** node --test over the compiled suite (the plan's scoring surface). */
export async function runSuite(buildDir: string, timeoutS: number, onChild?: (h: ChildHandle) => void): Promise<ChildOutcome> {
  return step(
    { argv: [process.execPath, "--test", "dist/test/**/*.test.js"], cwd: buildDir, timeoutS, env: { NODE_TEST_CONTEXT: undefined } },
    onChild,
  );
}

export async function runReplay(buildDir: string, timeoutS: number, onChild?: (h: ChildHandle) => void): Promise<ChildOutcome> {
  return step({ argv: [process.execPath, "selfbench/replay.mjs"], cwd: buildDir, timeoutS }, onChild);
}

function step(
  opts: { readonly argv: readonly string[]; readonly cwd: string; readonly timeoutS: number; readonly env?: Readonly<Record<string, string | undefined>> },
  onChild?: (h: ChildHandle) => void,
): Promise<ChildOutcome> {
  return runChild(onChild === undefined ? opts : { ...opts, onChild });
}

/** Parse the node:test TAP summary lines ('# tests N' / '# pass N' / '# fail N'). */
export function parseTapSummary(stdout: string): TapSummary | null {
  let tests: number | null = null;
  let pass: number | null = null;
  let fail: number | null = null;
  for (const line of stdout.split("\n")) {
    const m = /^# (tests|pass|fail) (\d+)$/.exec(line);
    if (m === null) continue;
    const value = Number(m[2]);
    if (m[1] === "tests") tests = value;
    else if (m[1] === "pass") pass = value;
    else fail = value;
  }
  if (tests === null || pass === null || fail === null) return null;
  return { tests, pass, fail };
}

export function parseReplayDigest(stdout: string): string | null {
  const lines = stdout.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? "";
    if (!line.startsWith("{")) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value === "object" && value !== null && "digest" in value) {
        const d = value.digest;
        if (typeof d === "string" && /^[0-9a-f]{64}$/.test(d)) return d;
      }
    } catch {
      // not the digest line — keep scanning upward.
    }
  }
  return null;
}

export async function incumbentSnapshot(genomeRepo: string, genomeFp: string, commitSha: string, env: WorktreeEnv): Promise<string> {
  const handle = await snapshotCommit({ repoPath: genomeRepo, genomeFp }, commitSha, { env });
  return handle.snapshotPath;
}

/** src/** candidate files (rel path -> text) from a candidate snapshot. */
export function candidateSrcFiles(snapshotPath: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rel of treePaths(snapshotPath)) {
    if (rel.startsWith(OVERLAY_PREFIX)) out.set(rel, readFileSync(path.join(snapshotPath, rel), "utf8"));
  }
  return out;
}

export function removeBuildDir(buildDir: string): void {
  rmSync(buildDir, { recursive: true, force: true });
}

/** The TRUSTED replay expectation — a corrupt goalpost file is cannot-answer, never a pass. */
export function readExpectedDigest(snapshotPath: string): string {
  let raw: string;
  try {
    raw = readFileSync(path.join(snapshotPath, "selfbench", "expected.json"), "utf8");
  } catch {
    return cannotAnswer(`self-snapshot: trusted selfbench/expected.json missing from snapshot ${snapshotPath}`);
  }
  let digest: unknown;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === "object" && value !== null && "digest" in value) digest = value.digest;
  } catch {
    return cannotAnswer(`self-snapshot: selfbench/expected.json in ${snapshotPath} is not valid JSON`);
  }
  if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) {
    return cannotAnswer(`self-snapshot: selfbench/expected.json in ${snapshotPath} carries no 64-hex digest`);
  }
  return digest;
}
