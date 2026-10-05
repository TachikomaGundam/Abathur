// grader-v3.mjs — single-mechanism sub-exam ruler (s31 route-accounting, s32 pour-mechanics).
// Why v3 (measurement-system postmortem, NIGHTLY r45 control): same roles/tools/ruler scored
// 0.49 vs 0.21 across two full-B runs — n=1 arm-to-arm comparison on the 90-min mixed exam is
// below the noise floor. v3 tests ONE physics mechanism per 30-min run with INPUT-vs-OUTPUT
// DELTA gates computed by the grader itself from the pristine arena input
// (.state/arena-input-board.kicad_pcb, seeded), so a claim is never compared against a
// narrative and no arm can be flattered by wandering into another mechanism's credit.
// v2 verdicts stand side-by-side (L-ORACLE-INTEGRITY). Usage: node grader-v3.mjs <unit> <scenario> <s31|s32>
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const fail = (m) => { process.stderr.write(m + "\n"); process.exit(2); };
const unitId = process.argv[2];
const scenarioFile = process.argv[3];
const phase = process.argv[4];
if (!unitId || !scenarioFile || !["s31", "s32"].includes(phase))
  fail("usage: grader-v3.mjs <unit> <scenario> <s31|s32>");
const arena = process.env.PCB_FORCE_ARENA || fail("PCB_FORCE_ARENA required");
const R = (p) => path.join(arena, p);
const C = (p) => { const q = R(p); return existsSync(q) ? q : R(path.join("production-console", p)); };
const readC = (p) => { try { return readFileSync(C(p), "utf8"); } catch { return ""; } };
const KCLI = process.env.KICAD_CLI || "/home/lab/bin/kicad-cli";
const INPUT = [R(".state/arena-input-board.kicad_pcb")].find(existsSync)
  || fail("pristine arena input missing — v3 requires s3x-seeded arena");

const board = phase === "s31"
  ? [C("board-routed.kicad_pcb")].find(existsSync)
  : [C("board-poured.kicad_pcb"), C("board-routed.kicad_pcb")].find(existsSync);
const resultDoc = readC("RESULT.md") || readC("RESULT.md", );
const findings = readC("FINDINGS.md");
const metrics = { unit: unitId, phase, grader_version: "v3" };

function drcOf(file, refill) {
  const argv = ["pcb", "drc", file, "--severity-error", "--format", "json"];
  if (refill) argv.splice(3, 0, "--refill-zones", "--save-board");
  try { execFileSync(KCLI, [...argv, "--output", file + ".v3drc.json"], { timeout: 240000, stdio: "pipe" }); } catch {}
  try { return JSON.parse(readFileSync(file + ".v3drc.json", "utf8")); } catch { return null; }
}
function measure(file, refill = false) {
  const txt = (() => { try { return readFileSync(file, "utf8"); } catch { return ""; } })();
  const doc = drcOf(file, refill);
  if (!doc) return null;
  const hard = (doc.violations || []).filter((x) => x.type !== "starved_thermal").length;
  const u = doc.unconnected_items || [];
  let nc = 0; for (const it of u) if ((it.items || []).some((i) => /\[NC/.test(i.description || ""))) nc++;
  return {
    hard, rats: u.length, nonNC: Math.max(0, u.length - nc),
    segs: (txt.match(/\(segment/g) || []).length,
    gndSegs: gndSegments(txt),
    zonesF: (txt.match(/\(layer\s+"F\.Cu"/g) || []).length,
    zonesB: (txt.match(/\(layer\s+"B\.Cu"/g) || []).length,
    reliefs: (txt.match(/thermal/gi) || []).length,
  };
}
// GND-net trace segments: segment blocks are s-expressions; count those whose net name is GND.
function gndSegments(txt) {
  let n = 0; const re = /\(segment\s+\(start[^)]*\)\s*\(end[^)]*\)[\s\S]{0,200}?\(net\s+(\d+)\s+"([^"]*)"\)/g;
  let m; while ((m = re.exec(txt))) if (/^(GND|\/?GND)$/i.test(m[2]) || /GND/.test(m[2])) n++;
  return n;
}

const inp = measure(INPUT);
const out = board ? measure(board, true) : null;
if (!inp) fail("cannot measure pristine input (kicad-cli)");
metrics.input = inp;
if (!board) {
  process.stdout.write(JSON.stringify({ unit: unitId, phase, score: 0, pass: false, metrics: { ...metrics, no_deliverable: true } }) + "\n");
  process.exit(0);
}
if (!out) fail("cannot measure delivered board");
metrics.delivered = { path: path.basename(board), ...out };

let outcome = 0; const om = {};
const eyes = []; // {id, hit, w}
if (phase === "s31") {
  // 1) deliverable at contract path 0.10
  if (path.basename(board) === "board-routed.kicad_pcb") { outcome += 0.10; om.contract_path = true; }
  // 2) copper strictly up vs input, >=8 segments 0.20 (partial credit at >=1)
  if (out.segs >= 8) outcome += 0.20; else if (out.segs >= 1) outcome += 0.08;
  om.segs_delta = out.segs - inp.segs;
  // 3) rat reduction vs input 0.20
  if (inp.nonNC > 0 && out.nonNC < inp.nonNC) outcome += 0.10;
  if (inp.nonNC > 0 && out.nonNC <= inp.nonNC * 0.6) outcome += 0.10;
  om.nonNC = `${inp.nonNC}->${out.nonNC}`;
  // 4) no NEW hard DRC vs input 0.10
  const newHard = Math.max(0, out.hard - inp.hard);
  if (newHard === 0) outcome += 0.10; else outcome = Math.max(0, outcome - newHard * 0.03);
  om.new_hard = newHard;
  // 5) ledger integrity: grep RESULT for segment counts; some claim within +-1 of measured 0.10
  const claims = [...(resultDoc.match(/(\d+)\s*(segments|segs|\(segment)/gi) || [])].map((s) => parseInt(s));
  om.ledger_claims_found = claims.length;
  if (claims.some((c) => Math.abs(c - out.segs) <= 1)) outcome += 0.10;
  else if (claims.length) om.ledger_MISMATCH = true; // honesty violation -> no credit, never fake credit
  // eyes 0.30: T1 NC semantics declared, T7 corridor physics, T5 first-failing measurement
  const t1 = /(NC|floating)[\s\S]{0,140}(no copper|by design|no rats|dangling|expected)/i.test(resultDoc + findings);
  const t7 = /(corridor|0\.5\s?mm|J1|gauntlet|fine.?pitch)[\s\S]{0,200}(\d\.\d+\s?mm|clearance|impossible|escape)/i.test(resultDoc + findings);
  const t5 = /(first|before).{0,80}(fail|violation|error)|violations?=\d+[\s\S]{0,400}violations?=(\d+)/i.test(resultDoc);
  for (const [id, hit, w] of [["T1_nc_semantics", t1, 0.10], ["T7_corridor_physics", t7, 0.10], ["T5_first_failure", t5, 0.10]]) { eyes.push({ id, hit, w }); if (hit) outcome += w; }
} else {
  // s32 pour-mechanics
  // 1) contract path 0.10
  if (path.basename(board) === "board-poured.kicad_pcb") { outcome += 0.10; om.contract_path = true; }
  // 2) zones on both layers 0.20
  if (out.zonesF >= 1 && out.zonesB >= 1) outcome += 0.20; else if (out.zonesF + out.zonesB >= 1) outcome += 0.08;
  om.zones = `F:${out.zonesF} B:${out.zonesB}`;
  // 3) no NEW hard DRC (pour must not create violations) 0.20
  const newHard = Math.max(0, out.hard - inp.hard);
  if (newHard === 0) outcome += 0.20; else outcome = Math.max(0, outcome - newHard * 0.05);
  om.new_hard = newHard;
  // 4) copper preserved: routed-in segments not swallowed (>= input board copper, input=0 here
  //    so gate is: if team routed helpers, they persist: out.segs >= 0 always true -> instead gate
  //    ZONE SANITY: refill produced connect-style reliefs evidence) 0.10
  if (out.reliefs >= 1 || out.zonesF + out.zonesB >= 2) outcome += 0.10;
  om.thermal_evidence = out.reliefs;
  // 5) RESULT carries the exact refill DRC command + numbers 0.10
  if (/kicad-cli[^\n]*refill-zones/i.test(resultDoc) && /violation/i.test(resultDoc)) outcome += 0.10;
  // eyes 0.30: T3 pour-not-traces (GND seg growth bounded), T6 grammar honesty, T4 starved named
  const gndGrew = Math.max(0, out.gndSegs - inp.gndSegs);
  const t3 = gndGrew <= 4; // thermal helpers tolerated; wholesale fake-pour traces fail
  const t6 = /(grammar|zone|s-expression|net\s*class|fill)[\s\S]{0,300}(trap|lesson|fixed|avoid|careful|manual)/i.test(findings + resultDoc);
  const t4 = /(starved|thermal.?relief|spoke)[\s\S]{0,200}(fix|pad|connect|island|spoke)/i.test(findings + resultDoc) || /(starved)/i.test(resultDoc);
  for (const [id, hit, w] of [["T3_pour_not_traces", t3, 0.12], ["T6_grammar_honesty", t6, 0.09], ["T4_starved_named", t4, 0.09]]) { eyes.push({ id, hit, w }); if (hit) outcome += w; }
  om.gnd_segs = `${inp.gndSegs}->${out.gndSegs}`;
}
const score = Math.min(1, outcome);
process.stdout.write(JSON.stringify({
  unit: unitId, phase, grader_version: "v3", score: +score.toFixed(3), pass: score >= 0.7,
  metrics: { ...metrics, outcome: +score.toFixed(3), eyes_reported: eyes, detailed: om },
}) + "\n");
