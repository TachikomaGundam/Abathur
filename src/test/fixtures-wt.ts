// Shared test fixtures for todo 3 (worktree store). Deliberately independent of
// src/util/git.ts so the RED phase fails on the module under test, not here.
// Every fixture lives under a per-run mkdtemp root (no path shared across
// checkouts/worktrees running the suite concurrently).

import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { TestContext } from "node:test";

const exec = promisify(execFile);

/** Deterministic identity + no signing, immune to the machine's global gitconfig. */
export const GIT_ID = [
  "-c",
  "user.name=abathur-test",
  "-c",
  "user.email=test@abathur.local",
  "-c",
  "commit.gpgsign=false",
] as const;

export async function gitIn(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", [...args], {
    cwd,
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout.trim();
}

/** chmod dirs on the way up so rm -rf can collect a frozen snapshot tree. */
export async function forceRm(root: string): Promise<void> {
  async function walk(dir: string): Promise<void> {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.isDirectory()) await walk(path.join(dir, e.name));
    }
    await chmod(dir, 0o755);
  }
  try {
    await walk(root);
  } catch {
    /* already gone */
  }
  await rm(root, { recursive: true, force: true });
}

export interface FixtureGenome {
  readonly root: string;
  readonly repo: string;
  /** Injectable WorktreeEnv: XDG + HOME both point inside the tmp root. */
  readonly env: { XDG_CACHE_HOME: string; HOME: string };
  readonly fp: string;
  readonly head: string;
}

/** Git working copy with tracked `a.txt` and `bench/run.sh`, one seeded commit on `main`. */
export async function fixtureRepo(
  t: TestContext,
  prefix = "abathur-wt-",
): Promise<FixtureGenome> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => forceRm(root));
  const repo = path.join(root, "src-repo");
  await mkdir(repo, { recursive: true });
  await gitIn(repo, "init", "-q", "-b", "main");
  await writeFile(path.join(repo, "a.txt"), "first\n");
  await mkdir(path.join(repo, "bench"));
  await writeFile(path.join(repo, "bench", "run.sh"), "echo bench\n");
  await gitIn(repo, "add", ".");
  await gitIn(repo, ...GIT_ID, "commit", "-qm", "genome seed");
  const head = await gitIn(repo, "rev-parse", "HEAD");
  return {
    root,
    repo,
    env: { XDG_CACHE_HOME: path.join(root, "xdg-cache"), HOME: path.join(root, "fake-home") },
    fp: "fp-fixture01",
    head,
  };
}
