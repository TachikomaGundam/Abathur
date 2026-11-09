import { appendFileSync, existsSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

export const SCHEMA = "abathur.ops.contract.v1";
export const CONTRACT_REL = "ops/execution-contract.json";
export const LEDGER_REL = "ops/propagation.jsonl";
export const MAX_EXCEPTION_DAYS = 90;

export class OpsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OpsError";
    this.code = code;
  }
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function sha256File(path) {
  return sha256(readFileSync(path));
}

export function contractPath(root) {
  return join(resolve(root), CONTRACT_REL);
}

export function parseLedger(text) {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

export function appendLedger(root, entry) {
  const path = ledgerPath(root);
  const entries = existsSync(path) ? parseLedger(readFileSync(path, "utf8")) : [];
  const prev = entries.length ? entries[entries.length - 1].sha256 ?? null : null;
  const body = {
    seq: entries.length,
    ts: new Date().toISOString(),
    prev,
    ...entry,
  };
  body.sha256 = sha256(JSON.stringify(body));
  appendFileSync(path, `${JSON.stringify(body)}\n`);
  return body;
}

export function sealContract(root) {
  const loaded = loadContract(root);
  if (!loaded.ok) throw new OpsError(loaded.code, `${loaded.path} cannot be sealed`);
  return appendLedger(root, {
    type: "contract",
    project: loaded.contract.project,
    contract_sha256: loaded.sha256,
  });
}

export function ledgerPath(root) {
  return join(resolve(root), LEDGER_REL);
}

export function loadContract(root) {
  const path = contractPath(root);
  if (!existsSync(path)) return { ok: false, code: "NO-CONTRACT", path };
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return { ok: false, code: "CONTRACT-SYMLINK", path };
    const text = readFileSync(path, "utf8");
    return { ok: true, path, text, contract: JSON.parse(text), sha256: sha256(text) };
  } catch (error) {
    return { ok: false, code: "CONTRACT-INVALID", path, detail: error.message };
  }
}

export function validateContract(contract) {
  const problems = [];
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    return ["contract must be an object"];
  }
  if (contract.schema !== SCHEMA) problems.push(`schema must be ${SCHEMA}`);
  if (typeof contract.project !== "string" || !contract.project.trim()) problems.push("project is required");
  if (!Array.isArray(contract.surfaces)) problems.push("surfaces must be an array");
  if (!Array.isArray(contract.exceptions)) problems.push("exceptions must be an array");
  for (const [index, surface] of (contract.surfaces ?? []).entries()) {
    if (!surface || typeof surface !== "object") {
      problems.push(`surfaces[${index}] must be an object`);
      continue;
    }
    if (typeof surface.path !== "string" || !surface.path.trim()) problems.push(`surfaces[${index}].path is required`);
    if (surface.invocation && !["argv", "shell", "unknown"].includes(surface.invocation)) {
      problems.push(`surfaces[${index}].invocation is invalid`);
    }
  }
  for (const [index, exception] of (contract.exceptions ?? []).entries()) {
    if (!exception || typeof exception !== "object") {
      problems.push(`exceptions[${index}] must be an object`);
      continue;
    }
    if (typeof exception.surface !== "string" || !exception.surface.trim()) problems.push(`exceptions[${index}].surface is required`);
    if (typeof exception.primitive !== "string" || !exception.primitive.trim()) problems.push(`exceptions[${index}].primitive is required`);
    if (typeof exception.reason !== "string" || !exception.reason.trim()) problems.push(`exceptions[${index}].reason is required`);
    if (!exception.expires_at || Number.isNaN(Date.parse(exception.expires_at))) {
      problems.push(`exceptions[${index}].expires_at must be an ISO date`);
    } else if (Date.parse(exception.expires_at) > Date.now() + MAX_EXCEPTION_DAYS * 24 * 60 * 60 * 1000) {
      problems.push(`exceptions[${index}].expires_at exceeds the ${MAX_EXCEPTION_DAYS}-day maximum`);
    }
  }
  return problems;
}

export function defaultContract(root, surfaces) {
  return {
    schema: SCHEMA,
    project: resolve(root).split("/").filter(Boolean).pop() || "project",
    owner: "local",
    created_at: new Date().toISOString(),
    surfaces,
    exceptions: [],
  };
}
