import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const { validateRequest, submit, serveOnce, healthReport } = await import(path.join(REPO, "tools/wave_engine/cellrunner.mjs"));

function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cellrunner-"));
  const repo = path.join(root, "repo");
  const templates = path.join(repo, "templates");
  fs.mkdirSync(templates, { recursive: true });
  fs.writeFileSync(path.join(templates, "t.json"), "{}");
  fs.writeFileSync(path.join(templates, "t.SIG.json"), "{}");
  const extra = path.join(root, "extra");
  fs.mkdirSync(extra, { recursive: true });
  fs.mkdirSync(path.join(repo, "work"));
  return { root, repo, extra, opts: { repoRoot: repo, extraRoot: extra } };
}

function good(s) {
  return {
    id: "t-1",
    target: "shell",
    cmd: "echo hi",
    timeout_s: 60,
    cwd: path.join(s.repo, "work"),
    allowed_roots: [path.join(s.repo, "work"), s.extra],
    template: path.join(s.repo, "templates", "t.json"),
    signatures: path.join(s.repo, "templates", "t.SIG.json"),
  };
}

test("validator accepts a well-formed request", () => {
  const s = scratch();
  const v = validateRequest(good(s), s.opts);
  assert.equal(v.ok, true, v.errors.join("; "));
});

test("validator rejects: escapes, wrong target, bad id, timeout cap, long cmd", () => {
  const s = scratch();
  const cases = [
    [{ allowed_roots: ["/etc"] }, /allowlist/],
    [{ allowed_roots: [path.join(s.repo, "nope-does-not-exist")] }, /allowlist|resolve/],
    [{ target: "opencode" }, /target=shell/],
    [{ id: "BAD ID" }, /id must match/],
    [{ timeout_s: 99999 }, /timeout_s/],
    [{ cmd: "x".repeat(9000) }, /cmd/],
    [{ cwd: s.root }, /cwd/],
    [{ template: "/tmp/t.json" }, /templates/],
  ];
  for (const [patch, re] of cases) {
    const v = validateRequest({ ...good(s), ...patch }, s.opts);
    assert.equal(v.ok, false, `should reject ${JSON.stringify(patch)}`);
    assert.match(v.errors.join("; "), re, `wrong reason for ${JSON.stringify(patch)}: ${v.errors.join("; ")}`);
  }
});

test("submit writes pending; duplicate id refused; queue injected for tests", () => {
  const s = scratch();
  const queue = path.join(s.root, "queue");
  const r1 = submit(good(s), { queue, validateOpts: s.opts });
  assert.equal(r1.ok, true, (r1.errors ?? []).join("; "));
  assert.match(r1.request_sha256, /^[0-9a-f]{64}$/);
  assert.ok(fs.existsSync(path.join(queue, "pending", "t-1.request.json")));
  const r2 = submit(good(s), { queue, validateOpts: s.opts });
  assert.equal(r2.ok, false);
  assert.match(r2.errors.join(), /already used/);
});

test("serveOnce claims, executes via cellwrap, answers with hashed result", () => {
  const s = scratch();
  const queue = path.join(s.root, "queue");
  // Skip the validator here (fake roots); the executor path is what this covers.
  const req = { ...good(s), id: "pipe-1", template: path.join(s.repo, "templates", "t.json") };
  assert.equal(submit(req, { queue, validate: false }).ok, true);
  const processed = serveOnce({ queue });
  assert.deepEqual(processed, ["pipe-1"]);
  const resultPath = path.join(queue, "done", "pipe-1.result.json");
  assert.ok(fs.existsSync(resultPath));
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  // Template is unsigned ({}) so cellwrap must refuse: nonzero rc, hashed output present.
  assert.notEqual(result.rc, 0);
  assert.match(result.request_sha256, /^[0-9a-f]{64}$/);
  assert.match(result.output.sha256, /^[0-9a-f]{64}$/);
  assert.ok(fs.existsSync(result.output.path));
  assert.ok(!fs.existsSync(path.join(queue, "pending", "pipe-1.request.json")));
  assert.ok(fs.existsSync(path.join(queue, "done", "pipe-1.request.json")));
});

test("healthReport explains liveness from heartbeat; status CLI codes it", () => {
  const s = scratch();
  const queue = path.join(s.root, "queue");
  let h = healthReport({ queue });
  assert.equal(h.alive, false);
  assert.equal(h.heartbeat_age_s, null);
  serveOnce({ queue }); // empty tick still heartbeats
  h = healthReport({ queue });
  assert.equal(h.alive, true);
  assert.ok(h.heartbeat_age_s <= 5);
  assert.deepEqual(h.queue, { pending: 0, running: 0, done_files: 0 });
  let rc = 0;
  try {
    execFileSync(process.execPath, [path.join(REPO, "tools/wave_engine/cellrunner.mjs"), "status"], { encoding: "utf8" });
  } catch (error) {
    rc = error.status; // default repo queue has no heartbeat yet -> 3, not a crash
  }
  assert.ok(rc === 0 || rc === 3, `unexpected rc ${rc}`);
});

test("CLI submit on a bad request exits nonzero (spawned like the seat would)", () => {
  const s = scratch();
  const reqFile = path.join(s.root, "req.json");
  fs.writeFileSync(reqFile, JSON.stringify({ ...good(s), target: "opencode" }));
  let rc = 0;
  const out = (() => {
    try {
      return execFileSync(process.execPath, [path.join(REPO, "tools/wave_engine/cellrunner.mjs"), "submit", "--request", reqFile], { encoding: "utf8" });
    } catch (error) {
      rc = error.status;
      return error.stdout ?? "";
    }
  })();
  assert.notEqual(rc, 0);
  assert.match(out, /target=shell/);
});
