import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const SCRIPT = resolve(new URL("../scripts/copy-gate.mjs", import.meta.url).pathname);

function run(extra) {
  const env = { ...process.env, ...extra };
  if (!extra) delete env.ABATHUR_COPY_GATE_CMD;
  return spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", env });
}

test("an unconfigured copy gate is undispatchable", () => {
  const result = run(null);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /COPY GATE UNDISPATCHABLE/);
});

test("the injected gate's rc is propagated", () => {
  assert.equal(run({ ABATHUR_COPY_GATE_CMD: "exit 0" }).status, 0);
  assert.equal(run({ ABATHUR_COPY_GATE_CMD: "exit 4" }).status, 4);
});

test("the gate never silently passes on a missing command", () => {
  const result = run({ ABATHUR_COPY_GATE_CMD: "definitely-not-a-command-ab2" });
  assert.notEqual(result.status, 0);
});
