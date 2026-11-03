/**
 * Lane registry and write attribution. When attribution cannot be established the
 * event stays DISPUTED; no seat is named by guesswork.
 */

export const DEFAULT_LANES = [
  { lane: "abathur", repo: "/home/lab/workspace/harness/Abathur", seat: "abathur" },
  { lane: "abathur-v2", repo: "/home/lab/workspace/harness/Abathur-v2", seat: "abathur" },
];

/**
 * @param {Array<{lane:string,repo:string,seat:string}>} lanes
 * @param {{path:string, actor?:string, ts?:string, identity?:{status?:string}, contentOwner?:string}} event
 */
export function attributeWrite(lanes, event) {
  const path = typeof event?.path === "string" ? event.path : "";
  if (!path.startsWith("/")) return { status: "DISPUTED", reason: "path is not absolute" };
  const lane = lanes.find((row) => path.startsWith(row.repo.endsWith("/") ? row.repo : `${row.repo}/`));
  if (!lane) return { status: "DISPUTED", reason: "path belongs to no registered lane" };
  if (!event.actor || event.identity?.status !== "ATTRIBUTED" || !event.ts) {
    return { status: "DISPUTED", reason: "actor, attributed identity and timestamp are required", lane };
  }
  if (event.contentOwner && event.contentOwner !== event.actor) {
    return { status: "DISPUTED", reason: "content owner and actor disagree", lane };
  }
  return { status: "ATTRIBUTED", lane: lane.lane, seat: lane.seat, path };
}

/** @param {Array<{lane:string,repo:string}>} lanes @param {string} path */
export function foreignWrite(lanes, path) {
  const inside = lanes.some((row) => path.startsWith(row.repo.endsWith("/") ? row.repo : `${row.repo}/`));
  return inside ? { foreign: false } : { foreign: true, path, reason: "outside every registered lane repo" };
}
