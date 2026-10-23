// Pure helpers behind the fixture-scenarios adapter (todo 6): semver probing,
// the sandbox HOME mirror (copy-only, never symlink), the val-hiding scenario
// manifest, and run-metadata parsing. No process state, no zod — everything is
// deterministic given its inputs so reset→seed digests replay exactly.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { cannotAnswer } from "../exit.js";
import { canonicalJson } from "../core/ids.js";
import { parseJsonc } from "../jsonc.js";
import type { BenchUnit } from "../core/spec.js";
import type { RunMetrics } from "./adapter.js";

// ------------------------------------------------------------------ semver

export interface SemverVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly pre: string | null;
}

const SEMVER = /v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/;

export function parseSemver(text: string): SemverVersion | null {
  const m = SEMVER.exec(text);
  if (m === null) return null;
  const pre = m[4];
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: pre === undefined || pre.length === 0 ? null : pre,
  };
}

/** First line carrying a semver, as {raw, version}; raw is the whole trimmed line. */
export function semverFromText(text: string): { raw: string; version: SemverVersion } | null {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const version = parseSemver(trimmed);
    if (version !== null) return { raw: trimmed, version };
  }
  return null;
}

export function compareSemver(a: SemverVersion, b: SemverVersion): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (a.pre === b.pre) return 0;
  if (a.pre === null) return 1;
  if (b.pre === null) return -1;
  return a.pre < b.pre ? -1 : 1;
}

// ------------------------------------------------------------- sandbox HOME

export const SANDBOX_HOME_DIRNAME = ".sandbox-home";
export const BENCH_DIRNAME = ".bench";

/** Only this .opencode subset is mirrored from the real HOME (plan line 120). */
const OPENCODE_SUBDIRS = ["plugin", "skills", "node_modules"] as const;

export function sandboxHomeDir(sandboxDir: string): string {
  return path.join(sandboxDir, SANDBOX_HOME_DIRNAME);
}

export function benchDir(sandboxDir: string): string {
  return path.join(sandboxDir, BENCH_DIRNAME);
}

export function transcriptPathFor(sandboxDir: string, unitId: string): string {
  return path.join(benchDir(sandboxDir), "transcripts", `${unitId}.jsonl`);
}

function copyDirIfExists(src: string, dst: string): void {
  if (!statSync(src, { throwIfNoEntry: false })?.isDirectory()) return;
  try {
    mkdirSync(path.dirname(dst), { recursive: true });
    cpSync(src, dst, { recursive: true, dereference: true });
  } catch (cause) {
    cannotAnswer(
      `fixture: cannot mirror sandbox home entry '${src}': ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

function readConfigBase(file: string): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return {};
  }
  try {
    const doc: unknown = file.endsWith(".jsonc") ? parseJsonc(text) : JSON.parse(text);
    if (typeof doc === "object" && doc !== null && !Array.isArray(doc)) {
      return doc as Record<string, unknown>;
    }
  } catch {
    // the copied config is the user's own malformed file: reset it to the mutation
  }
  return {};
}

/**
 * Rebuild <sandbox>/.sandbox-home: .opencode/{plugin,skills,node_modules} copied from
 * the real HOME, plus a COPY of the user's opencode config mutated with the scenario's
 * agent model (never a symlink; real HOME is read-only for this adapter).
 */
export function mirrorSandboxHome(home: string, sandboxDir: string, agentModel: string): void {
  const sbHome = sandboxHomeDir(sandboxDir);
  rmSync(sbHome, { recursive: true, force: true });
  mkdirSync(sbHome, { recursive: true });
  const srcOpen = path.join(home, ".opencode");
  for (const sub of OPENCODE_SUBDIRS) {
    copyDirIfExists(path.join(srcOpen, sub), path.join(sbHome, ".opencode", sub));
  }
  const srcCfg = path.join(home, ".config", "opencode");
  const dstCfg = path.join(sbHome, ".config", "opencode");
  copyDirIfExists(srcCfg, dstCfg);
  mkdirSync(dstCfg, { recursive: true });
  const jsonFile = path.join(dstCfg, "opencode.json");
  const jsoncFile = path.join(dstCfg, "opencode.jsonc");
  const base = existsSync(jsonFile)
    ? readConfigBase(jsonFile)
    : existsSync(jsoncFile)
      ? readConfigBase(jsoncFile)
      : {};
  base["model"] = agentModel;
  writeFileSync(jsonFile, `${canonicalJson(base)}\n`, "utf8");
}

// ---------------------------------------------------- scenario manifest (val)

export interface ScenarioEntry {
  readonly alias: string;
  readonly split: BenchUnit["split"];
  readonly id?: string | undefined;
  readonly path?: string | undefined;
}

/**
 * Mutator-facing view: val scenarios appear as opaque aliases only — their id and
 * path never enter the output unless the operator asked with includeVal.
 */
export function buildManifest(units: readonly BenchUnit[], includeVal: boolean): readonly ScenarioEntry[] {
  return units.map((unit, index) => {
    const alias = `scenario-${String(index + 1).padStart(2, "0")}`;
    if (unit.split === "val" && !includeVal) return { alias, split: "val" as const };
    return { alias, split: unit.split, id: unit.id, path: unit.path };
  });
}

export function manifestPathFor(sandboxDir: string): string {
  return path.join(benchDir(sandboxDir), "manifest.json");
}

export function writeManifest(sandboxDir: string, entries: readonly ScenarioEntry[]): void {
  mkdirSync(benchDir(sandboxDir), { recursive: true });
  writeFileSync(
    manifestPathFor(sandboxDir),
    `${canonicalJson({ benchType: "opencode-fixture-scenarios", scenarios: entries })}\n`,
    "utf8",
  );
}

/**
 * Train/val discrimination is by SPLIT FIELD ONLY. allowVal = the caller's
 * benching permission: operator includeVal OR the loop's internal
 * loopValAuthority (see FixtureAdapterOptions; F1-fix2).
 */
export function gateVal(unit: BenchUnit, allowVal: boolean): void {
  if (unit.split === "val" && !allowVal) {
    cannotAnswer(
      `fixture: unit '${unit.id}' is a val-split scenario and requires the operator flag --include-val`,
      "the evolution loop benches val replicates under its internal loopValAuthority; this refusal is for a direct adapter consumer that never opted in — pass includeVal (CLI: 'abathur run --include-val', which additionally EXPOSES val ids/paths in the manifest)",
    );
  }
}

// ---------------------------------------------------------------- run meta

/**
 * Run-metadata contract: the fake/real runner may append a final JSON line
 * {tokensEst?, turns?}; garbage or absence degrades to zeroed metrics, never a crash.
 */
export function parseRunMeta(stdoutText: string): RunMetrics {
  const last = stdoutText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .at(-1);
  if (last === undefined) return { tokensEst: 0, turns: 0 };
  let doc: unknown;
  try {
    doc = JSON.parse(last);
  } catch {
    return { tokensEst: 0, turns: 0 };
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return { tokensEst: 0, turns: 0 };
  const record = doc as Record<string, unknown>;
  const count = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
  return { tokensEst: count(record["tokensEst"]), turns: count(record["turns"]) };
}
