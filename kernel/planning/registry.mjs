import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export const CLASSES = ["A", "B", "C", "D", "E", "F", "G", "H", "P"];
export const REGISTRY_PATH = new URL("../../rules/registry.yaml", import.meta.url);

/**
 * @param {string} path
 * @returns {{version:number, clauses:Array<Record<string, unknown>>, sha256:string}}
 */
export function loadRegistry(path = REGISTRY_PATH) {
  const raw = readFileSync(path, "utf8");
  const data = JSON.parse(raw);
  return { ...data, sha256: createHash("sha256").update(raw).digest("hex") };
}

/**
 * @param {{clauses?: unknown}} registry
 * @param {Set<string>} [examIds]
 * @returns {string[]} named violations
 */
export function validateRegistry(registry, examIds) {
  const problems = [];
  const clauses = registry?.clauses;
  if (!Array.isArray(clauses) || clauses.length === 0) {
    return ["registry.clauses must be a non-empty array"];
  }
  const ids = new Set();
  for (const [index, clause] of clauses.entries()) {
    const at = `clauses[${index}]`;
    if (!clause || typeof clause !== "object") {
      problems.push(`${at}: not an object`);
      continue;
    }
    const id = typeof clause.id === "string" ? clause.id.trim() : "";
    if (!id) problems.push(`${at}: missing id`);
    else if (ids.has(id)) problems.push(`${at}: duplicate id ${id}`);
    else ids.add(id);
    if (!CLASSES.includes(clause.class)) problems.push(`${at}: illegal class ${String(clause.class)}`);
    if (typeof clause.statement !== "string" || clause.statement.trim().length < 12) {
      problems.push(`${at}: statement too short`);
    }
    const check = clause.check;
    if (!check || typeof check.cmd !== "string" || !check.cmd.trim()) {
      problems.push(`${at}: check.cmd missing`);
    }
    if (!check || !Number.isInteger(check.expect_rc)) {
      problems.push(`${at}: check.expect_rc must be an integer`);
    }
    const hasExam = typeof clause.exam_item === "string" && clause.exam_item.trim() !== "";
    const hasReason = typeof clause.no_exam_reason === "string" && clause.no_exam_reason.trim() !== "";
    if (hasExam === hasReason) problems.push(`${at}: exactly one of exam_item or no_exam_reason required`);
    if (typeof clause.evidence !== "string" || !clause.evidence.startsWith("/")) {
      problems.push(`${at}: evidence must be an absolute path`);
    }
    if (hasExam && examIds && !examIds.has(clause.exam_item)) {
      problems.push(`${at}: exam_item ${clause.exam_item} not present in exam bank`);
    }
  }
  return problems;
}
