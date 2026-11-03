import { createHash } from "node:crypto";
import { ITEMS } from "./bank.mjs";

function seedToInt(seed) {
  const digest = createHash("sha256").update(String(seed)).digest();
  return digest.readUInt32BE(0);
}

function rand(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic draw. The same seed and bank produce the same order.
 * @param {{seed:string, count?:number, canary?:boolean}} options
 * @param {Array<Record<string, unknown>>} [items]
 */
export function draw(options, items = ITEMS) {
  const rng = rand(seedToInt(options.seed));
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const count = Math.min(options.count ?? pool.length, pool.length);
  const picked = pool.slice(0, count);
  if (options.canary && !picked.some((item) => item.canary)) {
    const canary = pool.find((item) => item.canary);
    if (canary) picked[picked.length - 1] = canary;
  }
  return picked.map((item) => item.id);
}

/**
 * Regression duty: a class with two consecutive PASSes is cleared; otherwise it
 * stays due. Input is a history of {class, verdict}.
 * @param {Array<{class:string, verdict:string}>} history
 */
export function regressionDuty(history) {
  const byClass = new Map();
  for (const row of history) {
    const key = row.class;
    const streak = byClass.get(key) ?? 0;
    byClass.set(key, row.verdict === "PASS" ? streak + 1 : 0);
  }
  const due = [];
  for (const [klass, streak] of byClass) {
    if (streak < 2) due.push(klass);
  }
  return due;
}
