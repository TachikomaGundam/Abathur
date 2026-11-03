import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export const VERIFIER_ENV = "ABATHUR_SESSION_VERIFIER";

/**
 * Verify an auditor session through the injected verifier. Unset = fail closed.
 * The verifier receives the session id on stdin and must print JSON
 * {"valid": true, "kind": "engine-session", "session": "..."}.
 * @param {{kind?:string, session?:string}} auditor
 * @param {NodeJS.ProcessEnv} [env]
 */
export function verifyAuditor(auditor, env = process.env) {
  if (!auditor || auditor.kind !== "engine-session") {
    return { rc: 1, code: "AUDITOR-NOT-ENGINE-SESSION", detail: "auditor.kind must be engine-session" };
  }
  const session = typeof auditor.session === "string" ? auditor.session.trim() : "";
  if (!session) return { rc: 1, code: "AUDITOR-NO-SESSION", detail: "auditor.session is required" };
  const cmd = env[VERIFIER_ENV];
  if (!cmd || !cmd.trim()) {
    return { rc: 2, code: "SESSION VERIFIER UNDISPATCHABLE", detail: `${VERIFIER_ENV} is not set` };
  }
  const result = spawnSync("/bin/sh", ["-c", cmd], {
    input: `${session}\n`,
    encoding: "utf8",
    env,
    timeout: 30_000,
  });
  if (result.status !== 0) {
    return { rc: result.status ?? 1, code: "VERIFIER-FAILED", detail: (result.stderr || "").trim() };
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { rc: 1, code: "VERIFIER-BAD-OUTPUT", detail: "verifier did not print JSON" };
  }
  if (parsed.valid !== true || parsed.session !== session || parsed.kind !== "engine-session") {
    return { rc: 1, code: "AUDITOR-REJECTED", detail: JSON.stringify(parsed) };
  }
  return { rc: 0, code: "AUDITOR-OK", session };
}

/**
 * @param {any} entry
 * @param {{kind?:string, session?:string}} auditor
 * @param {{forbiddenSessions?:string[], env?:NodeJS.ProcessEnv}} [options]
 */
export function registerDefect(entry, auditor, options = {}) {
  const verified = verifyAuditor(auditor, options.env ?? process.env);
  if (verified.rc !== 0) return verified;
  const forbidden = new Set(options.forbiddenSessions ?? []);
  if (forbidden.has(auditor.session)) {
    return { rc: 1, code: "SELF-ATTESTATION", detail: "auditor session belongs to the judged generation" };
  }
  if (!entry || typeof entry !== "object") return { rc: 1, code: "BAD-ENTRY", detail: "entry is required" };
  const required = ["kind", "class", "bundle_sha256", "fixed_bundle_sha256", "evidence"];
  const missing = required.filter((key) => !entry[key]);
  if (missing.length) return { rc: 1, code: "BAD-ENTRY", detail: `missing ${missing.join(",")}` };
  if (!/^[0-9a-f]{64}$/.test(entry.bundle_sha256) || !/^[0-9a-f]{64}$/.test(entry.fixed_bundle_sha256)) {
    return { rc: 1, code: "BAD-ENTRY", detail: "bundle digests must be 64-hex" };
  }
  if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) {
    return { rc: 1, code: "BAD-ENTRY", detail: "evidence pointers are required" };
  }
  for (const pointer of entry.evidence) {
    if (typeof pointer?.path !== "string" || !existsSync(pointer.path)) {
      return { rc: 1, code: "BAD-EVIDENCE", detail: `evidence missing: ${String(pointer?.path)}` };
    }
    if (typeof pointer.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(pointer.sha256)) {
      return { rc: 1, code: "BAD-EVIDENCE", detail: "evidence sha256 required" };
    }
  }
  return { rc: 0, code: "DEFECT-ACCEPTED" };
}

/**
 * Two rejections on the same page escalate to the human. Never a silent third round.
 * @param {Array<{verdict?:string}>} history
 */
export function roundStop(history) {
  const rejections = (history ?? []).filter((row) => row?.verdict === "REJECT").length;
  if (rejections >= 2) {
    return { action: "ESCALATE", code: "ESCALATE", rejections };
  }
  return { action: "CONTINUE", code: "CONTINUE", rejections };
}
