// Machine-identifier masking + whole-member leak scanning for lineage bundles
// (todo 12, oracle Major #7 + round-2 #4). Export masks every non-tree member at
// build; the PRE-WRITE scan over the final serialized bytes is the hard gate —
// a surviving declared literal or any generic machine-rooted absolute path
// (fail-closed, catches undeclared secrets like a wiki mount point) names the
// member + 1-based line and blocks the write.

export interface MaskLiteral {
  readonly literal: string;
  readonly placeholder: string;
}

export interface MaskPlan {
  readonly literals: readonly MaskLiteral[];
  mask(text: string): string;
}

export interface LeakHit {
  readonly literal: string;
  readonly line: number;
  readonly snippet: string;
}

export interface MaskPlanInput {
  readonly home: string | null;
  readonly repoPath: string;
  readonly extra: readonly string[];
}

/** Machine-rooted absolute-path roots; anything of the form /<root>/... surviving
 *  a masked member is treated as a leak even when it was never declared. */
const MACHINE_PATH_ROOTS = "home|root|Users|tmp|var|opt|etc|usr|srv|mnt|media|private|proc|sys";
const MACHINE_PATH_RE = new RegExp(`(?:^|[\\s"'\\\`(<=[{,:])\\/(?:${MACHINE_PATH_ROOTS})\\/`, "m");

function dedupeLiterals(entries: readonly MaskLiteral[]): MaskLiteral[] {
  const byLength = [...new Map(entries.map((e) => [e.literal, e])).values()].sort(
    (a, b) => b.literal.length - a.literal.length,
  );
  return byLength;
}

export function buildMaskPlan(input: MaskPlanInput): MaskPlan {
  const entries: MaskLiteral[] = [];
  if (input.home !== null && input.home.length > 0) entries.push({ literal: input.home, placeholder: "<HOME>" });
  entries.push({ literal: input.repoPath, placeholder: "<GENOME>" });
  input.extra.forEach((literal, i) => {
    entries.push({ literal, placeholder: `<MASKED-${String(i + 1)}>` });
  });
  const literals = dedupeLiterals(entries);
  return {
    literals,
    mask(text: string): string {
      let out = text;
      for (const { literal, placeholder } of literals) out = out.split(literal).join(placeholder);
      return out;
    },
  };
}

function firstLineOf(text: string, index: number): { line: number; snippet: string } {
  const before = text.slice(0, index);
  const nl = before.lastIndexOf("\n");
  const lineStart = nl + 1;
  let lineEnd = text.indexOf("\n", lineStart);
  if (lineEnd === -1) lineEnd = text.length;
  const raw = text.slice(lineStart, lineEnd).replace(/[^\x20-\x7e]/g, " ").trim();
  return {
    line: before.split("\n").length,
    snippet: raw.length > 120 ? `${raw.slice(0, 117)}...` : raw,
  };
}

/**
 * Scan one final serialized member body for leaks. `extraLiterals` lets inspect
 * add this machine's HOME/repoPath to the check even when the exporting machine
 * declared different maskLiterals. Returns the first hit (member scope), or null.
 */
export function scanMemberLeaks(
  text: string,
  plan: MaskPlan,
  ...extraLiterals: readonly (string | null)[]
): LeakHit | null {
  const candidates: MaskLiteral[] = [
    ...plan.literals,
    ...extraLiterals
      .filter((l): l is string => l !== null && l.length > 0)
      .map((literal) => ({ literal, placeholder: "?" })),
  ];
  let best: (LeakHit & { at: number }) | null = null;
  for (const { literal } of candidates) {
    const at = text.indexOf(literal);
    if (at === -1) continue;
    if (best === null || at < best.at) best = { literal, ...firstLineOf(text, at), at };
  }
  const machine = MACHINE_PATH_RE.exec(text);
  if (machine !== null) {
    const at = machine.index + (machine[0].startsWith("/") ? 0 : 1);
    const label = `absolute machine path ${machine[0].slice(machine[0].startsWith("/") ? 0 : 1)}`;
    if (best === null || at < best.at) best = { literal: label, ...firstLineOf(text, at), at };
  }
  return best;
}
