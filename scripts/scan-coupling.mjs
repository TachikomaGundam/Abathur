#!/usr/bin/env node
/**
 * Guard against hard-coupling a specific review product into the v2 tree.
 * The review mechanism is abstract; the local adapter is injected by the
 * operator. Product names are forbidden in code, rules and docs.
 *
 * The forbidden token is assembled from parts so this scanner does not flag
 * itself.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const PRODUCTS = [["si", "byl"].join(""), String.fromCharCode(0x897f, 0x6bd4, 0x62c9)];
const TOKEN = new RegExp(PRODUCTS.join("|"), "i");
const EXTS = new Set([".mjs", ".js", ".cjs", ".ts", ".yaml", ".yml", ".json", ".md"]);
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".omo", "__pycache__", ".border", ".bench", ".state", "coverage"]);
const SKIP_FILES = new Set(["package-lock.json"]);

function walk(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const rel = relative(root, abs).split("\\").join("/");
      if (SKIP_FILES.has(rel)) continue;
      const st = statSync(abs);
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) stack.push(abs);
        continue;
      }
      const dot = name.lastIndexOf(".");
      const ext = dot >= 0 ? name.slice(dot) : "";
      if (EXTS.has(ext)) out.push({ abs, rel });
    }
  }
  return out;
}

const argRoot = process.argv.indexOf("--root");
const root = argRoot >= 0 ? process.argv[argRoot + 1] : process.cwd();
const files = walk(root);
const hits = [];
for (const { abs, rel } of files) {
  const lines = readFileSync(abs, "utf8").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (TOKEN.test(lines[i])) hits.push(`${rel}:${i + 1}`);
  }
}
if (hits.length) {
  for (const hit of hits) process.stdout.write(`COUPLING FAIL ${hit}\n`);
  process.stdout.write(`COUPLING FAIL hits=${hits.length} files=${files.length} rc=1\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`COUPLING OK files=${files.length} rc=0\n`);
}
