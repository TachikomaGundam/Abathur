"use strict";
// Shared recorded fixtures for the historian grader tests (task 14). NOT a test
// file — importing this module registers no tests (unlike importing a .test.js).
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GOOD_FINAL = exports.GOOD_INCIDENT_PAGE = exports.GOOD_PAGE = exports.FIXTURE5_PATHS = void 0;
exports.goodCreated = goodCreated;
exports.obs = obs;
exports.FIXTURE5_PATHS = [
    "_sandbox/index",
    "_sandbox/llm-inference/rocm-tuning",
    "_sandbox/mess/untitled",
    "_sandbox/mess/gpu-notes",
    "_sandbox/mess/gpu-stuff",
];
exports.GOOD_PAGE = "# Qwen 27B Threading Findings\n\n> Status: Active | Updated: 2026-09-10 | Scope: llama.cpp decode tuning on the rocm host\n\nThis page answers: which settings moved qwen-27b decode throughput.\n\n## Findings\n\n- `HSA_OVERRIDE_GFX_VERSION=11.0.0` plus 8 threads lifted decode from 47.4 to 53.7 tok/s.\n\n## Method\n\nRun under test: `./llama-server -m qwen-27b.gguf --threads 8 --ctx-size 8192`\n\n## Related Pages\n\n- [ROCm tuning](/_sandbox/llm-inference/rocm-tuning)\n";
exports.GOOD_INCIDENT_PAGE = "# Wiki ES OOM 2026-08-28\n\n> Status: Active | Updated: 2026-09-10 | Scope: 502/OOM incident on the wiki host\n\nThis page answers: what happened, why, and how it is prevented.\n\n## Symptoms\n\n- Wiki.js returned HTTP 502 for 19 minutes; users saw spinning search boxes.\n\n## Root Cause\n\n- Elasticsearch JVM heap was unbounded after the host RAM upgrade.\n\n## Fix\n\n- Capped the heap with `ES_JAVA_OPTS=-Xms4g -Xmx4g`; added a restart policy.\n\n## Prevention\n\n- Review heap caps after host-memory changes; alert on repeated restarts.\n\n## Related Pages\n\n- [ROCm tuning](/_sandbox/llm-inference/rocm-tuning)\n";
exports.GOOD_FINAL = "已在 _sandbox/llm-inference/qwen27b-threading 创建调优结论页,链接到 _sandbox/llm-inference/rocm-tuning," +
    "并更新了 _sandbox/index 的 LLM Inference 小节;首 token 没有正式测量,按要求不作为结论写入。";
function goodCreated(over) {
    if (over === void 0) { over = {}; }
    return __assign({ path: "_sandbox/llm-inference/qwen27b-threading", locale: "en", title: "Qwen 27B Threading Findings", content: exports.GOOD_PAGE }, over);
}
function obs(over) {
    if (over === void 0) { over = {}; }
    return __assign({ scenarioNo: 1, created: [goodCreated()], updated: [], moved: [], deletedFixturePaths: [], outside: { created: [], updated: [], deleted: [] }, indexUpdated: true, indexContent: "## LLM Inference\n- [Qwen 27B Threading Findings](/_sandbox/llm-inference/qwen27b-threading) (Active)\n- [ROCm tuning](/_sandbox/llm-inference/rocm-tuning) (Active)", livePaths: __spreadArray(__spreadArray([], exports.FIXTURE5_PATHS, true), ["_sandbox/llm-inference/qwen27b-threading"], false), allPaths: __spreadArray(__spreadArray([], exports.FIXTURE5_PATHS, true), ["_sandbox/llm-inference/qwen27b-threading", "infra/network"], false), backlinkBodies: [], finalMessage: exports.GOOD_FINAL, urlChecks: [] }, over);
}
