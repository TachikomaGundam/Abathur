#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, join } from "node:path";

const ROOT = process.cwd();
const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  process.stderr.write("usage: npm run release:prepare -- <x.y.z>\n");
  process.exit(2);
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { cwd: ROOT, stdio: options.capture ? "pipe" : "inherit", encoding: "utf8" });
  if (result.status !== 0) {
    if (options.capture) process.stderr.write(result.stderr ?? "");
    process.stderr.write(`release:prepare: command failed: ${cmd} ${args.join(" ")}\n`);
    process.exit(result.status ?? 1);
  }
  return result;
}

function git(args, options = {}) {
  return run("git", args, options);
}

const status = git(["status", "--porcelain"], { capture: true }).stdout.trim();
const tracked = status.split("\n").filter((line) => line && !line.startsWith("??"));
if (tracked.length) {
  process.stderr.write(`release:prepare: tracked worktree is not clean:\n${tracked.join("\n")}\n`);
  process.exit(1);
}
if (status.includes("\n??") || status.startsWith("??")) {
  process.stderr.write("release:prepare: warning: untracked files are not in the release candidate\n");
}

const tag = `v${version}`;
const tagExists = spawnSync("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`], { cwd: ROOT });
if (tagExists.status === 0) {
  process.stderr.write(`release:prepare: tag ${tag} already exists\n`);
  process.exit(1);
}

run("npm", ["version", version, "--no-git-tag-version"]);
git(["add", "package.json"]);
if (existsSync(join(ROOT, "package-lock.json"))) git(["add", "package-lock.json"]);
git(["commit", "-m", `release: bump ${version}`]);

const gates = [
  ["npm", ["test"]],
  ["node", ["scripts/scan-quality.mjs"]],
  ["node", ["scripts/scan-coupling.mjs"]],
  ["node", ["kernel/exec/spawn-gate.mjs"]],
  ["node", ["cli/abathur-v2.mjs", "rules", "validate"]],
  ["node", ["cli/abathur-v2.mjs", "gate", "run"]],
];
if (existsSync(join(ROOT, ".omo/plans/refactor-abathur-v2.md"))) {
  gates.push(["node", ["scripts/plan-check.mjs", ".omo/plans/refactor-abathur-v2.md"]]);
}
for (const [cmd, args] of gates) run(cmd, args);

const candidateRun = run("node", ["scripts/release-candidate.mjs", "--commit", "HEAD"], { capture: true });
const line = candidateRun.stdout.split("\n").find((entry) => entry.trim().startsWith("{"));
if (!line) {
  process.stderr.write("release:prepare: candidate output was not JSON\n");
  process.exit(1);
}
const candidate = JSON.parse(line);
const commit = candidate.commit;
const current = git(["rev-parse", "HEAD"], { capture: true }).stdout.trim();
const describe = spawnSync("git", ["describe", "--tags", "--abbrev=0", "HEAD~1"], { cwd: ROOT, encoding: "utf8" });
const previous = describe.status === 0 ? describe.stdout.trim() : "";
const log = previous
  ? git(["log", "--oneline", `${previous}..${current}`], { capture: true }).stdout.trim()
  : git(["log", "--oneline", "-10"], { capture: true }).stdout.trim();

const releaseDir = join(ROOT, "docs", "release");
mkdirSync(releaseDir, { recursive: true });
const releasePath = join(releaseDir, `${tag}.md`);
const doc = `# Release ${version}

gate: PASS

## 本版变更

\`\`\`
${log || "(no commits listed)"}
\`\`\`

## 检查结果

| 项 | 结果 |
|---|---|
| 全部门 | PASS |
| 候选包 commit | \`${commit}\` |
| \`npm pack\` | \`${candidate.files}\` 个文件 |
| tarball sha256 | \`${candidate.sha256}\` |
| 候选收据 | \`<state>/evidence/release-candidates/${basename(candidate.receipt)}\` |

## 怎么发

由人运行：

```sh
cd "$(git rev-parse --show-toplevel)" && ./scripts/release.sh ${tag}
```
`;
writeFileSync(releasePath, doc);
git(["add", `docs/release/${tag}.md`]);
git(["commit", "-m", `docs(release): ${version} receipt`]);
git(["tag", "-a", tag, "-m", `abathur ${version}`]);

appendFileSync(
  join(ROOT, ".omo", "evidence", `release-prepare-${version}.md`),
  `- ${new Date().toISOString()} prepared ${tag}\n- code commit ${commit}\n- candidate sha256 ${candidate.sha256}\n- candidate files ${candidate.files}\n`,
);

process.stdout.write(`RELEASE PREPARED ${tag}\n`);
process.stdout.write(`code=${commit} files=${candidate.files} sha256=${candidate.sha256}\n`);
process.stdout.write(`HUMAN: cd ${ROOT} && ./scripts/release.sh ${tag}\n`);
