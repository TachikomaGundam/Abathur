import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildBwrapArgv,
  stageInput,
  validateRequest,
  R1Error,
  bwrapVersion,
} from "../kernel/exec/policy.mjs";

function base(over = {}) {
  return {
    argv: ["/usr/bin/true"],
    cwd: "/run/warden/artifacts",
    class: "tests",
    timeoutMs: 5_000,
    stateDir: "/tmp/state",
    ...over,
  };
}

test("request validation is argv-only and refuses shells/adversarial classes", () => {
  assert.throws(() => validateRequest({ ...base(), argv: "echo hi" }), /argv must be a non-empty array/);
  assert.throws(() => validateRequest({ ...base(), argv: ["/bin/sh", "-c", "id"] }), /shell entrypoints/);
  assert.throws(() => validateRequest({ ...base(), class: "exam-seat" }), /require R2\/R3/);
  assert.throws(() => validateRequest({ ...base(), cwd: "/tmp" }), /under \/run\/warden/);
  assert.throws(() => validateRequest({ ...base(), cwd: "/run/warden/../etc" }), /must be normalized/);
  assert.throws(() => validateRequest({ ...base(), input: "/tmp/in" }), /closed allowlist/);
  assert.equal(validateRequest(base()).class, "tests");
});

test("environment is reduced to non-secret keys", () => {
  const out = validateRequest(base({ env: { PATH: "/usr/bin", TOKEN: "secret", LANG: "C" } }));
  assert.deepEqual(out.env, { PATH: "/usr/bin", LANG: "C" });
});

test("input staging copies only the allowlist and refuses symlinks", () => {
  const dir = mkdtempSync(join(tmpdir(), "r1-stage-"));
  try {
    mkdirSync(join(dir, "in", "src"), { recursive: true });
    writeFileSync(join(dir, "in", "package.json"), "{}");
    writeFileSync(join(dir, "in", "src", "a.mjs"), "export {};\n");
    writeFileSync(join(dir, "in", "secret.env"), "TOKEN=1\n");
    symlinkSync("/etc/passwd", join(dir, "in", "link"));
    const dest = join(dir, "staged");
    assert.throws(() => stageInput({ input: join(dir, "in"), dest, allow: ["**"] }), /refusing to stage symlink/);
    const result = stageInput({ input: join(dir, "in"), dest, allow: ["src/**", "package.json"] });
    assert.equal(result.files, 2);
    assert.equal(readFileSync(join(dest, "src", "a.mjs"), "utf8"), "export {};\n");
    assert.equal(readFileSync(join(dest, "package.json"), "utf8"), "{}");
    assert.throws(() => readFileSync(join(dest, "secret.env")), /ENOENT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bwrap argv has no original input mount and no uid flag", () => {
  const argv = buildBwrapArgv({
    probePath: "/opt/probe.py",
    inputPath: "/host/staged",
    requestPath: "/host/request.json",
    argv: ["/usr/bin/true"],
  });
  const text = argv.join(" ");
  assert.match(text, /--cap-drop ALL/);
  assert.match(text, /--disable-userns/);
  assert.match(text, /--unshare-cgroup/);
  assert.match(text, /--ro-bind \/opt\/probe.py \/run\/warden\/r1-probe.py/);
  assert.match(text, /--ro-bind \/host\/staged \/run\/warden\/input/);
  assert.doesNotMatch(text, /--uid/);
  assert.doesNotMatch(text, /--bind \/host\/staged \/run\/warden\/input/);
  assert.match(text, /--sync-fd 3/);
  assert.doesNotMatch(text, /--size 64M|--size 512M|--preserve-fds/);
});

test("bwrap version parser is strict enough to reject garbage", () => {
  assert.deepEqual(bwrapVersion("bubblewrap 0.11.1"), { major: 0, minor: 11, patch: 1, text: "bubblewrap 0.11.1" });
  assert.equal(bwrapVersion("not a version"), null);
});

test("R1Error carries a stable code", () => {
  const error = new R1Error("R1-TEST", "detail");
  assert.equal(error.code, "R1-TEST");
  assert.equal(error.message, "detail");
});
