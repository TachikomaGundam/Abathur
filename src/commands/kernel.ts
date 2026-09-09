// `abathur kernel audit <label>` — read-only seal check (todo 4). Promote-time
// reseal/generation stays with todo 10; this router only reports drift so the
// validation loop (todo 9) and gate can consume the same auditKernel() result.

import type { CommandSpec } from "../cli.js";
import { resolveConfigDir } from "../config.js";
import { requireGenomesByLabel } from "../core/genome.js";
import { auditKernel } from "../core/kernel.js";
import { EXIT_OK, blocked, cannotAnswer, type ExitCode } from "../exit.js";
import { writeStdout } from "../out.js";

function kernelAudit(configDir: string, args: readonly string[]): ExitCode {
  const label = args[0];
  if (label === undefined || label.length === 0) {
    cannotAnswer("kernel audit: missing <label> argument", "usage: abathur kernel audit <label>");
  }
  const scan = requireGenomesByLabel(configDir, label);
  for (const warning of scan.warnings) writeStdout(`warning: ${warning}`);
  const failures: string[] = [];
  for (const entry of scan.entries) {
    const audit = auditKernel(entry, configDir);
    if (audit.ok) {
      writeStdout(`sealed clean: '${entry.label}' (${entry.fingerprint})`);
    } else {
      failures.push(
        ...audit.drifted.map((d) => `${entry.label} (${entry.fingerprint}): ${d.path} ${d.kind}`),
      );
    }
  }
  if (failures.length > 0) {
    blocked(
      `kernel audit FAILED for '${label}':\n  - ${failures.slice(0, 10).join("\n  - ")}` +
        `${failures.length > 10 ? `\n  - (+${String(failures.length - 10)} more)` : ""}`,
      "restore the named files or resolve the drift at promote — 'genome add' cannot reseal",
    );
  }
  return EXIT_OK;
}

function runKernel(args: readonly string[]): ExitCode {
  const configDir = resolveConfigDir();
  const [sub, ...rest] = args;
  switch (sub) {
    case "audit":
      return kernelAudit(configDir, rest);
    default:
      return cannotAnswer(
        `kernel: unknown subcommand '${sub ?? "<none>"}'`,
        "usage: abathur kernel audit <label> (promote-time reseal arrives with todo 10)",
      );
  }
}

export const kernelCommand: CommandSpec = {
  name: "kernel",
  summary: "audit frozen kernel seals against the working tree",
  run: ({ args }) => runKernel(args),
};
