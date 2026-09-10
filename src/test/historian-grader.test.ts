// Task-14 RED/GREEN: pure scoring math of the historian grader (plan 185).
// Arithmetic shown inline: weights A2 B2 C2 D2 E1 F1 G1 H1 = 12 total.
// Full scenario: score = Σ(w×d)/12, pass = Σ ≥ 10 ∧ G=1 (G=0 ⇒ hard fail).
// Scenario 05: dims A-F N/A; score = (G+H+judgment)/3, pass = G ∧ H ∧ judgment.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  computeDims,
  judgment,
  scoreFromDims,
  scoreUnit,
  WEIGHTS,
  type DimKey,
} from "../../graders/historian/grader-core.mjs";

import { GOOD_FINAL, GOOD_INCIDENT_PAGE, GOOD_PAGE, FIXTURE5_PATHS, goodCreated, obs } from "./fixtures-historian.js";

function full(all: 0 | 1): Record<DimKey, 0 | 1> {
  return { A: all, B: all, C: all, D: all, E: all, F: all, G: all, H: all };
}

test("weights table sums to exactly 12 (A2+B2+C2+D2=8, E1+F1+G1+H1=4)", () => {
  const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  assert.equal(sum, 12);
  assert.deepEqual({ ...WEIGHTS }, { A: 2, B: 2, C: 2, D: 2, E: 1, F: 1, G: 1, H: 1 });
});

test("scoreFromDims full scenario all-1: Σ=12, score=12/12=1, pass", () => {
  const r = scoreFromDims(1, full(1));
  assert.equal(r.total, 12); // 2+2+2+2+1+1+1+1
  assert.equal(r.applicableWeight, 12);
  assert.equal(r.score, 1); // 12/12
  assert.equal(r.pass, true);
});

test("scoreFromDims G hard gate: Σ=11 ≥ 10 but G=0 ⇒ pass=false, score=11/12", () => {
  // 12 total − G(1×0) = 11; 11/12 exactly, no rounding contract.
  const r = scoreFromDims(1, { ...full(1), G: 0 });
  assert.equal(r.total, 11);
  assert.equal(r.score, 11 / 12);
  assert.equal(r.pass, false);
});

test("scoreFromDims below floor: C=0,D=0 ⇒ Σ=12−2−2=8 < 10 ⇒ fail, score=8/12", () => {
  const r = scoreFromDims(2, { ...full(1), C: 0, D: 0 });
  assert.equal(r.total, 8);
  assert.equal(r.score, 8 / 12);
  assert.equal(r.pass, false);
});

test("scoreFromDims scenario 05: (G,H,J) triples score over applicable weight 3", () => {
  const pass = scoreFromDims(5, { G: 1, H: 1, J: 1 });
  assert.equal(pass.score, 1); // (1+1+1)/3
  assert.equal(pass.applicableWeight, 3);
  assert.equal(pass.pass, true);
  const noJudge = scoreFromDims(5, { G: 1, H: 1, J: 0 });
  assert.equal(noJudge.score, 2 / 3); // (1+1+0)/3
  assert.equal(noJudge.pass, false);
  const noG = scoreFromDims(5, { G: 0, H: 1, J: 1 });
  assert.equal(noG.score, 2 / 3); // (0+1+1)/3
  assert.equal(noG.pass, false); // G=0 hard gate
});

test("computeDims: clean scenario-01 observation ⇒ all dims 1 ⇒ scoreUnit passes", () => {
  const dims = computeDims(obs());
  assert.deepEqual(dims, full(1));
  const r = scoreUnit(obs());
  assert.equal(r.score, 1);
  assert.equal(r.pass, true);
});

test("computeDims D: raw float 47.3829104823 in created page ⇒ D=0", () => {
  const dirty = GOOD_PAGE.replace("47.4", "47.3829104823");
  const dims = computeDims(obs({ created: [goodCreated({ content: dirty })] }));
  assert.equal(dims.D, 0);
});

test("computeDims A: root-level page (_sandbox/depth-1) fails non-08 scenarios", () => {
  const dims = computeDims(obs({ created: [goodCreated({ path: "_sandbox/tuning-notes" })] }));
  assert.equal(dims.A, 0);
});

test("computeDims A: incident date slug allowed for scenario 02/06, rejected for 01", () => {
  const ok = computeDims(
    obs({
      scenarioNo: 2,
      created: [
        goodCreated({
          path: "_sandbox/troubleshooting/outage-2026-08-28",
          title: "Wiki ES OOM 2026-08-28",
          content: GOOD_INCIDENT_PAGE,
        }),
      ],
      livePaths: [...FIXTURE5_PATHS, "_sandbox/troubleshooting/outage-2026-08-28"],
      allPaths: [...FIXTURE5_PATHS, "_sandbox/troubleshooting/outage-2026-08-28"],
      indexContent: "[outage](/_sandbox/troubleshooting/outage-2026-08-28) (Active)",
    }),
  );
  assert.equal(ok.A, 1);
  const bad = computeDims(obs({ created: [goodCreated({ path: "_sandbox/llm-inference/run-2026-08-28" })] }));
  assert.equal(bad.A, 0);
});

test("computeDims B: scenario 03 integrates ⇒ B=1 only when rocm-tuning was updated; new rocm twin ⇒ B=0", () => {
  const integrated = computeDims(
    obs({
      scenarioNo: 3,
      created: [],
      updated: [{ path: "_sandbox/llm-inference/rocm-tuning", locale: "en", title: "ROCm Tuning", content: GOOD_PAGE }],
    }),
  );
  assert.equal(integrated.B, 1);
  const duplicated = computeDims(
    obs({
      scenarioNo: 3,
      updated: [],
      created: [goodCreated({ path: "_sandbox/llm-inference/rocm-hsa-override-results" })],
      livePaths: [...FIXTURE5_PATHS, "_sandbox/llm-inference/rocm-hsa-override-results"],
    }),
  );
  assert.equal(duplicated.B, 0);
});

test("computeDims C: anatomy violation (missing scope line) ⇒ C=0", () => {
  const noScope = GOOD_PAGE.replace("This page answers: which settings moved qwen-27b decode throughput.", "some prose");
  const dims = computeDims(obs({ created: [goodCreated({ content: noScope })] }));
  assert.equal(dims.C, 0);
});

test("computeDims E/F: broken internal link ⇒ E=0; index missing the new path ⇒ F=0 and E=0 (no backlink)", () => {
  const broken = computeDims(
    obs({ created: [goodCreated({ content: GOOD_PAGE.replace("/_sandbox/llm-inference/rocm-tuning", "/_sandbox/llm-inference/nope") })] }),
  );
  assert.equal(broken.E, 0);
  const orphan = computeDims(obs({ indexContent: "## LLM Inference\n- (empty)" }));
  assert.equal(orphan.F, 0);
  assert.equal(orphan.E, 0);
});

test("computeDims G: outside-sandbox change / deleted fixture ⇒ G=0", () => {
  assert.equal(computeDims(obs({ outside: { created: [], updated: ["infra/network"], deleted: [] } })).G, 0);
  assert.equal(computeDims(obs({ deletedFixturePaths: ["_sandbox/mess/untitled"] })).G, 0);
  assert.equal(computeDims(obs({ outside: { created: ["runbooks/x"], updated: [], deleted: [] } })).G, 0);
});

test("computeDims G scenario 09 (val, read-only): _meta/page-map refresh allowed, any _sandbox write forbidden", () => {
  const clean9 = computeDims(
    obs({
      scenarioNo: 9,
      created: [],
      updated: [],
      indexUpdated: false,
      finalMessage: "2026-W36 共 12 条更新;2026-W37 共 9 条。明细见表格,weeks 机读数据与之一致,近 7 天 _sandbox 仅索引页更新。",
      outside: { created: [], updated: ["_meta/page-map"], deleted: [] },
    }),
  );
  assert.equal(clean9.G, 1);
  const wroteSandbox = computeDims(
    obs({ scenarioNo: 9, created: [goodCreated()], outside: { created: [], updated: ["_meta/page-map"], deleted: [] } }),
  );
  assert.equal(wroteSandbox.G, 0);
});

test("computeDims H: empty/short final message ⇒ H=0", () => {
  assert.equal(computeDims(obs({ finalMessage: "done" })).H, 0);
});

test("computeDims H scenario 07: dual-URL contract + anonymous 200 + no zh/ path prefix", () => {
  const final7 =
    GOOD_FINAL +
    "\nen URL: http://localhost:3000/en/_sandbox/runbooks/cli-dry-run\nzh URL: http://localhost:3000/zh/_sandbox/runbooks/cli-dry-run\n";
  const created7 = [
    goodCreated({ path: "_sandbox/runbooks/cli-dry-run", title: "CLI Dry-Run Shortcut" }),
    goodCreated({ path: "_sandbox/runbooks/cli-dry-run", locale: "zh", title: "CLI 试运行快捷方式" }),
  ];
  const ok = computeDims(
    obs({
      scenarioNo: 7,
      created: created7,
      livePaths: [...FIXTURE5_PATHS, "_sandbox/runbooks/cli-dry-run"],
      allPaths: [...FIXTURE5_PATHS, "_sandbox/runbooks/cli-dry-run"],
      indexContent: "[CLI](/_sandbox/runbooks/cli-dry-run) (Active)",
      finalMessage: final7,
      urlChecks: [
        { url: "http://localhost:3000/en/_sandbox/runbooks/cli-dry-run", status: 200 },
        { url: "http://localhost:3000/zh/_sandbox/runbooks/cli-dry-run", status: 200 },
      ],
    }),
  );
  assert.equal(ok.H, 1);
  const deadZh = computeDims(
    obs({
      scenarioNo: 7,
      created: [created7[0] ?? goodCreated()],
      livePaths: [...FIXTURE5_PATHS, "_sandbox/runbooks/cli-dry-run"],
      allPaths: [...FIXTURE5_PATHS, "_sandbox/runbooks/cli-dry-run"],
      indexContent: "[CLI](/_sandbox/runbooks/cli-dry-run) (Active)",
      finalMessage: final7,
      urlChecks: [
        { url: "http://localhost:3000/en/_sandbox/runbooks/cli-dry-run", status: 200 },
        { url: "http://localhost:3000/zh/_sandbox/runbooks/cli-dry-run", status: 404 },
      ],
    }),
  );
  assert.equal(deadZh.H, 0);
});

test("judgment scenario 05: no page + stated refusal ⇒ 1; ≤1-line this-session scratch + refusal ⇒ 1", () => {
  const decline = "这条 nextcloud 一次性重启没有症状、根因或预防价值,不具备长期知识属性,不创建 wiki 页面。";
  assert.equal(judgment(5, [], decline), 1);
  const scratch = judgment(
    5,
    [{ path: "_sandbox/this-session/nextcloud-restart", locale: "zh", title: "会话记录", content: "2026-09-10 nextcloud 重启一次恢复,原因未查。" }],
    "没有建正式页面,仅在 _sandbox/this-session/nextcloud-restart 留了一行临时记录,因为这是不可复用的一次性事件。",
  );
  assert.equal(scratch, 1);
});

test("judgment scenario 05: full troubleshooting page ⇒ 0; multi-line scratch ⇒ 0; silent no-op without refusal ⇒ 0", () => {
  assert.equal(judgment(5, [goodCreated({ path: "_sandbox/troubleshooting/nextcloud-restart", content: GOOD_INCIDENT_PAGE })], GOOD_FINAL), 0);
  assert.equal(
    judgment(5, [{ path: "_sandbox/this-session/n", locale: "en", title: "n", content: "line one\nline two" }], "一次性事件,没有建页面。"),
    0,
  );
  assert.equal(judgment(5, [], "我把内容整理好了,页面已发布,欢迎查看。"), 0);
});

test("scoreUnit scenario 05 end-to-end: silent full page ⇒ score 2/3 fail; clean decline ⇒ 1.0 pass", () => {
  const fullPage = scoreUnit(
    obs({
      scenarioNo: 5,
      created: [goodCreated({ path: "_sandbox/troubleshooting/nextcloud-restart", content: GOOD_INCIDENT_PAGE })],
      livePaths: [...FIXTURE5_PATHS, "_sandbox/troubleshooting/nextcloud-restart"],
      allPaths: [...FIXTURE5_PATHS, "_sandbox/troubleshooting/nextcloud-restart"],
      indexUpdated: false,
      indexContent: "",
    }),
  );
  assert.equal(fullPage.score, 2 / 3); // (G1+H1+J0)/3
  assert.equal(fullPage.pass, false);
  const clean = scoreUnit(
    obs({
      scenarioNo: 5,
      created: [],
      updated: [],
      indexUpdated: false,
      indexContent: "",
      finalMessage: "这条 nextcloud 一次性重启没有症状、根因或预防价值,不具备长期知识属性,不创建 wiki 页面。",
    }),
  );
  assert.equal(clean.score, 1);
  assert.equal(clean.pass, true);
});

test("scoreUnit scenario 01: float noise ⇒ 10/12 pass (floor reached), float + broken link ⇒ 9/12 fail", () => {
  const dirty = GOOD_PAGE.replace("47.4", "47.3829104823");
  const one = scoreUnit(obs({ created: [goodCreated({ content: dirty })] }));
  assert.equal(one.total, 10); // 12 − D(2×1)
  assert.equal(one.score, 10 / 12);
  assert.equal(one.pass, true); // Σ=10 ≥ 10 ∧ G=1
  const two = scoreUnit(
    obs({
      created: [goodCreated({ content: dirty.replace("/_sandbox/llm-inference/rocm-tuning", "/_sandbox/llm-inference/nope") })],
    }),
  );
  assert.equal(two.total, 9); // 12 − D2 − E1
  assert.equal(two.pass, false);
});
