// Pareto-frontier ranking of complete generations (plan todo 7): the human-facing
// rank list over (trainScore, tokens, wallS), deterministic per seed. Split out
// of stats.ts (pure-LOC ceiling); stats.ts re-exports seededRandom, paretoFrontier
// and the ParetoPoint type, so consumers import them from "../core/stats.js"
// unchanged.

/** mulberry32 — dependency-free deterministic PRNG for tie-breaks. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dominates(q: ParetoPoint, p: ParetoPoint): boolean {
  return q.trainScore >= p.trainScore && q.tokens <= p.tokens && q.wallS <= p.wallS && (q.trainScore > p.trainScore || q.tokens < p.tokens || q.wallS < p.wallS);
}

/**
 * Non-dominated complete candidates, ranked for the human: trainScore desc,
 * then tokens asc, then wallS asc; exact ties share a seeded rank order
 * (same seed ⇒ same order). Budget-truncated generations never enter the set.
 */
export function paretoFrontier(points: readonly ParetoPoint[], seed: number = 1): readonly string[] {
  const complete = points.filter((p) => p.complete);
  const frontier = complete.filter((p) => !complete.some((q) => dominates(q, p)));
  frontier.sort((a, b) => {
    if (a.trainScore !== b.trainScore) return b.trainScore - a.trainScore;
    if (a.tokens !== b.tokens) return a.tokens - b.tokens;
    return a.wallS - b.wallS;
  });
  const rng = seededRandom(seed);
  const ids: string[] = [];
  let i = 0;
  while (i < frontier.length) {
    let j = i + 1;
    while (
      j < frontier.length &&
      frontier[j]!.trainScore === frontier[i]!.trainScore &&
      frontier[j]!.tokens === frontier[i]!.tokens &&
      frontier[j]!.wallS === frontier[i]!.wallS
    ) {
      j += 1;
    }
    const group = frontier.slice(i, j);
    // Fisher–Yates shuffle: deterministic per seed.
    for (let k = group.length - 1; k > 0; k--) {
      const r = Math.floor(rng() * (k + 1));
      [group[k], group[r]] = [group[r] as ParetoPoint, group[k] as ParetoPoint];
    }
    for (const p of group) ids.push(p.id);
    i = j;
  }
  return ids;
}
export interface ParetoPoint {
  readonly id: string;
  readonly trainScore: number;
  readonly tokens: number;
  readonly wallS: number;
  readonly complete: boolean; // false ⇒ budget-truncated generation, never in the set
}
