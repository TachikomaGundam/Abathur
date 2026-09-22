#!/usr/bin/env node
/**
 * judge-poststage.mjs — scenario-17 蜂判 run-stage poststage (deterministic
 * plumbing, zero deps, argv-only spawns).
 *
 * Doctrine binding (historian .omo/evidence/good-wiki-readability-doctrine-FINAL.md):
 *   总则2  [蜂判] = 传感器：盲评双跑、分歧仲裁、一致率入法官健康台账。
 *   总则4  grader 只算结构/状态/工具事件；语义一律蜂判 ⇒ the LLM calls live
 *          HERE (run stage), never inside the shipped deterministic grader.
 *   B4 §4  arbitration = fresh isolated third run on the SAME (rubric, page),
 *          appended as rep3; majority 2/3; unresolved never agrees.
 *
 * Flow: materialize the created dossier pair (live wiki fetch by (path, locale)
 * — read-only — or --files locale=path for offline fixture runs) → invoke
 * judge-bench.mjs matrix (the certified instrument, imported by CLI spawn, NOT
 * re-implemented) → map ledger rows onto {page, locale} → for every agree=false
 * row, one `pair --reps 1` arbitration run appended as rep3 → fold the majority
 * per row → write .bench/judge-verdicts.json (grader consumes it as observable
 * state; s17FoldJudgeVerdicts re-derives everything fail-closed).
 *
 * Usage:
 *   node judge-poststage.mjs --page _sandbox/eval17/gpu-warm-pool-dossier \
 *       --wiki-base http://localhost:3000 [--out .bench/judge-verdicts.json] \
 *       [--ledger .bench/judge-ledger.jsonl] [--reps 2] [--sleep-s 2] \
 *       [--timeout-s 240] [--model local-qwen/qwen3.8-flash-next] \
 *       [--rubrics a.md,b.md,c.md] [--bench judge-bench.mjs]
 *   node judge-poststage.mjs --page <label> --files en=g.md,zh=d.md [...]
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULTS = {
  bench: "/home/lab/workspace/harness/historian/.omo/evidence/judge-bench/judge-bench.mjs",
  rubrics: ["R1-semantic", "R4-duty-v2", "R5-flavor"].map(
    (r) => `/home/lab/workspace/harness/historian/.omo/evidence/judge-bench/rubrics/${r}.md`,
  ),
  model: "local-qwen/qwen3.8-flash-next",
};

function parseArgs(argv) {
  const o = { ...DEFAULTS, out: path.join(".bench", "judge-verdicts.json"), ledger: null, reps: 2, sleepS: 2, timeoutS: 240, page: null, wikiBase: null, files: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const need = () => { i += 1; if (i >= argv.length) throw new Error(`${a} needs a value`); return argv[i]; };
    if (a === "--page") o.page = need();
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
  if (o.page === null) throw new Error("--page <wiki path or label> required");
  if (o.wikiBase === null && o.files === null) throw new Error("need --wiki-base <url> (live) or --files en=<f>,zh=<f> (offline fixtures)");
  if (Number.isNaN(o.reps) || o.reps < 2) throw new Error("--reps must be ≥2 (盲评双跑 is the certified mode)");
  return o;
}

const t0 = Date.now();
const log = (m) => process.stderr.write(`[judge-poststage] ${m}\n`);

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
const work = mkdtempSync(path.join(os.tmpdir(), "s17-judge-"));
const localeFile = new Map();
const targets = [["en", "en.md"], ["zh", "zh.md"]];
for (const [locale, fname] of targets) {
  let body = null;
  if (opts.files !== null) {
    const pair = opts.files.split(",").map((s) => s.split("=")).find(([k]) => k === locale);
    if (pair === undefined) { log(`--files has no ${locale} leg — skipped (coverage fails closed downstream)`); continue; }
    body = readFileSync(path.resolve(pair[1]), "utf8");
  } else {
    body = await fetchLocaleBody(opts.wikiBase, opts.page, locale);
    if (body === null) { log(`live wiki has no (${opts.page}, ${locale}) row — skipped (coverage fails closed downstream)`); continue; }
  }
  const f = path.join(work, fname); // neutral names: page label never enters the judge channel
  writeFileSync(f, body);
  localeFile.set(locale, f);
}
if (localeFile.size === 0) {
  rmSync(work, { recursive: true, force: true });
  throw new Error("nothing to judge — both locale bodies missing; write no verdicts file (grader fail-closes the 蜂判 legs)");
}

const ledgerPath = opts.ledger ?? path.join(".bench", "judge-ledger.jsonl");
mkdirSync(path.dirname(ledgerPath), { recursive: true });
const files = [...localeFile.values()].join(",");
log(`matrix: ${opts.rubrics.length} rubrics × ${String(localeFile.size)} locale file(s) × ${String(opts.reps)} reps = ${String(opts.rubrics.length * localeFile.size * opts.reps)} calls`);
runBench(opts.bench, ["matrix", "--rubrics", opts.rubrics.join(","), "--pages", files, "--reps", String(opts.reps),
  "--sleep-s", String(opts.sleepS), "--timeout-s", String(opts.timeoutS), "--model", opts.model, "--ledger", ledgerPath]);
const fileToTag = new Map([...localeFile.entries()].map(([loc, f]) => [f, loc]));
let rows = ledgerRows(ledgerPath).filter((r) => fileToTag.has(r.page));
if (rows.length === 0) {
  rmSync(work, { recursive: true, force: true });
  throw new Error("judge-bench emitted no ledger rows for the staged pages (instrument failure, not a verdict)");
}

const arbLedger = `${ledgerPath}.arb`;
let arbitrations = 0;
for (const row of rows) {
  if (row.agree === true) continue;
  arbitrations += 1;
  log(`arbitration (B4 §4-b): ${row.rubric} × ${fileToTag.get(row.page)} — fresh isolated rep3`);
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
  unit: "scenario-17",
  page: opts.page,
  mode: opts.files !== null ? "offline-files" : "live-wiki",
  model: opts.model,
  instrument: { bench: opts.bench, rubrics: opts.rubrics.map((r) => ({ file: r, name: path.basename(r, ".md"), sha256: sha256(readFileSync(r, "utf8")) })), reps: opts.reps, sleepS: opts.sleepS, timeoutS: opts.timeoutS, ledger: ledgerPath, arbitrations },
  wall_ms: Date.now() - t0,
  rows: rows.map((r) => ({ ...r, page: opts.page, locale: fileToTag.get(r.page) ?? String(r.page) })),
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
  process.stderr.write(`[judge-poststage] FATAL ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(2);
}
})();
