// `abathur bundle export|inspect` (todo 12) — thin router: flag parsing and the
// registry lookup live here; all bundle mechanics in src/core/bundle*.ts.

import { homedir } from "node:os";

import { resolveConfigDir } from "../config.js";
import { EXIT_OK, cannotAnswer, type ExitCode } from "../exit.js";
import { exportBundle } from "../core/bundle-export.js";
import { inspectBundle } from "../core/bundle-inspect.js";
import { writeStdout } from "../out.js";
import type { CommandSpec } from "../cli.js";
import { resolveUniqueEntry } from "./run.js";

const USAGE =
  "usage: abathur bundle export <label> (--gen <genId> [--gen <genId> ...] | --last <N>) --out <dir>\n" +
  "   or: abathur bundle inspect <path>";

interface ExportFlags {
  readonly label: string;
  readonly genIds: readonly string[] | null;
  readonly last: number | null;
  readonly outDir: string | null;
}

function parseExportFlags(args: readonly string[]): ExportFlags {
  const [label, ...rest] = args;
  if (label === undefined || label.startsWith("--")) cannotAnswer("bundle export: <label> required", USAGE);
  const genIds: string[] = [];
  let last: number | null = null;
  let outDir: string | null = null;
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (flag === "--gen") {
      if (value === undefined || value.startsWith("--")) cannotAnswer("bundle export: --gen needs a genId", USAGE);
      genIds.push(value);
      i += 1;
    } else if (flag === "--last") {
      if (value === undefined || !/^\d+$/.test(value)) cannotAnswer("bundle export: --last needs a positive integer", USAGE);
      last = Number.parseInt(value, 10);
      i += 1;
    } else if (flag === "--out") {
      if (value === undefined || value.startsWith("--")) cannotAnswer("bundle export: --out needs a directory", USAGE);
      outDir = value;
      i += 1;
    } else {
      cannotAnswer(`bundle export: unknown argument '${String(flag)}'`, USAGE);
    }
  }
  if (genIds.length > 0 && last !== null) cannotAnswer("bundle export: choose --gen or --last, not both", USAGE);
  if (genIds.length === 0 && last === null) cannotAnswer("bundle export: pick generations with --gen <id> or --last <N>", USAGE);
  if (outDir === null) cannotAnswer("bundle export: --out <dir> is required", USAGE);
  return { label, genIds: genIds.length > 0 ? genIds : null, last, outDir };
}

async function runBundle(args: readonly string[]): Promise<ExitCode> {
  const [sub, ...rest] = args;
  if (sub === "export") {
    const flags = parseExportFlags(rest);
    const configDir = resolveConfigDir();
    const entry = resolveUniqueEntry(configDir, flags.label, "bundle");
    const select = flags.genIds !== null ? { genIds: flags.genIds } : { last: flags.last ?? 0 };
    const outcome = await exportBundle({ entry, configDir, select, outDir: flags.outDir ?? "", home: homedir() });
    for (const line of outcome.lines) writeStdout(line);
    return EXIT_OK;
  }
  if (sub === "inspect") {
    const [bundlePath] = rest;
    if (bundlePath === undefined || rest.length !== 1) cannotAnswer("bundle inspect: expected exactly one bundle path", USAGE);
    const outcome = inspectBundle({ bundlePath, home: homedir() });
    for (const line of outcome.lines) writeStdout(line);
    return outcome.exitCode;
  }
  cannotAnswer(`bundle: unknown subcommand '${String(sub ?? "(none)")}'`, USAGE);
}

export const bundleCommand: CommandSpec = {
  name: "bundle",
  summary: "export a genome + lineage as an offline bundle (or inspect one: re-hash, self-consistency, leak re-scan)",
  run: ({ args }) => runBundle(args),
};
