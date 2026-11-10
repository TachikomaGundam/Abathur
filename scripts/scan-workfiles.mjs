#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const WORK_DIRS = new Set(["handoffs", "dockets", "work", "workfiles", "notes", "sessions", "tmp", ".omo"]);
const WORK_NAME = /(handoff|docket|session-close|worklog)/i;

export function classifyPath(path) {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => WORK_DIRS.has(part.toLowerCase()))) {
    return "work-directory";
  }
  const name = parts.at(-1) ?? "";
  if (WORK_NAME.test(name)) return "work-file-name";
  return null;
}

export function scan(root = process.cwd()) {
  const listed = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
  if (listed.status !== 0) {
    throw new Error(listed.stderr?.trim() || "git ls-files failed");
  }
  const files = listed.stdout.split("\0").filter(Boolean);
  const violations = [];
  for (const file of files) {
    const reason = classifyPath(file);
    if (reason) violations.push({ path: file, reason });
  }
  return { files: files.length, violations };
}

export function parseObjectLines(text) {
  const candidates = [];
  let objects = 0;
  for (const line of text.split("\n")) {
    const space = line.indexOf(" ");
    if (space < 0) continue;
    objects += 1;
    const oid = line.slice(0, space);
    const path = line.slice(space + 1);
    const reason = classifyPath(path);
    if (reason) candidates.push({ oid, path, reason });
  }
  return { objects, candidates };
}

export function filterBlobViolations(candidates, types) {
  const violations = [];
  const seen = new Set();
  candidates.forEach((c, i) => {
    if (types[i] === "blob" && !seen.has(c.path)) {
      seen.add(c.path);
      violations.push({ path: c.path, reason: c.reason });
    }
  });
  return violations;
}

export function parsePrepushLines(text) {
  const zero = /^0+$/;
  const pushes = [];
  for (const line of text.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 4 || zero.test(fields[1])) continue;
    pushes.push({ localOid: fields[1], ref: fields[2], remoteOid: fields[3] });
  }
  return pushes;
}

export function scanHistory(root = process.cwd(), revs = ["--all"]) {
  const listed = spawnSync("git", ["rev-list", "--objects", ...revs], { cwd: root, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  if (listed.status !== 0) {
    throw new Error(listed.stderr?.trim() || "git rev-list --objects failed");
  }
  const { objects, candidates } = parseObjectLines(listed.stdout);
  let violations = [];
  if (candidates.length) {
    const input = candidates.map((c) => c.oid).join("\n") + "\n";
    const typed = spawnSync("git", ["cat-file", "--batch-check=%(objecttype)"], {
      cwd: root, encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024,
    });
    if (typed.status !== 0) {
      throw new Error(typed.stderr?.trim() || "git cat-file --batch-check failed");
    }
    violations = filterBlobViolations(candidates, typed.stdout.split("\n"));
  }
  return { objects, violations };
}

export function scanPrepush(input, root = process.cwd()) {
  const zero = /^0+$/;
  const violations = [];
  const pushes = parsePrepushLines(input);
  for (const push of pushes) {
    const { localOid, remoteOid, ref } = push;
    const revs = zero.test(remoteOid) ? [localOid] : [localOid, `^${remoteOid}`];
    const result = scanHistory(root, revs);
    for (const item of result.violations) {
      violations.push({ ...item, ref });
    }
  }
  return { refs: pushes.length, violations };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  try {
    if (argv.includes("--prepush")) {
      const input = readFileSync(0, "utf8");
      const result = scanPrepush(input, process.cwd());
      if (result.violations.length) {
        for (const item of result.violations) {
          process.stderr.write(`WORKFILE-GATE FAIL ${item.path} (${item.reason}) ref=${item.ref}\n`);
        }
        process.stderr.write(`WORKFILE-GATE FAIL history violations=${result.violations.length}\n`);
        process.exit(1);
      }
      process.stdout.write(`WORKFILE-GATE OK prepush refs=${result.refs}\n`);
      process.exit(0);
    }
    if (argv.includes("--history")) {
      const revIdx = argv.indexOf("--revs");
      const revs = revIdx >= 0 ? argv.slice(revIdx + 1).filter((a) => !a.startsWith("--")) : ["--all"];
      const result = scanHistory(process.cwd(), revs.length ? revs : ["--all"]);
      if (result.violations.length) {
        for (const item of result.violations) {
          process.stderr.write(`WORKFILE-GATE FAIL ${item.path} (${item.reason})\n`);
        }
        process.stderr.write(`WORKFILE-GATE FAIL history objects=${result.objects} violations=${result.violations.length}\n`);
        process.exit(1);
      }
      process.stdout.write(`WORKFILE-GATE OK history objects=${result.objects}\n`);
      process.exit(0);
    }
    const result = scan(process.cwd());
    if (result.violations.length) {
      for (const item of result.violations) {
        process.stderr.write(`WORKFILE-GATE FAIL ${item.path} (${item.reason})\n`);
      }
      process.stderr.write(`WORKFILE-GATE FAIL violations=${result.violations.length}; move work artifacts to the state work directory\n`);
      process.exit(1);
    }
    process.stdout.write(`WORKFILE-GATE OK files=${result.files}\n`);
  } catch (error) {
    process.stderr.write(`WORKFILE-GATE ERROR ${error.message}\n`);
    process.exit(2);
  }
}
