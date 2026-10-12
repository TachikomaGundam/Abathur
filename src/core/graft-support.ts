// Graft support (todo 13): the pending-bench queue file convention, the
// `graft_import` ledger-row shape, and the echo sanitizer shared by `graft`
// and `status`. Kept deliberately dependency-light (fs + text only, no git,
// no bench, no ledger class) so `status` can render graft state WITHOUT ever
// calling Ledger.open — the todo-10 rule: status side-effects must not poison
// the genome-rm ledgerless check. The queue file IS the graft_import record
// when no local repo exists to hold a ledger.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { cannotAnswer } from "../exit.js";

export const LEDGER_KIND_GRAFT_IMPORT = "graft_import";
/** <configDir>/graft-queue/<bundle-sha256>.json — one explicit entry per
 *  pending-bench bundle (plan todo 13: "explicit queue entry in status"). */
export const GRAFT_QUEUE_DIRNAME = "graft-queue";

const HEX64 = /^[0-9a-f]{64}$/;

export type GraftDecision =
  | "quarantined"
  | "pending-bench"
  | "nominated"
  | "culled"
  | "indeterminate"
  | "inconclusive";

const DECISIONS: readonly GraftDecision[] = [
  "quarantined",
  "pending-bench",
  "nominated",
  "culled",
  "indeterminate",
  "inconclusive",
];

function asDecision(value: unknown): GraftDecision | null {
  return DECISIONS.find((decision): decision is GraftDecision => decision === value) ?? null;
}

/** A terminal decision blocks re-grafting the same bundle; pending does not
 *  (the plan's eligible path is "register genome then re-run graft"). */
export const isTerminalDecision = (decision: GraftDecision): boolean => decision !== "pending-bench";

export interface GraftQueueEntry {
  readonly bundleSha256: string;
  readonly bundlePath: string;
  readonly genomeLabel: string;
  readonly reason: string;
  readonly queuedAt: string;
  readonly sourceGenomeFingerprint?: string | undefined;
}

export function graftQueueDir(configDir: string): string {
  return path.join(configDir, GRAFT_QUEUE_DIRNAME);
}

export function graftQueuePath(configDir: string, bundleSha256: string): string {
  if (!HEX64.test(bundleSha256)) {
    cannotAnswer(`graft: queue key '${bundleSha256}' is not a 64-char sha256 hex`);
  }
  return path.join(graftQueueDir(configDir), `${bundleSha256}.json`);
}

export function writeGraftQueueEntry(configDir: string, entry: GraftQueueEntry): string {
  const file = graftQueuePath(configDir, entry.bundleSha256);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
  return file;
}

/** Idempotent consume: the success-path decision retires the queue entry. */
export function removeGraftQueueEntry(configDir: string, bundleSha256: string): void {
  rmSync(graftQueuePath(configDir, bundleSha256), { force: true });
}

function parseQueueFile(file: string, name: string): GraftQueueEntry {
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch (cause) {
    return cannotAnswer(`graft queue: ${file} is not readable JSON — refusing to render a partial truth: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const raw = (typeof doc === "object" && doc !== null && !Array.isArray(doc) ? doc : undefined) as
    | Record<string, unknown>
    | undefined;
  const bad = (): never =>
    cannotAnswer(`graft queue: ${file} violates the queue-entry shape — fix or remove the file by hand`);
  if (raw === undefined) bad();
  const body = raw as Record<string, unknown>;
  const str = (key: string): string => {
    const value = body[key];
    return typeof value === "string" && value.length > 0 ? value : bad();
  };
  const bundleSha256 = str("bundleSha256");
  // the filename is the address: a foreign key inside is tampering, not data
  if (!HEX64.test(bundleSha256) || `${bundleSha256}.json` !== name) bad();
  const fp = body.sourceGenomeFingerprint;
  if (fp !== undefined && (typeof fp !== "string" || !HEX64.test(fp))) bad();
  return {
    bundleSha256,
    bundlePath: str("bundlePath"),
    genomeLabel: str("genomeLabel"),
    reason: str("reason"),
    queuedAt: str("queuedAt"),
    ...(typeof fp === "string" ? { sourceGenomeFingerprint: fp } : {}),
  };
}

/** Sorted, fail-closed read of the whole queue (status + graft dedup view). */
export function listGraftQueue(configDir: string): readonly GraftQueueEntry[] {
  const dir = graftQueueDir(configDir);
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; // no queue yet = empty, not an error
    throw error; // unreadable-but-present (EACCES/EIO) must never render as an empty queue
  }
  return names.map((name) => parseQueueFile(path.join(dir, name), name));
}

export interface GraftPeerClaim {
  readonly verdict: string | null;
  readonly nRepeats: number | null;
  readonly opencodeVersion: string | null;
  readonly agentModel: string | null;
  readonly judgeModel: string | null;
  readonly statsConfigDigest: string | null;
  readonly rationale: string;
}

export interface GraftImportRow {
  readonly decision: GraftDecision;
  readonly genomeLabel: string;
  readonly bundleSha256: string;
  readonly bundlePath: string;
  readonly sourceGenomeFingerprint: string | null;
  readonly sourceBenchDigest: string | null;
  readonly reason: string;
  readonly imported: boolean;
  readonly graftGenId: string | null;
  readonly commitSha: string | null;
  readonly treeSha: string | null;
  readonly peerClaim: GraftPeerClaim | null;
}

const asStr = (value: unknown): string | null => (typeof value === "string" ? value : null);
const asStrOrNull = (value: unknown): string | null | undefined =>
  value === null || typeof value === "string" ? value : undefined;

/** Lenient read of a graft_import row (ledger data is record<string,unknown>). */
export function decodeGraftImport(data: Record<string, unknown>): GraftImportRow | null {
  const decision = asDecision(data.decision);
  if (decision === null) return null;
  const genomeLabel = asStr(data.genomeLabel);
  const bundleSha256 = asStr(data.bundleSha256);
  const reason = asStr(data.reason);
  if (genomeLabel === null || bundleSha256 === null || reason === null) return null;
  if (data.imported !== true) return null;
  const sourceGenomeFingerprint = asStrOrNull(data.sourceGenomeFingerprint);
  const sourceBenchDigest = asStrOrNull(data.sourceBenchDigest);
  const graftGenId = asStrOrNull(data.graftGenId);
  const commitSha = asStrOrNull(data.commitSha);
  const treeSha = asStrOrNull(data.treeSha);
  const bundlePath = asStr(data.bundlePath) ?? "";
  if (sourceGenomeFingerprint === undefined || sourceBenchDigest === undefined) return null;
  if (graftGenId === undefined || commitSha === undefined || treeSha === undefined) return null;
  const rawClaim = data.peerClaim;
  let peerClaim: GraftPeerClaim | null = null;
  if (typeof rawClaim === "object" && rawClaim !== null && !Array.isArray(rawClaim)) {
    const claim = rawClaim as Record<string, unknown>;
    const verdict = asStrOrNull(claim.verdict);
    const nRepeats = claim.nRepeats;
    const opencodeVersion = asStrOrNull(claim.opencodeVersion);
    const agentModel = asStrOrNull(claim.agentModel);
    const judgeModel = asStrOrNull(claim.judgeModel);
    const statsConfigDigest = asStrOrNull(claim.statsConfigDigest);
    const rationale = asStr(claim.rationale);
    if (
      verdict !== undefined &&
      (nRepeats === null || (typeof nRepeats === "number" && Number.isInteger(nRepeats))) &&
      opencodeVersion !== undefined &&
      agentModel !== undefined &&
      judgeModel !== undefined &&
      statsConfigDigest !== undefined &&
      rationale !== null
    ) {
      peerClaim = {
        verdict,
        nRepeats: typeof nRepeats === "number" ? nRepeats : null,
        opencodeVersion,
        agentModel,
        judgeModel,
        statsConfigDigest,
        rationale,
      };
    }
  }
  return {
    decision,
    genomeLabel,
    bundleSha256,
    bundlePath,
    sourceGenomeFingerprint,
    sourceBenchDigest,
    reason,
    imported: true,
    graftGenId,
    commitSha,
    treeSha,
    peerClaim,
  };
}

/** The quarantine/pending row's peerClaim projection of a bundle manifest. */
export function peerClaimFromManifest(manifest: {
  stats: { verdict: string | null };
  benchProvenance: { nRepeats: number | null; opencodeVersion: string | null; agentModel: string | null; judgeModel: string | null; statsConfigDigest: string | null };
  rationale: string;
}): GraftPeerClaim {
  return {
    verdict: manifest.stats.verdict,
    nRepeats: manifest.benchProvenance.nRepeats,
    opencodeVersion: manifest.benchProvenance.opencodeVersion,
    agentModel: manifest.benchProvenance.agentModel,
    judgeModel: manifest.benchProvenance.judgeModel,
    statsConfigDigest: manifest.benchProvenance.statsConfigDigest,
    rationale: manifest.rationale,
  };
}

/** Single-line print sanitizer for untrusted echo content (todo-8 flat discipline). */
export function echo(value: string, max = 140): string {
  const one = value.replace(/[^ -~]/g, " ").replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

export const sha12 = (sha: string): string => (HEX64.test(sha) ? sha.slice(0, 12) : echo(sha, 12));
