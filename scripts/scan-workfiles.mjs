#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const WORK_DIRS = new Set(["handoffs", "dockets", "work", "workfiles", "notes", "sessions", "tmp"]);
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

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
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
