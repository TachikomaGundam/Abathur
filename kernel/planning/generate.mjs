import { createHash } from "node:crypto";
import { loadRegistry } from "./registry.mjs";

/**
 * Deterministic rule text. Inputs change -> output changes; same input -> same bytes.
 * @param {{version:number, clauses:Array<Record<string, unknown>>, sha256:string}} registry
 */
export function renderRules(registry) {
  const lines = [
    "# Generated rules — do not edit by hand",
    "",
    `registry-sha256: ${registry.sha256}`,
    `registry-version: ${registry.version}`,
    "",
  ];
  const clauses = [...registry.clauses].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const clause of clauses) {
    lines.push(`## ${clause.id} (${clause.class})`);
    lines.push("");
    lines.push(String(clause.statement));
    lines.push("");
    lines.push(`- check: \`${clause.check.cmd}\` expects rc=${clause.check.expect_rc}`);
    if (clause.exam_item) lines.push(`- exam: ${clause.exam_item}`);
    if (clause.no_exam_reason) lines.push(`- exam exemption: ${clause.no_exam_reason}`);
    lines.push(`- evidence: \`${clause.evidence}\``);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderDigest(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function generateRules(registryPath) {
  const registry = loadRegistry(registryPath);
  const text = renderRules(registry);
  return { text, sha256: renderDigest(text), registrySha256: registry.sha256 };
}
