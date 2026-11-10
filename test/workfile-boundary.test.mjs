import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyPath, scan, scanHistory,
  parseObjectLines, filterBlobViolations, parsePrepushLines,
} from "../scripts/scan-workfiles.mjs";

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

test("omo workspace is refused", () => {
  assert.equal(classifyPath(".omo/evidence/x.md"), "work-directory");
  assert.equal(classifyPath("src/.omo/boulder.json"), "work-directory");
});



test("history parsing flags work blobs but not tree entries", () => {
  const revList = [
    "aaaa .omo",
    "bbbb .omo/leak.md",
    "cccc README.md",
    "dddd handoffs/HANDOFF-x.md",
  ].join("\n");
  const { objects, candidates } = parseObjectLines(revList);
  assert.equal(objects, 4);
  assert.deepEqual(candidates.map((c) => c.path), [".omo", ".omo/leak.md", "handoffs/HANDOFF-x.md"]);
  const violations = filterBlobViolations(candidates, ["tree", "blob", "blob"]);
  assert.deepEqual(violations.map((v) => v.path), [".omo/leak.md", "handoffs/HANDOFF-x.md"]);
});

test("prepush parsing keeps non-zero pushes and drops deletes", () => {
  const zero = "0".repeat(40);
  const input = [
    `refs/heads/main aaaa refs/heads/main ${zero}`,
    `refs/heads/gone bbbb refs/heads/gone cccc`,
    `refs/tags/v1 dddd refs/tags/v1 ${zero}`,
  ].join("\n");
  const pushes = parsePrepushLines(input);
  assert.equal(pushes.length, 3);
  assert.deepEqual(pushes[0], { localOid: "aaaa", ref: "refs/heads/main", remoteOid: zero });
});

test("this repository's own history passes the history scan", () => {
  const result = scanHistory(ROOT, ["refs/heads/main"]);
  assert.deepEqual(result.violations, []);
  assert.ok(result.objects > 0);
});
