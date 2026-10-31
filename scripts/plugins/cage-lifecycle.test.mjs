import test from "node:test";
import assert from "node:assert/strict";
import { classifyCage, mustRebuild, VERDICT, toMs } from "./cage-lifecycle.mjs";

const LAUNCH = "2026-10-31T10:00:00Z";

test("cage born before the launcher is discarded", () => {
  const r = classifyCage({ cageBornAt: "2026-10-28T08:00:00Z", launcherStartedAt: LAUNCH });
  assert.equal(r.verdict, VERDICT.DISCARDED);
  assert.equal(mustRebuild(r), true);
});

test("cage born after the launcher is reused", () => {
  const r = classifyCage({ cageBornAt: "2026-10-31T10:00:05Z", launcherStartedAt: LAUNCH });
  assert.equal(r.verdict, VERDICT.FRESH);
  assert.equal(mustRebuild(r), false);
});

test("equal timestamps count as fresh", () => {
  assert.equal(classifyCage({ cageBornAt: LAUNCH, launcherStartedAt: LAUNCH }).verdict, VERDICT.FRESH);
});

test("missing either side is unknown and must rebuild", () => {
  assert.equal(classifyCage({ cageBornAt: LAUNCH }).verdict, VERDICT.UNKNOWN);
  assert.equal(classifyCage({ launcherStartedAt: LAUNCH }).verdict, VERDICT.UNKNOWN);
  assert.equal(classifyCage({}).verdict, VERDICT.UNKNOWN);
  assert.equal(mustRebuild(classifyCage({})), true);
});

test("epoch millis and Date are accepted alongside ISO strings", () => {
  const base = Date.parse(LAUNCH);
  assert.equal(classifyCage({ cageBornAt: base - 1, launcherStartedAt: base }).verdict, VERDICT.DISCARDED);
  assert.equal(classifyCage({ cageBornAt: new Date(base + 1000), launcherStartedAt: new Date(base) }).verdict, VERDICT.FRESH);
});

test("garbage values are unknown, never NaN comparisons", () => {
  assert.equal(toMs("not-a-date"), null);
  assert.equal(toMs("   "), null);
  assert.equal(toMs(NaN), null);
  assert.equal(classifyCage({ cageBornAt: "not-a-date", launcherStartedAt: LAUNCH }).verdict, VERDICT.UNKNOWN);
});

test("mustRebuild refuses a missing result", () => {
  assert.equal(mustRebuild(null), true);
});
