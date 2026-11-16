#!/usr/bin/env node
// Fail-closed scan for identifiers retired by a history purge.
//
// A rewrite retires the entire old object namespace. Any published ID is a
// retrieval handle for content that "unreachable" still serves, so retained
// artifacts must not name retired IDs.
//
// Two independent checks, both fail-closed:
//   1. Registry check: no tracked file, commit message or tag message may
//      contain a prefix listed in config/retired-handles.json, unless the
//      occurrence is registered under accepted_residuals.
//   2. Identity check: every full 40-hex token in a tracked file, commit
//      message or tag message must resolve to a local object. This catches
//      handles that no registry entry knows about yet.
//
// Usage: node scripts/scan-retired-handles.mjs [--root <dir>] [--json]

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const HEX = /(?<![0-9a-fA-F])[0-9a-f]{7,40}(?![0-9a-fA-F])/g;
const FULL = /(?<![0-9a-fA-F])[0-9a-f]{40}(?![0-9a-fA-F])/g;

export function loadRegistry(root = process.cwd()) {
  const path = join(root, "config", "retired-handles.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Registry prefixes sorted longest-first, so the most specific match wins. */
export function prefixesOf(registry) {
  const list = (registry?.handles ?? []).map((h) => String(h.prefix).toLowerCase());
  return [...new Set(list)].sort((a, b) => b.length - a.length);
}

/** Tokens in `text` that are a registered retired prefix, or that a registered prefix extends. */
export function findRegistryHits(text, prefixes) {
  const hits = [];
  for (const match of String(text).matchAll(HEX)) {
    const token = match[0].toLowerCase();
    const prefix = prefixes.find((p) => token.startsWith(p) || p.startsWith(token));
    if (prefix) hits.push({ token, prefix });
  }
  return hits;
}

/** Full 40-hex tokens present in `text`. */
export function fullTokens(text) {
  return [...String(text).matchAll(FULL)].map((m) => m[0].toLowerCase());
}

/**
 * Ask git whether each token resolves. Tokens that do not resolve are the
 * identity-check violations. Batch for speed: one cat-file process.
 */
export function unresolvedTokens(tokens, root = process.cwd()) {
  const unique = [...new Set(tokens)];
  if (unique.length === 0) return [];
  const run = spawnSync("git", ["cat-file", "--batch-check"], {
    cwd: root,
    input: unique.join("\n") + "\n",
    encoding: "utf8",
  });
  if (run.status !== 0) {
    throw new Error(`git cat-file failed: ${run.stderr?.trim() || run.status}`);
  }
  const missing = [];
  for (const line of run.stdout.split("\n").filter(Boolean)) {
    if (/ missing$/.test(line)) missing.push(line.split(" ")[0]);
  }
  return missing;
}

function git(root, args) {
  const run = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr?.trim()}`);
  return run.stdout;
}

function acceptedFor(registry, kind, scopeId, prefix) {
  return (registry?.accepted_residuals ?? []).some(
    (entry) =>
      entry.kind === kind &&
      entry.prefix === prefix &&
      (kind === "commit-message" ? entry.commit === scopeId : true),
  );
}

/**
 * @returns {{files:number, violations:Array<object>, accepted:number}}
 */
export function scan(root = process.cwd()) {
  const registry = loadRegistry(root);
  const prefixes = prefixesOf(registry);
  const violations = [];
  let accepted = 0;

  const files = git(root, ["ls-files", "-z"]).split("\0").filter(Boolean);
  const pending = [];
  for (const file of files) {
    if (file === "config/retired-handles.json") continue;
    let text;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) continue;
    for (const hit of findRegistryHits(text, prefixes)) {
      violations.push({ kind: "retired-handle", where: file, token: hit.token, prefix: hit.prefix });
    }
    pending.push(...fullTokens(text).map((t) => ({ token: t, where: file })));
  }
  for (const token of unresolvedTokens(pending.map((p) => p.token), root)) {
    for (const hit of pending.filter((p) => p.token === token)) {
      violations.push({ kind: "unresolved-full-handle", where: hit.where, token });
    }
  }

  const log = git(root, ["log", "--all", "--format=%H%x1e%B%x1e"]);
  const parts = log.split("\x1e");
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const commit = parts[i].trim();
    const body = parts[i + 1] ?? "";
    if (!/^[0-9a-f]{40}$/.test(commit)) continue;
    for (const hit of findRegistryHits(body, prefixes)) {
      if (acceptedFor(registry, "commit-message", commit, hit.prefix)) accepted += 1;
      else violations.push({ kind: "retired-handle-in-message", where: `commit ${commit}`, token: hit.token, prefix: hit.prefix });
    }
    for (const token of unresolvedTokens(fullTokens(body), root)) {
      violations.push({ kind: "unresolved-full-handle-in-message", where: `commit ${commit}`, token });
    }
  }

  const tags = git(root, ["for-each-ref", "--format=%(refname)%x1e%(contents)%x1e", "refs/tags"]);
  const tagParts = tags.split("\x1e");
  for (let i = 0; i + 1 < tagParts.length; i += 2) {
    const ref = tagParts[i].trim();
    const body = tagParts[i + 1] ?? "";
    if (!ref) continue;
    for (const hit of findRegistryHits(body, prefixes)) {
      violations.push({ kind: "retired-handle-in-tag", where: ref, token: hit.token, prefix: hit.prefix });
    }
  }

  return { files: files.length, violations, accepted };
}

function main(argv) {
  const rootIndex = argv.indexOf("--root");
  const root = resolve(rootIndex >= 0 ? argv[rootIndex + 1] : process.cwd());
  const json = argv.includes("--json");
  let result;
  try {
    result = scan(root);
  } catch (error) {
    process.stdout.write(`RETIRED-HANDLES ERROR ${error.message}\n`);
    return 2;
  }
  if (json) {
    process.stdout.write(`${JSON.stringify({ rc: result.violations.length ? 1 : 0, ...result })}\n`);
    return result.violations.length ? 1 : 0;
  }
  if (result.violations.length === 0) {
    process.stdout.write(`RETIRED-HANDLES OK files=${result.files} accepted_residuals=${result.accepted} rc=0\n`);
    return 0;
  }
  process.stdout.write(`RETIRED-HANDLES FAIL files=${result.files} violations=${result.violations.length}\n`);
  for (const v of result.violations) {
    process.stdout.write(`  ${v.kind} ${v.where} ${v.token}${v.prefix ? ` prefix=${v.prefix}` : ""}\n`);
  }
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  process.exitCode = main(process.argv.slice(2));
}
