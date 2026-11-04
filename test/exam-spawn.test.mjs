import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startLongRun, probeRun, assertRunPath } from "../exam/spawn.mjs";
import { recordLongRun } from "../exam/runner.mjs";
import { tempRoot } from "../kernel/surface/containment.mjs";

test("a long-run state path outside the run roots is refused", () => {
  assert.throws(() => assertRunPath("/etc/passwd", "statePath"), /outside the run roots/);
  assert.throws(
    () => startLongRun({ name: "x", command: [process.execPath, "-e", "0"], statePath: "/etc/x.json", logPath: "/etc/x.log" }),
    /outside the run roots/,
  );
});

test("recordLongRun applies the same boundary", () => {
  assert.throws(() => recordLongRun(join(tmpdir(), "outside.json"), { status: "x" }), /outside the run roots/);
});

test("a long run inside the temp root records its exit", async () => {
  mkdirSync(tempRoot(), { recursive: true });
  const dir = mkdtempSync(join(tempRoot(), "run-"));
  try {
    const statePath = join(dir, "state.json");
    startLongRun({
      name: "immediate-exit",
      command: [process.execPath, "-e", "process.exit(0)"],
      statePath,
      logPath: join(dir, "log.txt"),
    });
    let state = probeRun(statePath, readFileSync);
    for (let i = 0; i < 40 && state.status !== "exited"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      state = probeRun(statePath, readFileSync);
    }
    assert.equal(state.status, "exited", JSON.stringify(state));
    assert.equal(state.code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
