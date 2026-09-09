// Bundle manifest v1 — exact plan schema (todo 12, line 166). Key insertion
// order below IS the serialized byte order: re-exports must stay byte-identical,
// and tests pin the field list verbatim.

import { z } from "zod";

import { ADAPTER_IFACE_VERSION, fingerprint } from "./ids.js";
import { unitMatrixRowSchema, type GenerationRowData } from "./evolve/run-rows.js";
import type { GenomeSpec } from "./spec.js";

export const DIGEST_ALGO = "sha256-canonical-v1";
export const BUNDLE_SCHEMA_VERSION = 1;

const nullable = <T extends z.ZodType>(inner: T) => z.union([inner, z.null()]);

export const bundleManifestSchema = z.strictObject({
  schema_version: z.literal(BUNDLE_SCHEMA_VERSION),
  digest_algo: z.string(),
  genome: z.strictObject({
    label: z.string().min(1),
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/, "genome.fingerprint must be sha256 hex"),
  }),
  parent: z.string().regex(/^[0-9a-f]{7,64}$/, "parent must be a git commit id"),
  benchDigest: z.string().regex(/^[0-9a-f]{64}$/),
  benchProvenance: z.strictObject({
    opencodeVersion: nullable(z.string()),
    agentModel: nullable(z.string()),
    adapterConfigDigest: nullable(z.string()),
    fixtureSeedId: nullable(z.string()),
    judgeModel: nullable(z.string()),
    mutatorModel: nullable(z.string()),
    nRepeats: nullable(z.number().int().nonnegative()),
    statsConfigDigest: nullable(z.string()),
  }),
  budgetCounters: z.strictObject({
    candidates: z.number(),
    modelCalls: z.number(),
    tokens: z.number(),
    wallS: z.number(),
  }),
  stats: z.strictObject({
    matrix: z.array(unitMatrixRowSchema),
    verdict: nullable(z.enum(["nominated", "culled", "indeterminate", "inconclusive"])),
  }),
  sealedGlobs: z.array(z.string()),
  files: z.array(
    z.strictObject({
      path: z.string().min(1),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      len: z.number().int().nonnegative(),
    }),
  ).min(1),
  rationale: z.string(),
  frictionDigests: z.array(z.string()),
});
export type BundleManifest = z.infer<typeof bundleManifestSchema>;

export interface BundleProvenance {
  readonly opencodeVersion: string | null;
  readonly agentModel: string | null;
  readonly adapterConfigDigest: string | null;
  readonly fixtureSeedId: string | null;
  readonly judgeModel: string | null;
  readonly mutatorModel: string | null;
  readonly nRepeats: number | null;
  readonly statsConfigDigest: string | null;
}

/** Ledger row + contained spec → the plan's benchProvenance field set. Fields the
 *  bench kind genuinely does not have (toy has no opencode version; mutator model
 *  lands with todo 11) are explicit nulls, never guesses. */
export function deriveBenchProvenance(row: GenerationRowData, spec: GenomeSpec): BundleProvenance {
  const bench = spec.bench;
  return {
    opencodeVersion:
      row.benchProvenance.versions.find((v) => v.bin === "opencode")?.version ?? null,
    agentModel: bench.agentModel ?? null,
    adapterConfigDigest: fingerprint({
      adapterIface: ADAPTER_IFACE_VERSION,
      benchType: bench.type,
      graderCommand: bench.graderCommand,
      judgeCommand: bench.judgeCommand ?? null,
      resetCommand: bench.resetCommand ?? null,
      runCommand: bench.runCommand,
      seedCommand: bench.seedCommand ?? null,
      timeoutS: bench.timeoutS,
    }),
    fixtureSeedId: bench.seedCommand === undefined ? null : fingerprint({ seedCommand: bench.seedCommand }),
    judgeModel: bench.judgeModel ?? null,
    mutatorModel: null,
    nRepeats: row.reps,
    statsConfigDigest: fingerprint(bench.stats),
  };
}

export interface LineageEntry {
  readonly genId: string;
  readonly parent: string;
  readonly commitSha: string;
  readonly treeSha: string;
  readonly verdict: string | null;
  readonly rationale: string;
}

export function lineageEntry(genId: string, row: GenerationRowData): LineageEntry {
  return {
    genId,
    parent: row.headCommit,
    commitSha: row.commitSha ?? "",
    treeSha: row.treeSha ?? "",
    verdict: row.verdict ?? null,
    rationale: row.rationale ?? "",
  };
}

export function renderReadme(params: {
  readonly label: string;
  readonly genomeFingerprint: string;
  readonly genIds: readonly string[];
  readonly primary: LineageEntry;
  readonly memberCount: number;
}): string {
  const lines = [
    `# abathur lineage bundle — ${params.label}`,
    "",
    `- genome fingerprint: \`${params.genomeFingerprint}\``,
    `- generations (newest primary last): ${params.genIds.map((g) => `\`${g}\``).join(", ")}`,
    `- primary parent commit: \`${params.primary.parent}\``,
    `- primary commit: \`${params.primary.commitSha}\` (tree \`${params.primary.treeSha}\`)`,
    `- verdict: ${params.primary.verdict ?? "n/a"}`,
    `- rationale: ${params.primary.rationale}`,
    "",
    "Members: manifest.json (schema v1, digest sha256-canonical-v1), patch.diff",
    "(primary parent..commit), lineage.json (ledger-row summaries), trees/<genId>/",
    "(generation content read from git objects at export), README.md, and",
    "evidence/<genId>/<runId>.jsonl — REDACTED train-only bench transcripts",
    "(val units are structurally never exported). Machine-local paths and any",
    "declared mask literals appear only as <HOME>/<GENOME>/<MASKED-n> placeholders.",
    "This bundle carries no signatures and implies no trust — verify with",
    "`abathur bundle inspect <this file>`, which re-hashes every pinned member.",
    "",
  ];
  return lines.join("\n");
}
