// bwrap probing: identity, capabilities, and a fail-closed feature check.
// This does not run a target; it decides whether the R1 backend is usable.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { R1Error, bwrapVersion } from "./policy.mjs";

export const REQUIRED_FEATURES = [
  "--die-with-parent",
  "--new-session",
  "--as-pid-1",
  "--unshare-user",
  "--unshare-pid",
  "--unshare-ipc",
  "--unshare-uts",
  "--unshare-net",
  "--unshare-cgroup",
  "--disable-userns",
  "--cap-drop",
  "--size",
  "--tmpfs",
  "--ro-bind",
  "--symlink",
  "--dev",
  "--proc",
  "--clearenv",
  "--sync-fd",
  "--seccomp",
];

export function findBwrap(env = process.env) {
  const candidate = env.ABATHUR_BWRAP ?? "/usr/bin/bwrap";
  return candidate;
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Probe the bwrap binary. Fails closed on a missing binary, a version below
 * 0.8, or a missing feature flag. `digest` is the exact binary hash, not a
 * claim about a package version.
 */
export function probeBwrap(path = findBwrap()) {
  if (!existsSync(path)) throw new R1Error("R1-BWRAP-MISSING", `bwrap not found at ${path}`);
  let versionText;
  let helpText;
  try {
    versionText = execFileSync(path, ["--version"], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
    helpText = execFileSync(path, ["--help"], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    throw new R1Error("R1-BWRAP-PROBE", `bwrap probe failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const version = bwrapVersion(versionText);
  if (version === null) throw new R1Error("R1-BWRAP-VERSION", `cannot parse bwrap version: ${versionText.trim()}`);
  if (version.major < 0 || (version.major === 0 && version.minor < 8)) {
    throw new R1Error("R1-BWRAP-VERSION", `bwrap ${version.text} is below the conservative 0.8 floor`);
  }
  const missing = REQUIRED_FEATURES.filter((flag) => !helpText.includes(flag));
  if (missing.length > 0) {
    throw new R1Error("R1-BWRAP-FEATURE", `bwrap lacks required flags: ${missing.join(", ")}`);
  }
  return {
    path,
    version,
    digest: sha256File(path),
    features: [...REQUIRED_FEATURES],
  };
}
