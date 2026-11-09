import { resolve } from "node:path";
import { sha256 } from "./contract.mjs";
import { audit } from "./scan.mjs";

export const GUARANTEES = [
  "deterministic checks run against the local checkout",
  "declared surfaces and wait primitives are inspected",
  "expired exceptions and malformed contracts fail closed",
  "the report digest is reproducible from the same files",
];

export const LIMITS = [
  "not tamper-proof against a same-uid process",
  "no external anchor or independent timestamp",
  "not a sandbox and not a malicious-code detector",
  "excludes test/dist/build/coverage/.next directories, symlinks, depth > 8, and languages without wait patterns",
  "excepted findings are counted; suppression is visible but not independently verified",
];

export function buildReport(root) {
  const base = resolve(root);
  const result = audit(base);
  const body = {
    schema: "abathur.ops.report.v1",
    project: base,
    generated_at: new Date().toISOString(),
    state: result.state,
    claim: {
      tier: "local",
      anchored: false,
      external_verification: "none",
      label: result.claim,
      guarantees: GUARANTEES,
      limits: LIMITS,
    },
    evidence: {
      scanner_sha256: result.scanner_sha256,
      contract_sha256: result.contract_sha256,
      ledger_sha256: result.ledger_sha256,
      ledger_entries: result.ledger_entries,
      ledger_contract_sha256: result.ledger_contract_sha256 ?? null,
    },
    reasons: result.reasons,
    findings: result.findings,
    excepted_count: result.excepted_count,
    excepted: result.excepted,
    surfaces: result.surfaces,
    detected_surfaces: result.detected_surfaces,
    coverage: result.coverage,
  };
  const { generated_at, ...hashBody } = body;
  body.report_sha256 = sha256(JSON.stringify(hashBody));
  return body;
}

export function formatHuman(report) {
  const lines = [];
  lines.push(`OPS ${report.state} tier=${report.claim.tier} anchored=${report.claim.anchored}`);
  lines.push(`claim: ${report.claim.label} (${report.claim.external_verification})`);
  if (report.reasons.length) {
    lines.push("reasons:");
    for (const reason of report.reasons) lines.push(`  - ${reason.code}: ${reason.detail ?? ""}`.trimEnd());
  }
  if (report.findings.length) {
    lines.push("findings:");
    for (const finding of report.findings) {
      const where = finding.line ? `${finding.path}:${finding.line}` : finding.path ?? "";
      lines.push(`  - ${finding.code}: ${where} ${finding.primitive ?? ""} ${finding.text ?? ""}`.trimEnd());
    }
  }
  lines.push(`excepted=${report.excepted_count ?? 0} surfaces=${report.surfaces.length} detected=${report.detected_surfaces.length}`);
  lines.push("limits:");
  for (const limit of report.claim.limits) lines.push(`  - ${limit}`);
  lines.push(`ledger_contract_sha256=${report.evidence.ledger_contract_sha256 ?? "none"}`);
  lines.push(`report_sha256=${report.report_sha256}`);
  return `${lines.join("\n")}\n`;
}

export function auditText(root) {
  const report = buildReport(root);
  return { report, text: formatHuman(report) };
}
