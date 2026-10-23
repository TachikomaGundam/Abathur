// Campaign-entry install integrity probe (ruling sibyl-20261023T095118Z-75ee
// must-fix: the version/path check is embedded fail-closed at the campaign entry
// point, not left as an external optional script). Fires only when the running
// cli.js is itself an installed copy (path under node_modules/@tachikomagundam/
// abathur); development worktree runs skip. When installed, the PATH-resolved
// `abathur` must realpath to the same file — a mismatch means a second install
// shadows this one (the 2026-10-23 sudo-prefix incident class).

import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { blocked } from "../exit.js";

const INSTALLED_MARKER = path.join("node_modules", "@tachikomagundam", "abathur");

export interface ProbeEnv {
  readonly PATH?: string | undefined;
}

function whichSync(bin: string, pathEnv: string | undefined): string | null {
  for (const dir of (pathEnv ?? "").split(path.delimiter)) {
    if (dir.length === 0) continue;
    const candidate = path.join(dir, bin);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function assertCampaignInstallIntegrity(argv1: string, env: ProbeEnv = process.env): void {
  let self: string;
  try {
    self = realpathSync(argv1);
  } catch {
    return; // argv[1] unresolvable — nothing trustworthy to compare; skip
  }
  if (!self.includes(INSTALLED_MARKER)) return; // dev worktree run: not the probe's subject
  const onPath = whichSync("abathur", env.PATH);
  if (onPath === null) return; // invoked by absolute path, nothing on PATH to shadow
  let resolved: string;
  try {
    resolved = realpathSync(onPath);
  } catch {
    return; // dangling shim — dead links cannot execute, not a shadow
  }
  if (resolved !== self) {
    blocked(
      `campaign refused: PATH shadow — running install and PATH-resolved install differ\n` +
        `  running:  ${self}\n  PATH hit: ${resolved}`,
      "remove the stale install or fix PATH order; see scripts/check-engine-version.sh",
    );
  }
}
