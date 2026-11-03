#!/usr/bin/env node
/**
 * Generate the v1 -> v2 mapping table. Every tracked v1 file gets exactly one
 * row: rewrite (with the v2 destination), carry (with an override), or discard
 * (with a reason). Binary and generated files are excluded by the names below.
 *
 * usage: node scripts/gen-mapping.mjs <v1-root> <v2-root>
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [v1root, v2root] = process.argv.slice(2).map((p) => resolve(p));
if (!v1root || !v2root) {
  process.stdout.write("usage: node scripts/gen-mapping.mjs <v1-root> <v2-root>\n");
  process.exitCode = 2;
  process.exit();
}

const EXCLUDE = [
  /(^|\/)package-lock\.json$/,
  /^docs\/evidence-manifests\//,
  /\.(png|jpe?g|gif|webp|ico|pdf|zip|tar|gz|tgz|woff2?|ttf|otf|mp4|mov|wasm)$/i,
];

const listing = spawnSync("git", ["-C", v1root, "ls-files"], { encoding: "utf8" });
if (listing.status !== 0) {
  process.stdout.write(`MAPPING FAILED: ${listing.stderr.trim()}\n`);
  process.exitCode = 2;
  process.exit();
}

const files = listing.stdout.split("\n").map((line) => line.trim()).filter(Boolean).filter((path) => !EXCLUDE.some((rx) => rx.test(path)));

function classify(path) {
  if (path.startsWith("src/bench/")) return ["rewrite", "exam/ adapters (candidate/judge channels)"];
  if (path.startsWith("src/core/evolve/")) return ["rewrite", "kernel/planning/ (plan lifecycle)"];
  if (path.startsWith("src/core/")) return ["rewrite", "kernel/ modules by concern (identity, evidence, judge, gate, surface, lane)"];
  if (path.startsWith("src/commands/")) return ["rewrite", "cli/abathur-v2.mjs"];
  if (path.startsWith("src/util/")) return ["rewrite", "shared helpers inlined into the owning kernel module"];
  if (path.startsWith("src/test/")) return ["rewrite", "test/*.test.mjs"];
  if (path.startsWith("src/")) return ["rewrite", "kernel/ or cli/ interface"];
  if (path === "loop/bank.py") return ["rewrite", "exam/bank.mjs"];
  if (path === "loop/draw.py") return ["rewrite", "exam/draw.mjs"];
  if (/^loop\/.*(run_registry|spawn|clean_run|reclaim)/.test(path)) return ["rewrite", "exam/spawn.mjs + kernel/hygiene"];
  if (path.startsWith("loop/proposals/") || path.startsWith("loop/constitution")) return ["discard", "v1 exam governance history; v2 rules/registry.yaml is the authority"];
  if (path.startsWith("loop/")) return ["discard", "v1 exam runner and ledgers replaced by v2 exam/ and kernel/evidence"];
  if (path === "scripts/copy-similarity.py") return ["discard", "W0 instrument stays in the main tree and is dispatched by path, not copied"];
  if (path === "scripts/plan_check.py") return ["discard", "W0 instrument stays in the main tree (plan gate owner)"];
  if (path.startsWith("scripts/")) return ["discard", "v1 operational scripts replaced by v2 scripts/ (gate, receipts, quality, baseline)"];
  if (path.startsWith("skills/")) return ["discard", "v1 skill manuals replaced by v2 README + docs"];
  if (path.startsWith("docs/")) return ["discard", "v1 documentation; v2 docs rewritten from scratch"];
  if (path.startsWith(".opencode/")) return ["discard", "host plugin not part of the v2 runtime"];
  if (path === "package.json" || path === "package-lock.json") return ["rewrite", "v2 package metadata (zero runtime dependencies)"];
  if (path === "AGENTS.md") return ["discard", "v1 project rules remain in the main tree; v2 authority is rules/registry.yaml"];
  if (/^README/.test(path)) return ["discard", "v1 README replaced by v2 README.md"];
  if (path === ".gitignore") return ["rewrite", "v2 .gitignore"];
  return ["discard", "not part of the v2 runtime or evidence surface"];
}

const rows = files.map((path) => {
  const [destination, reason] = classify(path);
  return { path, destination, reason };
});

const rewrite = rows.filter((row) => row.destination === "rewrite").length;
const discard = rows.filter((row) => row.destination === "discard").length;
const carry = rows.filter((row) => row.destination === "carry").length;

const lines = [
  "# v1 -> v2 mapping",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  `- v1 root: \`${v1root}\``,
  `- v2 root: \`${v2root}\``,
  `- tracked v1 rows (after named exclusions): **${rows.length}**`,
  `- rewrite: **${rewrite}**`,
  `- discard: **${discard}**`,
  `- carry: **${carry}** (cap: 3 entries and 10% of v2 file count; every carry needs an independent audit receipt)`,
  "",
  "| v1 path | destination | reason |",
  "|---|---|---|",
  ...rows.map((row) => `| \`${row.path}\` | ${row.destination} | ${row.reason} |`),
  "",
];

const out = join(v2root, "docs/MAPPING-v1-v2.md");
writeFileSync(out, `${lines.join("\n")}`);
process.stdout.write(`MAPPING ${out} rows=${rows.length} rewrite=${rewrite} discard=${discard} carry=${carry}\n`);
