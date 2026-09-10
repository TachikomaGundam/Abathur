// Type declarations for grader-core.mjs — the plan-185 scoring engine.
// Runtime lives in the .mjs; this file is the compile-time contract.

export type DimKey = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";
export type Bit = 0 | 1;
export type FullDims = Readonly<Record<DimKey, Bit>>;
export type WorthDims = Readonly<{ G: Bit; H: Bit; J: Bit }>;

export interface CreatedPage {
  readonly path: string;
  readonly locale: string;
  readonly title: string;
  readonly content: string;
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

export function computeDims(obs: Observation): FullDims;
export function judgment(scenarioNo: number, created: readonly CreatedPage[], finalMessage: string): Bit;
export function scoreFromDims(scenarioNo: number, dims: FullDims | WorthDims): UnitScore;
export function scoreUnit(obs: Observation): ScoredUnit;
