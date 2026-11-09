import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildArgv, shouldWrap, wrapCommand } from "../.opencode/plugins/sandbox-bash.js";

function tmpWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "abathur-cage-"));
}

test("cage boots on a tree with no v1-only paths", () => {
  const ws = tmpWorkspace();
  const argv = buildArgv({ workspace: ws, cmd: "true", bornAt: "t0", launcherStartedAt: "t1" });
  assert.ok(argv.includes("--bind"));
  assert.ok(argv.includes(ws));
  assert.ok(!argv.some((a) => a.includes("loop/bank.py")), "no hard-coded v1 path");
  assert.ok(!argv.some((a) => a.includes(path.join(ws, "scripts"))), "absent scripts not mounted");
});

test("self-protection mounts appear only when the target exists", () => {
  const ws = tmpWorkspace();
  fs.mkdirSync(path.join(ws, ".opencode", "plugins"), { recursive: true });
  fs.mkdirSync(path.join(ws, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(ws, "kernel"), { recursive: true });
  const argv = buildArgv({ workspace: ws, cmd: "true", bornAt: "t0", launcherStartedAt: "t1" });
  for (const rel of [".opencode", "scripts", "kernel"]) {
    const p = path.join(ws, rel);
    const i = argv.indexOf(p);
    assert.ok(i > 0 && argv[i - 1] === "--ro-bind", `${rel} must be ro-bound`);
  }
});

test("scope check is root-or-below, never a sibling", () => {
  const root = tmpWorkspace();
  const child = path.join(root, "sub");
  fs.mkdirSync(child);
  const outside = tmpWorkspace();
  assert.equal(shouldWrap(root, root), true);
  assert.equal(shouldWrap(child, root), true);
  assert.equal(shouldWrap(outside, root), false);
});

test("command quoting keeps the wrapped argv intact", () => {
  const ws = tmpWorkspace();
  const cmd = wrapCommand({ bwrap: "/usr/bin/bwrap", workspace: ws, cmd: "printf '%s' \"a b\"", net: "none", bornAt: "t0", launcherStartedAt: "t1" });
  assert.ok(cmd.startsWith("/usr/bin/bwrap "));
  assert.ok(cmd.includes("printf"));
});
