#!/usr/bin/env node
// Historian grader (task 14, script-first). Emits ONE JSON line on stdout —
// {unit, score, pass, metrics} — the adapter's parseGraderLine contract
// (src/bench/adapter.ts). Any unusable input exits NONZERO so the adapter
// records the unit as inconclusive (infra semantics), never as a zero score.
//
// Reads (all relative to cwd = the per-unit bench sandbox):
//   .bench/transcripts/<unitId>.jsonl  recorded `opencode run --format json`
//   .bench/wiki-pre.json               post-seed row snapshot (seed-wrapped.sh)
//   $ABATHUR_GRADER_STATE              optional offline state file {post, content, urlStatus}
// argv[1] is the unit scenario rendered by the engine as `{repoRoot}/{unit.path}`
// — the bench's ACTIVE TREE (incumbent repoPath / candidate worktree, S4 seam).
// It is read only when it exists (offline fixtures may omit it) and must agree
// with the unit id on the scenario number: disagreement means the command was
// baked against the wrong tree, so the grader exits nonzero (inconclusive).
// Live mode queries the wiki GraphQL list, fetches _sandbox page bodies, and
// (scenario 07 only) anonymously probes every reported page URL for HTTP 200.
// Integrity units (scenario-10/11/12) additionally REQUIRE .bench/seed-state.json
// (the per-unit seed capture) — without it they exit nonzero (inconclusive),
// never scoring vacuously against missing evidence.

import { readFileSync } from "node:fs";
import path from "node:path";

import { APPLICABLE, scoreUnit } from "./grader-core.mjs";
import { diffWiki, isSandboxPath, parseTranscript, scanToolEvents, scenarioNoFromUnit } from "./grader-support.mjs";

function fail(msg) {
  process.stderr.write(`grader: ${msg}\n`);
  process.exit(1);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (cause) {
    fail(`cannot read ${file}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

const [unitId, scenarioPath, wikiBase] = process.argv.slice(2);
if (unitId === undefined || unitId.length === 0 || scenarioPath === undefined) {
  fail("usage: grader.mjs <unitId> <scenarioPath> [wikiBase]");
}

let transcriptText;
let meta;
try {
  transcriptText = readFileSync(path.join(process.cwd(), ".bench", "transcripts", `${unitId}.jsonl`), "utf8");
  meta = parseTranscript(transcriptText);
} catch (cause) {
  fail(`transcript unusable: ${cause instanceof Error ? cause.message : String(cause)}`);
}

const pre = readJson(path.join(process.cwd(), ".bench", "wiki-pre.json"));
const scenarioNo = scenarioNoFromUnit(unitId);

// Active-tree scenario resolution mirrors the ABATHUR_GRADER_STATE pattern at
// the bottom of this file: the received path is authoritative, consulted only
// when the file exists. A readable scenario must carry the unit's number —
// file basename digits vs unitId digits, both Number()-normalized ("09" ⇒ 9).
function resolveScenario(id, p) {
  if (p === undefined || p.length === 0) return null;
  const abs = path.resolve(p);
  try {
    readFileSync(abs, "utf8");
  } catch {
    return null;
  }
  const fileNo = /(\d+)/.exec(path.basename(abs));
  const unitNo = /(\d+)/.exec(id);
  if (fileNo !== null && unitNo !== null && Number(fileNo[1]) !== Number(unitNo[1])) {
    fail(`scenario file ${abs} (number ${fileNo[1]}) does not match unit '${id}' (number ${unitNo[1]})`);
  }
  return abs;
}
const scenarioFile = resolveScenario(unitId, scenarioPath);
const URL_RE = /https?:\/\/\S+\/(?:en|zh)\/_sandbox\/\S+/g;

function reportedUrls(message) {
  return [...new Set((message.match(URL_RE) ?? []).map((u) => u.replace(/[),.;，。；]+$/, "")))];
}

async function liveWikiState() {
  if (wikiBase === undefined || wikiBase.length === 0) fail("wikiBase argv required outside ABATHUR_GRADER_STATE mode");
  const keyFile = process.env.ABATHUR_WIKI_KEY_FILE ?? path.join(process.env.HOME ?? "", ".wikijs-api-key");
  const token = readFileSync(keyFile, "utf8").trim();
  const base = wikiBase.replace(/\/$/, "");
  const gql = async (query, variables) => {
    const res = await fetch(`${base}/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, ...(variables === undefined ? {} : { variables }) }),
    });
    if (!res.ok) throw new Error(`graphql http ${String(res.status)}`);
    const doc = await res.json();
    if (doc.errors !== undefined) throw new Error(`graphql ${JSON.stringify(doc.errors).slice(0, 200)}`);
    return doc.data;
  };
  const list = await gql("{ pages { list { id path locale title description updatedAt } } }");
  const post = list.pages.list;
  const content = {};
  for (const row of post) {
    if (!row.path.startsWith("_sandbox/") && !row.path.startsWith("_meta/")) continue;
    const one = await gql(`{ pages { single(id: ${String(row.id)}) { id title path locale content } } }`);
    const page = one.pages.single;
    if (page !== null && page !== undefined) content[String(page.id)] = page.content ?? "";
  }
  const urlStatus = {};
  for (const url of reportedUrls(meta.finalMessage)) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      urlStatus[url] = res.status;
    } catch {
      urlStatus[url] = 0;
    }
  }
  return { post, content, urlStatus };
}

const state =
  process.env.ABATHUR_GRADER_STATE !== undefined && process.env.ABATHUR_GRADER_STATE.length > 0
    ? readJson(process.env.ABATHUR_GRADER_STATE)
    : await liveWikiState();

const diff = diffWiki({ pre, post: state.post, content: state.content, scenarioNo });
const urlChecks = Object.entries(state.urlStatus ?? {}).map(([url, status]) => ({ url, status }));
const obs = { ...diff, scenarioNo, finalMessage: meta.finalMessage, urlChecks };

// Integrity units (s10/11/12): transcript tool events + the seed capture feed
// the I/J checkers. A missing/unshaped seed-state.json exits nonzero here —
// fail-closed (inconclusive), never vacuous or guessed (task-05 G4 doctrine).
if (APPLICABLE[scenarioNo] !== undefined) {
  const seedPath = path.join(process.cwd(), ".bench", "seed-state.json");
  const seed = readJson(seedPath);
  if (!Array.isArray(seed?.rows) || seed.content === null || typeof seed.content !== "object") {
    fail(`seed-state unusable: ${seedPath} must be {rows:[], content:{}}`);
  }
  const sandboxRows = state.post
    .filter((r) => isSandboxPath(r.path))
    .map((r) => ({ path: r.path, id: String(r.id), description: String(r.description ?? "") }));
  obs.tools = scanToolEvents(transcriptText);
  obs.integrity = {
    sandboxRows,
    content: state.content,
    rowIdByPath: new Map(sandboxRows.map((r) => [r.path, r.id])),
    descByPath: new Map(sandboxRows.map((r) => [r.path, r.description])),
    seedDescByPath: new Map(seed.rows.map((r) => [r.path, String(r.description ?? "")])),
    seedContent: Object.fromEntries(seed.rows.map((r) => [String(r.id), seed.content[String(r.id)] ?? ""])),
  };
}

const result = scoreUnit(obs);

process.stdout.write(
  `${JSON.stringify({
    unit: unitId,
    score: result.score,
    pass: result.pass,
    metrics: {
      tokensEst: meta.tokensEst,
      turns: meta.turns,
      dims: result.dims,
      total: result.total,
      applicableWeight: result.applicableWeight,
      notes: result.notes,
      scenarioFile,
    },
  })}\n`,
);
