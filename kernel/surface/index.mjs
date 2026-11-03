export const SURFACES = {
  E0: { name: "one-shot discarded", writes: ["/tmp/e0/"], forbids: ["/home/", "/etc/"] },
  E1: { name: "seat worktree", writes: ["/home/lab/workspace/harness/Abathur-v2/"], forbids: [] },
  Q: { name: "release checkout", writes: ["/home/lab/workspace/release/"], forbids: [] },
  E2: { name: "production", writes: [], forbids: ["*"] },
  E3: { name: "remote write", writes: [], forbids: ["*"] },
};

export const HUMAN_GATES = new Set(["promote", "tombstone", "publish"]);

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
  const path = typeof request.path === "string" ? request.path : "";
  if (!path.startsWith("/")) return { rc: 1, code: "BAD-PATH", detail: "absolute path required" };
  const rule = policy[surface];
  if (rule.forbids.includes("*")) return { rc: 1, code: "SURFACE-DENIED", detail: `${surface} is write-forbidden` };
  for (const prefix of rule.forbids) {
    if (path.startsWith(prefix)) return { rc: 1, code: "SURFACE-DENIED", detail: `${path} is forbidden on ${surface}` };
  }
  if (!rule.writes.some((prefix) => path.startsWith(prefix))) {
    return { rc: 1, code: "SURFACE-DENIED", detail: `${path} is outside ${surface}` };
  }
  return { rc: 0, code: "SURFACE-OK", detail: path };
}

/** Human-gate text: absolute command + why a human must hold the key. */
export function humanGatePrescription(op, target) {
  const at = target && target.startsWith("/") ? target : "/home/lab/workspace/harness/Abathur-v2";
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
