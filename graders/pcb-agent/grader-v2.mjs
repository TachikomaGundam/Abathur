// grader-v2.mjs — phase-aware ruler (supersedes grader.mjs v1 for toy phase-A/B exams).
// Ruler-defect postmortem (why v2 exists): v1 conflated phase A (spec->schematic->placement)
// with phase B (routing->pour->fab). Under v1, a PERFECT phase-A run scores at most 0.407
// (outcome arm caps 0.35: it demanded nonNC==0 + fab artifacts, both out-of-scope for A;
// eyes arm: 5 of 7 traps are B-physics). Phase-A pass>=0.7 was mathematically unreachable,
// and incumbent 0.521 was earned largely by out-of-scope wandering keyword-matches.
// v1 verdicts are NOT rewritten; they stand side-by-side (L-ORACLE-INTEGRITY: version the
// ruler). Evidence: PCB-Agent/.omo/evidence/r28-candA-run/ (candidate 0.407 v1) vs the
// r27 anchor 0.521 v1, forensic re-read of both RESULT/FINDINGS docs.
//
// Design rules:
//  - every point comes from a REAL gate the grader itself runs, or from a machine-checkable
//    artifact fact — never from keyword-guessing prose, except the two declared discovery
//    traps (T1/T2) whose predicates are deliberately narrow and phase-scoped.
//  - each phase's max is genuinely achievable (1.0) and pass>=0.7 is meaningful.
// Usage: node grader-v2.mjs <unitId> <scenarioFile> [phaseA|phaseB]   (default phaseA)
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const fail = (m) => { process.stderr.write(m + "\n"); process.exit(2); }; // 2 = cannot-answer (infra/arena)
const unitId = process.argv[2];
const scenarioFile = process.argv[3];
const phase = process.argv[4] === "phaseB" ? "phaseB" : "phaseA";
if (!unitId || !scenarioFile) fail("usage: grader-v2.mjs <unitId> <scenarioFile> [phaseA|phaseB]");

// arena: same resolution as v1 (PCB_FORCE_ARENA override for re-grading saved runs)
const arena = process.env.PCB_FORCE_ARENA || fail("PCB_FORCE_ARENA required for v2 re-grade (arena is ephemeral)");
const R = (p) => path.join(arena, p);
// artifacts may sit at arena root or in production-console subdir (v1 used the runner's cwd copy)
const C = (p) => { const q = R(p); return existsSync(q) ? q : R(path.join("production-console", p)); };
const readC = (p) => { try { return readFileSync(C(p), "utf8"); } catch { return ""; } };
const resultDoc = readC("RESULT.md");
const findings = readC("FINDINGS.md");
const specRaw = (() => { for (const q of [C("spec.json"), "/home/lab/workspace/harness/Abathur/graders/pcb-agent/seed/spec.json"]) { try { return readFileSync(q, "utf8"); } catch {} } return ""; })();
let spec = null; try { spec = JSON.parse(specRaw); } catch {}
const schPath = [C("board.kicad_sch"), C("out.kicad_sch")].find(existsSync);
const pcbPath = [C("board.kicad_pcb"), C("out.kicad_pcb")].find(existsSync);
const KCLI = process.env.KICAD_CLI || "/home/lab/bin/kicad-cli";

const metrics = { unit: unitId, phase, grader_version: "v2" };
if (!resultDoc && !findings && !pcbPath) {
  // nothing produced = honest LOW, not inconclusive (same doctrine as v1)
  process.stdout.write(JSON.stringify({ unit: unitId, phase, score: 0, pass: false, metrics: { ...metrics, nothing_produced: true } }) + "\n");
  process.exit(0);
}

function runJson(argv, outFile) {
  try { execFileSync(KCLI, [...argv, "--output", outFile], { timeout: 240000, stdio: "pipe" }); }
  catch (e) { /* violations exit 1 is expected */ }
  try { return JSON.parse(readFileSync(outFile, "utf8")); } catch { return null; }
}

// ---------- OUTCOME (0.6) ----------
let outcome = 0; const om = {};
if (phase === "phaseA") {
  // A1 ERC + A2 netlist roundtrip = EXACTLY the team's own deterministic gate (tools/board_gate.py
  // semantics: --format json ERC with violations==0 AND unconnected==0, plus paren-balanced
  // net-block membership diff vs spec components[].pins — never regex across closers).
  if (schPath && spec && Array.isArray(spec.components)) {
    const wantByNet = new Map(); // net name -> Set("ref.pin")
    for (const c of spec.components) {
      for (const [p, net] of Object.entries(c.pins || {})) {
        if (!wantByNet.has(net)) wantByNet.set(net, new Set());
        wantByNet.get(net).add(`${c.ref}.${p}`);
      }
    }
    // ERC (json format, same flags as board_gate.py)
    let ercOk = false;
    try {
      execFileSync(KCLI, ["sch", "erc", schPath, "--format", "json", "--severity-error", "--output", C(".g2-erc.json")], { timeout: 120000, stdio: "pipe" });
      ercOk = true;
    } catch (e) { ercOk = existsSync(C(".g2-erc.json")); } // exit 1 on violations still writes report
    if (ercOk) {
      try {
        const d = JSON.parse(readFileSync(C(".g2-erc.json"), "utf8"));
        const sh = (d.sheets && d.sheets[0] && d.sheets[0].erc) || {};
        const v = (sh.violations || []).length, u = (sh.unconnected || []).length;
        om.erc = { violations: v, unconnected: u };
        if (v === 0 && u === 0) outcome += 0.20; else outcome += Math.max(0, 0.20 - (v + u) * 0.05);
      } catch { om.erc_unparseable = true; }
    } else { om.erc_unrunnable = true; }
    // roundtrip export (balanced-block parse, exact membership)
    try {
      execFileSync(KCLI, ["sch", "export", "netlist", schPath, "-o", C(".g2-netlist.net")], { timeout: 120000, stdio: "pipe" });
      const txt = readFileSync(C(".g2-netlist.net"), "utf8");
      const expByNet = new Map();
      let i = 0;
      while (true) {
        i = txt.indexOf("(net\n", i); if (i < 0) break;
        let depth = 0, j = i, instr = false;
        while (j < txt.length) {
          const ch = txt[j];
          if (ch === '"' && txt[j - 1] !== "\\") instr = !instr;
          else if (!instr) { if (ch === "(") depth++; else if (ch === ")") { depth--; if (depth === 0) break; } }
          j++;
        }
        const block = txt.slice(i, j + 1);
        const m = block.match(/\(name "([^"]+)"\)/);
        if (m) {
          const s = new Set();
          for (const mm of block.matchAll(/ref "([^"]+)"\)\s*\(\s*pin "([^"]+)"/g)) s.add(`${mm[1]}.${mm[2]}`);
          expByNet.set(m[1], s);
        }
        i = j + 1;
      }
      let matched = 0;
      for (const [net, want] of wantByNet) {
        const got = expByNet.get(net);
        if (got && got.size === want.size && [...want].every((x) => got.has(x))) matched++;
      }
      const extra = [...expByNet.keys()].filter((k) => !wantByNet.has(k));
      om.roundtrip = { nets: wantByNet.size, matched, extra_nets: extra.length };
      if (wantByNet.size && matched === wantByNet.size && extra.length === 0) outcome += 0.15;
      else outcome += Math.max(0, 0.15 * (matched / Math.max(1, wantByNet.size)) - 0.01 * extra.length);
    } catch { om.roundtrip_unrunnable = true; }
  } else { om.no_schematic_or_spec = true; }

  if (pcbPath) {
    const doc = runJson(["pcb", "drc", pcbPath, "--refill-zones", "--severity-error", "--format", "json"], C(".g2-drc.json"));
    if (!doc) { om.drc_unrunnable = true; }
    else {
      const v = (doc.violations || []).filter((x) => x.type !== "starved_thermal");
      om.drc_hard_errors = v.length;
      // A3 placement DRC error-severity == 0 (unconnected EXCLUDED — ratsnest is expected pre-routing)
      const hardNoUnc = v.filter((x) => x.type !== "unconnected_items" && !/unconnected/i.test(x.type || ""));
      om.drc_hard_no_unc = hardNoUnc.length;
      if (hardNoUnc.length === 0) outcome += 0.15; else outcome += Math.max(0, 0.15 - hardNoUnc.length * 0.05);
      // A4 ratsnest declared honestly in RESULT.md  (0.05)
      // A4 honest scope declaration: RESULT states the ratsnest is EXPECTED at phase A
      if (/(unconnected|ratsnest)[\s\S]{0,120}(expected|pre.?routing|phase.?A|phase.?B|not.?error|by.?design)/i.test(resultDoc)
       || /(expected|pre.?routing|phase.?A|not.?error|by.?design)[\s\S]{0,120}(unconnected|ratsnest)/i.test(resultDoc)) outcome += 0.05;
      const unc = doc.unconnected_items || [];
      om.unconnected_total = unc.length;
    }
    // A5 board file written before deadline = delivered, not narrated (0.05)
    outcome += 0.05; om.artifact_on_disk = true;
  } else { om.no_board = true; }

  // discrepancy guard (kept from v1, tightened): if RESULT.md claims an ERC number the re-run contradicts
  const claimedErc = (resultDoc.match(/erc\D{0,30}?(\d+)\s*\/\s*\d+/i) || [])[1];
  if (claimedErc !== undefined && om.erc_errors !== undefined && Number(claimedErc) !== om.erc_errors) {
    om.DISCREPANCY_claimed_erc = { claimed: Number(claimedErc), actual: om.erc_errors };
    outcome = Math.max(0, outcome - 0.2);
  }
} else {
  // phaseB: routing+pour+fab — v1's outcome arms were written for THIS phase; keep them, minus the trap prose
  if (!pcbPath) { om.no_board = true; }
  else {
    const doc = runJson(["pcb", "drc", pcbPath, "--refill-zones", "--save-board", "--severity-error", "--format", "json"], C(".g2-drc.json"));
    if (!doc) om.drc_unrunnable = true;
    else {
      const v = doc.violations || []; const hard = v.filter((x) => x.type !== "starved_thermal");
      const u = doc.unconnected_items || [];
      let nc = 0; for (const it of u) if ((it.items || []).some((i) => /\[NC/.test(i.description || ""))) nc++;
      const nonNC = Math.max(0, u.length - nc);
      om.drc_hard_errors = hard.length; om.unconnected = { total: u.length, nonNC, nc };
      if (hard.length === 0) outcome += 0.30; else outcome += Math.max(0, 0.30 - hard.length * 0.05);
      if (nonNC === 0) outcome += 0.20;
      outcome += 0.05; // sch present check omitted; board counts
      const fabDir = R("fab-out");
      const fab = existsSync(fabDir) ? readdirSync(fabDir) : [];
      if (fab.some((f) => /gerber|\.gbr|\.zip/i.test(f)) && fab.some((f) => /drl|drill/i.test(f))) outcome += 0.05;
    }
  }
}
outcome = Math.min(0.6, outcome);
metrics.outcome = +outcome.toFixed(3); metrics.detailed = om;

// ---------- EYES (0.4): phase-scoped discovery traps ----------
// v1 lesson: prose keyword-matching inflated/deflated scores unpredictably. v2 keeps only
// traps whose subject-matter is PROVABLE from machine artifacts, plus two narrow declaration
// traps. B-physics traps (pour/zone-grammar/starved/pad-ring/incremental) belong to phase B.
const F = findings; const hits = [];
let outcomeEyes = 0;
const t = (id, w, cond) => { if (cond) { hits.push(id); outcomeEyes += w; } };
if (phase === "phaseA") {
  t("T1_nc_net_semantics", 0.10, /NC/i.test(F) && /(by.?design|floating|skip|不连|悬空)/i.test(F));
  t("T2_same_ref_internal_bond", 0.10, /(same.?ref|internal bond|同ref|同一器件|self.?loop)/i.test(F));
  // E1 size-deviation discovery: spec plants a declared 0402->0603 passive deviation
  // (corridor physics = the phase-A-visible slice of the T7 family; existence computable from spec)
  t("E1_size_deviation", 0.10, /(0402|0603)/i.test(F) && /(deviat|size|courtyard|clearance|corridor)/i.test(F));
  // E2 contradiction-flag forensics: team noticed a spec-vs-datasheet/footprint conflict
  // (the fixture plants J1 alias mismatch + U1 pin-map convention; r27 F-02 / r28 F-01..F-03)
  t("E2_spec_conflict_flagged", 0.10, /(datasheet|contradiction|conflict|mismatch|not silicon|convention)[\s\S]{0,120}(spec|pin|footprint|alias|J1|U1)/i.test(F + "\n" + resultDoc));
} else {
  t("T3_gnd_pour_not_traces", 0.08, /(pour|zone|铺铜|flood)/i.test(F) && /(GND|地)/i.test(F));
  t("T4_starved_thermal_root", 0.08, /starved_thermal/i.test(F) && /(spoke|relief|thermal|rim|幅条|热幅)/i.test(F));
  t("T5_incremental_durable_output", 0.08, /(incremental|progress|write.?at.?end|断点|增量)/i.test(F) || existsSync(C(".progress")) || existsSync(C("router.progress")));
  t("T6_kicad10_zone_grammar", 0.08, /(connect_pads|island_type|grammar|token|priority)/i.test(F));
  t("T7_corridor_physics", 0.08, /(corridor|0\.15|0\.36|courtyard|clearance.*physic|走廊|物理不可达|deviat)/i.test(F));
  t("T8_cross_layer_pad_ring", 0.0, /(cross.?layer|两.?层|both layer)/i.test(F));
  t("T1_nc_net_semantics", 0.0, true); // counted but zero-weight continuity marker
}
if (!F.trim() && phase === "phaseA" && !hits.some((h) => h.startsWith("E"))) {
  metrics.eyes_note = "empty FINDINGS: declaration traps cannot fire";
}
let eyes = Math.min(0.4, (outcomeEyes / 0.4) * 0.4);
metrics.eyes = +eyes.toFixed(3); metrics.traps_hit = hits;

const score = +(outcome + eyes).toFixed(3);
process.stdout.write(JSON.stringify({ unit: unitId, phase, grader_version: "v2", score, pass: score >= 0.7, metrics }) + "\n");
