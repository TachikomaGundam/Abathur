import { spawnSync } from "node:child_process";

export const REVIEW_ENV = "ABATHUR_REVIEW_CMD";
const REQUIRED = ["verdict", "independence", "run", "artifact_sha256"];
const VERDICTS = new Set(["APPROVE", "REJECT"]);
const INDEPENDENCE = new Set(["INDEPENDENT", "NOT-INDEPENDENT"]);

export function runReview({ artifact, goal, env = process.env, timeoutMs = 120000 } = {}) {
  if (!artifact || !goal) {
    return { rc: 2, code: "REVIEW UNDISPATCHABLE", error: "artifact and goal are required" };
  }
  const cmd = env[REVIEW_ENV];
  if (!cmd) {
    return { rc: 2, code: "REVIEW UNDISPATCHABLE", error: `${REVIEW_ENV} is not set` };
  }
  const result = spawnSync(cmd, [artifact, goal], { encoding: "utf8", timeout: timeoutMs });
  if (result.error) {
    return { rc: 2, code: "REVIEW UNDISPATCHABLE", error: result.error.message };
  }
  if (result.status !== 0) {
    return { rc: 2, code: "REVIEW FAILED", error: `adapter rc=${result.status}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { rc: 2, code: "REVIEW MALFORMED", error: "adapter stdout is not JSON" };
  }
  const missing = REQUIRED.filter((field) => typeof parsed[field] !== "string" || parsed[field].length === 0);
  if (missing.length) {
    return { rc: 2, code: "REVIEW MALFORMED", missing };
  }
  if (!VERDICTS.has(parsed.verdict)) {
    return { rc: 2, code: "REVIEW MALFORMED", error: `unknown verdict ${parsed.verdict}` };
  }
  if (!INDEPENDENCE.has(parsed.independence)) {
    return { rc: 2, code: "REVIEW MALFORMED", error: `unknown independence ${parsed.independence}` };
  }
  if (!/^[0-9a-f]{64}$/.test(parsed.artifact_sha256)) {
    return { rc: 2, code: "REVIEW MALFORMED", error: "artifact_sha256 must be 64 lowercase hex" };
  }
  return { rc: 0, code: "REVIEW OK", ...parsed };
}
