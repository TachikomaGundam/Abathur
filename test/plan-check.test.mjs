import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const CHECK = resolve(ROOT, "scripts", "plan-check.mjs");

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

function planText({ classes = ["A", "B", "C", "D", "E", "F", "G", "H", "P"], mustNot = true, indentFirst = false, dropField = null } = {}) {
  const lines = ["# fixture", ""];
  for (const heading of HEADINGS) {
    lines.push(heading, "");
    if (heading === "## Scope") {
      lines.push("### Must have", "", "1. one thing", "");
      lines.push("### Must NOT have (guardrails)", "");
      if (mustNot) lines.push("1. **禁止** nothing else", "");
    }
    if (heading === "## Todos") {
      classes.forEach((cls, index) => {
        const prefix = indentFirst && index === 0 ? " " : "";
        lines.push(`${prefix}- [ ] ${index + 1}. fixture task ${cls}`);
        const fields = {
          Class: cls,
          Clause: `${cls}-TEST-01`,
          Wave: "1",
          Depends: "none",
          "What to do / Must NOT do": "do a; must not do b",
          References: "/tmp/ref",
          Acceptance: "true rc=0",
          Evidence: "/tmp/evidence.log",
          QA: "manual qa",
          Commit: "test: fixture",
        };
        for (const [key, value] of Object.entries(fields)) {
          if (key === dropField) continue;
          lines.push(`  - **${key}:** ${value}`);
        }
        lines.push("");
      });
    }
  }
  return `${lines.join("\n")}\n`;
}

function run(text) {
  const dir = mkdtempSync(join(tmpdir(), "plan-check-"));
  const file = join(dir, "plan.md");
  writeFileSync(file, text);
  const result = spawnSync(process.execPath, [CHECK, file], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return result;
}

test("accepts a well-formed plan with all nine classes", () => {
  const result = run(planText());
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PLAN-CHECK OK n=9 classes=ABCDEFGHP rc=0/);
});

test("rejects an indented todo", () => {
  const result = run(planText({ indentFirst: true }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /indented todo line/);
});

test("rejects a missing required field", () => {
  const result = run(planText({ dropField: "QA" }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /missing QA/);
});

test("rejects an empty Must NOT have section", () => {
  const result = run(planText({ mustNot: false }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Must NOT have/);
});

test("rejects an unknown class", () => {
  const result = run(planText({ classes: ["A", "B", "C", "D", "E", "F", "G", "H", "Z"] }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /bad class Z/);
});
