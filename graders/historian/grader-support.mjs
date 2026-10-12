// Pure IO-side helpers for the historian grader (task 14, script-first).
// No network here: parseTranscript turns recorded `opencode run --format json`
// events into run metrics; diffWiki turns pre/post wiki row snapshots into the
// Observation the scoring core consumes. Both are deterministic given inputs.

/** A wiki page row as returned by the GraphQL list/`pages.single` probes. */
export function isSandboxPath(p) {
  return p === "_sandbox" || p.startsWith("_sandbox/");
}

const INDEX_PATH = "_sandbox/index";

/**
 * Parse an opencode JSONL transcript (plan §todo6 protocol). Throws on garbage:
 * the grader must exit nonzero so the ADAPTER records the unit as inconclusive
 * (infra_failed semantics), never as a zero score.
 */
export function parseTranscript(text) {
  const events = [];
  let sawContent = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    let doc;
    try {
      doc = JSON.parse(line);
    } catch {
      throw new Error(`transcript line is not JSON: ${line.slice(0, 120)}`);
    }
    if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
      throw new Error(`transcript line is not a JSON object: ${line.slice(0, 120)}`);
    }
    sawContent = true;
    events.push(doc);
  }
  if (!sawContent) throw new Error("transcript is empty");
  let turns = 0;
  let tokensEst = 0;
  let finalMessage = "";
  for (const ev of events) {
    const part = typeof ev.part === "object" && ev.part !== null ? ev.part : {};
    if (ev.type === "step_finish" || part.type === "step-finish") {
      turns += 1;
      const total = part.tokens !== null && typeof part.tokens === "object" ? part.tokens.total : undefined;
      if (typeof total === "number" && Number.isFinite(total) && total >= 0) tokensEst += total;
    }
    if (ev.type === "text" && typeof part.text === "string") finalMessage = part.text;
  }
  if (turns === 0) throw new Error("transcript has no step_finish event — run never completed");
  return { finalMessage, tokensEst, turns, eventCount: events.length };
}

/** "scenario-07" | "07" | path tail "07-..." ⇒ 7 (NaN on nothing numeric). */
export function scenarioNoFromUnit(unitId) {
  const m = /(\d+)/.exec(unitId);
  if (m === null) throw new Error(`cannot derive scenario number from unit '${unitId}'`);
  return Number(m[1]);
}

/**
 * opencode --format json tool events, in transcript order. Tolerant: garbage
 * lines skipped (malformed_input ⇒ missing evidence scores 0, never crashes).
 * Verbatim port of the task-05 proposal (historian baseline/grader-proposal/
 * proposed-core.mjs) — unlike parseTranscript this must NOT throw: the I/J
 * dims read it for evidence and absence of evidence scores 0.
 */
export function scanToolEvents(text) {
  const out = [];
  for (const [i, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (line.length === 0) continue;
    let doc;
    try { doc = JSON.parse(line); } catch { continue; }
    const part = doc?.part;
    if (part?.type !== "tool") continue;
    const state = part.state ?? {};
    out.push({
      index: i,
      tool: String(part.tool ?? ""),
      status: String(state.status ?? ""),
      input: state.input ?? {},
      output: typeof state.output === "string" ? state.output : JSON.stringify(state.output ?? ""),
    });
  }
  return out;
}

function lastSegment(p) {
  const segs = p.split("/");
  return segs[segs.length - 1] ?? p;
}

function touched(row, content) {
  return {
    path: row.path,
    locale: row.locale,
    title: row.title ?? lastSegment(row.path),
    content: content[String(row.id)] ?? "",
  };
}

/**
 * Diff the post-seed snapshot (written by seed-wrapped.sh) against the live
 * post-run row list. `content` maps page id → markdown body for every page the
 * grader fetched (created/updated/_sandbox bodies). scenario 09 is read-only:
 * its single sanctioned side effect — refreshing `_meta/page-map` — never
 * counts as an outside-sandbox write.
 */
export function diffWiki({ pre, post, content, scenarioNo }) {
  const preById = new Map(pre.map((r) => [r.id, r]));
  const postById = new Map(post.map((r) => [r.id, r]));
  const created = [];
  const updated = [];
  const moved = [];
  const deletedFixturePaths = [];
  const outside = { created: [], updated: [], deleted: [] };

  const outsideUpdatedAllowed = new Set(scenarioNo === 9 ? ["_meta/page-map"] : []);

  for (const row of post) {
    if (preById.has(row.id)) continue;
    if (isSandboxPath(row.path)) created.push(touched(row, content));
    else outside.created.push(row.path);
  }
  for (const row of pre) {
    if (postById.has(row.id)) continue;
    if (isSandboxPath(row.path)) deletedFixturePaths.push(row.path);
    else outside.deleted.push(row.path);
  }
  for (const row of post) {
    const old = preById.get(row.id);
    if (old === undefined || old.path === row.path) continue;
    if (isSandboxPath(row.path) || isSandboxPath(old.path)) moved.push({ from: old.path, to: row.path });
    else outside.updated.push(row.path);
  }
  let indexUpdated = false;
  for (const row of post) {
    const old = preById.get(row.id);
    if (old === undefined || old.path !== row.path || old.updatedAt === row.updatedAt) continue;
    if (row.path === INDEX_PATH && row.locale === "en") {
      indexUpdated = true;
      continue;
    }
    if (!isSandboxPath(row.path)) {
      if (!outsideUpdatedAllowed.has(row.path)) outside.updated.push(row.path);
      continue;
    }
    updated.push(touched(row, content));
  }
  // A deleted-and-recreated index is an index update, not a fixture deletion.
  const recreatedIndex = created.find((c) => c.path === INDEX_PATH && c.locale === "en");
  if (recreatedIndex !== undefined && deletedFixturePaths.includes(INDEX_PATH)) {
    deletedFixturePaths.splice(deletedFixturePaths.indexOf(INDEX_PATH), 1);
    created.splice(created.indexOf(recreatedIndex), 1);
    indexUpdated = true;
  }
  const indexRow = post.find((r) => r.path === INDEX_PATH && r.locale === "en");
  const indexContent = indexRow === undefined ? "" : (content[String(indexRow.id)] ?? "");
  const livePaths = [...new Set(post.filter((r) => isSandboxPath(r.path)).map((r) => r.path))];
  const allPaths = [...new Set(post.map((r) => r.path))];
  const backlinkBodies = post
    .filter((r) => isSandboxPath(r.path) && r.path !== INDEX_PATH && content[String(r.id)] !== undefined)
    .map((r) => ({ path: r.path, locale: r.locale, content: content[String(r.id)] ?? "" }));
  return { created, updated, moved, deletedFixturePaths, outside, indexUpdated, indexContent, livePaths, allPaths, backlinkBodies };
}
