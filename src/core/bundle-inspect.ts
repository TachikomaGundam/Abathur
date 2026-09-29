// `abathur bundle inspect` (todo 12): treat the bundle as UNTRUSTED input. Never
// trusts manifest sha values blindly — every pinned member is re-hashed from the
// extracted bytes; the genome fingerprint and benchDigest are recomputed from the
// contained tree; the whole non-tree bundle is re-scanned for machine leaks with
// this machine's HOME/repoPath added; val-derived evidence members are rejected.
// Malformed container/manifest/digest_algo ⇒ exit 2 (cannot-answer); integrity
// failures ⇒ exit 1 naming path + expected/actual values or member:line.

import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import { blocked, cannotAnswer, EXIT_OK, type ExitCode } from "../exit.js";
import { fingerprint } from "./ids.js";
import {
  benchDigestFor,
  bundleGenIds,
  containedSpec,
  EVIDENCE_PREFIX,
  maskPlanFor,
  primaryGenId,
  treeOf,
  sha256Hex,
} from "./bundle-common.js";
import { bundleManifestSchema, DIGEST_ALGO } from "./bundle-manifest.js";
import { scanMemberLeaks } from "./bundle-mask.js";
import { readTar, type TarMember } from "./bundle-tar.js";

export interface BundleInspectRequest {
  readonly bundlePath: string;
  readonly home: string | null;
}

function loadMembers(bundlePath: string): TarMember[] {
  if (!existsSync(bundlePath)) cannotAnswer(`bundle inspect: cannot read ${bundlePath}`);
  let tarBytes: Uint8Array;
  try {
    tarBytes = new Uint8Array(gunzipSync(readFileSync(bundlePath)));
  } catch (cause) {
    return cannotAnswer(
      `bundle inspect: ${bundlePath} is not a gzip stream: ${cause instanceof Error ? cause.message.split("\n")[0] : String(cause)}`,
    );
  }
  try {
    return readTar(tarBytes);
  } catch (cause) {
    return cannotAnswer(`bundle inspect: ${bundlePath} is not a readable tar: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function parseManifest(members: readonly TarMember[]): ReturnType<typeof bundleManifestSchema.parse> {
  const raw = members.find((m) => m.path === "manifest.json");
  if (raw === undefined) cannotAnswer("bundle inspect: manifest.json missing from bundle");
  let document: unknown;
  try {
    document = JSON.parse(new TextDecoder().decode(raw.content));
  } catch (cause) {
    return cannotAnswer(`bundle inspect: manifest.json is not valid JSON: ${cause instanceof Error ? cause.message.split("\n")[0] : String(cause)}`);
  }
  const parsed = bundleManifestSchema.safeParse(document);
  if (!parsed.success) {
    cannotAnswer(`bundle inspect: manifest.json failed schema v1: ${parsed.error.issues.map((i) => `${String(i.path.join("."))}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}

function verifyPinnedMembers(members: readonly TarMember[], manifest: { files: { path: string; sha256: string; len: number }[] }): void {
  const byPath = new Map(members.map((m) => [m.path, m]));
  const pinned = new Set<string>();
  for (const f of manifest.files) {
    if (f.path === "manifest.json") blocked("bundle inspect: manifest.json must not pin itself in files[]");
    pinned.add(f.path);
    const member = byPath.get(f.path);
    if (member === undefined) blocked(`bundle inspect: pinned member '${f.path}' is missing from the bundle`);
    const actualSha = sha256Hex(member.content);
    if (actualSha !== f.sha256) blocked(`bundle inspect: ${f.path}: sha256 mismatch — expected ${f.sha256} actual ${actualSha}`);
    if (member.content.length !== f.len) blocked(`bundle inspect: ${f.path}: length mismatch — expected ${String(f.len)} actual ${String(member.content.length)}`);
  }
  for (const m of members) {
    if (m.path === "manifest.json") continue;
    if (!pinned.has(m.path)) blocked(`bundle inspect: unexpected member '${m.path}' is not pinned in manifest.files`);
  }
}

function verifyGenomes(members: readonly TarMember[], manifest: { genome: { label: string; fingerprint: string } }): string {
  const genIds = bundleGenIds(members);
  if (genIds.length === 0) cannotAnswer("bundle inspect: bundle ships no trees/<genId>/ generation content");
  for (const genId of genIds) {
    const spec = containedSpec(treeOf(members, genId), genId);
    const recomputed = fingerprint(spec);
    if (recomputed !== manifest.genome.fingerprint) {
      blocked(
        `bundle inspect: genome fingerprint mismatch — trees/${genId}/genome.jsonc fingerprints to ${recomputed}, manifest claims ${manifest.genome.fingerprint}`,
        "wrong-genome import attempt: the contained spec does not match the bundle's claimed genome",
      );
    }
    if (spec.label !== manifest.genome.label) {
      blocked(`bundle inspect: genome label mismatch in trees/${genId}/ — spec says '${spec.label}', manifest claims '${manifest.genome.label}'`);
    }
  }
  return primaryGenId(genIds);
}

function verifyBenchDigest(members: readonly TarMember[], manifest: { benchDigest: string }, primary: string): void {
  const tree = treeOf(members, primary);
  const spec = containedSpec(tree, primary);
  const recomputed = benchDigestFor(spec, tree, primary);
  if (recomputed !== manifest.benchDigest) {
    blocked(`bundle inspect: benchDigest mismatch — contained tree recomputes to ${recomputed}, manifest claims ${manifest.benchDigest}`);
  }
}

function verifyValExclusion(members: readonly TarMember[], primary: string): void {
  const spec = containedSpec(treeOf(members, primary), primary);
  const valIds = spec.bench.units.filter((u) => u.split === "val").map((u) => u.id);
  const evidenceNames = members.filter((m) => m.path.startsWith(EVIDENCE_PREFIX)).map((m) => m.path.slice(m.path.lastIndexOf("/") + 1));
  for (const valId of valIds) {
    const escaped = valId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const marker = new RegExp(`-${escaped}-\\d+\\.jsonl$`);
    const hit = evidenceNames.find((n) => marker.test(n));
    if (hit !== undefined) blocked(`bundle inspect: evidence member '${hit}' derives from VAL unit '${valId}' — bundles carry train evidence only`);
  }
}

function verifyMask(members: readonly TarMember[], home: string | null): void {
  const plans = bundleGenIds(members).map((genId) => maskPlanFor(containedSpec(treeOf(members, genId), genId), home));
  for (const m of [...members].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    if (m.path.startsWith("trees/")) continue;
    const text = new TextDecoder().decode(m.content);
    for (const plan of plans) {
      const hit = scanMemberLeaks(text, plan, home);
      if (hit !== null) blocked(`bundle inspect: leak in ${m.path}:${String(hit.line)} — "${hit.snippet}" (declared literals and machine-absolute paths must never survive in a bundle)`);
    }
  }
}

export function inspectBundle(req: BundleInspectRequest): { readonly lines: readonly string[]; readonly exitCode: ExitCode } {
  const members = loadMembers(req.bundlePath);
  const manifest = parseManifest(members);
  if (manifest.digest_algo !== DIGEST_ALGO) {
    cannotAnswer(`bundle inspect: unknown digest_algo '${manifest.digest_algo}' — this build understands '${DIGEST_ALGO}' only`);
  }
  verifyPinnedMembers(members, manifest);
  if (!members.some((m) => m.path === "patch.diff")) blocked("bundle inspect: patch.diff missing from bundle");
  const primary = verifyGenomes(members, manifest);
  verifyBenchDigest(members, manifest, primary);
  verifyValExclusion(members, primary);
  verifyMask(members, req.home);
  return {
    exitCode: EXIT_OK,
    lines: [
      `bundle inspect: OK — ${manifest.genome.label} fingerprint ${manifest.genome.fingerprint.slice(0, 16)}…`,
      `  gens: ${bundleGenIds(members).join(", ")} (primary ${primary}, parent ${manifest.parent.slice(0, 8)}…)`,
      `  ${String(manifest.files.length + 1)} members re-hashed, benchDigest + mask scan re-verified, verdict: ${manifest.stats.verdict ?? "n/a"}`,
    ],
  };
}
