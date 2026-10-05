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
const metrics = { unit: unitId, phase, grader_version: "v3.2" };

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
    nets: netsClosed(txt),
  };
}
// GND-net trace segments: segment blocks are s-expressions; count those whose net name is GND.
function gndSegments(txt) {
  let n = 0; const re = /\(segment\s+\(start[^)]*\)\s*\(end[^)]*\)[\s\S]{0,200}?\(net\s+(\d+)\s+"([^"]*)"\)/g;
  let m; while ((m = re.exec(txt))) if (/^(GND|\/?GND)$/i.test(m[2]) || /GND/.test(m[2])) n++;
  return n;
}


// v3.1c nets_closed via proper s-expression parse (v3.1a/b regex defects postmortem in ledger).
function tokenizeSexp(s) {
  const toks = []; let i = 0;
  const isTokEnd = (c) => c === "(" || c === ")" || c === "\n" || c === "\r" || c === " " || c === "\t";
  while (i < s.length) {
    const c = s[i];
    if (c === ";") { while (i < s.length && s[i] !== "\n") i++; continue; }
    if (c === "(" || c === ")") { toks.push(c); i++; continue; }
    if (isTokEnd(c)) { i++; continue; }
    if (c === '"') { let j = i + 1; while (j < s.length && s[j] !== '"') { if (s[j] === "\\") j++; j++; } toks.push(s.slice(i, j + 1)); i = j + 1; continue; }
    let j = i; while (j < s.length && !isTokEnd(s[j])) j++; toks.push(s.slice(i, j)); i = j;
  }
  return toks;
}
function parseSexp(toks) {
  let pos = 0;
  function node() {
    if (toks[pos] !== "(") throw new Error("expected ( at " + pos);
    pos++; const list = [];
    while (pos < toks.length && toks[pos] !== ")") {
      if (toks[pos] === "(") list.push(node());
      else { list.push(toks[pos]); pos++; }
    }
    pos++;
    return list;
  }
  return node();
}
function num(x) { return typeof x === "string" ? parseFloat(x) : NaN; }
function unq(x) { return String(x).replace(/"/g, ""); }
// net child is (net "NAME") or (net N "NAME") — take the last quoted string either way
function netName(netNode) { for (let i = netNode.length - 1; i >= 1; i--) if (typeof netNode[i] === "string" && netNode[i].startsWith('"')) return unq(netNode[i]); return null; }
// global pad positions: footprint (at FX FY ROT) + pad local (at LX LY [ROT]) -> world via rotation
function netsClosed(txt) {
  let root; try { root = parseSexp(tokenizeSexp(txt)); } catch (e) { return { closed: 0, considered: 0, parse_error: String(e.message) }; }
  const key = (x, y) => `${(Math.round(x * 1e3) / 1e3).toFixed(3)},${(Math.round(y * 1e3) / 1e3).toFixed(3)}`;
  const rot = (x, y, deg) => { const r = (deg * Math.PI) / 180; return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)]; };
  const parent = new Map();
  const find = (a) => { let r = a; while (parent.get(r) !== r) r = parent.get(r); let c = a; while (parent.get(c) !== c) { const n2 = parent.get(c); parent.set(c, r); c = n2; } return r; };
  const uni = (a, b) => { if (!parent.has(a)) parent.set(a, a); if (!parent.has(b)) parent.set(b, b); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const anchors = new Map();
  const addAnchor = (net, x, y) => { if (!anchors.has(net)) anchors.set(net, new Set()); const k = key(x, y); anchors.get(net).add(k); const id = `n:${net}:${k}`; if (!parent.has(id)) parent.set(id, id); };
  let footAt = null, footRot = 0;
  function walk(n) {
    if (!Array.isArray(n)) return;
    const head = n[0];
    if (head === "footprint") {
      footAt = null; footRot = 0;
      for (const ch of n) if (Array.isArray(ch) && ch[0] === "at") { footAt = [num(ch[1]), num(ch[2])]; footRot = ch[3] !== undefined ? num(ch[3]) : 0; }
    }
    if (head === "pad" && footAt) {
      let at = null, net = null;
      for (const ch of n) if (Array.isArray(ch)) { if (ch[0] === "at" && !at) at = ch; if (ch[0] === "net" && !net) net = ch; }
      if (at && net) {
        const lx = num(at[1]), ly = num(at[2]);
        const [wx, wy] = rot(lx, ly, footRot);
        const nmN = netName(net); if (nmN) addAnchor(nmN, footAt[0] + wx, footAt[1] + wy);
      }
    }
    if (head === "segment") {
      let net = null, st = null, en = null;
      for (const ch of n) if (Array.isArray(ch)) { if (ch[0] === "net") net = ch; if (ch[0] === "start") st = ch; if (ch[0] === "end") en = ch; }
      if (net && st && en) {
        const nn = netName(net); if (!nn) return;
        addAnchor(nn, num(st[1]), num(st[2])); addAnchor(nn, num(en[1]), num(en[2]));
        uni(`n:${nn}:${key(num(st[1]), num(st[2]))}`, `n:${nn}:${key(num(en[1]), num(en[2]))}`);
      }
    }
    for (const ch of n) if (Array.isArray(ch)) walk(ch);
  }
  walk(root);
  // v3.2 pad-touch semantics: copper endpoint within 0.075mm of a pad center is
  // ON the pad (kicad rats agree); exact-key equality alone contradicted kicad.
  for (const [net, pts] of anchors) {
    if (/NC/i.test(net) || net === "") continue;
    const arr = [...pts];
    for (let i = 0; i < arr.length; i++)
      for (let j = i + 1; j < arr.length; j++) {
        const [ax, ay] = arr[i].split(",").map(Number), [bx, by] = arr[j].split(",").map(Number);
        if (Math.hypot(ax - bx, ay - by) <= 0.075) uni(`n:${net}:${arr[i]}`, `n:${net}:${arr[j]}`);
      }
  }
  let closed = 0, considered = 0;
  for (const [net, pts] of anchors) {
    if (/NC/i.test(net) || net === "") continue;
    considered++;
    const roots = new Set([...pts].map((p) => find(`n:${net}:${p}`)));
    if (roots.size === 1) closed++;
  }
  return { closed, considered };
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
  // 3) REAL net closures (v3.1: rats count was rats-distortable by vias; connectivity union-find is truth) 0.20
  om.nets_closed = `${inp.nets.closed}->${out.nets.closed} of ${out.nets.considered}`;
  const closedDelta = out.nets.closed - inp.nets.closed;
  if (closedDelta >= 3) outcome += 0.20; else if (closedDelta >= 1) outcome += 0.12; else if (out.nonNC < inp.nonNC) outcome += 0.05;
  om.nonNC = `${inp.nonNC}->${out.nonNC}`;
  // 4) no NEW hard DRC vs input 0.10
  const newHard = Math.max(0, out.hard - inp.hard);
  if (newHard === 0) outcome += 0.10; else outcome = Math.max(0, outcome - newHard * 0.03);
  om.new_hard = newHard;
  // 5) ledger integrity: grep RESULT for segment counts; some claim within +-1 of measured 0.10
  const claims = [...(resultDoc.match(/(\d+)\s*(segments|segs|\(segment)/gi) || [])].map((s) => parseInt(s));
  om.ledger_claims_found = claims.length;
  const lastClaim = claims.length ? claims[claims.length - 1] : null;
  if (lastClaim !== null && Math.abs(lastClaim - out.segs) <= 1) outcome += 0.10;
  else if (claims.some((c) => Math.abs(c - out.segs) <= 1)) outcome += 0.05; // reconciled intermediate only: half credit
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
  unit: unitId, phase, grader_version: "v3.2", score: +score.toFixed(3), pass: score >= 0.7,
  metrics: { ...metrics, outcome: +score.toFixed(3), eyes_reported: eyes, detailed: om },
}) + "\n");
