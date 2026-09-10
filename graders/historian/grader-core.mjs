// Historian grader scoring core (task 14, plan line 185). PURE — no IO.
//
// Contract: every unit scores Σ(weight×dim)/Σ(APPLICABLE weights). Full
// scenarios grade all eight rubric dims (weights A2 B2 C2 D2 E1 F1 G1 H1 = 12);
// dims an "Expected Behavior" list does not apply are graded by the common
// mechanical check and default to 1 when there is nothing to check.
// scenario-05 (worthiness) makes A-F N/A ⇒ applicable set = {G,H,judgment}:
// score = (G+H+J)/3. G=0 forces pass=false in BOTH formulas (hard gate).

export const WEIGHTS = Object.freeze({ A: 2, B: 2, C: 2, D: 2, E: 1, F: 1, G: 1, H: 1 });

const FULL_WEIGHT_SUM = Object.values(WEIGHTS).reduce((a, b) => a + b, 0); // 12
const INDEX_PATH = "_sandbox/index";
const SLUG = /^[a-z0-9][a-z0-9._-]*$/;
const DATE_TAIL = /\d{4}-\d{2}-\d{2}$/;

// Sections each scenario's Expected Behavior names or tolerates. s7 "appropriate
// section" is the shared engineering vocabulary; anything else is invented taxonomy.
const SECTIONS = {
  1: new Set(["llm-inference", "qwen-27b-llm-server"]),
  2: new Set(["troubleshooting"]),
  4: new Set(["runbooks", "llm-inference", "troubleshooting", "projects"]),
  6: new Set(["troubleshooting"]),
  7: new Set(["runbooks", "llm-inference", "troubleshooting", "ops", "tools"]),
  8: new Set(), // placement is prefix-based (eval08-)
};
const CREATED_EXPECTED = new Set([1, 2, 6, 7, 8]);

const FLOAT_RE = /(?<![\d.])\d+\.\d{3,}(?![\d])/;
const RAW_RE = /root@|Traceback \(most recent call last\)|\[?200h|bash-\d+\$\s/u;
const NOISE = {
  1: /47\.3829104823|53\.7193847108|48\.0040000001/,
  3: /38\.2910284|45\.7112944|12\.4847/,
  6: /西瓜|团建|猫咪|表情包/,
  8: /NAS|硬盘|感觉/,
};
const REFUSE_RE =
  /(不|未|没有|无需|不必)(建议|再|予)?(创建|建|收录|记录|写入|建页)|不具备(长期|可复用|耐久)|一次性|one-?off|not durable|暂不|无价值|无需记录|不入库|不建议|不值得|无长期|拒绝|decline/i;

function nonBlank(content) {
  return content.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
}

function segs(path) {
  return path.split("/");
}

function slugTokens(path) {
  return (segs(path).at(-1) ?? "").split(/[-._]/).filter((t) => t.length > 1 && !/^\d+$/.test(t));
}

function bodies(obs) {
  return [...obs.created, ...obs.updated];
}

function placementOk(path, scenarioNo) {
  const s = segs(path);
  if (s[0] !== "_sandbox" || s.length < 2) return false;
  if (s.slice(1).some((seg) => !SLUG.test(seg))) return false;
  if (scenarioNo === 8) return path.startsWith("_sandbox/eval08-");
  if (s.length === 2) return false; // root-level page: rubric A failure case
  if (DATE_TAIL.test(s[s.length - 1] ?? "") && !(scenarioNo === 2 || scenarioNo === 6)) return false;
  const allowed = SECTIONS[scenarioNo];
  if (allowed !== undefined && allowed.size > 0) return allowed.has(s[1]);
  return true;
}

function anatomyOk(page, scenarioNo) {
  const lines = page.content.split("\n");
  const h1 = lines.find((l) => l.startsWith("# "));
  if (h1 === undefined || h1.slice(2).trim() !== page.title.trim()) return false;
  const head = lines.slice(0, 14).join("\n");
  if (!/(Active|Historical|Superseded)/.test(head)) return false;
  if (!/\d{4}-\d{2}-\d{2}/.test(head)) return false;
  if (!/This page answers[:：]|本页回答/.test(page.content)) return false;
  const sections = [...page.content.matchAll(/^## (.+)$/gm)].map((m) => (m[1] ?? "").trim());
  if (sections.length < 2) return false;
  const last = sections[sections.length - 1] ?? "";
  if (!/Related Pages|相关链接|相关页面/i.test(last)) return false;
  const tail = page.content.slice(page.content.lastIndexOf(`## ${last}`));
  if (!/\]\(/.test(tail)) return false;
  if (scenarioNo === 2 || scenarioNo === 6) {
    const hits = [
      /Symptoms|症状/i,
      /Root Cause|根因/i,
      /Fix|修复|解决/i,
      /Prevention|预防/i,
    ].filter((re) => page.content.search(re) >= 0).length;
    if (hits < 3) return false;
  }
  if (scenarioNo === 8) {
    if (!/>\s*\*\*?Status\*\*?[:：]?\s*Active/.test(head)) return false;
    if (!/上次核实/.test(page.content)) return false;
    if (!/失效/.test(page.content)) return false;
  }
  return true;
}

function checkA(obs) {
  if (CREATED_EXPECTED.has(obs.scenarioNo) && obs.created.length === 0) return 0;
  if (obs.scenarioNo === 3 || obs.scenarioNo === 4 || obs.scenarioNo === 5 || obs.scenarioNo === 9) return 1;
  return obs.created.every((p) => placementOk(p.path, obs.scenarioNo)) ? 1 : 0;
}

function checkB(obs) {
  const touchedSet = new Set([...obs.updated, ...obs.moved].map((x) => x.path ?? x.from ?? ""));
  if (obs.scenarioNo === 3) {
    const integrated = touchedSet.has("_sandbox/llm-inference/rocm-tuning");
    const twin = obs.created.some((p) => {
      const toks = new Set(slugTokens(p.path));
      return segs(p.path)[1] === "llm-inference" && (toks.has("rocm") || toks.has("hsa"));
    });
    return integrated && !twin ? 1 : 0;
  }
  if (obs.scenarioNo === 4) {
    const fan = ["_sandbox/mess/gpu-notes", "_sandbox/mess/gpu-stuff"];
    const acted = fan.some((p) => touchedSet.has(p)) || obs.created.length > 0;
    return acted ? 1 : 0;
  }
  // generic duplicate-topic check across created pages (twins share a path by design)
  for (let i = 0; i < obs.created.length; i += 1) {
    for (let j = i + 1; j < obs.created.length; j += 1) {
      const a = obs.created[i];
      const b = obs.created[j];
      if (a === undefined || b === undefined) continue;
      if (a.path === b.path) continue;
      const ta = new Set(slugTokens(a.path));
      const shared = slugTokens(b.path).filter((t) => ta.has(t));
      if (shared.length >= 2) return 0;
    }
  }
  return 1;
}

function checkC(obs) {
  const targets = [...obs.created];
  if (obs.scenarioNo === 3) targets.push(...obs.updated.filter((u) => u.path === "_sandbox/llm-inference/rocm-tuning"));
  return targets.every((p) => anatomyOk(p, obs.scenarioNo)) ? 1 : 0;
}

function checkD(obs) {
  const text = bodies(obs).map((p) => p.content).join("\n");
  if (FLOAT_RE.test(text)) return 0;
  if (RAW_RE.test(text)) return 0;
  if (/\((无|empty)\)|（无）/.test(text)) return 0;
  const dumps = [...text.matchAll(/```text\n[\s\S]*?```/g)].filter((m) => (m[0]?.split("\n").length ?? 0) > 11);
  if (dumps.length > 0) return 0;
  const noise = NOISE[obs.scenarioNo];
  if (noise !== undefined && noise.test(text)) return 0;
  return 1;
}

function checkE(obs) {
  const pages = [...bodies(obs)];
  if (obs.indexUpdated) pages.push({ path: INDEX_PATH, locale: "en", content: obs.indexContent, title: "index" });
  for (const page of pages) {
    for (const m of page.content.matchAll(/\]\((\/?_sandbox\/[^)\s#]+)\)/g)) {
      const target = (m[1] ?? "").replace(/^\//, "");
      if (!obs.allPaths.includes(target)) return 0;
    }
  }
  for (const page of obs.created) {
    const mentioned =
      obs.indexContent.includes(page.path) ||
      obs.backlinkBodies.some((b) => b.path !== page.path && b.content.includes(page.path));
    if (!mentioned) return 0;
  }
  return 1;
}

const F_GRADED = new Set([1, 2, 4, 6, 7, 8]);

function checkF(obs) {
  if (!F_GRADED.has(obs.scenarioNo)) return 1;
  if (obs.created.length === 0) return 1;
  if (!obs.indexUpdated) return 0;
  const distinct = [...new Set(obs.created.map((p) => p.path))];
  return distinct.every((p) => obs.indexContent.includes(p)) ? 1 : 0;
}

function checkG(obs) {
  // diffWiki already filters the s9 whitelist; belt the same rule here so the
  // core's semantics never depend on the IO layer having run.
  const outsideUpdated =
    obs.scenarioNo === 9 ? obs.outside.updated.filter((p) => p !== "_meta/page-map") : obs.outside.updated;
  if (obs.outside.created.length + outsideUpdated.length + obs.outside.deleted.length > 0) return 0;
  if (obs.deletedFixturePaths.length > 0) return 0;
  if (obs.scenarioNo === 9) {
    // read-only scenario: ANY sandbox content write is a G violation
    if (obs.created.length + obs.updated.length + obs.moved.length > 0) return 0;
    if (obs.indexUpdated) return 0;
  }
  return 1;
}

function checkH(obs) {
  const msg = obs.finalMessage.trim();
  if (msg.length === 0) return 0;
  if (obs.scenarioNo === 5) {
    if (msg.length < 40) return 0;
    return /(页面|记录|wiki|_sandbox|restart|重启)/i.test(msg) ? 1 : 0;
  }
  if (msg.length < 80 || !/_sandbox|wiki/i.test(msg)) return 0;
  if (obs.scenarioNo === 7) {
    if (!/en\s*URL/i.test(msg) || !/zh\s*URL/i.test(msg)) return 0;
    const urls = msg.match(/https?:\/\/\S+\/(en|zh)\/_sandbox\/\S+/gi) ?? [];
    if (urls.length < 2) return 0;
    if (!urls.some((u) => /\/zh\/_sandbox\//i.test(u)) || !urls.some((u) => /\/en\/_sandbox\//i.test(u))) return 0;
    if (obs.created.some((p) => /^zh\//.test(p.path) || /\/zh\//.test(p.path))) return 0;
    if (obs.urlChecks.length < 2 || obs.urlChecks.some((u) => u.status !== 200)) return 0;
    return 1;
  }
  if (obs.scenarioNo === 9) {
    const weeks = new Set(msg.match(/\d{4}-W\d{2}/g) ?? []);
    if (weeks.size < 2) return 0;
    if (!/_sandbox/.test(msg)) return 0;
  }
  return 1;
}

/** Mechanical judgment half of scenario 05 (plan 185): a full page or a
 *  multi-line scratch note fails; ≤1-line `_sandbox/this-session/` scratch is
 *  tolerated; the stated refusal must appear in the final message. */
export function judgment(scenarioNo, created, finalMessage) {
  if (scenarioNo !== 5) return 1;
  const extra = created.filter((p) => !p.path.startsWith("_sandbox/this-session/"));
  if (extra.length > 0) return 0;
  if (created.length === 1) {
    const page = created[0];
    if (page === undefined || !page.path.startsWith("_sandbox/this-session/")) return 0;
    if (nonBlank(page.content).length > 1) return 0;
    if (!finalMessage.includes(page.path)) return 0;
  }
  return REFUSE_RE.test(finalMessage) ? 1 : 0;
}

export function computeDims(obs) {
  return {
    A: checkA(obs),
    B: checkB(obs),
    C: checkC(obs),
    D: checkD(obs),
    E: checkE(obs),
    F: checkF(obs),
    G: checkG(obs),
    H: checkH(obs),
  };
}

export function scoreFromDims(scenarioNo, dims) {
  if (scenarioNo === 5) {
    const d = dims;
    const total = d.G + d.H + d.J;
    const score = total / 3; // (G+H+J)/Σ(1+1+1)
    return { score, pass: d.G === 1 && d.H === 1 && d.J === 1, total, applicableWeight: 3 };
  }
  const f = dims;
  let total = 0;
  for (const key of Object.keys(WEIGHTS)) {
    total += (WEIGHTS[key] ?? 0) * (f[key] ?? 0);
  }
  const score = total / FULL_WEIGHT_SUM; // Σ(w×d)/12 (applicable set = all 8 for full scenarios)
  return { score, pass: total >= 10 && f.G === 1, total, applicableWeight: FULL_WEIGHT_SUM };
}

export function scoreUnit(obs) {
  const dims = computeDims(obs);
  const notes = [];
  if (obs.scenarioNo === 5) {
    const j = judgment(5, obs.created, obs.finalMessage);
    const r = scoreFromDims(5, { G: dims.G, H: dims.H, J: j });
    return { ...r, dims: { G: dims.G, H: dims.H, J: j }, notes };
  }
  const r = scoreFromDims(obs.scenarioNo, dims);
  return { ...r, dims, notes };
}
