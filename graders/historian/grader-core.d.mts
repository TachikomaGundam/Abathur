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

/** Post-run sandbox row + seed captures the I/J checkers diff evidence against. */
export interface IntegrityState {
  readonly sandboxRows: ReadonlyArray<{ readonly path: string; readonly id: string; readonly description: string }>;
  readonly content: Readonly<Record<string, string>>;
  readonly rowIdByPath: ReadonlyMap<string, string>;
  readonly descByPath: ReadonlyMap<string, string>;
  readonly seedDescByPath: ReadonlyMap<string, string>;
  readonly seedContent: Readonly<Record<string, string>>;
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
export const APPLICABLE: Readonly<Record<number, Readonly<Record<string, number>>>>;

export interface StatusTokens {
  readonly header: string | null;
  readonly rows: readonly string[];
}

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
