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
// Live mode queries the wiki GraphQL list, fetches _sandbox page bodies, and
// (scenario 07 only) anonymously probes every reported page URL for HTTP 200.

import { readFileSync } from "node:fs";
import path from "node:path";

import { scoreUnit } from "./grader-core.mjs";
import { diffWiki, parseTranscript, scenarioNoFromUnit } from "./grader-support.mjs";

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

let meta;
try {
  meta = parseTranscript(readFileSync(path.join(process.cwd(), ".bench", "transcripts", `${unitId}.jsonl`), "utf8"));
} catch (cause) {
  fail(`transcript unusable: ${cause instanceof Error ? cause.message : String(cause)}`);
}

const pre = readJson(path.join(process.cwd(), ".bench", "wiki-pre.json"));
const scenarioNo = scenarioNoFromUnit(unitId);
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
  const list = await gql("{ pages { list { id path locale title updatedAt } } }");
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
const result = scoreUnit({ ...diff, scenarioNo, finalMessage: meta.finalMessage, urlChecks });

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
    },
  })}\n`,
);
