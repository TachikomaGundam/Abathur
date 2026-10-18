// Post-build asset copier: tsc only emits .js from src/**\/*.ts, so non-TS runtime
// assets must be staged into dist/ explicitly. Every source is OPTIONAL at this
// stage (they land in todos 5 and 8); missing sources are a graceful no-op.
import { cp, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** [source relative to repo root, destination relative to dist/] */
const ASSETS = [
  ["src/core/evolve/stub-mutators.mjs", "core/evolve/stub-mutators.mjs"],
  ["genomes/toy-smoke", "genomes/toy-smoke"],
];

for (const [srcRel, dstRel] of ASSETS) {
  const src = path.join(repoRoot, srcRel);
  const dst = path.join(repoRoot, "dist", dstRel);
  try {
    await stat(src);
  } catch {
    continue; // asset not authored yet (todos 5/8) — nothing to copy
  }
  await cp(src, dst, { recursive: true });
  console.log(`copy-assets: ${srcRel} -> dist/${dstRel}`);
}

const packageText = await readFile(path.join(repoRoot, "package.json"), "utf8");
const packageManifest = JSON.parse(packageText);
if (typeof packageManifest.version !== "string" || packageManifest.version.length === 0) {
  throw new Error("copy-assets: package.json version is invalid");
}
await writeFile(
  path.join(repoRoot, "dist", "version-manifest.json"),
  `${JSON.stringify({ version: packageManifest.version })}\n`,
  "utf8",
);
console.log("copy-assets: package.json -> dist/version-manifest.json");
