// `abathur status <label>` — a READ-ONLY ledger view. It never opens the Ledger
// class (that mkdirs on first sight) and never touches worktrees: everything is
// parsed from the ledger file plus one rev-parse. Ledger-sourced strings are
// untrusted free text — every one is flattened before printing, so a hostile
// reason/candidateId cannot forge table rows or terminal escapes.

import { existsSync, readFileSync } from "node:fs";

import { resolveConfigDir } from "../config.js";
import { EXIT_OK, cannotAnswer, type ExitCode } from "../exit.js";
import { writeStdout } from "../out.js";
import { INCUMBENT_BRANCH } from "../core/incumbent.js";
import { ledgerPath, ledgerRecordSchema, type LedgerRecord } from "../core/ledger.js";
import { gitOpts } from "../core/genome-paths.js";
import { decodeGenerationRecord, type GenerationRowData } from "../core/evolve/run-bench.js";
import { tryGit } from "../util/git.js";
import type { CommandSpec } from "../cli.js";
import { resolveUniqueEntry } from "./run.js";

const KIND_GENERATION = "generation_complete";
const KIND_PROMOTE = "promote";
const KIND_TOMBSTONE = "tombstone";
const USAGE = "usage: abathur status <label> [--last N]";

function flat(value: string, max = 64): string {
  const one = value.replace(/[^ -~]/g, " ").replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

function readLedgerRecords(file: string): readonly LedgerRecord[] {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, "utf8");
  return text.split("\n").filter((l) => l.length > 0).map((line, idx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return cannotAnswer(`status: ledger row ${String(idx + 1)} in ${file} is not JSON — refusing to render a partial truth`);
    }
    const check = ledgerRecordSchema.safeParse(parsed);
    if (!check.success) {
      return cannotAnswer(`status: ledger row ${String(idx + 1)} in ${file} violates the envelope schema: ${String(check.error.issues[0]?.message ?? "schema")}`);
    }
    return check.data;
  });
}

interface GenEntry {
  readonly genId: string;
  readonly data: GenerationRowData;
}

function generations(records: readonly LedgerRecord[]): readonly GenEntry[] {
  return records
    .filter((r) => r.kind === KIND_GENERATION && r.genId !== undefined)
    .map((r) => ({ genId: r.genId as string, data: decodeGenerationRecord(r) }));
}

function verdictCell(data: GenerationRowData): string {
  return `verdict=${data.verdict ?? "—"}`;
}

function gainCell(data: GenerationRowData): string {
  if (data.gain === undefined) return "gain=—";
  if (data.gain === null) return "gain=n/a";
  return `gain=${data.gain >= 0 ? "+" : ""}${data.gain.toFixed(3)}`;
}

function counterCell(d: GenerationRowData): string {
  return `cand=${String(d.counters.candidates)} model=${String(d.counters.modelCalls)} tok=${String(d.counters.tokens)} wall=${d.counters.wallS.toFixed(2)}s`;
}

// Quarantine depth = candidate generations the stats gate nominated that the human
// has NEVER decided: latest generation_complete row per genId says verdict=nominated
// and no promote or tombstone row exists for that genId. Todo-12 graft imports are
// "quarantined" by the same ledger shape (logged, undecided ⇒ counted here).
function quarantineEntries(gens: readonly GenEntry[], records: readonly LedgerRecord[]): readonly string[] {
  const latest = new Map<string, GenerationRowData>();
  for (const g of gens) latest.set(g.genId, g.data);
  const decided = new Set(records.filter((r) => r.kind === KIND_PROMOTE || r.kind === KIND_TOMBSTONE).map((r) => String(r.genId)));
  return [...latest.entries()]
    .filter(([id, d]) => d.source === "candidate" && d.verdict === "nominated" && !decided.has(id))
    .map(([id]) => flat(id, 40));
}

function sha12(sha: string): string {
  return sha.slice(0, 12);
}

async function runStatus(args: readonly string[]): Promise<ExitCode> {
  const positional: string[] = [];
  let last = 10;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg === "--last") {
      const raw = Number(args[(i += 1)]);
      if (!Number.isInteger(raw) || raw < 1 || raw > 1000) cannotAnswer(`status: --last expects an integer 1..1000`, USAGE);
      last = raw;
    } else if (arg.startsWith("--")) {
      cannotAnswer(`status: unknown flag ${arg}`, USAGE);
    } else {
      positional.push(arg);
    }
  }
  const label = positional[0];
  if (label === undefined || positional.length !== 1) cannotAnswer("status: expected exactly <label>", USAGE);

  const configDir = resolveConfigDir();
  const entry = resolveUniqueEntry(configDir, label, "status");
  const repo = entry.spec.repoPath;
  const records = readLedgerRecords(ledgerPath(repo));
  const gens = generations(records);

  writeStdout(`genome: ${flat(entry.label)} (${entry.fingerprint})  repo: ${flat(repo, 200)}`);

  const ref = await tryGit(["rev-parse", "--verify", "-q", `refs/heads/${INCUMBENT_BRANCH}`], gitOpts({}, repo));
  const refSha = ref.ok ? ref.stdout.trim() : null;
  const promoteRows = records.filter((r) => r.kind === KIND_PROMOTE);
  const lastPromote = promoteRows.at(-1);
  if (refSha === null) {
    writeStdout(lastPromote === undefined
      ? "incumbent: none"
      : `incumbent: none (warning: last promote targeted ${String(lastPromote.data.to).slice(0, 12)} — the ${INCUMBENT_BRANCH} ref is missing)`);
  } else {
    writeStdout(`incumbent: ${sha12(refSha)} (${INCUMBENT_BRANCH})`);
    if (lastPromote !== undefined) {
      const data = lastPromote.data as { genId?: unknown; from?: unknown; to?: unknown };
      const from = data.from === null || data.from === undefined ? "new branch" : String(data.from).slice(0, 12);
      writeStdout(`  last promote: ${flat(String(data.genId ?? "?"), 40)} ${from} -> ${String(data.to ?? "?").slice(0, 12)} at ${lastPromote.ts}`);
      if (String(data.to ?? "") !== refSha) writeStdout(`  warning: ref ${sha12(refSha)} differs from last promote target — lineage moved outside promote`);
    }
  }

  const quarantine = quarantineEntries(gens, records);
  writeStdout(`quarantine depth: ${String(quarantine.length)}`);
  if (quarantine.length > 0) writeStdout(`  pending: ${quarantine.slice(0, 10).join(", ")}${quarantine.length > 10 ? ` (+${String(quarantine.length - 10)} more)` : ""}`);
  // Todo 12 owns the pending-bench graft queue; no queue-file convention exists
  // yet, so the honest depth is 0 — status never fabricates queue entries.
  writeStdout("pending-bench graft queue: 0 (todo 12 — no queue file convention yet)");

  writeStdout(`generations (last ${String(Math.min(last, gens.length))} of ${String(gens.length)}):`);
  for (const g of gens.slice(-last)) {
    const who = g.data.source === "candidate" ? `candidate ${flat(g.data.candidateId ?? "?", 40)}` : "incumbent-baseline";
    writeStdout(`  # ${flat(g.genId, 40)}  ${who}  ${verdictCell(g.data)}  ${gainCell(g.data)}  ${counterCell(g.data)}`);
  }

  const spent = { candidates: 0, modelCalls: 0, tokens: 0, wallS: 0 };
  for (const g of gens) {
    spent.candidates += g.data.counters.candidates;
    spent.modelCalls += g.data.counters.modelCalls;
    spent.tokens += g.data.counters.tokens;
    spent.wallS += g.data.counters.wallS;
  }
  const caps = entry.spec.budget;
  writeStdout(`budget: candidates ${String(spent.candidates)}/${String(caps.maxCandidates)}, modelCalls ${String(spent.modelCalls)}/${String(caps.maxModelCalls)}, tokens ${String(spent.tokens)}/${String(caps.maxTokens)}, wallS ${spent.wallS.toFixed(2)}/${String(caps.maxWallS)}`);
  return EXIT_OK;
}

export const statusCommand: CommandSpec = {
  name: "status",
  summary: "read-only ledger view: incumbent, generations, quarantine depth, budget consumption",
  run: ({ args }) => runStatus(args),
};
