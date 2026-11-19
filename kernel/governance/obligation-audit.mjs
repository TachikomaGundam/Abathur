// Obligation-pointer audit (registered 2026-11-19, owner question m00757).
// Invariant: an obligation-bearing work file (handoff, ticket, proposal,
// wound sheet…) exists for future seat generations ONLY if the authoritative
// ledger carries its pointer (basename or full sha256). A file on disk with
// no ledger row is invisible after a session-generation break — proven by the
// 2026-11-05 architecture handoff, which survived only because the owner
// asked about it (ledger seq14).
// This audit sweeps the work tree and reports UNREGISTERED obligations.
// Fail-closed: unreadable work root or empty ledger corpus = CANNOT-ANSWER.
// Zero-dependency stdlib; readers injectable for tests.
import { createHash } from "node:crypto";

export const EXIT = { COVERED: 0, GAPS: 1, "CANNOT-ANSWER": 2 };
const EXTS = new Set([".md", ".json", ".jsonc", ".txt"]);

// workFiles: [{ path, content }] (caller enumerates; keeps fs out of kernel)
// ledgerText: concatenation of all authoritative ledger content.
export function auditObligations({ workFiles, ledgerText }) {
  if (!Array.isArray(workFiles)) return { verdict: "CANNOT-ANSWER", reasons: ["workFiles-not-array"] };
  if (typeof ledgerText !== "string" || ledgerText.trim() === "") {
    return { verdict: "CANNOT-ANSWER", reasons: ["ledger-corpus-empty"] };
  }
  const unregistered = [];
  const registered = [];
  for (const f of workFiles) {
    if (typeof f.path !== "string" || typeof f.content !== "string") continue;
    const dot = f.path.lastIndexOf(".");
    const ext = dot >= 0 ? f.path.slice(dot) : "";
    if (!EXTS.has(ext)) continue;
    const name = f.path.split("/").pop();
    const sha = createHash("sha256").update(f.content).digest("hex");
    // a pointer counts only as full basename or full sha256 (truncated "7797b362…"
    // prose mentions are not pointers)
    if (ledgerText.includes(name) || ledgerText.includes(sha)) {
      registered.push({ path: f.path, sha });
    } else {
      unregistered.push({ path: f.path, sha });
    }
  }
  return {
    verdict: unregistered.length ? "GAPS" : "COVERED",
    checked: registered.length + unregistered.length,
    registered: registered.length,
    unregistered,
    ts: new Date().toISOString(),
  };
}
