// `abathur tombstone <label> <genId> --reason <text>` — cull is NOT delete:
// this command only appends one ledger row. Commits, worktrees, and every prior
// row survive; the reason is stored verbatim (canonicalJson escapes control
// bytes) but NEVER echoed raw — the confirmation line is sanitized like todo-8's
// sealMessage so untrusted text cannot forge terminal output.

import { Ledger } from "../core/ledger.js";
import { resolveConfigDir } from "../config.js";
import { EXIT_OK, blocked, cannotAnswer, type ExitCode } from "../exit.js";
import { writeStdout } from "../out.js";
import type { CommandSpec } from "../cli.js";
import { resolveUniqueEntry } from "./run.js";

const LEDGER_KIND_TOMBSTONE = "tombstone";
const MAX_REASON_CHARS = 4000;
const USAGE = "usage: abathur tombstone <label> <genId> --reason <text>";

function echoed(reason: string): string {
  const flat = reason.replace(/[^ -~]/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat;
}

function parseArgs(args: readonly string[]): { readonly label: string; readonly genId: string; readonly reason: string } {
  const positional: string[] = [];
  let reason: string | null = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg === "--reason") {
      const value = args[(i += 1)];
      if (value === undefined || value.startsWith("--")) cannotAnswer("tombstone: --reason requires a value", USAGE);
      if (reason !== null) cannotAnswer("tombstone: --reason given twice", USAGE);
      reason = value;
    } else if (arg.startsWith("--")) {
      cannotAnswer(`tombstone: unknown flag ${arg}`, USAGE);
    } else {
      positional.push(arg);
    }
  }
  const [label, genId] = positional;
  if (label === undefined || genId === undefined || positional.length !== 2) cannotAnswer("tombstone: expected exactly <label> <genId>", USAGE);
  if (reason === null || reason.trim().length === 0) cannotAnswer("tombstone: --reason <text> is required (why is this lineage culled?)", USAGE);
  if (reason.length > MAX_REASON_CHARS) cannotAnswer(`tombstone: --reason exceeds ${String(MAX_REASON_CHARS)} chars`, USAGE);
  return { label, genId, reason };
}

function runTombstone(args: readonly string[]): ExitCode {
  const { label, genId, reason } = parseArgs(args);
  const configDir = resolveConfigDir();
  const entry = resolveUniqueEntry(configDir, label, "tombstone");
  const ledger = Ledger.open(entry.spec.repoPath);
  const records = ledger.readAll();
  if (!records.some((r) => r.kind === "generation_complete" && r.genId === genId)) {
    blocked(`tombstone: no generation_complete ledger row for gen '${genId}' of '${label}' — nothing to bury`);
  }
  const promoted = records.find((r) => r.kind === "promote" && r.genId === genId);
  if (promoted !== undefined) {
    blocked(`tombstone: gen '${genId}' was already promoted at ${promoted.ts} — cull is for candidates the human never accepted`);
  }
  const buried = records.find((r) => r.kind === LEDGER_KIND_TOMBSTONE && r.genId === genId);
  if (buried !== undefined) {
    blocked(`tombstone: gen '${genId}' is already tombstoned at ${buried.ts}`);
  }
  ledger.append({ kind: LEDGER_KIND_TOMBSTONE, genId, data: { genId, reason, actor: "cli" } });
  writeStdout(`tombstone recorded: '${genId}' (reason: ${echoed(reason)}) — commits and lineage preserved (cull ≠ delete)`);
  return EXIT_OK;
}

export const tombstoneCommand: CommandSpec = {
  name: "tombstone",
  summary: "human gate: bury a candidate lineage with a reason (append-only; never deletes)",
  run: ({ args }) => runTombstone(args),
};
