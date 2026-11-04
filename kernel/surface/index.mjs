import { checkInside, inside, IN_REPO, tempRoot as TEMP_ROOT } from "./containment.mjs";

/** E1 means "this repository" — the directory the CLI was started in. */
export const REPO_ROOT = process.cwd();

export const SURFACES = {
  E0: { name: "one-shot discarded", writes: [TEMP_ROOT()], forbids: ["/home/", "/etc/"] },
  E1: { name: "seat worktree", writes: [REPO_ROOT], forbids: [] },
  Q: { name: "release checkout", writes: ["/home/lab/workspace/release/"], forbids: [] },
  E2: { name: "production", writes: [], forbids: ["*"] },
  E3: { name: "remote write", writes: [], forbids: ["*"] },
};

export const HUMAN_GATES = new Set(["promote", "tombstone", "publish"]);

export {
  stateDir,
  tempRoot,
  evidenceRoots,
  ensureDir,
  canonical,
  inside,
  checkInside,
  deny,
  isSymlink,
} from "./containment.mjs";
export { createRunRecord, readRunRecord, pruneRuns, reconcileRuns, runsDir } from "./record.mjs";

import { REPO_ROOT as CONTAINMENT_ROOT } from "./containment.mjs";
import { readRunRecord } from "./record.mjs";

/**
 * Resolve the effective surface. A launcher-issued record wins; no record
 * means the human/direct path, which is E1 rooted at the repository.
 */
export function resolveRun(env = process.env) {
  if (!env.ABATHUR_RUN_RECORD) {
    if (!IN_REPO) {
      return {
        ok: false,
        code: "E1-NO-REPO",
        detail: "not inside a git repository; E1 is not established (refusing to treat the home directory as a worktree)",
      };
    }
    return { ok: true, record: { surface: "E1", root: CONTAINMENT_ROOT, origin: "direct" } };
  }
  return readRunRecord(env.ABATHUR_RUN_RECORD, env);
}

/**
 * @param {{op:string, path?:string, surface?:string}} request
 * @param {typeof SURFACES} [policy]
 */
export function assertSurface(request, policy = SURFACES) {
  const surface = request?.surface;
  const op = request?.op;
  if (!op || !surface || !policy[surface]) {
    return { rc: 1, code: "UNCONFIGURED", detail: "op and surface are required" };
  }
  if (HUMAN_GATES.has(op)) {
    return { rc: 1, code: "HUMAN-GATE", detail: humanGatePrescription(op, request?.path ?? "") };
  }
  if (surface === "E2" || surface === "E3") {
    return { rc: 1, code: "HUMAN-GATE", detail: `${surface} writes require the owner` };
  }
  if (surface === "E1" && !IN_REPO) {
    return { rc: 1, code: "E1-NO-REPO", detail: "not inside a git repository; E1 is not established" };
  }
  const path = typeof request.path === "string" ? request.path : "";
  if (!path.startsWith("/")) return { rc: 1, code: "BAD-PATH", detail: "absolute path required" };
  const rule = policy[surface];
  if (rule.forbids.includes("*")) return { rc: 1, code: "SURFACE-DENIED", detail: `${surface} is write-forbidden` };
  for (const prefix of rule.forbids) {
    if (inside(prefix, path)) return { rc: 1, code: "SURFACE-DENIED", detail: `${path} is forbidden on ${surface}` };
  }
  if (!checkInside(path, rule.writes).ok) {
    return { rc: 1, code: "SURFACE-DENIED", detail: `${path} is outside ${surface}` };
  }
  return { rc: 0, code: "SURFACE-OK", detail: path };
}

/** Human-gate text: absolute command + why a human must hold the key. */
export function humanGatePrescription(op, target) {
  const at = target && target.startsWith("/") ? target : REPO_ROOT;
  if (op === "promote") {
    return `HUMAN-GATE promote: run \`node ${at}/cli/abathur-v2.mjs promote --id <id>\` in a terminal; the owner holds the approval key.`;
  }
  if (op === "tombstone") {
    return `HUMAN-GATE tombstone: run \`node ${at}/cli/abathur-v2.mjs tombstone --id <id>\` in a terminal; retirement is an owner decision.`;
  }
  if (op === "publish") {
    return `HUMAN-GATE publish: run \`cd ${at} && npm publish --dry-run\` first, then publish in a terminal; publishing is an owner decision.`;
  }
  return `HUMAN-GATE ${op}: owner action required.`;
}
