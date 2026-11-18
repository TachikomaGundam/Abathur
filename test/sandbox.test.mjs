import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pluginDefault, { buildArgv, shouldWrap, wrapCommand, detectNestedBwrap, COPY_MARKERS } from "../.opencode/plugins/sandbox-bash.js";

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

// ---- W-C (2026-11-16): the guard must key on EXECUTION position, not text ----
// Differential proof: every ALLOW row is a command the old v5 predicate
// (COPY_MARKERS substring over the whole command) WOULD have rejected.

const WC_ALLOW = [
  "pgrep -af bwrap --die-with-parent --unshare-all",
  `echo "--die-with-parent --unshare-all W-C-CANARY"`,
  "grep -rn -- --unshare-user kernel/",
  `grep "bwrap --" .omo/evidence/gate-blocks.jsonl`,
  `cat x | grep "/usr/bin/bwrap "`,
  `bash -c 'pgrep -f "bwrap --unshare-all"'`,
  `cat > x <<'EOF'\nbwrap --unshare-all true\nEOF`,
  `printf '%s\\n' 'bwrap --die-with-parent'`,
  `sed -n '/bwrap --/p' app.log`,
  `git commit -m "guard: fix bwrap --unshare-user false reject (W-C)"`,
  `awk '/--unshare-user/ {print}' /tmp/x.log`,
  `wc -l <<< 'bwrap --unshare-all'`,
];

const WC_REJECT = [
  ["/usr/bin/bwrap --ro-bind / / true", "T1-WORD"],
  ["bwrap --die-with-parent --unshare-user -- /bin/sh -c ls", "T1-WORD"],
  ["echo x | bwrap --unshare-all true", "T1-WORD"],
  ["cd /tmp && bwrap --ro-bind / / true", "T1-WORD"],
  ["sudo bwrap --unshare-user true", "T1-WORD"],
  ["FOO=1 timeout 5 bwrap --unshare-user true", "T1-WORD"],
  ["timeout --kill-after 10 5 bwrap --ro-bind / / x", "T1-WORD"],
  [`bash -c 'if true; then /usr/bin/bwrap --unshare-user true; fi'`, "T1-WORD"],
  ["echo $(bwrap --unshare-all true)", "T1-WORD"],
  ['eval "bwrap --unshare-user true"', "T1-WORD"],
  ["--die-with-parent --unshare-user /usr/bin/foo", "T2-PREFIX"],
  [`python3 -c "import subprocess; subprocess.run(['bwrap','--unshare-all'])"`, "T6-LANG-INLINE"],
  ["find . -exec bwrap --unshare-user {} \\;", "T1-WORD"],
  [`sh -c "sh -c 'bwrap --ro-bind / / x'"`, "T1-WORD"],
  ["(bwrap --ro-bind / / x)", "T1-WORD"],
  ["x=1; /usr/bin/bwrap --tmpfs /tmp x", "T1-WORD"],
];

test("W-C differential: mention-only commands pass though old predicate rejected them", () => {
  for (const cmd of WC_ALLOW) {
    assert.ok(COPY_MARKERS.some((m) => cmd.includes(m)), `old predicate must have rejected: ${cmd}`);
    assert.equal(detectNestedBwrap(cmd), null, `new classifier must allow: ${cmd}`);
  }
});

test("W-C: real nested bwrap executions still rejected, with tier", () => {
  for (const [cmd, tier] of WC_REJECT) {
    const hit = detectNestedBwrap(cmd);
    assert.ok(hit, `must reject: ${cmd}`);
    assert.equal(hit.tier, tier, `tier for: ${cmd}`);
  }
});

test("W-C fail-closed: truncated/over-deep/nulled inputs never silently allow", () => {
  assert.equal(detectNestedBwrap("echo $(bwrap --ro-bind / / true").tier, "T1-WORD"); // unclosed $( still rejected
  const deep = "echo $(" + "echo $(" .repeat(3) + "bwrap --ro-bind / / x" + ")".repeat(3) + ")";
  assert.equal(detectNestedBwrap(deep).tier, "T7-DEPTH"); // 5th nesting level exceeds maxDepth=4 → fail-closed
  assert.doesNotThrow(() => detectNestedBwrap(null));
});

test("W-C wiring: hook rejects nested launch and wraps mention-only command", async () => {
  delete process.env.ABATHUR_SANDBOX;
  process.env.ABATHUR_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "abathur-wc-"));
  // 证据卫生（W-E U3）：测试心跳/包裹日志必须离开共享 /tmp/opencode/abathur-sandbox.log
  process.env.ABATHUR_SANDBOX_LOG = path.join(process.env.ABATHUR_STATE_DIR, "plugin-test.log");
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const handlers = [];
  await pluginDefault.setup({ shell: { hook: async (evt, fn) => { if (evt === "create.before") handlers.push(fn); } }, location: { directory: repoRoot } });
  assert.ok(handlers.length >= 1, "setup registered create.before handler");
  for (const fn of handlers) {
    const ev = { cwd: repoRoot, command: "bwrap --ro-bind / / true" };
    await assert.rejects(async () => fn(ev), /SANDBOX-PREFIX-COPIED/);
  }
  for (const fn of handlers) {
    const ev = { cwd: repoRoot, command: `echo "--unshare-user W-C canary"` };
    await fn(ev);
    assert.ok(ev.command.startsWith("/usr/bin/bwrap "), "mention-only command must be wrapped, not rejected");
  }
});
