#!/usr/bin/env node
/**
 * Static quality scan: syntax-check every JS/MJS file, flag leftover markers,
 * empty catch blocks, and suspicious debug statements.
 */
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SKIP = new Set([".git", "node_modules", ".omo", ".codegraph", "dist", "build", ".border", ".bench", ".state", "coverage"]);
const problems = [];
let checked = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      if (relative(ROOT, path) === "rules/generated") continue;
      walk(path);
    } else if (/\.(mjs|js)$/.test(name)) inspect(path);
  }
}

function inspect(path) {
  checked += 1;
  const source = readFileSync(path, "utf8");
  const syntax = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
  if (syntax.status !== 0) problems.push(`${path}: syntax error`);
  const marker = new RegExp(`\\b(${["FIX", "ME"].join("")}|${["TO", "DO"].join("")})\\b|${String.fromCharCode(0x5f85, 0x529e)}`);
  if (marker.test(source)) problems.push(`${path}: leftover marker`);
  if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(source)) problems.push(`${path}: empty catch`);
  if (/console\.log\(/.test(source) && !path.includes("/scripts/")) problems.push(`${path}: console.log outside scripts/`);
}

walk(ROOT);
for (const problem of problems) process.stdout.write(`QUALITY: ${problem}\n`);
process.stdout.write(`QUALITY ${problems.length === 0 ? "OK" : "FAIL"} files=${checked} problems=${problems.length} rc=${problems.length === 0 ? 0 : 1}\n`);
process.exitCode = problems.length === 0 ? 0 : 1;
