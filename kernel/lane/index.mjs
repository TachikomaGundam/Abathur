/**
 * Lane registry and write attribution. When attribution cannot be established the
 * event stays DISPUTED; no seat is named by guesswork.
 *
 * The Abathur lane owns exactly one repository. Resolve it from this module so
 * the registry does not keep a second tree name after the single-repo move.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const DEFAULT_LANES = [
  { lane: "abathur", repo: REPO_ROOT, seat: "abathur" },
];

/**
 * @param {Array<{lane:string,repo:string,seat:string}>} lanes
 * @param {{path:string, actor?:string, ts?:string, identity?:{status?:string}, contentOwner?:string}} event
 */
export function attributeWrite(lanes, event) {
  const pathName = typeof event?.path === "string" ? event.path : "";
  if (!pathName.startsWith("/")) return { status: "DISPUTED", reason: "path is not absolute" };
  const lane = lanes.find((row) => pathName.startsWith(row.repo.endsWith("/") ? row.repo : `${row.repo}/`));
  if (!lane) return { status: "DISPUTED", reason: "path belongs to no registered lane" };
  if (!event.actor || event.identity?.status !== "ATTRIBUTED" || !event.ts) {
    return { status: "DISPUTED", reason: "actor, attributed identity and timestamp are required", lane };
  }
  if (event.contentOwner && event.contentOwner !== event.actor) {
    return { status: "DISPUTED", reason: "content owner and actor disagree", lane };
  }
  return { status: "ATTRIBUTED", lane: lane.lane, seat: lane.seat, path: pathName };
}

/** @param {Array<{lane:string,repo:string}>} lanes @param {string} pathName */
export function foreignWrite(lanes, pathName) {
  const inside = lanes.some((row) => pathName.startsWith(row.repo.endsWith("/") ? row.repo : `${row.repo}/`));
  return inside ? { foreign: false } : { foreign: true, path: pathName, reason: "outside every registered lane repo" };
}
