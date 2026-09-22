// Type declarations for grader-core.mjs — the plan-185 scoring engine.
// Runtime lives in the .mjs; this file is the compile-time contract.

import type { ToolEvent } from "./grader-support.mjs";

export type DimKey = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";
export type Bit = 0 | 1;
export type FullDims = Readonly<Record<DimKey, Bit>>;
export type WorthDims = Readonly<{ G: Bit; H: Bit; J: Bit }>;
export type IntegrityDims = Readonly<{ I: Bit; J: Bit }>;
export type IntegrityNote = string;

export interface CreatedPage {
  readonly path: string;
  readonly locale: string;
  readonly title: string;
  readonly content: string;
}

/** Post-run sandbox row + seed captures the I/J checkers diff evidence against.
 *  Twin-row units (scenario-13: one path, en+zh rows; scenario-15: the created
 *  archive twin) key the locale-aware maps `rowIdByLocalePath`/
 *  `seedRowIdByLocalePath` by `path + "\u0000" + locale`; scenario-14/15 seeds
 *  are EN-only but ride the same locale-keyed lookups. */
export interface IntegrityState {
  readonly sandboxRows: ReadonlyArray<{ readonly path: string; readonly id: string; readonly description: string; readonly locale?: string | undefined }>;
  readonly content: Readonly<Record<string, string>>;
  readonly rowIdByPath: ReadonlyMap<string, string>;
  readonly rowIdByLocalePath?: ReadonlyMap<string, string> | undefined;
  readonly descByPath: ReadonlyMap<string, string>;
  readonly seedDescByPath: ReadonlyMap<string, string>;
  readonly seedRowIdByLocalePath?: ReadonlyMap<string, string> | undefined;
  readonly seedContent: Readonly<Record<string, string>>;
  /** scenario-17 only: the parsed `.bench/judge-verdicts.json` instrument output
   *  (judge-bench blind double runs + B4 §4 arbitration rows). undefined = the
   *  file is absent (the 蜂判 legs fail CLOSED); {parseError} = unparseable. */
  readonly judgeVerdicts?: unknown;
}

export interface Observation {
  readonly scenarioNo: number;
  readonly created: readonly CreatedPage[];
  readonly updated: readonly CreatedPage[];
  readonly moved: readonly { readonly from: string; readonly to: string }[];
  readonly deletedFixturePaths: readonly string[];
  readonly outside: {
    readonly created: readonly string[];
    readonly updated: readonly string[];
    readonly deleted: readonly string[];
  };
  readonly indexUpdated: boolean;
  readonly indexContent: string;
  readonly livePaths: readonly string[];
  readonly allPaths: readonly string[];
  readonly backlinkBodies: ReadonlyArray<{ readonly path: string; readonly locale: string; readonly content: string }>;
  readonly finalMessage: string;
  readonly urlChecks: readonly { readonly url: string; readonly status: number }[];
  /** Required for integrity units (scenario-10/11/12): transcript tool events. */
  readonly tools?: readonly ToolEvent[] | undefined;
  /** Required for integrity units: seed-state-derived wiki context. */
  readonly integrity?: IntegrityState | undefined;
}

export interface UnitScore {
  readonly score: number;
  readonly pass: boolean;
  readonly total: number;
  readonly applicableWeight: number;
}

export type ScoredUnit = UnitScore & {
  readonly dims: Readonly<Record<string, Bit>>;
  readonly notes: readonly string[];
};

export const WEIGHTS: Readonly<Record<DimKey, number>>;

export const S10_PATH: string;
export const S10_DECOY: string;
export const S11_CARD: string;
export const S11_SUPERSEDE: string;
export const S11_SEED_DATE: string;
export const VERIFY_TOKEN: string;
export const S12_JUNK: readonly string[];
export const S12_DECOY: readonly string[];
export const S13_RUNBOOK: string;
export const S13_DECOY: string;
export const S13_FAB_STAMP: string;
export const S13_FAB_MIGRATE: string;
export const S14_HUB: string;
export const S14_OPS: string;
export const S14_DUP_A: string;
export const S14_DUP_B: string;
export const S14_ORPHAN: string;
export const S14_DECOY: string;
export const S14_GHOST_A: string;
export const S14_GHOST_B: string;
export const S15_HUB: string;
export const S15_LEGACY: string;
export const S15_INCIDENT: string;
export const S15_DORMANT: string;
export const S15_ARCHIVE: string;
export const S15_TOKEN: string;
export const S16_HUB: string;
export const S16_EXEMPLAR: string;
export const S16_BAIT: string;
export const S16_PAGE: string;
export const S17_HUB: string;
export const S17_SOURCE: string;
export const S17_BAIT: string;
export const S17_PAGE: string;
export const S17_JUDGE_RUBRICS: readonly string[];
export const S17_JUDGE_LOCALES: readonly string[];
export const S18_HUB: string;
export const S18_GUIDE: string;
export const S18_DECOY: string;
export const S18_PAGE: string;
export const S18_GROUND: string;
export const S18_STEP2: string;
export const APPLICABLE: Readonly<Record<number, Readonly<Record<string, number>>>>;

/** Doctrine machine-line verdict (scenario-16): deterministic check result. */
export interface DoctrineCheck {
  readonly ok: boolean;
  readonly why?: string | undefined;
  readonly exempt?: boolean | undefined;
}

export interface DoctrineSignature {
  readonly h: number;
  readonly t: number;
  readonly c: number;
  readonly b: number;
}

/** (A) R1 形态门 — S1 stamp-form closed set, pre-first-H2 block, cap-5 tail. */
export function s16R1FormGate(content: string): DoctrineCheck;
/** (B) R2 — cell ≤120 chars, rendered row ≤120 cols, >20 rows need a grouping row. */
export function s16R2Tables(content: string): DoctrineCheck;
/** (C) R3 — emphasis spans per 2000 narrative non-ws chars, en ≤22 / zh ≤35. */
export function s16R3Emphasis(content: string, locale: string): DoctrineCheck;
/** (D) R9 — trailer dangling / normalized long-line repeat / placeholder closed set. */
export function s16R9Hygiene(content: string, region?: "page" | "trailer"): DoctrineCheck;
/** (E) R5 — twin structure signature (h, t, c, b), per-axis deviation cap. */
export function s16Signature(content: string): DoctrineSignature;
export function s16R5TwinParity(enBody: string, zhBody: string): DoctrineCheck;

export interface StatusTokens {
  readonly header: string | null;
  readonly rows: readonly string[];
}

/** Deterministic fold over `.bench/judge-verdicts.json` (scenario-17 蜂判 lines).
 *  coverageOk = the expected (rubric × locale) key set is fully double-run covered
 *  (2 ok reps, rep3 when the two disagree), malformed rows excluded-with-count;
 *  allOne = every expected key resolves to a majority 1. Absent/unparseable input
 *  fails both closed. Pure — no LLM, no IO. */
export interface JudgeFold {
  readonly coverageOk: boolean;
  readonly allOne: boolean;
  readonly coverageNotes: readonly string[];
  readonly foldNotes: readonly string[];
  readonly majority: ReadonlyMap<string, 0 | 1>;
}
export function s17FoldJudgeVerdicts(verdicts: unknown, page?: string): JudgeFold;

export interface IntegrityResult extends IntegrityDims {
  readonly notes: readonly IntegrityNote[];
}

export function computeDims(obs: Observation): FullDims;
export function judgment(scenarioNo: number, created: readonly CreatedPage[], finalMessage: string): Bit;
export function scoreFromDims(scenarioNo: number, dims: FullDims | WorthDims): UnitScore;
export function scoreUnit(obs: Observation): ScoredUnit;
export function statusTokens(content: string): StatusTokens;
/** Parse a tool event's output as JSON, following opencode's >45KB externalization
 *  stubs (`Full output saved to: <ref>`) to the ref file. Fail-closed: undefined
 *  when neither the inline output nor the referenced file parses. */
export function resolveToolJson(event: ToolEvent): unknown;
export function integrityDims(scenarioNo: number, obs: Observation, tools: readonly ToolEvent[], integrity: IntegrityState): IntegrityResult;
