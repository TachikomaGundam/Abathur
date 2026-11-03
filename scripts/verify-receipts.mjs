#!/usr/bin/env node
/**
 * Verify evidence receipts for a plan. Only closed todos are checked; open or
 * unchecked todos are PENDING and do not fail the run. A plan that parses to
 * zero todos is fail-closed (rc=1).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";

const planPath = process.argv[2];
if (!planPath || !existsSync(planPath)) {
  process.stdout.write("verify-receipts: plan path required and must exist\n");
  process.exitCode = 2;
  process.exit();
}

const lines = readFileSync(planPath, "utf8").split("\n");
const tasks = [];
let current = null;
let inTodos = false;
for (const line of lines) {
  if (line.startsWith("## ")) {
    inTodos = line.trim() === "## Todos" || line.trim() === "## Final verification wave";
    current = null;
    continue;
  }
  const task = /^- \[([ x])\] ([0-9]+|F[0-9]+)\.\s+(.*)$/.exec(line);
  if (inTodos && task) {
    current = { id: task[2], done: task[1] === "x", title: task[3], evidence: null };
    tasks.push(current);
    continue;
  }
  if (current) {
    const evidence = /^\s*(?:-\s*)?\*\*Evidence:\*\*\s*`?([^`]+)`?/.exec(line);
    if (evidence) current.evidence = evidence[1].trim();
  }
}

if (tasks.length === 0) {
  process.stdout.write("verify-receipts: parsed zero todos — refusing to pass\n");
  process.exitCode = 1;
  process.exit();
}

let failed = 0;
const pending = [];
for (const task of tasks) {
  if (!task.done) {
    pending.push(task.id);
    continue;
  }
  if (!task.evidence) {
    process.stdout.write(`RECEIPT FAIL task ${task.id}: missing Evidence field\n`);
    failed += 1;
    continue;
  }
  if (!existsSync(task.evidence)) {
    process.stdout.write(`RECEIPT FAIL task ${task.id}: missing ${task.evidence}\n`);
    failed += 1;
    continue;
  }
  const sidecar = `${task.evidence}.sha256`;
  if (existsSync(sidecar)) {
    const want = readFileSync(sidecar, "utf8").trim().split(/\s+/)[0];
    const got = createHash("sha256").update(readFileSync(task.evidence)).digest("hex");
    if (want !== got) {
      process.stdout.write(`RECEIPT FAIL task ${task.id}: sha256 mismatch for ${task.evidence}\n`);
      failed += 1;
      continue;
    }
  } else if (statSync(task.evidence).size === 0) {
    process.stdout.write(`RECEIPT FAIL task ${task.id}: empty receipt ${task.evidence}\n`);
    failed += 1;
  }
}

process.stdout.write(`RECEIPT CHECK tasks=${tasks.length} closed=${tasks.length - pending.length} pending=${pending.length} failed=${failed}\n`);
if (pending.length) process.stdout.write(`PENDING ${pending.join(",")}\n`);
process.exitCode = failed === 0 ? 0 : 1;
