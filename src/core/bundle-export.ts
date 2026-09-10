// `abathur bundle export` (todo 12): assemble a self-describing, redacted lineage
// bundle. All generation content is read from GIT OBJECTS at the gen commit
// (`git archive`, argv-only) — the worktree is never consulted, so a dirty
// worktree is impossible by construction. Stats/verdict/counters/provenance are
// copied from the LEDGER row (single source of truth); fingerprints are
// recomputed from the shipped content. Nothing reaches disk unless every member
// passes the whole-bundle leak scan; the write itself is tmp-file + rename.

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { blocked, cannotAnswer } from "../exit.js";
import { tryGit } from "../util/git.js";
import { Ledger } from "./ledger.js";
import { decodeGenerationRecord, type GenerationRowData } from "./evolve/run-rows.js";
import { LEDGER_KIND_GENERATION_COMPLETE } from "./ledger.js";
import type { RegistryEntry } from "./genome.js";
import { fingerprint } from "./ids.js";
import {
  benchDigestFor,
  containedSpec,
  EVIDENCE_CAP_BYTES,
  EVIDENCE_PREFIX,
  maskPlanFor,
  PATH_SAFE,
  primaryGenId,
  repOfRunId,

  sha256Hex,
} from "./bundle-common.js";
import { lineageEntry, renderReadme, deriveBenchProvenance, DIGEST_ALGO, BUNDLE_SCHEMA_VERSION, type BundleManifest } from "./bundle-manifest.js";
import { scanMemberLeaks, type LeakHit, type MaskPlan } from "./bundle-mask.js";
import { readTar, writeTar, type TarMember } from "./bundle-tar.js";

const COMMIT_RE = /^[0-9a-f]{7,64}$/;

export interface BundleExportRequest {
  readonly entry: RegistryEntry;
  readonly configDir: string;
  readonly select: { readonly genIds: readonly string[] } | { readonly last: number };
  readonly outDir: string;
  readonly home: string | null;
}

export interface BundleExportOutcome {
  readonly bundlePath: string;
  readonly lines: readonly string[];
}

interface GenRow {
  readonly genId: string;
  readonly data: GenerationRowData;
}

function candidateRowsByGenId(genomeRepo: string): GenRow[] {
  const latest = new Map<string, GenerationRowData>();
  for (const record of Ledger.open(genomeRepo).readAll()) {
    if (record.kind !== LEDGER_KIND_GENERATION_COMPLETE || record.genId === undefined) continue;
    const data = decodeGenerationRecord(record);
    if (data.source !== "candidate") continue;
    latest.set(record.genId, data);
  }
  return [...latest.entries()].map(([genId, data]) => ({ genId, data }));
}

function selectGens(rows: readonly GenRow[], select: BundleExportRequest["select"]): GenRow[] {
  if ("genIds" in select) {
    const byId = new Map(rows.map((r) => [r.genId, r]));
    const picked: GenRow[] = [];
    for (const id of select.genIds) {
      const row = byId.get(id);
      if (row === undefined) {
        cannotAnswer(`bundle export: no candidate generation_complete row for genId '${id}' in this ledger`, "list history with 'abathur status'");
      }
      if (!picked.some((r) => r.genId === id)) picked.push(row);
    }
    return picked;
  }
  if (!Number.isInteger(select.last) || select.last < 1) cannotAnswer(`bundle export: --last must be a positive integer, got ${String(select.last)}`);
  return rows.slice(-select.last);
}

/** Generation tree bytes via `git archive` — stdout is binary, so util/git's
 *  string contract does not apply; same argv-only + timeout + LC_ALL=C guards. */
async function gitTree(repoPath: string, genId: string, commit: string): Promise<Map<string, Uint8Array>> {
  if (!COMMIT_RE.test(commit)) cannotAnswer(`bundle export: ledger gen ${genId} carries a non-commit value '${commit}'`);
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    execFile(
      "git",
      ["-C", repoPath, "archive", "--format=tar", commit],
      { timeout: 30_000, killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024, encoding: "buffer", env: { ...process.env, LC_ALL: "C" } },
      (err, stdout) => (err === null ? resolve(new Uint8Array(stdout)) : reject(err)),
    );
  }).catch((err: unknown) => {
    const why = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return blocked(`bundle export: gen ${genId} commit ${commit} unreadable from local git: ${why}`, "fetch the gen commit before exporting");
  });
  try {
    const tree = new Map<string, Uint8Array>();
    for (const m of readTar(bytes)) {
      if (m.path === ".state" || m.path.startsWith(".state/")) continue;
      tree.set(m.path, m.content);
    }
    return tree;
  } catch (cause) {
    return blocked(`bundle export: git archive output for gen ${genId} is not readable as tar: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function findTranscript(sandboxBase: string, genId: string, dirName: string, unitId: string): string | null {
  let invs: string[];
  try {
    invs = readdirSync(sandboxBase).sort();
  } catch {
    return null;
  }
  let found: string | null = null;
  for (const inv of invs) {
    const candidate = path.join(sandboxBase, inv, genId, dirName, ".bench", "transcripts", `${unitId}.jsonl`);
    if (existsSync(candidate)) found = candidate;
  }
  return found;
}

function maskMemberText(plan: MaskPlan, text: string): Uint8Array {
  return new TextEncoder().encode(plan.mask(text));
}

export async function exportBundle(req: BundleExportRequest): Promise<BundleExportOutcome> {
  const repo = req.entry.spec.repoPath;
  const chosen = selectGens(candidateRowsByGenId(repo), req.select);
  if (chosen.length === 0) cannotAnswer("bundle export: the ledger holds no candidate generations yet", `abathur run --genome ${req.entry.spec.label} --mutator <template>`);
  for (const gen of chosen) {
    if (!PATH_SAFE.test(gen.genId)) {
      blocked(`bundle export: ledger genId '${gen.genId}' is not path-safe for member names or the output filename`, "repair or quarantine the tampered ledger row before exporting");
    }
  }
  const ids = chosen.map((c) => c.genId);
  const primary = chosen.find((c) => c.genId === primaryGenId(ids));
  if (primary === undefined) blocked("bundle export: primary generation vanished mid-export");
  const primaryRow = primary.data;
  if (primaryRow.commitSha === undefined) cannotAnswer(`bundle export: candidate row ${primary.genId} lacks commitSha`);
  if (!COMMIT_RE.test(primaryRow.headCommit)) cannotAnswer(`bundle export: candidate row ${primary.genId} carries a non-commit parent '${primaryRow.headCommit}'`);

  const trees = new Map<string, Map<string, Uint8Array>>();
  for (const gen of chosen) {
    if (gen.data.commitSha === undefined) cannotAnswer(`bundle export: candidate row ${gen.genId} lacks commitSha`);
    trees.set(gen.genId, await gitTree(repo, gen.genId, gen.data.commitSha));
  }
  const spec = containedSpec(trees.get(primary.genId) ?? new Map(), primary.genId);
  const genomeFingerprint = fingerprint(spec);
  const plan = maskPlanFor(spec, req.home);

  const members: TarMember[] = [];
  for (const [genId, tree] of [...trees.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    for (const [rel, content] of [...tree.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      members.push({ path: `trees/${genId}/${rel}`, content });
    }
  }

  const patchRun = await tryGit(["-C", repo, "diff", "--no-color", primaryRow.headCommit, primaryRow.commitSha]);
  if (!patchRun.ok) blocked(`bundle export: git diff ${primaryRow.headCommit}..${primaryRow.commitSha} failed: ${patchRun.error.stderr.split("\n")[0] ?? "git diff"}`);
  members.push({ path: "patch.diff", content: maskMemberText(plan, patchRun.stdout) });

  const lineage = {
    primary: primary.genId,
    gens: chosen.map((g) => lineageEntry(g.genId, g.data)),
  };
  members.push({ path: "lineage.json", content: maskMemberText(plan, `${JSON.stringify(lineage, null, 2)}\n`) });

  const sandboxBase = path.join(req.configDir, "bench-sandboxes");
  for (const gen of chosen) {
    for (const unit of gen.data.units) {
      if (unit.split !== "train") continue; // val evidence is structurally excluded
      for (const runId of unit.runIds) {
        const rep = repOfRunId(runId, gen.genId, unit.unitId);
        if (!PATH_SAFE.test(runId) || !PATH_SAFE.test(unit.unitId)) {
          blocked(`bundle export: runId '${runId}' is not path-safe for an evidence member name`);
        }
        const transcript = findTranscript(sandboxBase, gen.genId, `${unit.unitId}-${rep}`, unit.unitId);
        if (transcript === null) continue;
        const memberPath = `${EVIDENCE_PREFIX}${gen.genId}/${runId}.jsonl`;
        const size = statSync(transcript).size;
        if (size > EVIDENCE_CAP_BYTES) {
          blocked(`bundle export: ${memberPath} is ${String(size)} bytes — exceeds the 2 MiB/unit evidence cap; refusing (no truncation)`);
        }
        members.push({ path: memberPath, content: maskMemberText(plan, readFileSync(transcript, "utf8")) });
      }
    }
  }

  const readme = renderReadme({
    label: spec.label,
    genomeFingerprint,
    genIds: ids.slice().sort(),
    primary: lineageEntry(primary.genId, primaryRow),
    memberCount: members.length,
  });
  members.push({ path: "README.md", content: maskMemberText(plan, readme) });

  const files = [...members]
    .sort((a, b) => (a.path < b.path ? -1 : 1))
    .map((m) => ({ path: m.path, sha256: sha256Hex(m.content), len: m.content.length }));

  const manifestBody: Omit<BundleManifest, "schema_version" | "digest_algo"> = {
    genome: { label: spec.label, fingerprint: genomeFingerprint },
    parent: primaryRow.headCommit,
    benchDigest: benchDigestFor(spec, trees.get(primary.genId) ?? new Map(), primary.genId),
    benchProvenance: deriveBenchProvenance(primaryRow, spec),
    budgetCounters: primaryRow.counters,
    stats: { matrix: primaryRow.units, verdict: primaryRow.verdict ?? null },
    sealedGlobs: spec.kernel.immutableGlobs,
    files,
    rationale: primaryRow.rationale ?? "",
    frictionDigests: [],
  };
  const manifestDoc = { schema_version: BUNDLE_SCHEMA_VERSION, digest_algo: DIGEST_ALGO, ...manifestBody };
  const manifestBytes = new TextEncoder().encode(plan.mask(`${JSON.stringify(manifestDoc, null, 2)}\n`));
  const allMembers: TarMember[] = [...members, { path: "manifest.json", content: manifestBytes }];

  const leaks: string[] = [];
  for (const m of [...allMembers].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    if (m.path.startsWith("trees/")) continue; // git-object byte-truth, masked members carry the identifiers
    const hit: LeakHit | null = scanMemberLeaks(new TextDecoder().decode(m.content), plan, req.home);
    if (hit !== null) leaks.push(`${m.path}:${String(hit.line)} — "${hit.snippet}"`);
  }
  if (leaks.length > 0) {
    blocked(`bundle export: refusing to write — machine-local leak(s) detected pre-write:\n  - ${leaks.join("\n  - ")}`, "declare literals under the spec's bundle.maskLiterals or scrub the source data");
  }

  const name = `abathur-${genomeFingerprint.slice(0, 16)}-${ids.slice().sort().join("_")}.bundle.tgz`;
  mkdirSync(req.outDir, { recursive: true });
  const bundlePath = path.join(req.outDir, name);
  const { gzipSync } = await import("node:zlib");
  const tmpPath = path.join(req.outDir, `.${name}.partial-${String(process.pid)}`);
  writeFileSync(tmpPath, new Uint8Array(gzipSync(writeTar(allMembers))));
  renameSync(tmpPath, bundlePath);

  return {
    bundlePath,
    lines: [
      `bundle export: ${bundlePath}`,
      `  genome ${spec.label} fingerprint ${genomeFingerprint.slice(0, 16)}…, gens: ${ids.slice().sort().join(", ")}`,
      `  ${String(allMembers.length)} members, patch ${primaryRow.headCommit.slice(0, 8)}..${primaryRow.commitSha.slice(0, 8)}, benchDigest ${manifestBody.benchDigest.slice(0, 16)}…`,
    ],
  };
}
