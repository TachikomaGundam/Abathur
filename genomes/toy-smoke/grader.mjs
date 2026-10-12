// Toy grader (plan todo 5): script-first, model-free. Consumes a unit path (argv[2],
// resolved against cwd), imports the unit module, and scores it from its exported
// `checks(): boolean[]` contract. Prints EXACTLY one JSON line on success:
//   {unit, score 0..1, pass, metrics {tokensEst, turns}}
// Any problem (missing file, import throw, contract violation) => one stderr line
// and exit 1 with NO JSON — the adapter maps that to an inconclusive-for-unit.
// NOTE: importing executes unit top-level code; units must guard side effects with
// the standard `isMain` check (see units/*.mjs), exactly like Python __main__.

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BYTES_PER_TOKEN = 4;

const unitArg = process.argv[2];
if (typeof unitArg !== "string" || unitArg.length === 0) fail("usage: node grader.mjs <unitPath>");

const unitAbs = path.resolve(process.cwd(), unitArg);
let bytes;
try {
  bytes = readFileSync(unitAbs);
} catch {
  fail(`unit file not readable: ${unitArg}`);
}

let mod;
try {
  mod = await import(pathToFileURL(unitAbs).href);
} catch (cause) {
  fail(`unit import failed: ${cause instanceof Error ? cause.message : String(cause)}`);
}

if (typeof mod.checks !== "function") fail("unit does not export checks(): boolean[]");

let results;
try {
  results = mod.checks();
} catch (cause) {
  fail(`checks() threw: ${cause instanceof Error ? cause.message : String(cause)}`);
}

if (!Array.isArray(results) || results.length === 0) fail("checks() must return a non-empty array");
if (!results.every((r) => typeof r === "boolean")) fail("checks() must return booleans only");

const passes = results.filter((r) => r).length;
const line = {
  unit: unitArg,
  score: passes / results.length,
  pass: passes === results.length,
  metrics: {
    tokensEst: Math.ceil(bytes.length / BYTES_PER_TOKEN),
    turns: results.length,
  },
};
process.stdout.write(`${JSON.stringify(line)}\n`);

function fail(reason) {
  process.stderr.write(`grader: ${reason}\n`);
  process.exit(1);
}
