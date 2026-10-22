// Engine version reader: single source is the package's own package.json.
// Used by `abathur --version` and by the campaign-lock payload. readFileSync
// (not a JSON import) keeps this working identically from a repo checkout
// (dist/../package.json) and an installed npm package (same relative layout),
// with no tsconfig resolveJsonModule dependency.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

let cached: string | null = null;

export function engineVersion(): string {
  if (cached !== null) return cached;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // dist/version.js (or dist/<dir>/x.js) -> package root is two levels up
    // from src/, one level from dist/. Try both, repo layout first.
    for (const rel of ["../package.json", "../../package.json"]) {
      const p = path.resolve(here, rel);
      const parsed: unknown = JSON.parse(readFileSync(p, "utf8"));
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "version" in parsed &&
        typeof (parsed as { version: unknown }).version === "string" &&
        ((parsed as { name?: unknown }).name === "@tachikomagundam/abathur" ||
          (parsed as { name?: unknown }).name === undefined)
      ) {
        cached = (parsed as { version: string }).version;
        return cached;
      }
    }
  } catch {
    // fall through to unknown
  }
  cached = "unknown";
  return cached;
}
