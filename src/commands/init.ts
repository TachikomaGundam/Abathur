// `abathur init` — establish the deployment surfaces (ruling
// sibyl-20261023T095118Z-75ee, Q6 mechanism B). Idempotent mkdir, then a
// fail-closed self-check that every surface exists and is writable. The surface
// list comes from src/core/surfaces.ts — the single authoritative source; this
// command never touches shared device facilities (npm prefix, global config,
// crontab). Exit 0 = all surfaces ready; exit 2 = a surface cannot be
// established, with every failure named.

import { accessSync, constants, existsSync, mkdirSync, statSync } from "node:fs";
import type { CommandSpec } from "../cli.js";
import { EXIT_OK, cannotAnswer, type ExitCode } from "../exit.js";
import { writeStdout } from "../out.js";
import { deploymentSurfaces, type SurfacesEnv } from "../core/surfaces.js";

export function runInit(env: SurfacesEnv = process.env): ExitCode {
  const surfaces = deploymentSurfaces(env);
  const failures: string[] = [];
  for (const dir of surfaces) {
    try {
      const created = !existsSync(dir);
      if (created) mkdirSync(dir, { recursive: true });
      if (!statSync(dir).isDirectory()) throw new Error("exists but is not a directory");
      accessSync(dir, constants.W_OK);
      writeStdout(`init: ${dir} ${created ? "created" : "present"}`);
    } catch (error) {
      failures.push(`${dir}: ${(error as Error).message}`);
    }
  }
  if (failures.length > 0) {
    cannotAnswer(
      `init: ${failures.length} surface(s) not writable:\n  - ${failures.join("\n  - ")}`,
      "fix ownership/permissions yourself — init never escalates and never touches shared facilities",
    );
  }
  writeStdout(`init: ${surfaces.length} surfaces ready`);
  return EXIT_OK;
}

export const initCommand: CommandSpec = {
  name: "init",
  summary: "create Abathur-owned deployment surfaces (idempotent, fail-closed self-check)",
  run: () => runInit(),
};
