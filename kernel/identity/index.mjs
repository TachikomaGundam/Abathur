import { readFileSync } from "node:fs";

export const DEFAULT_IDENTITIES = new URL("../../config/identities.json", import.meta.url);

/**
 * @param {string|URL} [path]
 * @returns {Array<{name:string,email:string}>}
 */
export function loadIdentities(path = DEFAULT_IDENTITIES) {
  const rows = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(rows)) throw new TypeError("identity registry must be an array");
  return rows;
}

/**
 * Byte-exact dual-key match. No trimming of the identity values, no case folding.
 * @param {{name?:string,email?:string}} commit
 * @param {Array<{name:string,email:string}>} identities
 */
export function checkCommitIdentity(commit, identities) {
  const name = typeof commit?.name === "string" ? commit.name : "";
  const email = typeof commit?.email === "string" ? commit.email : "";
  if (!name || !email) return { status: "UNATTRIBUTED", reason: "missing name or email" };
  const match = identities.find((row) => row.name === name && row.email === email);
  if (!match) return { status: "UNATTRIBUTED", reason: `no registered identity for ${name} <${email}>` };
  return { status: "ATTRIBUTED", identity: match };
}
