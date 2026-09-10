// Thin git wrapper (todo 3 contract): execFile('git', arrayArgs) ONLY — paths are
// passed as argv elements and never reach a shell, so metacharacters in repo or
// worktree paths cannot inject commands. No push, no ref-mutating shortcuts
// live here; callers pass the exact argv they need.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 32 * 1024 * 1024;

/** How a git run ended badly: non-zero exit, timeout kill, or spawn failure. */
export type GitErrorKind = "failed" | "timeout" | "spawn";

export class GitError extends Error {
  constructor(
    readonly kind: GitErrorKind,
    readonly args: readonly string[],
    readonly exitCode: number | null,
    readonly stderr: string,
    message: string,
  ) {
    super(message);
    this.name = "GitError";
  }
}

export interface GitRunOptions {
  /** Working directory for the git invocation. */
  readonly cwd?: string | undefined;
  /** Kill a hung git after this many ms (default 30_000). */
  readonly timeoutMs?: number | undefined;
  /** Override the git binary — tests only, to prove the timeout plumbing kills a stuck run. */
  readonly bin?: string | undefined;
}

export interface GitResult {
  readonly stdout: string;
  readonly stderr: string;
}

/** Outcome of tryGit: exit-code failures are answers (ok:false); timeout/spawn reject. */
export type GitAttempt = ({ ok: true } & GitResult) | { ok: false; error: GitError };

// Node's execFile errors are Error instances carrying these optional fields
// (code/exit signal/stdout/stderr); this predicate encodes that contract.
type ExecErrorFields = {
  readonly code?: string | number | undefined;
  readonly killed?: boolean | undefined;
  readonly signal?: string | null | undefined;
  readonly stdout?: string | undefined;
  readonly stderr?: string | undefined;
};
function isExecError(err: unknown): err is Error & ExecErrorFields {
  return err instanceof Error;
}

function firstLine(text: string): string {
  const line = text.split("\n", 1)[0] ?? "";
  return line.trim();
}

function describe(args: readonly string[]): string {
  return `git ${args.join(" ")}`;
}

function classify(args: readonly string[], cause: unknown): GitError {
  if (isExecError(cause)) {
    const stderr = cause.stderr ?? "";
    if (cause.killed === true) {
      return new GitError(
        "timeout",
        args,
        null,
        stderr,
        `${describe(args)} timed out and was killed (signal ${cause.signal ?? "SIGKILL"})`,
      );
    }
    if (cause.code === "ENOENT") {
      return new GitError(
        "spawn",
        args,
        null,
        stderr,
        `${describe(args)}: cannot spawn git binary: ${firstLine(cause.message)}`,
      );
    }
    if (typeof cause.code === "number") {
      return new GitError(
        "failed",
        args,
        cause.code,
        stderr,
        `${describe(args)} exited ${cause.code}: ${firstLine(stderr) || firstLine(cause.message)}`,
      );
    }
  }
  const why = cause instanceof Error ? firstLine(cause.message) : String(cause);
  return new GitError("spawn", args, null, "", `${describe(args)} failed to run: ${why}`);
}

async function spawnGit(
  args: readonly string[],
  opts: GitRunOptions,
): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync(opts.bin ?? "git", [...args], {
      ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: MAX_BUFFER_BYTES,
      env: { ...process.env, LC_ALL: "C" },
    });
    return { stdout, stderr };
  } catch (cause) {
    throw classify(args, cause);
  }
}

/** Run git; reject with GitError on non-zero exit, timeout, or spawn failure. */
export async function git(
  args: readonly string[],
  opts: GitRunOptions = {},
): Promise<GitResult> {
  return spawnGit(args, opts);
}

/**
 * Like git(), but a plain non-zero *exit* is a result (ok: false) instead of a
 * rejection — for predicates like `merge-base --is-ancestor`. Timeouts and
 * spawn failures still reject (they are not answers, only missing ones).
 */
export async function tryGit(
  args: readonly string[],
  opts: GitRunOptions = {},
): Promise<GitAttempt> {
  try {
    const result = await spawnGit(args, opts);
    return { ok: true, ...result };
  } catch (cause) {
    if (cause instanceof GitError && cause.kind === "failed") {
      return { ok: false, error: cause };
    }
    throw cause;
  }
}
