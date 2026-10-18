import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { test } from "node:test";

import { ExitSignal } from "../exit.js";
import {
  adapterFixture,
  BIN_GOOD,
  BIN_GARBAGE_VERSION,
  BIN_NO_VERSION,
  isExit2,
  manifestPath,
} from "./fixtures-bench-fixture.js";

test("(C1) --version unsupported ⇒ exit 2 before ANY unit executed", async (t) => {
  const f = await adapterFixture(t, BIN_NO_VERSION, {}, {}, "oc-fake-probes");
  await assert.rejects(() => f.adapter.reset(f.sandbox), isExit2);
  assert.ok(!existsSync(manifestPath(f.sandbox)), "manifest must never be written pre-probe");
  const marker = spawnSync("pgrep", ["-f", "oc-fake-probes run"], { encoding: "utf8" });
  assert.equal((marker.stdout ?? "").trim(), "", "a unit ran despite the failed probe");
});

test("(C2) garbage --version output ⇒ exit 2, message names the parse failure", async (t) => {
  const f = await adapterFixture(t, BIN_GARBAGE_VERSION, {}, {}, "oc-fake-probes");
  await assert.rejects(
    () => f.adapter.reset(f.sandbox),
    (cause: unknown) => isExit2(cause) && /banana/.test((cause as ExitSignal).message),
  );
});

test("(C3) minVersion mismatch ⇒ exit 2 quoting observed and required", async (t) => {
  const f = await adapterFixture(t, BIN_GOOD, { minVersion: "9.9.9" }, {}, "oc-fake-probes");
  await assert.rejects(
    () => f.adapter.reset(f.sandbox),
    (cause: unknown) => isExit2(cause) && /1\.2\.3/.test((cause as ExitSignal).message) && /9\.9\.9/.test((cause as ExitSignal).message),
  );
});

test("(D1) missing requires[] binary ⇒ exit 2 naming the prerequisite", async (t) => {
  const f = await adapterFixture(t, BIN_GOOD, {
    requires: [{ cmd: "abathur-no-such-engine", probeExit: 0 }],
  }, {}, "oc-fake-probes");
  await assert.rejects(
    () => f.adapter.reset(f.sandbox),
    (cause: unknown) => isExit2(cause) && /abathur-no-such-engine/.test((cause as ExitSignal).message),
  );
});

test("(D2) requires probeExit mismatch ⇒ exit 2", async (t) => {
  const f = await adapterFixture(t, BIN_GOOD, {
    requires: [{ cmd: "node", args: ["--version"], probeExit: 3 }],
  }, {}, "oc-fake-probes");
  await assert.rejects(() => f.adapter.reset(f.sandbox), isExit2);
});
