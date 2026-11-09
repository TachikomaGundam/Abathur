import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runTarget } from "../kernel/exec/runner.mjs";
import { buildSeccompFilter, blockedSyscalls } from "../kernel/exec/seccomp.mjs";

// The integration tests need a host where bwrap can create namespaces. Inside
// the Abathur bash cage nested bwrap is denied. They are opt-in so CI without
// bwrap does not report a false failure.
const integration = process.env.R1_INTEGRATION === "1";

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r1-test-"));
  fs.writeFileSync(path.join(dir, "allowed.txt"), "allowed\n");
  fs.writeFileSync(path.join(dir, "secret.txt"), "secret\n");
  return dir;
}

function request(code, input, overrides = {}) {
  return {
    argv: ["/usr/bin/python3", "-c", code],
    cwd: "/run/warden/artifacts",
    class: "tests",
    input,
    allow: ["allowed.txt"],
    timeoutMs: 5000,
    artifactCapBytes: 1024 * 1024,
    ...overrides,
  };
}

function options(dir) {
  return { stateDir: path.join(dir, "state"), bwrap: "/usr/bin/bwrap" };
}

test("seccomp filter blocks the same-uid control syscalls", () => {
  const filter = buildSeccompFilter("x64");
  assert.equal(filter.length % 8, 0);
  assert.ok(filter.length > 64);
  assert.deepEqual(blockedSyscalls(), ["ptrace", "process_vm_readv", "process_vm_writev", "kcmp", "pidfd_getfd"]);
});

test("target runs and returns artifacts over the dedicated stream", { skip: !integration }, async () => {
  const dir = workspace();
  const result = await runTarget(request(
    "import os; print('hello'); open('/run/warden/artifacts/out.txt','w').write('ok')",
    dir,
  ), options(dir));
  assert.equal(result.ok, true);
  assert.equal(result.stdout, "hello\n");
  assert.deepEqual(result.artifacts.map((item) => item.path), ["out.txt"]);
  assert.equal(result.artifacts[0].data.toString(), "ok");
});

test("target cannot read the original input path", { skip: !integration }, async () => {
  const dir = workspace();
  const code = `import os\ntry:\n open(${JSON.stringify(path.join(dir, "secret.txt"))}).read()\n print("ESCAPED")\nexcept OSError:\n print("BLOCKED")\n`;
  const result = await runTarget(request(code, dir), options(dir));
  assert.equal(result.stdout, "BLOCKED\n");
});

test("only allowlisted input files reach the jail", { skip: !integration }, async () => {
  const dir = workspace();
  const code = [
    "import os",
    "print('ALLOWED' if os.path.exists('/run/warden/input/allowed.txt') else 'MISSING')",
    "print('SECRET' if os.path.exists('/run/warden/input/secret.txt') else 'NO-SECRET')",
  ].join("\n");
  const result = await runTarget(request(code, dir), options(dir));
  assert.equal(result.stdout, "ALLOWED\nNO-SECRET\n");
});

test("docker socket is absent", { skip: !integration }, async () => {
  const dir = workspace();
  const code = "import os; print('ABSENT' if not os.path.exists('/var/run/docker.sock') else 'PRESENT')";
  const result = await runTarget(request(code, dir), options(dir));
  assert.equal(result.stdout, "ABSENT\n");
});

test("sudo cannot acquire host privilege", { skip: !integration }, async () => {
  const dir = workspace();
  const code = [
    "import subprocess",
    "try:",
    " r = subprocess.run(['sudo', '-n', 'true'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)",
    " print('BLOCKED' if r.returncode != 0 else 'ALLOWED')",
    "except FileNotFoundError:",
    " print('BLOCKED')",
  ].join("\n");
  const result = await runTarget(request(code, dir), options(dir));
  assert.equal(result.stdout, "BLOCKED\n");
});

test("target write to /home does not reach the host home", { skip: !integration }, async () => {
  const dir = workspace();
  const marker = path.join(os.homedir(), `r1-escape-${process.pid}`);
  try { fs.rmSync(marker, { force: true }); } catch { /* absent */ }
  const code = `import os\nos.makedirs(${JSON.stringify(os.homedir())}, exist_ok=True)\nopen(${JSON.stringify(marker)}, 'w').write('escaped')\n`;
  const result = await runTarget(request(code, dir), options(dir));
  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(marker), false);
});

test("artifact symlink is refused", { skip: !integration }, async () => {
  const dir = workspace();
  const code = "import os; os.symlink('/etc/passwd', '/run/warden/artifacts/link')";
  await assert.rejects(
    runTarget(request(code, dir), options(dir)),
    (error) => error.code === "R1-ARTIFACT-REFUSED",
  );
});

test("ptrace is blocked by seccomp", { skip: !integration }, async () => {
  const dir = workspace();
  const code = [
    "import ctypes, os",
    "libc = ctypes.CDLL(None, use_errno=True)",
    "r = libc.ptrace(0, 0, 0, 0)",
    "print('EPERM' if r == -1 and ctypes.get_errno() == 1 else 'ALLOWED')",
  ].join("\n");
  const result = await runTarget(request(code, dir), options(dir));
  assert.equal(result.stdout, "EPERM\n");
});

test("network is absent by default", { skip: !integration }, async () => {
  const dir = workspace();
  const code = [
    "import socket",
    "s = socket.socket()",
    "try:",
    " s.settimeout(1); s.connect(('1.1.1.1', 80)); print('CONNECTED')",
    "except OSError:",
    " print('BLOCKED')",
  ].join("\n");
  const result = await runTarget(request(code, dir), options(dir));
  assert.equal(result.stdout, "BLOCKED\n");
});

test("timeout is enforced", { skip: !integration }, async () => {
  const dir = workspace();
  const started = Date.now();
  await assert.rejects(
    runTarget(request("import time; time.sleep(5)", dir, { timeoutMs: 300 }), options(dir)),
    (error) => error.code === "R1-TIMEOUT",
  );
  assert.ok(Date.now() - started < 2000, "timeout should not wait for the target");
});

test("target cannot open the probe artifact fd", { skip: !integration }, async () => {
  const dir = workspace();
  const code = [
    "import os",
    "try:",
    " os.open('/proc/1/fd/3', os.O_RDONLY); print('OPENED')",
    "except OSError:",
    " print('BLOCKED')",
  ].join("\n");
  const result = await runTarget(request(code, dir), options(dir));
  assert.equal(result.stdout, "BLOCKED\n");
});
