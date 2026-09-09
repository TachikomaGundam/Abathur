// Toy-smoke self-init (plan todo 5): `node init.mjs <destDir>` materializes an
// independent toy genome repo in destDir:
//   1. copy this template dir (skipping any .git/.state) into destDir,
//   2. rewrite genome.jsonc repoPath to the absolute destDir (paths are GENERATED
//      at runtime — nothing on disk hardcodes a machine path, D7),
//   3. when no .git exists, `git init` + full commit so todo-3 worktree flows work.
// Prints the destDir on stdout. Usage errors exit 2.

import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const destArg = process.argv[2];
if (typeof destArg !== "string" || destArg.length === 0) {
  process.stderr.write("usage: node init.mjs <destDir>\n");
  process.exit(2);
}
const dest = path.resolve(destArg);
if (dest === here) {
  process.stderr.write("init: destDir must differ from the template directory\n");
  process.exit(2);
}

if (!existsSync(path.join(here, "genome.jsonc"))) {
  process.stderr.write(`init: template dir ${here} has no genome.jsonc\n`);
  process.exit(2);
}

cpSync(here, dest, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(here, src);
    return rel !== ".git" && !rel.startsWith(`.git${path.sep}`) && rel !== ".state" && !rel.startsWith(`.state${path.sep}`);
  },
});

const specPath = path.join(dest, "genome.jsonc");
const spec = JSON.parse(readFileSync(specPath, "utf8"));
spec.repoPath = dest;
writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`, "utf8");

if (!existsSync(path.join(dest, ".git"))) {
  git(["init", "-b", "main"]);
  git(["add", "-A"]);
  // identity pinned via -c BEFORE the subcommand (global gitconfig immune;
  // `git init` itself rejects -c after the subcommand — learnings todo 3).
  git(["-c", "user.name=abathur", "-c", "user.email=abathur@harness.local", "commit", "-m", "toy-smoke fixture seed"]);
}

process.stdout.write(`${dest}\n`);

function git(args) {
  const run = spawnSync("git", args, { cwd: dest, encoding: "utf8" });
  if (run.error !== undefined && run.error !== null) {
    throw new Error(`init: cannot spawn git: ${run.error.message}`);
  }
  if (run.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${String(run.status)}): ${(run.stderr ?? "").trim()}`);
  }
}
