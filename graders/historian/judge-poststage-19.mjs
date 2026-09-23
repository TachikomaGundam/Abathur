#!/usr/bin/env node
/**
 * judge-poststage-19.mjs — scenario-19 蜂判 run-stage poststage (deterministic
 * plumbing, zero deps, argv-only spawns).
 *
 * Clone-and-parameterize of judge-poststage.mjs (which stays byte-frozen under
 * its own tests): same certified instrument (judge-bench.mjs pair/matrix, blind
 * double runs, B4 §4 arbitration, fail-closed exit-2 contract), two shape
 * changes demanded by the s19 架构法:
 *   1. PAGE SET — `--page <path>=<locale>` is REPEATABLE: s19 judges the two
 *      created pages (dossier en + summary zh), each as a STANDALONE page.
 *      The R6-termb certificate covers the single-page UNTRUSTED DATA input
 *      shape only, so bodies are staged as separate neutral files and judged
 *      row-per-page — never concatenated into one multi-page doc.
 *   2. RUBRICS LIST — defaults to the certified rubrics/R6-termb.md alone
 *      (verbatim reuse; the instrument bytes are the certification object).
 * Offline fixture runs: `--file <label>=<path.md>`, label = index into the
 * ordered --page specs (label-first keeps the `=`-bearing page=locale spec from
 * colliding with the file path on a naive split).
 *
 * Usage:
 *   node judge-poststage-19.mjs --page _sandbox/eval19/warm-pool-dossier=en \
 *       --page _sandbox/eval19/warm-pool-summary=zh \
 *       --wiki-base http://localhost:3000 [--out .bench/judge-verdicts.json] \
 *       [--ledger .bench/judge-ledger.jsonl] [--reps 2] [--sleep-s 2] \
 *       [--timeout-s 240] [--model local-qwen/qwen3.8-flash-next] \
 *       [--rubrics a.md,b.md] [--bench judge-bench.mjs]
 *   node judge-poststage-19.mjs --page P=en --page Q=zh --files 0=p.md,1=q.md
 *   (offline legs are labelled by page-spec index or by the wiki path)
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULTS = {
  bench: "/home/lab/workspace/harness/historian/.omo/evidence/judge-bench/judge-bench.mjs",
  rubrics: ["/home/lab/workspace/harness/historian/.omo/evidence/judge-bench/rubrics/R6-termb.md"],
  model: "local-qwen/qwen3.8-flash-next",
};

function parseArgs(argv) {
  const o = { ...DEFAULTS, rubrics: [...DEFAULTS.rubrics], out: path.join(".bench", "judge-verdicts.json"), ledger: null, reps: 2, sleepS: 2, timeoutS: 240, specs: [], wikiBase: null, files: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const need = () => { i += 1; if (i >= argv.length) throw new Error(`${a} needs a value`); return argv[i]; };
    if (a === "--page") {
      const v = need();
      const eq = v.lastIndexOf("=");
      if (eq <= 0 || eq === v.length - 1) throw new Error(`--page wants <path>=<locale>, got: ${v}`);
      o.specs.push({ path: v.slice(0, eq), locale: v.slice(eq + 1) });
    }
    else if (a === "--wiki-base") o.wikiBase = need();
    else if (a === "--files") o.files = need();
    else if (a === "--rubrics") o.rubrics = need().split(",").filter(Boolean);
    else if (a === "--bench") o.bench = need();
    else if (a === "--model") o.model = need();
    else if (a === "--out") o.out = need();
    else if (a === "--ledger") o.ledger = need();
    else if (a === "--reps") o.reps = Number(need());
    else if (a === "--sleep-s") o.sleepS = Number(need());
    else if (a === "--timeout-s") o.timeoutS = Number(need());
    else throw new Error(`unknown arg: ${a}`);
  }
  if (o.specs.length === 0) throw new Error("need at least one --page <path>=<locale>");
  if (new Set(o.specs.map((s) => `${s.path}|${s.locale}`)).size !== o.specs.length) throw new Error("duplicate --page specs");
  if (o.wikiBase === null && o.files === null) throw new Error("need --wiki-base <url> (live) or --files <label>=<f>,... (offline fixtures)");
  if (Number.isNaN(o.reps) || o.reps < 2) throw new Error("--reps must be ≥2 (盲评双跑 is the certified mode)");
  if (o.files !== null) {
    const parts = o.files.split(",");
    const dup = new Set(parts.map((p) => p.split("=")[0]));
    if (dup.size !== parts.length) throw new Error("--files has duplicate labels");
    if (parts.length > o.specs.length) throw new Error(`--files carries ${String(parts.length)} legs for ${String(o.specs.length)} pages`);
  }
  return o;
}

const t0 = Date.now();
const log = (m) => process.stderr.write(`[judge-poststage-19] ${m}\n`);

async function fetchLocaleBody(base, pagePath, locale) {
  const token = readFileSync(path.join(process.env.HOME ?? "", ".wikijs-api-key"), "utf8").trim();
  const gql = async (query) => {
    const res = await fetch(`${base.replace(/\/$/, "")}/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`graphql http ${String(res.status)}`);
    const doc = await res.json();
    if (doc.errors !== undefined) throw new Error(`graphql ${JSON.stringify(doc.errors).slice(0, 200)}`);
    return doc.data;
  };
  const list = (await gql("{ pages { list { id path locale } } }")).pages.list;
  const row = list.find((r) => r.path === pagePath && String(r.locale ?? "en") === locale);
  if (row === undefined) return null;
  const one = (await gql(`{ pages { single(id: ${String(row.id)}) { content } } }`)).pages.single;
  return one === null ? null : String(one.content ?? "");
}

function runBench(bench, args) {
  // argv-only spawn (no shell), same contract as judge-bench's own isolation.
  return execFileSync(process.execPath, [bench, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}

function ledgerRows(ledgerPath) {
  try {
    return readFileSync(ledgerPath, "utf8").split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function foldMajority(row) {
  const okRep = (rep, repNo) => rep !== null && rep !== undefined && rep.rep === repNo && rep.status === "ok" && (rep.score === 0 || rep.score === 1);
  if (!okRep(row.rep1, 1) || !okRep(row.rep2, 2)) return null;
  if (row.rep1.score === row.rep2.score) return row.rep1.score;
  if (!okRep(row.rep3, 3)) return null; // unresolved (B4 §4-c): never silently agrees
  return row.rep1.score === row.rep3.score ? row.rep1.score : row.rep2.score;
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

const opts = parseArgs(process.argv.slice(2));
(async () => {
try {
const work = mkdtempSync(path.join(os.tmpdir(), "s19-judge-"));
const fileLegs = opts.files === null ? [] : opts.files.split(",").map((s) => {
  const eq = s.indexOf("=");
  return eq < 0 ? [s, ""] : [s.slice(0, eq), s.slice(eq + 1)];
});
const staged = new Map(); // specIndex -> staged neutral file
for (const [i, spec] of opts.specs.entries()) {
  let body = null;
  if (opts.files !== null) {
    const pair = fileLegs.find(([label]) => label === String(i) || label === spec.path);
    if (pair === undefined || pair[1].length === 0) { log(`--files has no leg for ${spec.path}=${spec.locale} — skipped (coverage fails closed downstream)`); continue; }
    body = readFileSync(path.resolve(pair[1]), "utf8");
  } else {
    body = await fetchLocaleBody(opts.wikiBase, spec.path, spec.locale);
    if (body === null) { log(`live wiki has no (${spec.path}, ${spec.locale}) row — skipped (coverage fails closed downstream)`); continue; }
  }
  const f = path.join(work, `p${String(i + 1)}.md`); // neutral names: page labels never enter the judge channel
  writeFileSync(f, body);
  staged.set(i, f);
}
if (staged.size === 0) {
  rmSync(work, { recursive: true, force: true });
  throw new Error("nothing to judge — every page body missing; write no verdicts file (grader fail-closes the 蜂判 legs)");
}

const ledgerPath = opts.ledger ?? path.join(".bench", "judge-ledger.jsonl");
mkdirSync(path.dirname(ledgerPath), { recursive: true });
const files = [...staged.values()].join(",");
log(`matrix: ${opts.rubrics.length} rubric(s) × ${String(staged.size)} page file(s) × ${String(opts.reps)} reps = ${String(opts.rubrics.length * staged.size * opts.reps)} calls`);
runBench(opts.bench, ["matrix", "--rubrics", opts.rubrics.join(","), "--pages", files, "--reps", String(opts.reps),
  "--sleep-s", String(opts.sleepS), "--timeout-s", String(opts.timeoutS), "--model", opts.model, "--ledger", ledgerPath]);
const fileToLeg = new Map([...staged.entries()].map(([i, f]) => [f, opts.specs[i]]));
let rows = ledgerRows(ledgerPath).filter((r) => fileToLeg.has(r.page));
if (rows.length === 0) {
  rmSync(work, { recursive: true, force: true });
  throw new Error("judge-bench emitted no ledger rows for the staged pages (instrument failure, not a verdict)");
}

const arbLedger = `${ledgerPath}.arb`;
let arbitrations = 0;
for (const row of rows) {
  if (row.agree === true) continue;
  arbitrations += 1;
  const leg = fileToLeg.get(row.page);
  log(`arbitration (B4 §4-b): ${row.rubric} × ${leg === undefined ? row.page : `${leg.path}=${leg.locale}`} — fresh isolated rep3`);
  try {
    runBench(opts.bench, ["pair", "--rubric", opts.rubrics.find((r) => path.basename(r, ".md") === row.rubric) ?? row.rubric,
      "--page", row.page, "--reps", "1", "--sleep-s", String(opts.sleepS), "--timeout-s", String(opts.timeoutS),
      "--model", opts.model, "--ledger", arbLedger]);
    const arb = ledgerRows(arbLedger).filter((r) => r.rubric === row.rubric && r.page === row.page).pop();
    if (arb?.rep1 !== undefined) row.rep3 = { ...arb.rep1, rep: 3 };
  } catch (e) {
    log(`arbitration call failed: ${String(e.message).slice(0, 160)} — row stays UNRESOLVED`);
  }
  row.majority = foldMajority(row);
}
for (const row of rows) {
  row.majority = row.majority ?? foldMajority(row);
}

const doc = {
  generated: new Date().toISOString(),
  unit: "scenario-19",
  pages: opts.specs.map((s) => ({ page: s.path, locale: s.locale })),
  mode: opts.files !== null ? "offline-files" : "live-wiki",
  model: opts.model,
  instrument: { bench: opts.bench, rubrics: opts.rubrics.map((r) => ({ file: r, name: path.basename(r, ".md"), sha256: sha256(readFileSync(r, "utf8")) })), reps: opts.reps, sleepS: opts.sleepS, timeoutS: opts.timeoutS, ledger: ledgerPath, arbitrations },
  wall_ms: Date.now() - t0,
  rows: rows.map((r) => ({ ...r, page: String(fileToLeg.get(r.page)?.path ?? r.page), locale: String(fileToLeg.get(r.page)?.locale ?? "en") })),
};

mkdirSync(path.dirname(opts.out), { recursive: true });
writeFileSync(opts.out, JSON.stringify(doc, null, 1) + "\n");
rmSync(work, { recursive: true, force: true });
const counts = { ok: 0, zero: 0, unresolved: 0 };
for (const r of doc.rows) { if (r.majority === 1) counts.ok += 1; else if (r.majority === 0) counts.zero += 1; else counts.unresolved += 1; }
log(`wrote ${opts.out}: ${String(doc.rows.length)} rows, majority 1×${String(counts.ok)} 0×${String(counts.zero)} unresolved×${String(counts.unresolved)}, wall ${String(Math.round(doc.wall_ms / 1000))}s, arbitrations ${String(arbitrations)}`);
process.stdout.write(JSON.stringify({ out: opts.out, rows: doc.rows.length, ...counts, arbitrations, wall_ms: doc.wall_ms }) + "\n");
} catch (e) {
  // instrument failure ≠ a verdict: exit 2 (inconclusive plumbing), no file —
  // the grader's fail-closed 蜂判 legs own the honest 0 with an explicit note.
  process.stderr.write(`[judge-poststage-19] FATAL ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(2);
}
})();
