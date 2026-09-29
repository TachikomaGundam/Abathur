// Type surface for stub-mutators.mjs (runtime stays plain JS; this ships the types
// that TS consumers — todo 8/9 evolve loop and tests — import).

export interface ScriptedPatch {
  readonly id: string;
  readonly description: string;
  readonly file: string;
  readonly from: string;
  readonly to: string;
}

/** Patch shape accepted by applyPatch (subset of ScriptedPatch is enough). */
export interface PatchTarget {
  readonly file: string;
  readonly from: string;
  readonly to: string;
}

export function scriptedPatches(): ScriptedPatch[];
export function selectPatches(seed: number, count: number): ScriptedPatch[];
export function applyPatch(repoDir: string, patch: PatchTarget): boolean;
