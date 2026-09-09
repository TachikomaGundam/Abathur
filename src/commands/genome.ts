// `abathur genome` — thin subcommand router (todo 1 seam); all logic lives in
// src/core/{spec,genome,kernel,glob}.ts. `rm` (todo 10) is registry-only: a
// genome with ledger history is refused outright — lineage is archive-not-delete.

import { existsSync, readFileSync, rmSync } from "node:fs";

import type { CommandSpec } from "../cli.js";
import { resolveConfigDir } from "../config.js";
import { readRegistry, registerGenome, requireGenomesByLabel } from "../core/genome.js";
import { ledgerPath } from "../core/ledger.js";
import { EXIT_OK, blocked, cannotAnswer, type ExitCode } from "../exit.js";
import { writeStdout } from "../out.js";
import { resolveUniqueEntry } from "./run.js";

function requireLabelArg(args: readonly string[], command: string): string {
  const label = args[0];
  if (label === undefined || label.length === 0) {
    cannotAnswer(`genome ${command}: missing <label> argument`);
  }
  return label;
}

function genomeAdd(configDir: string, args: readonly string[]): ExitCode {
  const specPath = args[0];
  if (specPath === undefined) {
    cannotAnswer("genome add: missing <spec.jsonc> argument", "usage: abathur genome add <file.jsonc>");
  }
  const result = registerGenome(configDir, specPath);
  writeStdout(
    result.kind === "registered"
      ? `registered genome '${result.label}' (${result.fingerprint})`
      : `genome '${result.label}' (${result.fingerprint}) already registered — kernel manifest byte-identical, nothing rewritten`,
  );
  return EXIT_OK;
}

function genomeList(configDir: string): ExitCode {
  const scan = readRegistry(configDir);
  for (const warning of scan.warnings) writeStdout(`warning: ${warning}`);
  if (scan.entries.length === 0) {
    writeStdout("no genomes registered");
    return EXIT_OK;
  }
  for (const entry of scan.entries) writeStdout(`${entry.fingerprint}  ${entry.label}`);
  return EXIT_OK;
}

function genomeShow(configDir: string, label: string): ExitCode {
  const scan = requireGenomesByLabel(configDir, label);
  for (const warning of scan.warnings) writeStdout(`warning: ${warning}`);
  for (const entry of scan.entries) {
    writeStdout(`# ${entry.label} (${entry.fingerprint}) — ${entry.registryFile}`);
    writeStdout(entry.storedText.trimEnd());
  }
  return EXIT_OK;
}

function genomeSeals(configDir: string, label: string): ExitCode {
  const scan = requireGenomesByLabel(configDir, label);
  for (const warning of scan.warnings) writeStdout(`warning: ${warning}`);
  for (const entry of scan.entries) {
    writeStdout(`# effective seal globs for '${entry.label}' (${entry.fingerprint}) under ${entry.spec.repoPath}`);
    for (const glob of entry.spec.kernel.immutableGlobs) writeStdout(glob);
  }
  return EXIT_OK;
}

function genomeRm(configDir: string, label: string): ExitCode {
  const entry = resolveUniqueEntry(configDir, label, "genome rm");
  const file = ledgerPath(entry.spec.repoPath);
  if (existsSync(file) && readFileSync(file, "utf8").trim().length > 0) {
    blocked(
      `genome rm refused: '${entry.label}' (${entry.fingerprint}) has ledger history — archive instead`,
      `lineage lives in ${file}; unregistering a lived genome would orphan its evidence. Keep it registered or move the repo aside.`,
    );
  }
  rmSync(entry.registryFile);
  writeStdout(`unregistered genome '${entry.label}' (${entry.fingerprint}) — repo and kernel manifest left in place (cull ≠ delete)`);
  return EXIT_OK;
}

function runGenome(args: readonly string[]): ExitCode {
  const configDir = resolveConfigDir();
  const [sub, ...rest] = args;
  switch (sub) {
    case "add":
      return genomeAdd(configDir, rest);
    case "list":
      return genomeList(configDir);
    case "show":
      return genomeShow(configDir, requireLabelArg(rest, "show"));
    case "seals":
      return genomeSeals(configDir, requireLabelArg(rest, "seals"));
    case "rm":
      return genomeRm(configDir, requireLabelArg(rest, "rm"));
    default:
      return cannotAnswer(
        `genome: unknown subcommand '${sub ?? "<none>"}'`,
        "usage: abathur genome add <spec.jsonc> | list | show <label> | seals <label> | rm <label>",
      );
  }
}

export const genomeCommand: CommandSpec = {
  name: "genome",
  summary: "add/list/show/seals/rm genome specs and their kernel seals",
  run: ({ args }) => runGenome(args),
};
