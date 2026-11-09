import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerDefect, roundStop, verifyAuditor } from "../kernel/judge/defects.mjs";

const dir = mkdtempSync(join(tmpdir(), "ab2-defects-"));
const evidence = join(dir, "proof.log");
writeFileSync(evidence, "proof\n");
const sha = createHash("sha256").update("proof\n").digest("hex");
const verifier = join(dir, "verifier.cjs");
writeFileSync(
  verifier,
  'const s=require("fs").readFileSync(0,"utf8").trim();process.stdout.write(JSON.stringify({valid:true,kind:"engine-session",session:s}));\n',
);
const env = { ABATHUR_SESSION_VERIFIER: `node ${verifier}` };

const entry = {
  kind: "item",
  class: "rubric-contradicts-fixture",
  bundle_sha256: "b".repeat(64),
  fixed_bundle_sha256: "c".repeat(64),
  evidence: [{ path: evidence, sha256: sha }],
};

test("an unconfigured verifier fails closed", () => {
  const result = verifyAuditor({ kind: "engine-session", session: "ses_x" }, {});
  assert.equal(result.rc, 2);
  assert.equal(result.code, "SESSION VERIFIER UNDISPATCHABLE");
});

test("a non-engine-session auditor is rejected before any command", () => {
  const result = verifyAuditor({ kind: "seat", session: "ses_x" }, env);
  assert.equal(result.rc, 1);
  assert.equal(result.code, "AUDITOR-NOT-ENGINE-SESSION");
});

test("a verified auditor can register a defect", () => {
  const result = registerDefect(entry, { kind: "engine-session", session: "ses_auditor" }, { env });
  assert.equal(result.rc, 0);
  assert.equal(result.code, "DEFECT-ACCEPTED");
});

test("the judged generation cannot attest its own fix", () => {
  const result = registerDefect(entry, { kind: "engine-session", session: "ses_self" }, { env, forbiddenSessions: ["ses_self"] });
  assert.equal(result.rc, 1);
  assert.equal(result.code, "SELF-ATTESTATION");
});

test("two rejections escalate, one continues", () => {
  assert.equal(roundStop([{ verdict: "REJECT" }]).action, "CONTINUE");
  const escalated = roundStop([{ verdict: "REJECT" }, { verdict: "APPROVE" }, { verdict: "REJECT" }]);
  assert.equal(escalated.action, "ESCALATE");
  assert.equal(escalated.rejections, 2);
});
