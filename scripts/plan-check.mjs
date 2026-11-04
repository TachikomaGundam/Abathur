#!/usr/bin/env node
/**
 * Structural plan validator. It judges shape, not correctness: headings, todo
 * fields, class coverage, wave graph, and placeholder presence.
 */
import { readFileSync } from "node:fs";

const HEADINGS = [
  "## TL;DR (For humans)",
  "## Scope",
  "## Verification strategy",
  "## Execution strategy",
  "## Todos",
  "## Final verification wave",
  "## Commit strategy",
  "## Success criteria",
];
const CLASSES = new Set(["A", "B", "C", "D", "E", "F", "G", "H", "P"]);
const FIELDS = [
  "Class",
  "Clause",
  "Wave",
  "Depends",
  "What to do / Must NOT do",
  "References",
  "Acceptance",
  "Evidence",
  "QA",
  "Commit",
];
const PLACEHOLDER = /<fill|<\.\.\.>|<[A-Za-z]+\.\.\.>|\bTBD\b|\bTODO\b|待定|占位/;

function fail(problems) {
  for (const problem of problems) process.stdout.write(`PLAN-CHECK FAIL: ${problem}\n`);
  process.stdout.write(`PLAN-CHECK FAIL n=${problems.length} rc=1\n`);
  process.exitCode = 1;
}

function main() {
  const file = process.argv[2];
  if (!file) {
    process.stdout.write("usage: plan-check.mjs <plan.md>\nPLAN-CHECK FAIL usage rc=2\n");
    process.exitCode = 2;
    return;
  }
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    process.stdout.write(`PLAN-CHECK FAIL cannot read ${file}: ${error.message} rc=2\n`);
    process.exitCode = 2;
    return;
  }
  const problems = [];
  let cursor = -1;
  for (const heading of HEADINGS) {
    const at = text.indexOf(heading);
    if (at < 0) problems.push(`missing heading ${heading}`);
    if (at >= 0 && at < cursor) problems.push(`heading out of order ${heading}`);
    if (at >= 0) cursor = at;
  }
  for (const match of text.matchAll(/^[ \t]+- \[[ xX]\]\s+\d+\./gm)) {
    problems.push(`indented todo line: ${match[0].trim()}`);
  }
  const scope = text.slice(text.indexOf("## Scope"), text.indexOf("## Verification strategy"));
  const mustNot = scope.slice(scope.indexOf("### Must NOT have"));
  const mustBullets = mustNot.split("\n").filter((line) => /^\s*(?:[-*]|\d+\.)\s+\S/.test(line) && !/^\s*(?:[-*]|\d+\.)\s+(无|none|N\/A)\s*$/i.test(line));
  if (mustBullets.length === 0) problems.push("Scope has no non-empty Must NOT have bullet");

  const lines = text.split("\n");
  const todos = [];
  let current = null;
  for (const line of lines) {
    const head = line.match(/^- \[[ xX]\] (\d+)\.\s+(\S.*)$/);
    if (head) {
      current = { id: Number(head[1]), title: head[2], fields: {} };
      todos.push(current);
      continue;
    }
    if (!current) continue;
    const field = line.match(/^\s*-\s+(?:\*\*)?([A-Za-z][A-Za-z0-9 /]*?)(?:\*\*)?:\s*(?:\*\*)?\s*(.+)$/);
    if (field) {
      const name = field[1].trim();
      const canonical = FIELDS.find((item) => item.toLowerCase() === name.toLowerCase());
      if (canonical) current.fields[canonical] = field[2].trim();
    }
  }
  if (todos.length === 0) problems.push("no top-level todo lines");
  const ids = new Set(todos.map((todo) => todo.id));
  const waves = new Set();
  const covered = new Set();
  for (const todo of todos) {
    for (const field of FIELDS) {
      if (!todo.fields[field]) problems.push(`todo ${todo.id} missing ${field}`);
    }
    if (todo.fields.Class) {
      for (const value of todo.fields.Class.split("/").map((part) => part.trim())) {
        if (!CLASSES.has(value)) problems.push(`todo ${todo.id} bad class ${value}`);
        else covered.add(value);
      }
    }
    if (todo.fields.Wave && /^\d+$/.test(todo.fields.Wave)) waves.add(Number(todo.fields.Wave));
    else if (todo.fields.Wave) problems.push(`todo ${todo.id} wave is not a number`);
    if (todo.fields.Depends && todo.fields.Depends !== "none") {
      for (const dep of todo.fields.Depends.split(",").map((part) => Number(part.trim())).filter(Boolean)) {
        if (dep === todo.id) problems.push(`todo ${todo.id} depends on itself`);
        else if (!ids.has(dep)) problems.push(`todo ${todo.id} depends on missing ${dep}`);
      }
    }
    if (todo.fields.Acceptance && !/rc=\d+|exit=\d+/i.test(todo.fields.Acceptance)) problems.push(`todo ${todo.id} acceptance has no rc`);
    if (todo.fields.Evidence && !todo.fields.Evidence.includes("/")) problems.push(`todo ${todo.id} evidence has no path`);
    if (PLACEHOLDER.test(JSON.stringify(todo.fields))) problems.push(`todo ${todo.id} contains a placeholder`);
  }
  if (waves.size) {
    const max = Math.max(...waves);
    for (let wave = 1; wave <= max; wave += 1) {
      if (!waves.has(wave)) problems.push(`wave ${wave} is missing`);
    }
  }
  for (const value of CLASSES) {
    if (!covered.has(value)) problems.push(`class ${value} is not covered`);
  }
  if (problems.length) return fail(problems);
  process.stdout.write(`PLAN-CHECK OK n=${todos.length} classes=${[...covered].sort().join("")} rc=0\n`);
}

main();
