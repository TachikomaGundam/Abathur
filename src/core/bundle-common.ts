// Shared lineage-bundle plumbing (todo 12): tree access, contained-spec parsing,
// benchDigest reconstruction and mask-plan construction — one implementation so
// export and inspect can never drift apart.

import { createHash } from "node:crypto";

import { cannotAnswer } from "../exit.js";
import { parseJsonc } from "../jsonc.js";
import { benchDigest, type BenchDigestScript, type BenchDigestUnit } from "./ids.js";
import { genomeSpecSchema, type GenomeSpec } from "./spec.js";
import { buildMaskPlan, type MaskPlan } from "./bundle-mask.js";
import type { TarMember } from "./bundle-tar.js";

export const EVIDENCE_CAP_BYTES = 2 * 1024 * 1024;
export const TREES_PREFIX = "trees/";
export const EVIDENCE_PREFIX = "evidence/";

export const sha256Hex = (data: Uint8Array | string): string =>
  createHash("sha256").update(data).digest("hex");

/** trees/<genId>/... member paths → the generation ids shipped in this bundle. */
export function bundleGenIds(members: readonly TarMember[]): string[] {
  const ids = new Set<string>();
  for (const m of members) {
    if (!m.path.startsWith(TREES_PREFIX)) continue;
    const rest = m.path.slice(TREES_PREFIX.length);
    const slash = rest.indexOf("/");
    if (slash > 0) ids.add(rest.slice(0, slash));
  }
  return [...ids].sort();
}

/** The primary generation — lexicographically greatest genId (ids embed a UTC
 *  timestamp, so this is the newest). Export and inspect share this rule. */
export function primaryGenId(genIds: readonly string[]): string {
  const primary = [...genIds].sort().at(-1);
  if (primary === undefined) cannotAnswer("bundle: no trees/<genId>/ generation content inside");
  return primary;
}

/** Rel-path → bytes map for one generation's tree members. */
export function treeOf(members: readonly TarMember[], genId: string): Map<string, Uint8Array> {
  const prefix = `${TREES_PREFIX}${genId}/`;
  const tree = new Map<string, Uint8Array>();
  for (const m of members) if (m.path.startsWith(prefix)) tree.set(m.path.slice(prefix.length), m.content);
  return tree;
}

export function parseSpecMember(bytes: Uint8Array, origin: string): GenomeSpec {
  let document: unknown;
  try {
    document = parseJsonc(new TextDecoder().decode(bytes));
  } catch (cause) {
    return cannotAnswer(`bundle: malformed JSONC in ${origin}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const parsed = genomeSpecSchema.safeParse(document);
  if (!parsed.success) {
    cannotAnswer(`bundle: ${origin} is not a valid GenomeSpec: ${String(parsed.error.issues[0]?.message ?? "schema")}`);
  }
  return parsed.data;
}

export function containedSpec(tree: Map<string, Uint8Array>, genId: string): GenomeSpec {
  const specBytes = tree.get("genome.jsonc");
  if (specBytes === undefined) cannotAnswer(`bundle: trees/${genId}/genome.jsonc missing — cannot self-describe the genome`);
  return parseSpecMember(specBytes, `trees/${genId}/genome.jsonc`);
}

const SCRIPT_TOKEN = /^[A-Za-z0-9._/-]+\.(?:mjs|cjs|js|py|sh)$/;

/** File-operand tokens of a command template that exist in the generation tree.
 *  {placeholder} tokens never match, so unit paths stay out. */
export function commandScriptPaths(template: string): string[] {
  return template
    .split(/\s+/)
    .map((tok) => tok.replace(/^["']|["'],?$/g, ""))
    .filter((tok) => SCRIPT_TOKEN.test(tok) && !tok.includes("{"));
}

export function benchScriptsFor(spec: GenomeSpec, tree: Map<string, Uint8Array>): BenchDigestScript[] {
  const templates = [spec.bench.graderCommand, spec.bench.seedCommand, spec.bench.resetCommand];
  const byPath = new Map<string, BenchDigestScript>();
  for (const template of templates) {
    if (template === undefined) continue;
    for (const p of commandScriptPaths(template)) {
      const content = tree.get(p);
      if (content !== undefined && !byPath.has(p)) byPath.set(p, { path: p, content });
    }
  }
  return [...byPath.values()];
}

/** benchDigest recomputed from a generation's contained tree + spec (shared by
 *  export "recompute at build" and inspect "re-verify"). */
export function benchDigestFor(spec: GenomeSpec, tree: Map<string, Uint8Array>, genId: string): string {
  const units: BenchDigestUnit[] = spec.bench.units.map((unit) => {
    const content = tree.get(unit.path);
    if (content === undefined) cannotAnswer(`bundle: bench unit '${unit.id}' file '${unit.path}' absent from trees/${genId}/`);
    return { unitId: unit.id, content };
  });
  return benchDigest({
    units,
    scripts: benchScriptsFor(spec, tree),
    graderCommand: spec.bench.graderCommand,
    runCommand: spec.bench.runCommand,
    ...(spec.bench.judgeCommand === undefined ? {} : { judgeCommand: spec.bench.judgeCommand }),
    ...(spec.bench.agentModel === undefined ? {} : { agentModel: spec.bench.agentModel }),
    ...(spec.bench.judgeModel === undefined ? {} : { judgeModel: spec.bench.judgeModel }),
    timeoutS: spec.bench.timeoutS,
  });
}

export function maskPlanFor(spec: GenomeSpec, home: string | null): MaskPlan {
  return buildMaskPlan({ home, repoPath: spec.repoPath, extra: spec.bundle?.maskLiterals ?? [] });
}

/** A runId is r-<genId>-<unitId>-<rep>; recover the rep and validate path safety. */
export function repOfRunId(runId: string, genId: string, unitId: string): string {
  const prefix = `r-${genId}-${unitId}-`;
  const rep = runId.startsWith(prefix) ? runId.slice(prefix.length) : "";
  if (!/^\d+$/.test(rep)) {
    cannotAnswer(`bundle: ledger runId '${runId}' does not match unit '${unitId}' of gen ${genId}`);
  }
  return rep;
}

export const PATH_SAFE = /^[A-Za-z0-9._-]+$/;
