// Graft gates (todo 13): bundle IO + the four byte-exact pre-conditions —
// genome fingerprint, benchDigest, scoring provenance, requires[] probes —
// plus the duplicate-graft refusal. All mismatch messages carry the FULL
// expected vs actual digests (misleading_success_output guard: quarantine must
// always state WHICH gate failed). The trust narrative lives in
// docs/federation.md (todo 15); v1 has no noise-tolerance band.

import { readFileSync } from "node:fs";
import path from "node:path";

import { gunzipSync } from "node:zlib";

import { EXIT_BLOCKED, ExitSignal, cannotAnswer, type ExitCode } from "../exit.js";
import type { ConfigEnv } from "../config.js";
import { runChild } from "../bench/adapter.js";
import { probeEngines, resolveOpencodeBin } from "../bench/fixture-probe.js";
import { compareSemver, parseSemver } from "../bench/fixture-support.js";
import { benchDigestFor, containedSpec } from "./bundle-common.js";
import { bundleManifestSchema, deriveBenchProvenance, type BundleManifest } from "./bundle-manifest.js";
import { readTar, type TarMember } from "./bundle-tar.js";
import { clampReps } from "./stats.js";
import { emptyCounters, readResume, type GenerationRowData } from "./evolve/run-rows.js";
import type { RegistryEntry } from "./genome.js";
import { Ledger } from "./ledger.js";
import { decodeGraftImport, isTerminalDecision, sha12, LEDGER_KIND_GRAFT_IMPORT } from "./graft-support.js";
import type { GenomeSpec } from "./spec.js";

const BUNDLE_MAX_BYTES = 256 * 1024 * 1024;
const PROBE_TIMEOUT_S = 30;

export interface GraftRequest {
  /** Registry entry for the --genome label; null = not registered (pending-bench path). */
  readonly entry: RegistryEntry | null;
  readonly configDir: string;
  readonly bundlePath: string;
  readonly genomeLabel: string;
  /** This machine's HOME for the inspect re-scan (todo-12 inspect contract). */
  readonly home: string | null;
  readonly opencodeBin?: string | null | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly now?: (() => Date) | undefined;
}

export interface GraftOutcome {
  readonly exitCode: ExitCode;
  readonly lines: readonly string[];
}

export interface VerifiedBundle {
  readonly manifest: BundleManifest;
  readonly members: readonly TarMember[];
}

export function readBundleBytes(bundlePath: string): Buffer {
  let bytes: Buffer;
  try {
    bytes = readFileSync(bundlePath);
  } catch {
    return cannotAnswer(`graft: cannot read bundle ${bundlePath}`);
  }
  if (bytes.byteLength > BUNDLE_MAX_BYTES) {
    cannotAnswer(`graft: bundle ${bundlePath} is ${String(bytes.byteLength)} bytes — exceeds the ${String(BUNDLE_MAX_BYTES)} byte ceiling`);
  }
  return bytes;
}

/** Manifest + members under the EXACT todo-12 schema — export/inspect/graft share
 *  one parser, so the verification can never drift from what `inspect` proved. */
export function parseBundleBytes(bytes: Uint8Array): VerifiedBundle {
  let members: TarMember[];
  try {
    members = readTar(new Uint8Array(gunzipSync(bytes)));
  } catch (cause) {
    return cannotAnswer(`graft: bundle bytes unreadable after inspect passed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const raw = members.find((m) => m.path === "manifest.json");
  if (raw === undefined) return cannotAnswer("graft: manifest.json vanished from the bundle");
  let document: unknown;
  try {
    document = JSON.parse(new TextDecoder().decode(raw.content));
  } catch (cause) {
    return cannotAnswer(`graft: manifest.json is not valid JSON: ${cause instanceof Error ? cause.message.split("\n")[0] : String(cause)}`);
  }
  const parsed = bundleManifestSchema.safeParse(document);
  if (!parsed.success) {
    return cannotAnswer(`graft: manifest.json failed schema v1: ${String(parsed.error.issues[0]?.message ?? "schema")}`);
  }
  return { manifest: parsed.data, members };
}

/** Best-effort manifest claim extraction when inspect itself failed on a
 *  pinned-member integrity problem — the ledger row should still name the source
 *  genome if the manifest parses; unparseable garbage yields nulls. */
export function bestEffortClaim(bytes: Uint8Array): { fingerprint: string | null; benchDigest: string | null } {
  try {
    const { manifest } = parseBundleBytes(bytes);
    return { fingerprint: manifest.genome.fingerprint, benchDigest: manifest.benchDigest };
  } catch {
    return { fingerprint: null, benchDigest: null };
  }
}

/** Gate 2 anchor: the digest recomputed from the bundle's contained primary tree
 *  against the LOCAL registered spec (identities matching is gate 1's job; this
 *  gate pins the bench SURFACE the peer actually measured). */
export function localBenchDigest(spec: GenomeSpec, tree: Map<string, Uint8Array>, primary: string): string {
  return benchDigestFor(spec, tree, primary);
}

/**
 * Gate 3: scoring-provenance subset {agentModel, judgeModel, statsConfigDigest,
 * opencodeVersion-compatible} — byte-equal on the spec-recomputable fields,
 * semver-normalized on opencodeVersion (toy: both-null is the honest equality).
 * The peer side is re-derived from the bundle's OWN contained spec where
 * recomputable: manifest claims alone are never the word (adapterConfigDigest
 * and fixtureSeedId ride along as bonus recomputables).
 */
export function provenanceGateFailures(
  manifest: BundleManifest,
  spec: GenomeSpec,
  tree: Map<string, Uint8Array>,
  primary: string,
  ledger: Ledger,
): string[] {
  const claim = manifest.benchProvenance;
  const peerSpec = containedSpec(tree, primary);
  const localVersions = latestIncumbentVersions(ledger);
  const local = deriveBenchProvenance(provenanceRow(localVersions, clampReps(undefined, spec.bench.stats.nReps), spec), spec);
  const peer = deriveBenchProvenance(
    provenanceRow(claim.opencodeVersion === null ? [] : [{ bin: "opencode", version: claim.opencodeVersion }], claim.nRepeats ?? 1, peerSpec),
    peerSpec,
  );
  const failures: string[] = [];
  const keys = ["agentModel", "judgeModel", "statsConfigDigest", "adapterConfigDigest", "fixtureSeedId"] as const;
  for (const key of keys) {
    if (peer[key] !== local[key]) {
      failures.push(`${key}: local '${String(local[key] ?? "null")}' vs peer-derived '${String(peer[key] ?? "null")}'`);
    }
    if (claim[key] !== peer[key]) {
      failures.push(`${key}: manifest claims '${String(claim[key] ?? "null")}' but the contained spec derives '${String(peer[key] ?? "null")}'`);
    }
  }
  if (!opencodeVersionCompatible(local.opencodeVersion, claim.opencodeVersion)) {
    failures.push(`opencodeVersion: local '${local.opencodeVersion ?? "null"}' not semver-equal to peer '${claim.opencodeVersion ?? "null"}'`);
  }
  return failures;
}

function opencodeVersionCompatible(local: string | null, peer: string | null): boolean {
  if (local === null && peer === null) return true;
  if (local === null || peer === null) return false;
  const a = parseSemver(local);
  const b = parseSemver(peer);
  if (a === null || b === null) return false; // unparsable provenance is not comparable evidence
  return compareSemver(a, b) === 0;
}

/** Schema-valid row so deriveBenchProvenance (which reads .reps + .benchProvenance.versions)
 *  gets a real GenerationRowData, never a cast. */
function provenanceRow(
  versions: readonly { readonly bin: string; readonly version: string }[],
  reps: number,
  spec: GenomeSpec,
): GenerationRowData {
  return {
    source: "incumbent",
    headCommit: "0".repeat(40),
    complete: true,
    reps,
    units: [],
    counters: emptyCounters(),
    manifest: [],
    benchProvenance: { benchType: spec.bench.type, versions: versions.map((v) => ({ bin: v.bin, version: v.version })) },
  };
}

function latestIncumbentVersions(ledger: Ledger): readonly { readonly bin: string; readonly version: string }[] {
  let versions: readonly { readonly bin: string; readonly version: string }[] = [];
  for (const row of readResume(ledger).incumbentByHead.values()) versions = row.benchProvenance.versions;
  return versions;
}

/**
 * Gate 4 — requires[] probes via the todo-6 machinery BEFORE any worktree or
 * bench. Fixture genomes go through probeEngines (opencode --version +
 * minVersion + requires[]). Toy benches never spawn opencode, so probeEngines'
 * mandatory bin probe would be wrong there; the requires[] loop below mirrors
 * fixture-probe's runChild discipline exactly (argv spawn, 30s, exit-2-before-
 * any-unit on spawn_failed / probeExit mismatch).
 */
export async function probeGraftPrerequisites(
  spec: GenomeSpec,
  opencodeBin: string | null | undefined,
): Promise<void> {
  const repoRoot = path.resolve(spec.repoPath);
  if (spec.bench.type === "opencode-fixture-scenarios") {
    const env: ConfigEnv = process.env;
    const bin = resolveOpencodeBin(
      opencodeBin === null || opencodeBin === undefined ? { env } : { opencodeBin, env },
    );
    await probeEngines(spec, bin, repoRoot);
    return;
  }
  for (const prereq of spec.requires ?? []) {
    const outcome = await runChild({
      argv: [prereq.cmd, ...(prereq.args ?? ["--version"])],
      cwd: repoRoot,
      timeoutS: PROBE_TIMEOUT_S,
    });
    if (outcome.kind === "spawn_failed") {
      cannotAnswer(
        `graft: required prerequisite '${prereq.cmd}' is missing: ${outcome.reason}`,
        "install it or fix spec.requires before grafting",
      );
    }
    if (outcome.kind !== "exited" || outcome.exitCode !== prereq.probeExit) {
      cannotAnswer(
        `graft: prerequisite '${prereq.cmd}' probe expected exit ${String(prereq.probeExit)}, got ${outcome.reason}`,
      );
    }
  }
}

/** stale_state pin: the same bundle + genome never grafts twice — a terminal
 *  decision row (quarantined/nominated/culled/…) refuses re-entry. Pending
 *  rows do NOT: the plan's eligible path is "register genome then re-run". */
export function assertNotGrafted(ledger: Ledger, bundleSha256: string, genomeLabel: string): void {
  for (const record of ledger.readAll()) {
    if (record.kind !== LEDGER_KIND_GRAFT_IMPORT) continue;
    const row = decodeGraftImport(record.data);
    if (row === null || row.bundleSha256 !== bundleSha256 || row.genomeLabel !== genomeLabel) continue;
    if (!isTerminalDecision(row.decision)) continue;
    throw new ExitSignal(
      EXIT_BLOCKED,
      `graft: bundle ${sha12(bundleSha256)} already grafted under genome '${genomeLabel}' (decision '${row.decision}') — the ledger is append-only`,
      "export a newer bundle for new work; re-running the same bundle never re-benches",
    );
  }
}
