import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { auditObligations } from "../kernel/governance/obligation-audit.mjs";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const handoff = { path: "/w/line/handoffs/architecture-handoff.md", content: "A" };
const ticket = { path: "/w/line/2026-11-16-ticket.md", content: "B" };
const orphan = { path: "/w/line/2026-11-19-ruling-package.md", content: "C" };

test("basename pointer counts as registered", () => {
  const r = auditObligations({
    workFiles: [handoff, ticket, orphan],
    ledgerText: `{"body":"registered architecture-handoff.md here; 2026-11-16-ticket.md too"}`,
  });
  assert.equal(r.verdict, "GAPS");
  assert.equal(r.checked, 3);
  assert.equal(r.registered, 2);
  assert.equal(r.unregistered.length, 1);
  assert.equal(r.unregistered[0].path, orphan.path);
  assert.equal(r.unregistered[0].sha, sha("C"));
});

test("full sha256 pointer counts even without the basename", () => {
  const r = auditObligations({
    workFiles: [orphan],
    ledgerText: `pointer by hash ${sha("C")} only`,
  });
  assert.equal(r.verdict, "COVERED");
});

test("truncated prose hash (7797b362…) is NOT a pointer", () => {
  const r = auditObligations({
    workFiles: [{ path: "/w/x.md", content: "prefix-starts-7797b362" }],
    ledgerText: "draft sha 7797b362… pending",
  });
  assert.equal(r.verdict, "GAPS");
});

test("non-registered extensions ignored; ledger absence fail-closes", () => {
  const r = auditObligations({ workFiles: [{ path: "/w/img.png", content: "z" }], ledgerText: "x" });
  assert.equal(r.verdict, "COVERED");
  assert.equal(r.checked, 0);
  assert.equal(auditObligations({ workFiles: [], ledgerText: "  " }).verdict, "CANNOT-ANSWER");
  assert.equal(auditObligations({ workFiles: "junk", ledgerText: "x" }).verdict, "CANNOT-ANSWER");
});
