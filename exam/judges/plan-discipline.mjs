#!/usr/bin/env node
/**
 * Rubric judge for SR4-76 plan-discipline. Reads JSON {item, answer} on stdin and
 * emits the closed verdict shape used by exam/runner.mjs.
 *
 * The four required findings are the ones registered in exam/bank.mjs:
 *   1. the plan is unexecutable
 *   2. it copies the old code and calls it a rewrite
 *   3. it has no Must-NOT-Have guardrail list
 *   4. at least one todo has no QA
 */
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));
const item = input.item ?? {};
const answer = String(input.answer ?? "");

const checks = [
  {
    id: "S1-unexecutable",
    pass: /(不可执行|无法执行|not executable|unexecutable|reject|拒绝)/i.test(answer),
    reason: "answer must call the plan unexecutable",
  },
  {
    id: "S2-whole-copy",
    pass: /(整拷|整段复制|复制旧|copy(?:ing)? (?:the )?old|whole[- ]copy|old code)/i.test(answer),
    reason: "answer must name the whole-copy-old-code defect",
  },
  {
    id: "S3-must-not-have",
    pass: /(must[- ]not[- ]have|禁止清单|禁区|guardrail|no guardrails)/i.test(answer),
    reason: "answer must name the missing Must-NOT-Have list",
  },
  {
    id: "S4-todo-qa",
    pass: /(QA|验收|acceptance|no test|缺(?:少)?(?:QA|验收))/i.test(answer),
    reason: "answer must name the todo missing QA",
  },
];

const items = checks.map((check) => ({
  id: check.id,
  status: check.pass ? "PASS" : "FAIL",
  reason: check.pass ? "finding present" : check.reason,
}));
const verdict = items.every((row) => row.status === "PASS") ? "PASS" : "FAIL";
const canary = item.canary === true;
const canaryKill = canary && verdict === "FAIL";

process.stdout.write(
  `${JSON.stringify({
    verdict,
    canary_kill: canaryKill,
    answer_sha256: process.env.ABATHUR_ANSWER_SHA256 ?? "0".repeat(64),
    judge_session: `rubric:${item.id ?? "unknown"}`,
    items,
    evidence: [process.env.ABATHUR_JUDGE_EVIDENCE ?? "/dev/null"],
  })}\n`,
);
