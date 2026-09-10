// promoteGeneration (todo 10): the human-only gate. Import policy: this module is
// pulled in ONLY by src/commands/promote.ts — run-loop/evolve code must never reach
// it (plan Must NOT: no auto-promote path importable by evolve modules; pinned by
// src/test/promote.test.ts). Every fact comes from the LEDGER, never from worktree
// contents or exit codes (todo-9 rule): a forged nominated row still has to survive
// the independent sealed-path diff below before any ref or manifest moves.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ExitSignal, blocked, cannotAnswer } from "../exit.js";
import type { RegistryEntry } from "./genome.js";
import { compileGlob } from "./glob.js";
import { fastForwardIncumbent } from "./incumbent.js";
import {
  buildManifest,
  kernelsDirOf,
  manifestPathFor,
  readManifestFile,
  serializeManifest,
} from "./kernel.js";
import { Ledger, ledgerPath } from "./ledger.js";
import { gitOpts, requireSha } from "./genome-paths.js";
import type { WorktreeEnv, WorktreeOptions } from "./genome-paths.js";
import { snapshotCommit } from "./snapshot.js";
import { tryGit } from "../util/git.js";
import { decodeGenerationRecord } from "./evolve/run-bench.js";

export const LEDGER_KIND_PROMOTE = "promote";

export interface PromoteRequest {
  readonly entry: RegistryEntry;
  readonly configDir: string;
  readonly genId: string;
  readonly env?: WorktreeEnv | undefined;
}

export interface PromoteOutcome {
  readonly genId: string;
  readonly fromSha: string | null;
  readonly toSha: string;
  readonly lines: readonly string[];
}

/** Ledger/display-safe flattening of untrusted text (todo-8 sealMessage discipline). */
function display(value: string, max = 96): string {
  const flat = value.replace(/[^ -~]/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function short(sha: string): string {
  return sha.slice(0, 12);
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}

interface Nomination {
  readonly commitSha: string;
  readonly parent: string;
}

/** Read the nomination from the ledger. Never from worktree files or exit codes. */
function nominatedGeneration(record: ReturnType<typeof decodeGenerationRecord>, shown: string): Nomination {
  if (record.source !== "candidate") {
    blocked(`promote: '${shown}' is an incumbent baseline row — only candidate generations are promotable`);
  }
  if (record.verdict === undefined) {
    blocked(`promote: gen '${shown}' has no verdict in the ledger — cannot promote what the gate never judged`);
  }
  if (record.verdict !== "nominated") {
    blocked(`promote: gen '${shown}' verdict is '${record.verdict}', not 'nominated' — refusing`);
  }
  if (record.commitSha === undefined) {
    blocked(`promote: gen '${shown}' nominated row is missing its commitSha`);
  }
  return { commitSha: requireSha(record.commitSha, `promote: gen '${shown}' commit sha`), parent: record.headCommit };
}

/**
 * Second, independent enforcement of the kernel boundary: git-diff the sealed gen
 * range and cross every touched path against BOTH the spec's immutableGlobs and
 * the config-home manifest's file set. Runs before any mutation; a hit blocks even
 * when the ledger says nominated (tampered-ledger posture).
 */
async function sealedPathCheck(genId: string, nom: Nomination, matchers: readonly RegExp[], sealedPaths: ReadonlySet<string>, cwd: string, opts: WorktreeOptions): Promise<void> {
  const run = await tryGit(["diff", "--name-only", "-z", nom.parent, nom.commitSha], gitOpts(opts, cwd));
  if (!run.ok) {
    blocked(
      `promote: cannot diff ${short(nom.parent)}..${short(nom.commitSha)} for gen '${genId}' in ${cwd}: ${firstLine(run.error.stderr)}`,
      "the ledger names a commit this repo does not contain — investigate before promoting",
    );
  }
  const touched = run.stdout.split("\0").filter((p) => p.length > 0);
  const hits = touched.filter((p) => sealedPaths.has(p) || matchers.some((re) => re.test(p)));
  const unique = [...new Set(hits)].sort();
  if (unique.length > 0) {
    const shown = unique.slice(0, 10).map((p) => display(p, 200)).join(", ");
    const more = unique.length > 10 ? ` (+${String(unique.length - 10)} more)` : "";
    blocked(
      `promote: gen '${genId}' touches sealed paths: ${shown}${more} — ledger verdict 'nominated' is not sufficient; refusing`,
      "sealed kernel paths must not move inside a generation; cull it with `abathur tombstone`",
    );
  }
}

export async function promoteGeneration(req: PromoteRequest): Promise<PromoteOutcome> {
  const { entry, configDir } = req;
  const repo = entry.spec.repoPath;
  const shown = display(req.genId);
  const opts: WorktreeOptions = req.env === undefined ? {} : { env: req.env };

  const ledger = Ledger.open(repo);
  const records = ledger.readAll();
  const genRows = records.filter((r) => r.kind === "generation_complete" && r.genId === req.genId);
  const lastRow = genRows.at(-1);
  if (lastRow === undefined) {
    blocked(
      `promote: no generation_complete ledger row for gen '${shown}' of '${entry.label}'`,
      `state is read only from ${ledgerPath(repo)} — check candidates with \`abathur status ${entry.label}\``,
    );
  }
  if (records.some((r) => r.kind === LEDGER_KIND_PROMOTE && r.genId === req.genId)) {
    blocked(`promote: gen '${shown}' is already promoted (promote row in ledger) — nothing to do`);
  }
  const nom = nominatedGeneration(decodeGenerationRecord(lastRow), shown);

  const manifestFile = manifestPathFor(configDir, entry.fingerprint);
  let manifestEntries;
  try {
    manifestEntries = readManifestFile(manifestFile);
  } catch (cause) {
    if (cause instanceof ExitSignal) throw cause;
    const message = cause instanceof Error ? cause.message : String(cause);
    cannotAnswer(`promote: kernel manifest unreadable, refusing to gate: ${message}`);
  }
  const sealedPaths = new Set(manifestEntries.map((e) => e.path));
  const matchers = entry.spec.kernel.immutableGlobs.map((glob) => compileGlob(glob));
  await sealedPathCheck(req.genId, nom, matchers, sealedPaths, repo, opts);

  const genome = { repoPath: repo, genomeFp: entry.fingerprint };
  const ff = await fastForwardIncumbent(genome, nom.commitSha, opts);

  // regeneration happens ONLY here, after the human-invoked diff passed:
  // manifest reborn from the new incumbent's committed tree, not the worktree.
  const snap = await snapshotCommit(genome, nom.commitSha, opts);
  const fresh = buildManifest(snap.snapshotPath, entry.spec.kernel.immutableGlobs);
  mkdirSync(kernelsDirOf(configDir), { recursive: true });
  writeFileSync(manifestFile, serializeManifest(fresh), "utf8");

  ledger.append({
    kind: LEDGER_KIND_PROMOTE,
    genId: req.genId,
    data: { actor: "cli", genId: req.genId, from: ff.fromSha, to: ff.toSha },
  });

  return {
    genId: req.genId,
    fromSha: ff.fromSha,
    toSha: ff.toSha,
    lines: [
      `promoted '${entry.label}' (${entry.fingerprint}): ${ff.fromSha === null ? "incumbent branch created" : short(ff.fromSha)} -> ${short(ff.toSha)} (gen ${shown})`,
      `manifest: rewrote ${path.relative(process.cwd(), manifestFile) || manifestFile} from tree ${short(nom.commitSha)} (${String(fresh.length)} sealed ${fresh.length === 1 ? "entry" : "entries"})`,
      `ledger: appended '${LEDGER_KIND_PROMOTE}' row (actor: cli) to ${ledgerPath(repo)}`,
    ],
  };
}
