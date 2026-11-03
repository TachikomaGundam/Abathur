import { existsSync } from "node:fs";

export const VERDICTS = ["PASS", "FAIL"];
export const ITEM_STATUSES = ["PASS", "FAIL", "ERROR", "MISSING"];

/**
 * Closed verdict schema. Returns named problems; empty array means valid.
 * @param {any} verdict
 */
export function verdictProblems(verdict) {
  const problems = [];
  if (!verdict || typeof verdict !== "object") return ["verdict is not an object"];
  if (!VERDICTS.includes(verdict.verdict)) problems.push(`illegal verdict: ${String(verdict.verdict)}`);
  if (typeof verdict.canary_kill !== "boolean") problems.push("canary_kill must be boolean");
  if (typeof verdict.answer_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(verdict.answer_sha256)) {
    problems.push("answer_sha256 must be a 64-hex digest");
  }
  if (typeof verdict.judge_session !== "string" || verdict.judge_session.trim() === "") {
    problems.push("judge_session is required");
  }
  if (!Array.isArray(verdict.items) || verdict.items.length === 0) {
    problems.push("items must be a non-empty array");
  } else {
    for (const [index, item] of verdict.items.entries()) {
      const at = `items[${index}]`;
      if (!item || typeof item !== "object") {
        problems.push(`${at}: not an object`);
        continue;
      }
      if (typeof item.id !== "string" || item.id.trim() === "") problems.push(`${at}: missing id`);
      if (!ITEM_STATUSES.includes(item.status)) problems.push(`${at}: illegal status ${String(item.status)}`);
      if (typeof item.reason !== "string" || item.reason.trim().length < 3) problems.push(`${at}: reason too short`);
    }
  }
  if (!Array.isArray(verdict.evidence) || verdict.evidence.length === 0) {
    problems.push("evidence must be a non-empty array");
  } else {
    for (const [index, path] of verdict.evidence.entries()) {
      if (typeof path !== "string" || !path.startsWith("/")) {
        problems.push(`evidence[${index}]: not an absolute path`);
      } else if (!existsSync(path)) {
        problems.push(`evidence[${index}]: path does not exist`);
      }
    }
  }
  return problems;
}

/** Aggregate item verdicts; FAIL wins over PASS. */
export function aggregate(verdict) {
  const items = Array.isArray(verdict?.items) ? verdict.items : [];
  if (items.some((item) => item.status === "FAIL" || item.status === "ERROR" || item.status === "MISSING")) {
    return "FAIL";
  }
  return items.length > 0 && items.every((item) => item.status === "PASS") ? "PASS" : "FAIL";
}
