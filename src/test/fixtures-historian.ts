// Shared recorded fixtures for the historian grader tests (task 14). NOT a test
// file — importing this module registers no tests (unlike importing a .test.js).

import type { CreatedPage, Observation } from "../../graders/historian/grader-core.mjs";

export const FIXTURE5_PATHS = [
  "_sandbox/index",
  "_sandbox/llm-inference/rocm-tuning",
  "_sandbox/mess/untitled",
  "_sandbox/mess/gpu-notes",
  "_sandbox/mess/gpu-stuff",
];

export const GOOD_PAGE = `# Qwen 27B Threading Findings

> Status: Active | Updated: 2026-09-10 | Scope: llama.cpp decode tuning on the rocm host

This page answers: which settings moved qwen-27b decode throughput.

## Findings

- \`HSA_OVERRIDE_GFX_VERSION=11.0.0\` plus 8 threads lifted decode from 47.4 to 53.7 tok/s.

## Method

Run under test: \`./llama-server -m qwen-27b.gguf --threads 8 --ctx-size 8192\`

## Related Pages

- [ROCm tuning](/_sandbox/llm-inference/rocm-tuning)
`;

export const GOOD_INCIDENT_PAGE = `# Wiki ES OOM 2026-08-28

> Status: Active | Updated: 2026-09-10 | Scope: 502/OOM incident on the wiki host

This page answers: what happened, why, and how it is prevented.

## Symptoms

- Wiki.js returned HTTP 502 for 19 minutes; users saw spinning search boxes.

## Root Cause

- Elasticsearch JVM heap was unbounded after the host RAM upgrade.

## Fix

- Capped the heap with \`ES_JAVA_OPTS=-Xms4g -Xmx4g\`; added a restart policy.

## Prevention

- Review heap caps after host-memory changes; alert on repeated restarts.

## Related Pages

- [ROCm tuning](/_sandbox/llm-inference/rocm-tuning)
`;

export const GOOD_FINAL =
  "已在 _sandbox/llm-inference/qwen27b-threading 创建调优结论页,链接到 _sandbox/llm-inference/rocm-tuning," +
  "并更新了 _sandbox/index 的 LLM Inference 小节;首 token 没有正式测量,按要求不作为结论写入。";

export function goodCreated(over: Partial<CreatedPage> = {}): CreatedPage {
  return {
    path: "_sandbox/llm-inference/qwen27b-threading",
    locale: "en",
    title: "Qwen 27B Threading Findings",
    content: GOOD_PAGE,
    ...over,
  };
}

export function obs(over: Partial<Observation> = {}): Observation {
  return {
    scenarioNo: 1,
    created: [goodCreated()],
    updated: [],
    moved: [],
    deletedFixturePaths: [],
    outside: { created: [], updated: [], deleted: [] },
    indexUpdated: true,
    indexContent: `## LLM Inference\n- [Qwen 27B Threading Findings](/_sandbox/llm-inference/qwen27b-threading) (Active)\n- [ROCm tuning](/_sandbox/llm-inference/rocm-tuning) (Active)`,
    livePaths: [...FIXTURE5_PATHS, "_sandbox/llm-inference/qwen27b-threading"],
    allPaths: [...FIXTURE5_PATHS, "_sandbox/llm-inference/qwen27b-threading", "infra/network"],
    backlinkBodies: [],
    finalMessage: GOOD_FINAL,
    urlChecks: [],
    ...over,
  };
}
