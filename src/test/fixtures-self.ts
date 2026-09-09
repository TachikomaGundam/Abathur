// Shared fixture helpers for the todo-11 self-bench tests: a TRIMMED COPY of the
// harness repo (every real src file except src/test/**, plus the toolchain,
// genomes, selfbench and a stub graders/ contract) committed to a fresh git
// repo in tmp. NEVER the real repo — self-bench tests only ever point
// ABATHUR_SELF_REPO at these copies. The trimmed copy carries two tiny trusted
// tests so the overlay suite runs in seconds; node_modules is symlinked to the
// harness install (exactly what self-snapshot does for the toolchain).

import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TestContext } from "node:test";

import type { WorktreeEnv } from "../core/genome-paths.js";

export const HARNESS_ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

export interface SelfHarness {
  readonly root: string;
  readonly repo: string;
  readonly configDir: string;
  readonly xdg: string;
  readonly env: WorktreeEnv;
  readonly specPath: string;
}

const SANITY_TEST = `import assert from "node:assert/strict";
import test from "node:test";
import { EXIT_OK } from "../exit.js";
import { writeStdout } from "../out.js";
import { canonicalJson, fingerprint } from "../core/ids.js";

test("self-sanity: exit contract", () => {
  assert.equal(EXIT_OK, 0);
});

test("self-sanity: stdout funnel", () => {
  assert.equal(typeof writeStdout, "function");
});

test("self-sanity: canonical json ordering", () => {
  assert.equal(fingerprint({ b: 1, a: [1, { d: 2, c: 3 }] }), fingerprint({ a: [1, { c: 3, d: 2 }], b: 1 }));
  assert.equal(canonicalJson({ x: undefined }), "{}");
});
`;

const MUTATOR_TEST = `import assert from "node:assert/strict";
import test from "node:test";
import { scriptedPatches, selectPatches } from "../core/evolve/stub-mutators.mjs";

test("self-sanity: stub mutators deterministic", () => {
  const a = selectPatches(7, scriptedPatches().length).map((p) => p.id);
  const b = selectPatches(7, scriptedPatches().length).map((p) => p.id);
  assert.deepEqual(a, b);
  assert.equal(a.length, 4);
});
`;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=abathur", "-c", "user.email=abathur@harness.local", "-C", cwd, ...args], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
  }).trim();
}

/** Fresh git repo: real harness tree minus src/test, plus tiny trusted tests. */
export function makeSelfHarness(t: TestContext): SelfHarness {
  const root = mkdtempSync(path.join(os.tmpdir(), "abathur-self-"));
  t.after(() => {
    // frozen snapshot dirs (0444/0555) need u+w before rm -rf (todo-3 rule).
    try {
      execFileSync("chmod", ["-R", "u+w", root]);
    } catch {
      // tree already gone — nothing to thaw.
    }
    rmSync(root, { recursive: true, force: true });
  });
  const repo = path.join(root, "harness");
  mkdirSync(repo, { recursive: true });

  cpSync(path.join(HARNESS_ROOT, "src"), path.join(repo, "src"), {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(HARNESS_ROOT, src);
      return rel !== "src/test" && !rel.startsWith(`src/test${path.sep}`);
    },
  });
  for (const rel of ["package.json", "tsconfig.json", ".gitignore"]) {
    cpSync(path.join(HARNESS_ROOT, rel), path.join(repo, rel));
  }
  mkdirSync(path.join(repo, "scripts"), { recursive: true });
  cpSync(path.join(HARNESS_ROOT, "scripts", "copy-assets.mjs"), path.join(repo, "scripts", "copy-assets.mjs"));
  mkdirSync(path.join(repo, "genomes"), { recursive: true });
  cpSync(path.join(HARNESS_ROOT, "genomes"), path.join(repo, "genomes"), { recursive: true });
  mkdirSync(path.join(repo, "selfbench"), { recursive: true });
  cpSync(path.join(HARNESS_ROOT, "selfbench", "replay.mjs"), path.join(repo, "selfbench", "replay.mjs"));
  mkdirSync(path.join(repo, "graders"), { recursive: true });
  writeFileSync(
    path.join(repo, "graders", "contract.json"),
    '{"schema":"abathur-grader-contract-v1","line":"{unit, score 0..1, pass, metrics{tokensEst,turns}}"}\n',
    "utf8",
  );
  rmSync(path.join(repo, "src", "test"), { recursive: true, force: true });
  mkdirSync(path.join(repo, "src", "test"), { recursive: true });
  writeFileSync(path.join(repo, "src", "test", "self-sanity.test.ts"), SANITY_TEST, "utf8");
  writeFileSync(path.join(repo, "src", "test", "self-mutators.test.ts"), MUTATOR_TEST, "utf8");
  symlinkSync(path.join(HARNESS_ROOT, "node_modules"), path.join(repo, "node_modules"), "dir");

  git(repo, "init", "-b", "main");
  // the harness's 'node_modules/' pattern is dir-only and never matches this
  // symlink — without the exact-name exclude the link would be COMMITTED and
  // ride into every snapshot, colliding with the bench's own node_modules link.
  appendFileSync(path.join(repo, ".git", "info", "exclude"), "node_modules\n", "utf8");
  git(repo, "add", "-A");
  git(repo, "commit", "-m", "self harness fixture");
  return {
    root,
    repo,
    configDir: path.join(root, "config"),
    xdg: path.join(root, "xdg"),
    env: { XDG_CACHE_HOME: path.join(root, "xdg"), HOME: path.join(root, "home") },
    specPath: path.join(repo, "genomes", "abathur-self.jsonc"),
  };
}



/** Capture the golden replay digest against a fresh build of the CURRENT tree. */
export function captureReplayDigest(repo: string): string {
  execFileSync(process.execPath, [path.join(repo, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
    maxBuffer: 16 * 1024 * 1024,
  });
  const out = execFileSync(process.execPath, ["selfbench/replay.mjs"], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
  });
  const last = out.trim().split("\n").at(-1) ?? "";
  const parsed = JSON.parse(last) as { digest?: unknown };
  if (typeof parsed.digest !== "string") throw new Error(`replay produced no digest: ${last}`);
  return parsed.digest;
}

/** Write + commit selfbench/expected.json (digest of the current tree's replay). */
export function seedExpectedDigest(h: SelfHarness, digest: string): string {
  writeFileSync(
    path.join(h.repo, "selfbench", "expected.json"),
    `${JSON.stringify({ digest, capturedAt: new Date().toISOString().slice(0, 10), note: "golden toy-replay at seed — todo 11" }, null, 2)}\n`,
    "utf8",
  );
  git(h.repo, "add", "selfbench/expected.json");
  git(h.repo, "commit", "-m", "selfbench expected digest");
  return headSha(h.repo);
}

export function headSha(repo: string): string {
  return git(repo, "rev-parse", "HEAD");
}

/** Apply a working-tree surgery, commit it, return the new HEAD sha. */
export function handCommit(repo: string, surgery: () => void, message: string): string {
  surgery();
  git(repo, "add", "-A");
  git(repo, "commit", "-m", message);
  return headSha(repo);
}

export function editFile(repo: string, rel: string, mutate: (text: string) => string): void {
  const abs = path.join(repo, rel);
  writeFileSync(abs, mutate(readFileSync(abs, "utf8")), "utf8");
}


