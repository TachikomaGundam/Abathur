import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ReleaseIdentityInputError,
  assessReleaseIdentity,
} from "../release-state.js";

test("release identity: all observed released sources with one version are aligned", () => {
  const report = assessReleaseIdentity([
    { source: "runtime", kind: "observed", version: "0.2.10", released: true },
    { source: "registry", kind: "observed", version: "0.2.10", released: true },
    { source: "remote-tag", kind: "observed", version: "0.2.10", released: true },
    { source: "remote-main", kind: "observed", version: "0.2.10", released: true },
    { source: "local-head", kind: "observed", version: "0.2.10", released: true },
  ]);

  assert.equal(report.status, "aligned");
  assert.equal(report.basis, "supplied-observations");
  assert.deepEqual(report.versions, {
    runtime: "0.2.10",
    registry: "0.2.10",
    "remote-tag": "0.2.10",
    "remote-main": "0.2.10",
    "local-head": "0.2.10",
  });
});

test("release identity: unavailable evidence is incomplete before any mismatch claim", () => {
  const report = assessReleaseIdentity([
    { source: "runtime", kind: "observed", version: "0.2.8", released: true },
    { source: "registry", kind: "unavailable", reason: "package manager unavailable" },
    { source: "remote-tag", kind: "observed", version: "0.2.9", released: true },
    { source: "remote-main", kind: "observed", version: "0.2.9", released: true },
    { source: "local-head", kind: "observed", version: "0.2.9", released: false },
  ]);

  assert.equal(report.status, "incomplete");
  assert.deepEqual(report.unavailable, ["registry"]);
  assert.deepEqual(report.unreleased, ["local-head"]);
});

test("release identity: observed untagged head is distinct from unavailable evidence", () => {
  const report = assessReleaseIdentity([
    { source: "runtime", kind: "observed", version: "0.2.9", released: true },
    { source: "registry", kind: "observed", version: "0.2.9", released: true },
    { source: "remote-tag", kind: "observed", version: "0.2.9", released: true },
    { source: "remote-main", kind: "observed", version: "0.2.9", released: true },
    { source: "local-head", kind: "observed", version: "0.2.9", released: false },
  ]);

  assert.equal(report.status, "unreleased");
  assert.deepEqual(report.unavailable, []);
  assert.deepEqual(report.unreleased, ["local-head"]);
});

test("release identity: a normal unreleased wave is not a release divergence", () => {
  const report = assessReleaseIdentity([
    { source: "runtime", kind: "observed", version: "0.2.9", released: true },
    { source: "registry", kind: "observed", version: "0.2.9", released: true },
    { source: "remote-tag", kind: "observed", version: "0.2.9", released: true },
    { source: "remote-main", kind: "observed", version: "0.2.10", released: false },
    { source: "local-head", kind: "observed", version: "0.2.10", released: false },
  ]);

  assert.equal(report.status, "unreleased");
  assert.deepEqual(report.unreleased, ["remote-main", "local-head"]);
});

test("release identity: no observations is incomplete with every source missing", () => {
  const report = assessReleaseIdentity([]);

  assert.equal(report.status, "incomplete");
  assert.deepEqual(report.missing, ["runtime", "registry", "remote-tag", "remote-main", "local-head"]);
});

test("release identity: released mismatch wins over an unreleased wave", () => {
  const report = assessReleaseIdentity([
    { source: "runtime", kind: "observed", version: "0.2.8", released: true },
    { source: "registry", kind: "observed", version: "0.2.9", released: true },
    { source: "remote-tag", kind: "observed", version: "0.2.9", released: true },
    { source: "remote-main", kind: "observed", version: "0.2.10", released: false },
    { source: "local-head", kind: "observed", version: "0.2.10", released: false },
  ]);

  assert.equal(report.status, "diverged");
  assert.deepEqual(report.unreleased, ["remote-main", "local-head"]);
});

test("release identity: complete contradictory evidence is diverged with source attribution", () => {
  const report = assessReleaseIdentity([
    { source: "runtime", kind: "observed", version: "0.2.8", released: true },
    { source: "registry", kind: "observed", version: "0.2.9", released: true },
    { source: "remote-tag", kind: "observed", version: "0.2.9", released: true },
    { source: "remote-main", kind: "observed", version: "0.2.9", released: true },
    { source: "local-head", kind: "observed", version: "0.2.9", released: true },
  ]);

  assert.equal(report.status, "diverged");
  assert.deepEqual(report.versions, {
    runtime: "0.2.8",
    registry: "0.2.9",
    "remote-tag": "0.2.9",
    "remote-main": "0.2.9",
    "local-head": "0.2.9",
  });
});

test("release identity: duplicate and malformed observations have named input errors", () => {
  assert.throws(
    () => assessReleaseIdentity([
      { source: "runtime", kind: "observed", version: "0.2.9", released: true },
      { source: "runtime", kind: "observed", version: "0.2.10", released: true },
    ]),
    /duplicate release observation: runtime/,
  );
  assert.throws(
    () => assessReleaseIdentity([{ source: "other", kind: "observed", version: "0.2.9", released: true }]),
    ReleaseIdentityInputError,
  );
});
