// GenomeSpec schema (todo 4, plan line 102) — the contract todos 5-9 consume, so the
// field names below are load-bearing. Identity comes ONLY from the content
// fingerprint: `label` is a free string and may repeat across distinct genomes.
// Every bench.stats threshold is REQUIRED — an absent entry is an explicit config
// error naming the key, mirroring the hr discipline (hr/configs/thresholds.yaml:32-34:
// "missing entry = explicit config error", never a silent default).

import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import { cannotAnswer } from "../exit.js";
import { parseJsonc } from "../jsonc.js";

export const benchUnitSchema = z.strictObject({
  id: z.string().min(1),
  /** Path to the fixture/scenario file inside the genome repo. */
  path: z.string().min(1),
  split: z.enum(["train", "val"]),
});
export type BenchUnit = z.infer<typeof benchUnitSchema>;

/** Decision thresholds for the accept/indeterminate/reject gate — all mandatory. */
export const benchStatsSchema = z.strictObject({
  /** Half-width of the acceptance interval around an observed delta. */
  halfWidth: z.number().positive(),
  /** Smallest effect that can justify acceptance. */
  minEffect: z.number().nonnegative(),
  nReps: z.strictObject({
    initial: z.number().int().positive(),
    max: z.number().int().positive(),
  }),
});
export type BenchStats = z.infer<typeof benchStatsSchema>;

export const benchSchema = z
  .strictObject({
    type: z.enum(["toy", "opencode-fixture-scenarios"]),
    units: z.array(benchUnitSchema).min(1),
    seedCommand: z.string().min(1).optional(),
    resetCommand: z.string().min(1).optional(),
    runCommand: z.string().min(1),
    graderCommand: z.string().min(1),
    judgeCommand: z.string().min(1).optional(),
    judgeModel: z.string().min(1).optional(),
    agentModel: z.string().min(1).optional(),
    timeoutS: z.number().int().positive(),
    stats: benchStatsSchema,
  })
  .superRefine((bench, context) => {
    if (!bench.units.some((unit) => unit.split === "val")) {
      context.addIssue({
        code: "custom",
        path: ["units"],
        message: 'bench.units needs at least one split: "val" unit — validation splits are mandatory',
      });
    }
    if (bench.type === "opencode-fixture-scenarios" && bench.agentModel === undefined) {
      context.addIssue({
        code: "custom",
        path: ["agentModel"],
        message: 'bench.agentModel is required when bench.type is "opencode-fixture-scenarios"',
      });
    }
    if (bench.judgeCommand !== undefined && bench.judgeModel === undefined) {
      context.addIssue({
        code: "custom",
        path: ["judgeModel"],
        message: "bench.judgeModel is required when bench.judgeCommand is set",
      });
    }
  });
export type BenchSpec = z.infer<typeof benchSchema>;

/**
 * Bundle section (todo 12, additive): machine-local literals that `bundle export`
 * masks out of every manifest/patch/evidence/README member (placeholders
 * <HOME>/<GENOME>/<MASKED-n>). HOME and the genome repoPath are ALWAYS masked by
 * the exporter; entries here EXTEND that set — typically from the gitignored
 * *.local.jsonc overlay, keeping the committed spec machine-independent.
 */
export const bundleSectionSchema = z.strictObject({
  maskLiterals: z.array(z.string().min(1)),
});
export type BundleSection = z.infer<typeof bundleSectionSchema>;

export const genomeSpecSchema = z.strictObject({
  /** Free-form identity; genomes are distinguished by fingerprint, never by label. */
  label: z.string().min(1),
  /** Genome repo root; registry + kernel manifests live structurally OUTSIDE it. */
  repoPath: z.string().min(1),
  bench: benchSchema,
  budget: z.strictObject({
    maxCandidates: z.number().int().positive(),
    maxModelCalls: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
    maxWallS: z.number().int().positive(),
  }),
  kernel: z.strictObject({
    /** Sealed working-tree patterns; may only grow until a promote reseals. */
    immutableGlobs: z.array(z.string().min(1)),
  }),
  requires: z
    .array(
      z.strictObject({
        cmd: z.string().min(1),
        args: z.array(z.string()).optional(),
        /** Exit code that counts as "engine present" for the one-shot probe. */
        probeExit: z.number().int().nonnegative(),
      }),
    )
    .optional(),
  opencodeBinVersion: z.strictObject({ minVersion: z.string().min(1) }).optional(),
  bundle: bundleSectionSchema.optional(),
});
export type GenomeSpec = z.infer<typeof genomeSpecSchema>;

type SpecIssue = z.ZodError["issues"][number];

function keyPathOf(path: readonly PropertyKey[]): string {
  return path.length === 0 ? "<root>" : path.map(String).join(".");
}

function formatIssue(issue: SpecIssue): string {
  if (issue.code === "unrecognized_keys") {
    const listed = issue.keys.map((key) => `"${key}"`).join(", ");
    return `unknown ${issue.keys.length === 1 ? "key" : "keys"} ${listed} at "${keyPathOf(issue.path)}" — GenomeSpec is strict`;
  }
  return `invalid value at "${keyPathOf(issue.path)}": ${issue.message}`;
}

/** zod issues → one line per issue, each NAMING the offending key path (hr discipline). */
export function formatZodIssues(issues: readonly SpecIssue[]): readonly string[] {
  return issues.map(formatIssue);
}

export function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

// ------------------------------------------------ env-literal repo paths (todo 11)

/**
 * `${VAR}` repo-path literal: the abathur-self seed stores repoPath as the
 * UNRESOLVED literal `${ABATHUR_SELF_REPO}` so the spec bytes — and therefore
 * its content fingerprint and registry stem — stay machine-independent
 * (graft matching requires identical specs across machines). The env var is
 * resolved ONLY at FS boundaries, never inside the spec.
 */
const ENV_REPO_LITERAL = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

export interface EnvRepoLookup {
  readonly ABATHUR_SELF_REPO?: string | undefined;
  readonly [name: string]: string | undefined;
}

/** True when the spec stores an unresolved `${VAR}` env literal (self-genome marker). */
export function isEnvRepoLiteral(repoPath: string): boolean {
  return ENV_REPO_LITERAL.test(repoPath);
}

/** The literal itself when self, else null. */
export function envRepoName(repoPath: string): string | null {
  const match = ENV_REPO_LITERAL.exec(repoPath);
  return match?.[1] ?? null;
}

/**
 * Resolve a spec repoPath to a filesystem path. Non-literals behave exactly as
 * `path.resolve` before; `${VAR}` literals demand the env var to be set (missing
 * or empty ⇒ clean exit 2 naming the variable — never a silently-created
 * directory named `${ABATHUR_SELF_REPO}`).
 */
export function effectiveRepoPath(repoPath: string, env: EnvRepoLookup = process.env): string {
  const name = envRepoName(repoPath);
  if (name === null) return path.resolve(repoPath);
  const value = env[name];
  if (value === undefined || value.length === 0) {
    cannotAnswer(
      `genome: repoPath literal '\${${name}}' requires env var ${name} to be set (absolute path to the harness repo)`,
      `export ${name}=/path/to/abathur before running genomes that reference the harness itself`,
    );
  }
  return path.resolve(value);
}

/** Parse + strict-validate a GenomeSpec document; every failure is a clean exit 2. */
export function parseGenomeSpecDocument(document: unknown, origin: string): GenomeSpec {
  const result = genomeSpecSchema.safeParse(document);
  if (result.success) return result.data;
  cannotAnswer(
    `genome: invalid spec in ${origin}:\n  - ${formatZodIssues(result.error.issues).join("\n  - ")}`,
  );
}

/** Read a `<file>.jsonc` GenomeSpec: malformed JSONC or schema violation ⇒ exit 2. */
export function loadGenomeSpecFile(filePath: string): GenomeSpec {
  let source: string;
  try {
    source = readFileSync(filePath, "utf8");
  } catch {
    return cannotAnswer(`genome: cannot read spec file ${filePath}`);
  }
  let document: unknown;
  try {
    document = parseJsonc(source);
  } catch (cause) {
    return cannotAnswer(`genome: malformed JSONC in ${filePath}: ${errorText(cause)}`);
  }
  return parseGenomeSpecDocument(document, filePath);
}
