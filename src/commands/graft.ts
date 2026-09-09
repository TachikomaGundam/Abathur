// `abathur graft <bundle.tgz> --genome <label>` — thin CLI edge (plan todo 13):
// flag parsing + registry lookup + stdout funnel. All gates, queue mechanics
// and the local re-bench live in src/core/graft*.ts so the flow stays unit
// testable and the CLI never touches process.

import { homedir } from "node:os";
import path from "node:path";

import { resolveConfigDir } from "../config.js";
import { readRegistry, type RegistryEntry } from "../core/genome.js";
import { graftBundle } from "../core/graft.js";
import { cannotAnswer, type ExitCode } from "../exit.js";
import { writeStdout } from "../out.js";
import type { CommandContext, CommandSpec } from "../cli.js";

const USAGE = "usage: abathur graft <bundle.tgz> --genome <label>";

interface GraftFlags {
  readonly bundlePath: string;
  readonly label: string;
}

function parseGraftFlags(args: readonly string[]): GraftFlags {
  let bundlePath: string | null = null;
  let label: string | null = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg === "--genome") {
      const raw = args[(i += 1)];
      if (raw === undefined || raw.length === 0 || raw.startsWith("--")) cannotAnswer("graft: --genome <label> requires a value", USAGE);
      label = raw;
    } else if (arg.startsWith("--")) {
      cannotAnswer(`graft: unknown flag ${arg}`, `${USAGE}\n  no bypass flag exists — quarantine and pending-bench are decisions, not warnings`);
    } else if (bundlePath !== null) {
      cannotAnswer(`graft: unexpected extra argument '${arg}'`, USAGE);
    } else {
      bundlePath = arg;
    }
  }
  if (bundlePath === null) cannotAnswer("graft: <bundle.tgz> is required", USAGE);
  if (label === null) cannotAnswer("graft: --genome <label> is required", USAGE);
  return { bundlePath, label };
}

/** Registry lookup WITHOUT run.ts's resolveUniqueEntry so an unregistered
 *  label can reach the pending-bench queue path instead of exiting 2. */
function entryForLabel(configDir: string, label: string): RegistryEntry | null {
  const matches = readRegistry(configDir).entries.filter((entry) => entry.label === label);
  if (matches.length > 1) {
    cannotAnswer(
      `graft: label '${label}' is ambiguous — ${String(matches.length)} genomes share it: ${matches
        .map((e) => `${e.fingerprint} @ ${e.spec.repoPath}`)
        .join(", ")}`,
      "give the specs distinct labels; the fingerprint is the identity",
    );
  }
  return matches[0] ?? null;
}

async function runGraft(context: CommandContext): Promise<ExitCode> {
  const flags = parseGraftFlags(context.args);
  const configDir = resolveConfigDir();
  const outcome = await graftBundle({
    entry: entryForLabel(configDir, flags.label),
    configDir,
    bundlePath: path.resolve(flags.bundlePath),
    genomeLabel: flags.label,
    home: homedir(),
    opencodeBin: context.loaded.config.opencodeBin,
    env: process.env,
  });
  for (const line of outcome.lines) writeStdout(line);
  return outcome.exitCode;
}

export const graftCommand: CommandSpec = {
  name: "graft",
  summary: "import an offline bundle and graft its lineage",
  run: (context) => runGraft(context),
};
