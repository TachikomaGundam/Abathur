// Deployment surfaces — the single authoritative list (L-SINGLE-SOURCE) of every
// Abathur-owned directory the deployment establishes. Ruling
// sibyl-20261023T095118Z-75ee (Q6, mechanism B): isolation is established ONLY
// inside Abathur-owned surfaces; install hooks never touch shared device
// facilities (npm prefix, global config, crontab). `abathur init` creates these;
// any future first-run self-creation must derive from this same list.

import * as os from "node:os";
import path from "node:path";
import { resolveConfigDir } from "../config.js";

export interface SurfacesEnv {
  readonly ABATHUR_CONFIG?: string | undefined;
  readonly ABATHUR_HOME?: string | undefined;
  readonly HOME?: string | undefined;
}

function homeDir(env: SurfacesEnv): string {
  const raw = env.HOME;
  return raw !== undefined && raw.length > 0 ? raw : os.homedir();
}

/** Data home: $ABATHUR_HOME when set, else ~/.local/share/abathur (XDG on every OS). */
export function dataHomePath(env: SurfacesEnv = process.env): string {
  const raw = env.ABATHUR_HOME;
  if (raw !== undefined && raw.length > 0) return path.resolve(raw);
  return path.join(homeDir(env), ".local", "share", "abathur");
}

/**
 * THE list, in creation order. Anything the deployment expects to exist is here;
 * anything not here is not a surface. Cross-platform names per the repo AGENTS.md
 * deployment note: Linux/macOS share the XDG form; Windows maps to
 * %LOCALAPPDATA%\abathur\ via the same $ABATHUR_HOME override seam.
 */
export function deploymentSurfaces(env: SurfacesEnv = process.env): readonly string[] {
  const data = dataHomePath(env);
  return [
    resolveConfigDir(env), // genome registry + config state
    data, // data home (ledger support, future engine state)
    path.join(data, "anchor"), // anchor hash-chain home (deployed scripts write here)
  ];
}
