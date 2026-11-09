import test from "node:test";
import assert from "node:assert/strict";
import { classifyPath, scan } from "../scripts/scan-workfiles.mjs";

const ROOT = new URL("..", import.meta.url).pathname;

test("work directories are refused", () => {
  assert.equal(classifyPath("handoffs/HANDOFF-1.md"), "work-directory");
  assert.equal(classifyPath("dockets/ticket.md"), "work-directory");
  assert.equal(classifyPath("notes/session.md"), "work-directory");
});

test("handoff-shaped documentation is refused", () => {
  assert.equal(classifyPath("docs/architecture-handoff.md"), "work-file-name");
  assert.equal(classifyPath("docs/SESSION-CLOSE.md"), "work-file-name");
  assert.equal(classifyPath("docs/worklog.md"), "work-file-name");
});

test("product code and product docs are allowed", () => {
  assert.equal(classifyPath("kernel/exec/runner.mjs"), null);
  assert.equal(classifyPath("docs/ARCHITECTURE.md"), null);
  assert.equal(classifyPath("docs/design/strong-isolation-options.md"), null);
});

test("the live tree has no tracked work artifacts", () => {
  const result = scan(ROOT);
  assert.deepEqual(result.violations, []);
  assert.ok(result.files > 0);
});
