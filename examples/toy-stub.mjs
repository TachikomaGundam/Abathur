// README quick-start example: a minimal mutator driver.
// It reads the package's scripted-patch table and prints candidate JSON on stdout;
// the harness applies and benches each candidate itself.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (n) => args[args.indexOf(n) + 1];
const { scriptedPatches } = await import(pathToFileURL(opt("--lib")).href);

const candidates = [];
for (const patch of scriptedPatches()) {
  const lines = readFileSync(`${opt("--dir")}/${patch.file}`, "utf8").split("\n");
  const i = lines.findIndex((line) => line.includes(patch.from));
  if (i < 0) continue; // anchor already consumed — nothing to propose here
  candidates.push({
    id: patch.id,
    rationale: patch.description,
    diffs: [
      `--- a/${patch.file}\n+++ b/${patch.file}\n@@ -${i + 1},1 +${i + 1},1 @@\n` +
      `-${lines[i]}\n+${lines[i].replace(patch.from, patch.to)}\n`,
    ],
  });
}
process.stdout.write(`${JSON.stringify({ candidates })}\n`);
