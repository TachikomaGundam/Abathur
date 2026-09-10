// Deterministic scripted-patch mutator STUB (plan todo 5). Model-free candidate
// generator for the toy substrate: a fixed table of textual patches, seedable
// selection (mulberry32 + Fisher-Yates — same seed, same order, always), and an
// all-or-nothing single-occurrence apply. todo 8/9 consume this via the mutator
// interface; real LLM-driven mutators replace the table later, the selection
// contract stays.
//
// Patch semantics: `from` must occur EXACTLY ONCE in <repoDir>/<file> or applyPatch
// refuses (returns false, writes nothing) — ambiguous rewrites are how silent
// corruption starts.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** @type {ReadonlyArray<{id: string, description: string, file: string, from: string, to: string}>} */
const SCRIPTED_PATCHES = [
  {
    id: "fix-add",
    description: "seeded-bug fix: add() must sum, not subtract",
    file: "units/add.mjs",
    from: "return a - b; // seeded bug: must be `return a + b;`",
    to: "return a + b;",
  },
  {
    id: "break-mul",
    description: "harmful mutation: mul gains a spurious +a term",
    file: "units/mul.mjs",
    from: "return a * b;",
    to: "return a * b + a;",
  },
  {
    id: "break-sub",
    description: "harmful mutation: sub() flips sign",
    file: "units/sub.mjs",
    from: "return a - b;",
    to: "return a + b;",
  },
  {
    id: "annotate-add",
    description: "benign mutation: cosmetic marker inside add()'s signature",
    file: "units/add.mjs",
    from: "export function add(",
    to: "export function add /* patched */(",
  },
];

/** Every scripted patch, in stable declaration order (a copy — callers may sort). */
export function scriptedPatches() {
  return SCRIPTED_PATCHES.slice();
}

/**
 * Deterministically select up to `count` patches for `seed`: seeded shuffle of the
 * table, then slice. Same (seed, count) => element-wise identical arrays.
 * @param {number} seed non-negative integer
 * @param {number} count desired patch count, clamped into [0, table length]
 */
export function selectPatches(seed, count) {
  if (!Number.isInteger(seed) || seed < 0) {
    throw new TypeError(`selectPatches: seed must be an integer >= 0, got ${String(seed)}`);
  }
  if (!Number.isInteger(count) || count < 0) {
    throw new TypeError(`selectPatches: count must be an integer >= 0, got ${String(count)}`);
  }
  const items = SCRIPTED_PATCHES.slice();
  const rand = mulberry32(seed >>> 0);
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const swap = /** @type {const} */ ([items[i], items[j]]);
    items[j] = swap[0];
    items[i] = swap[1];
  }
  return items.slice(0, Math.min(count, items.length));
}

/**
 * Apply one patch under repoDir (accepts a patch from scriptedPatches/selectPatches
 * or any same-shaped object). Returns true on success; false — with NOTHING written —
 * when the file is missing, `from` is absent, or it occurs more than once.
 * @param {string} repoDir
 * @param {{file: string, from: string, to: string}} patch
 * @returns {boolean}
 */
export function applyPatch(repoDir, patch) {
  if (typeof patch.from !== "string" || patch.from.length === 0) return false;
  const file = path.join(repoDir, patch.file);
  if (!existsSync(file)) return false;
  const text = readFileSync(file, "utf8");
  const first = text.indexOf(patch.from);
  if (first === -1) return false;
  if (text.indexOf(patch.from, first + 1) !== -1) return false; // ambiguous
  writeFileSync(file, `${text.slice(0, first)}${patch.to}${text.slice(first + patch.from.length)}`, "utf8");
  return true;
}

/** Classic mulberry32 PRNG — 32-bit state, tiny, stable across engines. */
function mulberry32(a) {
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
