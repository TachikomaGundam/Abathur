// Review-council launch preflight gate (W-F; owner critique 2026-11-19: the
// same error repeated — the council was launched to research/decide what
// probing and engineering should settle, and its verdicts were laundered as
// authority). Per P-REVIEW-PORT-01 the review mechanism is abstract and the
// local adapter is operator-injected; this gate names no product. Invariants:
//   INV-1 mechanically answerable questions never reach the council —
//         probe receipts must exist on disk and hash-verify (not be claimed);
//   INV-2 the convener must not belong to the chain that authored the
//         artifact; when it does the verdict can only be DATA (NOT-INDEPENDENT;
//         precedent: 2026-11-05 handoff review rounds, all three NOT-INDEPENDENT);
//   INV-3 missing ticket fields, malformed receipts, unknown purposes →
//         fail-closed REFUSE. Never default-open.
// This gate judges the launch ticket; it cannot police a council launched
// without it (that enforcement gap is named in the ledger, wound W-F).
import { createHash } from "node:crypto";

export const PURPOSES = ["audit", "adjudicate", "draft"];
export const EXIT = { PASS: 0, REFUSE: 1, "NOT-INDEPENDENT": 2 };

const SHA_RE = /^[0-9a-f]{64}$/;
const MSGREF_RE = /^m\d+$/;

// ticket: object or JSON string. io: { read?: (path) => string|Buffer }
// returns { verdict: "PASS"|"REFUSE"|"NOT-INDEPENDENT", reasons: [], flags: {} }
export function reviewPreflight(ticket, io = {}) {
  const read = typeof io.read === "function" ? io.read : null;
  const refuse = (r) => ({ verdict: "REFUSE", reasons: [r], flags: {} });

  let t = ticket;
  if (typeof t === "string") {
    try { t = JSON.parse(t); } catch { return refuse("ticket-not-json"); }
  }
  if (!t || typeof t !== "object" || Array.isArray(t)) return refuse("ticket-not-object");
  if (t.kind !== "preflight") return refuse("ticket-kind");
  if (t.version !== 1) return refuse("ticket-version");
  if (typeof t.goal !== "string" || t.goal.trim().length === 0) return refuse("goal-empty");
  if (!PURPOSES.includes(t.purpose)) {
    return refuse(`unknown-purpose:${String(t.purpose).slice(0, 32)}`);
  }

  // owner-order reference: null, or a seat-message ref like "m00591"
  const ordered =
    t.orderedBy === null || t.orderedBy === undefined ? null : t.orderedBy;
  if (ordered !== null && (typeof ordered !== "string" || !MSGREF_RE.test(ordered))) {
    return refuse("orderedBy-not-msgref");
  }

  // author vs convener (identity binding discipline: engine session ids only)
  if (typeof t.artifactAuthor !== "string" || t.artifactAuthor.trim() === "") {
    return refuse("artifactAuthor-empty");
  }
  const isSeatArt = t.artifactAuthor.startsWith("seat:");
  const convener =
    typeof t.convenerSession === "string" && t.convenerSession.trim() !== ""
      ? t.convenerSession.trim()
      : null;
  if (convener === null && (typeof t.engineProof !== "string" || t.engineProof.trim() === "")) {
    return refuse("convener-unknown");
  }
  if (isSeatArt && convener !== null && convener === t.artifactAuthor) {
    return refuse("convener-is-author");
  }

  // probe evidence: receipts must exist and hash-verify, or a named waiver
  if (!Array.isArray(t.probeAttempts)) return refuse("probeAttempts-not-array");
  const fail = [];
  for (const [i, p] of t.probeAttempts.entries()) {
    if (!p || typeof p !== "object") { fail.push(`probe[${i}]-not-object`); continue; }
    if (typeof p.question !== "string" || p.question.trim() === "") fail.push(`probe[${i}]-question-empty`);
    if (typeof p.receiptPath !== "string" || !p.receiptPath.startsWith("/")) {
      fail.push(`probe[${i}]-receiptPath-not-absolute`); continue;
    }
    if (typeof p.receiptSha256 !== "string" || !SHA_RE.test(p.receiptSha256)) {
      fail.push(`probe[${i}]-sha-not-64hex`); continue;
    }
    let content = null;
    if (read) { try { content = read(p.receiptPath); } catch { content = null; } }
    if (content === null || content === undefined) {
      fail.push(`probe[${i}]-receipt-unreadable:${p.receiptPath}`); continue;
    }
    const sha = createHash("sha256").update(content).digest("hex");
    if (sha !== t.probeAttempts[i].receiptSha256) fail.push(`probe[${i}]-sha-mismatch`);
  }
  const waiver =
    typeof t.probeWaiver === "string" && t.probeWaiver.trim() !== "" ? t.probeWaiver : null;
  // waiver only excuses the no-probes branch; verified receipts need none.
  // draft/adjudicate with no probes must name WHY the council sees no receipts.
  if (t.probeAttempts.length === 0 && waiver === null) {
    if (t.purpose === "draft" || t.purpose === "adjudicate") {
      return refuse("purpose-probe-waiver-required");
    }
    return refuse("probe-evidence-missing");
  }
  if (fail.length > 0) return { verdict: "REFUSE", reasons: fail, flags: {} };

  const independent = !isSeatArt || (convener !== null && convener !== t.artifactAuthor);
  const flags = { ownerOrdered: ordered !== null, independentChain: independent, mechanical: true };
  if (independent && ordered !== null) {
    return { verdict: "PASS", reasons: ["owner-ordered + independent-chain + probe-evidence-verified"], flags };
  }
  const reasons = [];
  if (!independent) {
    reasons.push(convener === null
      ? "convener-chain-unverifiable: seat-authored artifact convened without engine convener id — verdict is DATA only (NOT-INDEPENDENT)"
      : "convener-chain == artifact-chain — verdict is DATA only (NOT-INDEPENDENT; precedent 2026-11-05 handoff review rounds)");
  }
  if (ordered === null) reasons.push("no owner-order reference (orderedBy null)");
  return { verdict: "NOT-INDEPENDENT", reasons, flags };
}
