import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { appendLedger, ledgerPath, sha256 } from "./contract.mjs";
import { createContract } from "./scan.mjs";

export function initOps(root, { force = false } = {}) {
  const result = createContract(root, force);
  mkdirSync(dirname(result.path), { recursive: true });
  writeFileSync(result.path, result.text);
  const ledger = ledgerPath(root);
  let ledgerCreated = false;
  if (!existsSync(ledger) || !readFileSync(ledger, "utf8").trim()) {
    appendLedger(root, {
      type: "genesis",
      project: result.contract.project,
      contract_sha256: sha256(result.text),
    });
    ledgerCreated = true;
  } else if (force) {
    appendLedger(root, {
      type: "contract",
      project: result.contract.project,
      contract_sha256: sha256(result.text),
    });
  }
  return {
    contract: result.path,
    surfaces: result.surfaces.length,
    ledger,
    ledgerCreated,
    force,
  };
}
