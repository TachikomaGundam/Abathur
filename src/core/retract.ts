// retractGeneration — the human gate that undoes a promote (design gap found
// 2026-09-28 when the human ordered a rollback of self-cli and the engine had
// no path: tombstone refuses promoted gens by design, incumbent.ts moves the
// ref forward-only). Doctrine:
// - History is append-only: the promote row STAYS; retract appends its own
//   row. No commit moves, no lineage deletes (retract ≠ delete).
// - LIFO only: a later LIVE promote must be retracted first.
// - Descendant guard: a generation seeded FROM this incumbent (a
//   generation_complete row appended after the promote row) blocks the
//   retract unless its lineage is dead (tombstoned or retracted).
// - ref-absent is NOT fail-open: when the incumbent ref is already gone (a
//   documented manual rollback), the retract is recordable only when the gen
//   being retracted is the ONLY live promote — anything else is a divergence
//   the human must resolve first. The row then carries refState:"absent".
// - The incumbent branch must be idle in EVERY worktree (worktree list
//   --porcelain), not just the primary checkout.
// - The whole read→guard→mutate→append sequence runs under the genome lock
//   plus a repo-local gate lock (cross-config-home safety). The descendant
//   guard is point-in-time BY DESIGN: a run seeded from this incumbent before
//   the retract may still append its generation_complete afterwards — that row
//   is honest and its commits are preserved (retract ≠ delete); what the lock
//   guarantees is that no decision RACES the retract, not that no lineage
//   outlives it.
// Import policy mirrors core/promote.ts: this module is imported ONLY by
// src/commands/retract.ts (pinned by the structural test in promote.test.ts).
// No force flag: every refusal is a bug report, not a flag.

import { existsSync, rmSync } from "node:fs";
import path from "node:path";

import { blocked, cannotAnswer } from "../exit.js";
import { tryGit } from "../util/git.js";
import type { RegistryEntry } from "./genome.js";
import { gitOpts, type WorktreeOptions } from "./genome-paths.js";
import { INCUMBENT_BRANCH } from "./incumbent.js";
import { manifestPathFor } from "./kernel.js";
import { acquireGenomeLock, acquireLock, LEDGER_KIND_PROMOTE, LEDGER_KIND_TOMBSTONE, Ledger } from "./ledger.js";
import { effectiveRepoPath } from "./spec.js";

export const LEDGER_KIND_RETRACT = "retract";

export interface RetractRequest {
  readonly entry: RegistryEntry;
  readonly configDir: string;
  readonly genId: string;
  readonly reason: string;
  readonly env?: NodeJS.ProcessEnv;
}

export interface RetractOutcome {
  readonly genId: string;
  readonly lines: readonly string[];
}

/** Every worktree (primary + linked) that has the incumbent branch checked out. */
async function incumbentCheckouts(repo: string, opts: WorktreeOptions): Promise<readonly string[]> {
  const run = await tryGit(["worktree", "list", "--porcelain"], gitOpts(opts, repo));
  if (!run.ok) cannotAnswer(`retract: cannot enumerate worktrees in ${repo}: ${run.error.kind}`);
  // entries are blank-line-separated blocks; attributes (branch, prunable …)
  // come AFTER the worktree line, so evaluate whole blocks, not a line stream
  const busy: string[] = [];
  for (const block of run.stdout.split("\n\n")) {
    const lines = block.split("\n");
    const wt = lines.find((l) => l.startsWith("worktree "));
    if (wt === undefined) continue;
    // "prunable <reason>" = stale metadata for a deleted directory — it must
    // not permanently block the rollback valve
    if (lines.some((l) => l.startsWith("prunable"))) continue;
    if (lines.some((l) => l === `branch refs/heads/${INCUMBENT_BRANCH}`)) busy.push(wt.slice("worktree ".length));
  }
  return busy;
}

export async function retractGeneration(req: RetractRequest): Promise<RetractOutcome> {
  const repo = effectiveRepoPath(req.entry.spec.repoPath);
  const opts: WorktreeOptions = req.env === undefined ? {} : { env: req.env };
  const gopts = gitOpts(opts, repo);
  const ledger = Ledger.open(repo);
  const lease = acquireGenomeLock({ ledger, configDir: req.configDir, genomeFp: req.entry.fingerprint });
  try {
    // the genome lock is keyed (configDir, fingerprint): two registry entries or two
    // config homes pointing at the SAME repo hold different locks. The ledger and the
    // incumbent ref are repo-global, so the gate sequence also takes a REPO-local
    // lock — same lock regardless of which config home the caller came through.
    // Nested inside the genome-lock try so a contended repo lock never strands it.
    const repoLease = acquireLock({ configDir: path.join(repo, ".state", "abathur"), key: "gate", label: "gate lock" });
    try {
    const records = ledger.readAll();

    const promoteIndex = records.findIndex((r) => r.kind === LEDGER_KIND_PROMOTE && r.genId === req.genId);
    if (promoteIndex < 0) {
      blocked(
        `retract: no promote ledger row for gen '${req.genId}' of '${req.entry.label}' — nothing to retract`,
        "retract undoes a promote; for a never-promoted candidate use `abathur tombstone`",
      );
    }
    const promoteRow = records[promoteIndex]!;
    if (records.some((r) => r.kind === LEDGER_KIND_RETRACT && r.genId === req.genId)) {
      blocked(`retract: gen '${req.genId}' is already retracted — nothing to do`);
    }
    // a lineage is dead once tombstoned (never promoted) or retracted (promoted,
    // then undone): it no longer sits on the incumbent chain.
    const released = new Set(
      records.filter((r) => r.kind === LEDGER_KIND_TOMBSTONE || r.kind === LEDGER_KIND_RETRACT).map((r) => r.genId),
    );
    const livePromotes = records.filter((r) => r.kind === LEDGER_KIND_PROMOTE && !released.has(r.genId));
    const later = records.slice(promoteIndex + 1);
    if (later.some((r) => r.kind === LEDGER_KIND_PROMOTE && !released.has(r.genId))) {
      blocked(
        `retract: a later promote exists for '${req.entry.label}' — retract is LIFO`,
        "retract the later generation first, then re-run this retract",
      );
    }
    const orphans = later.filter((r) => r.kind === "generation_complete" && !released.has(r.genId));
    if (orphans.length > 0) {
      blocked(
        `retract: ${String(orphans.length)} generation(s) were seeded from this incumbent after the promote — retracting would orphan them`,
        "let them conclude and tombstone the culled ones first, then re-run this retract",
      );
    }

    const to = (promoteRow.data as { to?: unknown }).to;
    if (typeof to !== "string" || !/^[0-9a-f]{40}$/.test(to)) {
      cannotAnswer(`retract: promote row for '${req.genId}' lacks a full commit sha — ledger inconsistent, refusing`);
    }

    const busy = await incumbentCheckouts(repo, opts);
    if (busy.length > 0) {
      blocked(
        `retract: ${INCUMBENT_BRANCH} is checked out in ${busy.join(", ")} — retract needs it idle`,
        "switch that worktree to another branch first; if the listing is stale, run `git worktree prune` in the genome repo",
      );
    }

    // for-each-ref: ok+empty = genuinely absent; ok+sha = present; !ok = git
    // itself failed (corruption/lock) — never launder a git failure into "absent"
    const ref = await tryGit(["for-each-ref", "--format=%(objectname)", `refs/heads/${INCUMBENT_BRANCH}`], gopts);
    if (!ref.ok) {
      cannotAnswer(`retract: cannot read ${INCUMBENT_BRANCH} in ${repo}: ${ref.error.kind} — nothing was touched`);
    }
    let refState: "deleted" | "absent";
    let removedSha: string | null = null;
    const current = ref.stdout.trim();
    if (current !== "") {
      if (current !== to) {
        blocked(
          `retract: ${INCUMBENT_BRANCH} now points at ${current.slice(0, 12)} but the promote row recorded ${to.slice(0, 12)} — state diverged, refusing`,
          "investigate with `git -C <repo> log abathur/incumbent` and the ledger before any manual surgery",
        );
      }
      // compare-and-delete: the old value pins what we verified, so a ref moved
      // between the check and the delete makes git refuse instead of clobbering
      const del = await tryGit(["update-ref", "-d", `refs/heads/${INCUMBENT_BRANCH}`, current], gopts);
      if (!del.ok) {
        blocked(
          `retract: ${INCUMBENT_BRANCH} moved between verification and deletion — refusing rather than deleting an unverified ref`,
          "re-run the retract; if it keeps failing, inspect the ref with git directly",
        );
      }
      removedSha = current;
      refState = "deleted";
    } else {
      // Manual-rollback path (documented 2026-09-28): recordable ONLY when this
      // gen is the sole live promote — otherwise the absent ref means a
      // divergence retract must not launder into an official-looking row.
      if (livePromotes.length !== 1) {
        blocked(
          `retract: ${INCUMBENT_BRANCH} is absent but ${String(livePromotes.length)} live promotes exist — cannot verify what the retract undoes`,
          "restore the ref to the promoted commit (or resolve the divergence) before retracting",
        );
      }
      refState = "absent";
    }

    const manifestFile = manifestPathFor(req.configDir, req.entry.fingerprint);
    const manifestBefore = existsSync(manifestFile);
    rmSync(manifestFile, { force: true });
    const manifestGone = !existsSync(manifestFile);

    // verbatim in the ledger (JSON-escaped on disk); printable-ASCII echo only
    ledger.append({
      kind: LEDGER_KIND_RETRACT,
      genId: req.genId,
      data: { actor: "cli", genId: req.genId, reason: req.reason, retractedTo: to, refState },
    });

    const flat = req.reason.replace(/[^ -~]/g, " ").replace(/\s+/g, " ").trim();
    const echoReason = flat.length > 120 ? `${flat.slice(0, 120)}…` : flat;
    const lines = [
      `retract recorded: '${req.genId}' (reason: ${echoReason})`,
      removedSha === null
        ? `${INCUMBENT_BRANCH} was already absent (manual rollback) — recorded with refState=absent`
        : `${INCUMBENT_BRANCH} removed (was ${removedSha.slice(0, 12)}) — genome returns to incumbent: none`,
      manifestBefore && manifestGone
        ? `kernel manifest cleared: ${manifestFile}`
        : !manifestBefore && manifestGone
          ? `kernel manifest already absent: ${manifestFile}`
          : `kernel manifest REMOVAL UNVERIFIED: ${manifestFile} still exists — investigate`,
      `the promote row remains in the append-only ledger; candidate commit ${to.slice(0, 12)} preserved (retract ≠ delete)`,
    ];
    return { genId: req.genId, lines };
    } finally {
      repoLease.release();
    }
  } finally {
    lease.release();
  }
}
