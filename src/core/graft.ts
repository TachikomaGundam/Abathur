// `graft` (plan todo 13): cross-instance crystallization merge with a LOCAL
// re-bench. A lineage bundle is UNTRUSTED input — the bundle's scores, verdicts
// and reps are recorded as `peerClaim` metadata and NEVER feed nomination math.
// v1 trust model, byte-for-byte (docs/federation.md — todo 15):
//
//   inspect (todo 12) → genome-fingerprint gate → benchDigest gate →
//   scoring-provenance gate → requires[] probes (todo 6) → fresh todo-3
//   worktree from the LOCAL incumbent HEAD carrying the bundle's contained
//   tree bytes → LOCAL bench at LOCAL reps/thresholds (NEVER the bundle's) →
//   todo-7 stats decide: nominated (human promote gate only) or culled.
//
//   * integrity/provenance mismatch ⇒ quarantined — exactly one graft_import
//     ledger row, NO worktree, NO bench; `status` lists it.
//   * genome unregistered ⇒ pending-bench — explicit queue entry under
//     <configDir>/graft-queue/, zero bench runs; the operator registers the
//     genome and re-runs graft to resolve the entry. Probes failing is the
//     same pending-bench shape (prerequisite repair, then re-run).
//   * the same bundle + genome never grafts twice (terminal-row refusal).
//
// No noise-tolerance band: byte-equality is the rule. No --force, no
// quarantine/pending-bench bypass, no merge of two incumbent branches, no
// auto-promote (core/promote.js is never imported here). Single-shot by design
// — graft is NOT a resumable run: the queue file + graft_import rows are the
// durable state, and "resume" means re-running `abathur graft`.

import path from "node:path";

import { EXIT_BLOCKED, EXIT_CANNOT_ANSWER, ExitSignal, type ExitCode } from "../exit.js";
import { inspectBundle } from "./bundle-inspect.js";
import { bundleGenIds, primaryGenId, sha256Hex, treeOf } from "./bundle-common.js";
import type { BundleManifest } from "./bundle-manifest.js";
import { fingerprint16 } from "./genome.js";
import { fingerprint } from "./ids.js";
import { acquireGenomeLock, Ledger } from "./ledger.js";
import {
  LEDGER_KIND_GRAFT_IMPORT,
  echo,
  peerClaimFromManifest,
  removeGraftQueueEntry,
  sha12,
  writeGraftQueueEntry,
  type GraftDecision,
} from "./graft-support.js";
import {
  assertNotGrafted,
  bestEffortClaim,
  localBenchDigest,
  parseBundleBytes,
  probeGraftPrerequisites,
  provenanceGateFailures,
  readBundleBytes,
  type GraftOutcome,
  type GraftRequest,
} from "./graft-gates.js";
import { graftAndBench } from "./graft-rebench.js";

export type { GraftOutcome, GraftRequest } from "./graft-gates.js";

export async function graftBundle(req: GraftRequest): Promise<GraftOutcome> {
  const now = req.now ?? (() => new Date());
  const bundlePath = path.resolve(req.bundlePath);
  const bytes = readBundleBytes(bundlePath);
  const bundleSha256 = sha256Hex(bytes);

  // ---- STEP 1: FULL inspect first (todo 12). Integrity failures are decided,
  // not negotiated: quarantine-booked, then the inspect wording is echoed.
  // Cannot-answer-class failures (garbage container / unreadable manifest)
  // leave no state to book — a refusal line is the whole story.
  try {
    inspectBundle({ bundlePath, home: req.home });
  } catch (cause) {
    if (cause instanceof ExitSignal && cause.code === EXIT_BLOCKED) {
      const claim = bestEffortClaim(bytes);
      return quarantine(req, bundleSha256, bundlePath, claim, `integrity: ${cause.message}`);
    }
    throw cause;
  }
  const { manifest, members } = parseBundleBytes(bytes);

  // ---- STEP 2: genome not registered locally ⇒ pending-bench. There is no
  // repo to hold a ledger, so the queue file IS the graft_import record.
  if (req.entry === null) {
    const reason = `genome '${req.genomeLabel}' is not registered locally`;
    const file = writeGraftQueueEntry(req.configDir, {
      bundleSha256,
      bundlePath,
      genomeLabel: req.genomeLabel,
      reason,
      queuedAt: now().toISOString(),
      sourceGenomeFingerprint: manifest.genome.fingerprint,
    });
    return pendingOutcome(req, bundleSha256, reason, file, EXIT_BLOCKED);
  }
  const entry = req.entry;
  const spec = entry.spec;
  const ledger = Ledger.open(spec.repoPath, { now });
  assertNotGrafted(ledger, bundleSha256, req.genomeLabel);

  // ---- STEP 3: the byte-exact gates; any miss quarantines before state or spawns.
  const localFingerprint = fingerprint(spec);
  if (localFingerprint !== manifest.genome.fingerprint) {
    return quarantineLedger(ledger, req, bundleSha256, bundlePath, manifest,
      `genome fingerprint mismatch — local spec fingerprints to ${localFingerprint}, bundle claims ${manifest.genome.fingerprint}`);
  }
  const primary = primaryGenId(bundleGenIds(members));
  const tree = treeOf(members, primary);
  const digest = localBenchDigest(spec, tree, primary);
  if (digest !== manifest.benchDigest) {
    return quarantineLedger(ledger, req, bundleSha256, bundlePath, manifest,
      `benchDigest mismatch — recomputed from the contained tree under the LOCAL spec: local ${digest}, bundle claims ${manifest.benchDigest}`);
  }
  const provenanceFailures = provenanceGateFailures(manifest, spec, tree, primary, ledger);
  if (provenanceFailures.length > 0) {
    return quarantineLedger(ledger, req, bundleSha256, bundlePath, manifest,
      `scoring provenance not comparable — ${provenanceFailures.join("; ")}`);
  }

  // ---- STEP 4: requires[] probes BEFORE any worktree or bench (todo-6 machinery).
  try {
    await probeGraftPrerequisites(spec, req.opencodeBin);
  } catch (cause) {
    if (cause instanceof ExitSignal && cause.code === EXIT_CANNOT_ANSWER) {
      const reason = `requires[] probe failed: ${cause.message}`;
      appendGraftImport(ledger, req, bundleSha256, bundlePath, manifest, {
        decision: "pending-bench",
        reason,
        sourceGenomeFingerprint: manifest.genome.fingerprint,
      });
      const file = writeGraftQueueEntry(req.configDir, {
        bundleSha256,
        bundlePath,
        genomeLabel: req.genomeLabel,
        reason,
        queuedAt: now().toISOString(),
        sourceGenomeFingerprint: manifest.genome.fingerprint,
      });
      return pendingOutcome(req, bundleSha256, reason, file, EXIT_CANNOT_ANSWER);
    }
    throw cause;
  }

  // ---- STEP 5: all green ⇒ fresh worktree + LOCAL re-bench under the genome lock.
  const lease = acquireGenomeLock({ ledger, configDir: req.configDir, genomeFp: fingerprint16(spec), now });
  try {
    return await graftAndBench(req, {
      ledger,
      spec,
      genomeFp: entry.fingerprint,
      manifest,
      tree,
      bundleSha256,
      recordDecision: (decision, reason, sealed) => {
        // EXACTLY ONE graft_import decision row, booked before the candidate
        // generation row; the terminal decision retires any pending-bench entry.
        appendGraftImport(ledger, req, bundleSha256, bundlePath, manifest, {
          decision,
          reason,
          sourceGenomeFingerprint: manifest.genome.fingerprint,
          graftGenId: sealed.graftGenId,
          commitSha: sealed.commitSha,
          treeSha: sealed.treeSha,
        });
        removeGraftQueueEntry(req.configDir, bundleSha256);
      },
    });
  } finally {
    lease.release();
  }
}

// ---------------------------------------------------------------- decision rows

interface DecisionDetail {
  readonly decision: GraftDecision;
  readonly reason: string;
  readonly sourceGenomeFingerprint: string | null;
  readonly graftGenId?: string;
  readonly commitSha?: string;
  readonly treeSha?: string;
}

function appendGraftImport(
  ledger: Ledger,
  req: GraftRequest,
  bundleSha256: string,
  bundlePath: string,
  manifest: BundleManifest | null,
  detail: DecisionDetail,
): void {
  ledger.append({
    kind: LEDGER_KIND_GRAFT_IMPORT,
    ...(detail.graftGenId === undefined ? {} : { genId: detail.graftGenId }),
    data: {
      decision: detail.decision,
      genomeLabel: req.genomeLabel,
      bundleSha256,
      bundlePath,
      sourceGenomeFingerprint: detail.sourceGenomeFingerprint,
      sourceBenchDigest: manifest?.benchDigest ?? null,
      reason: detail.reason,
      imported: true,
      graftGenId: detail.graftGenId ?? null,
      commitSha: detail.commitSha ?? null,
      treeSha: detail.treeSha ?? null,
      peerClaim: manifest === null ? null : peerClaimFromManifest(manifest),
    },
  });
}

/** Inspect-time integrity failure: quarantine on the LOCAL ledger when a repo
 *  exists; refuse clean (exit 1, no state) when the genome is unknown — the
 *  pending-bench queue records bundles AWAITING setup, not garbage. */
function quarantine(
  req: GraftRequest,
  bundleSha256: string,
  bundlePath: string,
  claim: { fingerprint: string | null; benchDigest: string | null },
  reason: string,
): GraftOutcome {
  if (req.entry === null) {
    throw new ExitSignal(EXIT_BLOCKED, `graft: quarantined — ${reason}`, "nothing was applied or benched; 'abathur bundle inspect' names the failing member");
  }
  const ledger = Ledger.open(req.entry.spec.repoPath);
  assertNotGrafted(ledger, bundleSha256, req.genomeLabel);
  ledger.append({
    kind: LEDGER_KIND_GRAFT_IMPORT,
    data: {
      decision: "quarantined",
      genomeLabel: req.genomeLabel,
      bundleSha256,
      bundlePath,
      sourceGenomeFingerprint: claim.fingerprint,
      sourceBenchDigest: claim.benchDigest,
      reason,
      imported: true,
      graftGenId: null,
      commitSha: null,
      treeSha: null,
      peerClaim: null,
    },
  });
  return quarantineOutcome(req, bundleSha256, reason);
}

function quarantineLedger(
  ledger: Ledger,
  req: GraftRequest,
  bundleSha256: string,
  bundlePath: string,
  manifest: BundleManifest,
  reason: string,
): GraftOutcome {
  appendGraftImport(ledger, req, bundleSha256, bundlePath, manifest, {
    decision: "quarantined",
    reason,
    sourceGenomeFingerprint: manifest.genome.fingerprint,
  });
  return quarantineOutcome(req, bundleSha256, reason);
}

function quarantineOutcome(req: GraftRequest, bundleSha256: string, reason: string): GraftOutcome {
  return {
    exitCode: EXIT_BLOCKED,
    lines: [
      `graft: quarantined — bundle ${sha12(bundleSha256)} refused under genome '${echo(req.genomeLabel, 80)}'`,
      `  gate: ${echo(reason, 400)}`,
      `  decision booked to the ledger as ${LEDGER_KIND_GRAFT_IMPORT} (imported:true); review with 'abathur status ${echo(req.genomeLabel, 80)}'`,
      `  NEVER applied, NEVER benched — v1 has no noise-tolerance band and no bypass flag (docs/federation.md)`,
    ],
  };
}

function pendingOutcome(req: GraftRequest, bundleSha256: string, reason: string, queueFile: string, exitCode: ExitCode): GraftOutcome {
  return {
    exitCode,
    lines: [
      `graft: pending-bench — bundle ${sha12(bundleSha256)} queued for genome '${echo(req.genomeLabel, 80)}'`,
      `  reason: ${echo(reason, 300)}`,
      `  queue: ${echo(queueFile, 200)}`,
      `  zero bench runs launched; the eligible path is to register/repair the local genome, then re-run 'abathur graft <this bundle> --genome ${echo(req.genomeLabel, 80)}'`,
    ],
  };
}
