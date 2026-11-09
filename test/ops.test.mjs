import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { audit, initOps, sealContract } from "../kernel/ops/index.mjs";
import { buildReport, formatHuman } from "../kernel/ops/report.mjs";

const CLI = new URL("../cli/abathur-v2.mjs", import.meta.url).pathname;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "abathur-ops-"));
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin", "tool"), "#!/bin/sh\nexit 0\n");
  return root;
}

function writeContract(root, mutate) {
  const path = join(root, "ops", "execution-contract.json");
  const contract = JSON.parse(readFileSync(path, "utf8"));
  mutate(contract);
  writeFileSync(path, `${JSON.stringify(contract, null, 2)}\n`);
}

test("init creates a contract and a genesis ledger entry", () => {
  const root = fixture();
  const result = initOps(root);
  assert.equal(result.surfaces, 1);
  assert.equal(result.ledgerCreated, true);
  assert.match(readFileSync(join(root, "ops", "execution-contract.json"), "utf8"), /abathur\.ops\.contract\.v1/);
  const ledger = readFileSync(join(root, "ops", "propagation.jsonl"), "utf8").trim().split("\n");
  assert.equal(ledger.length, 1);
  assert.equal(JSON.parse(ledger[0]).type, "genesis");
  assert.equal(audit(root).ledger_entries, 1);
});

test("clean repo reaches LOCAL-PASS with an explicit local-only claim", () => {
  const root = fixture();
  initOps(root);
  const result = audit(root);
  assert.equal(result.state, "LOCAL-PASS");
  assert.equal(result.claim, "LOCAL-INTEGRITY-ONLY");
  assert.ok(result.reasons.some((reason) => reason.code === "LOCAL-ONLY"));
});

test("missing contract is UNVERIFIED, not a green pass", () => {
  const result = audit(fixture());
  assert.equal(result.state, "UNVERIFIED");
  assert.equal(result.reasons[0].code, "NO-CONTRACT");
});

test("wait primitive fails unless an unexpired exception covers it", () => {
  const root = fixture();
  initOps(root);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "poll.mjs"), "await new Promise((resolve) => setTimeout(resolve, 30));\n");
  assert.equal(audit(root).state, "FAIL");
  writeContract(root, (contract) => {
    contract.exceptions.push({
      surface: "src/poll.mjs",
      primitive: "setTimeout",
      reason: "test fixture",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
  });
  sealContract(root);
  assert.equal(audit(root).state, "LOCAL-PASS");
  assert.equal(audit(root).excepted_count, 1);
});

test("expired exceptions fail closed", () => {
  const root = fixture();
  initOps(root);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "poll.mjs"), "await new Promise((resolve) => setTimeout(resolve, 30));\n");
  writeContract(root, (contract) => {
    contract.exceptions.push({
      surface: "src/poll.mjs",
      primitive: "setTimeout",
      reason: "expired",
      expires_at: new Date(Date.now() - 1_000).toISOString(),
    });
  });
  const result = audit(root);
  assert.equal(result.state, "FAIL");
  assert.ok(result.findings.some((finding) => finding.code === "EXCEPTION-EXPIRED"));
});

test("report carries tier, anchor status, and limits", () => {
  const root = fixture();
  initOps(root);
  const report = buildReport(root);
  assert.equal(report.state, "LOCAL-PASS");
  assert.equal(report.claim.tier, "local");
  assert.equal(report.claim.anchored, false);
  assert.equal(report.claim.external_verification, "none");
  assert.ok(report.claim.limits.some((limit) => limit.includes("same-uid")));
  assert.match(formatHuman(report), /OPS LOCAL-PASS/);
  assert.match(formatHuman(report), /not tamper-proof/);
});

test("init refuses to overwrite unless forced", () => {
  const root = fixture();
  initOps(root);
  assert.throws(() => initOps(root), /already exists/);
  assert.doesNotThrow(() => initOps(root, { force: true }));
});

test("CLI returns 0 for local pass and 2 for unverified", () => {
  const root = fixture();
  const init = spawnSync(process.execPath, [CLI, "ops", "init", "--root", root], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  const pass = spawnSync(process.execPath, [CLI, "ops", "audit", "--root", root, "--json"], { encoding: "utf8" });
  assert.equal(pass.status, 0, pass.stderr);
  assert.equal(JSON.parse(pass.stdout).state, "LOCAL-PASS");
  const seal = spawnSync(process.execPath, [CLI, "ops", "seal", "--root", root], { encoding: "utf8" });
  assert.equal(seal.status, 0, seal.stderr);
  assert.match(seal.stdout, /OPS SEAL seq=1/);
  const empty = spawnSync(process.execPath, [CLI, "ops", "audit", "--root", mkdtempSync(join(tmpdir(), "abathur-ops-empty-"))], {
    encoding: "utf8",
  });
  assert.equal(empty.status, 2);
  const again = spawnSync(process.execPath, [CLI, "ops", "init", "--root", root], { encoding: "utf8" });
  assert.equal(again.status, 3);
});

test("report digest is stable across runs because generated_at is excluded", () => {
  const root = fixture();
  initOps(root);
  const first = buildReport(root);
  const second = buildReport(root);
  assert.equal(first.report_sha256, second.report_sha256);
});

test("detected surfaces missing from the contract fail closed", () => {
  const root = fixture();
  initOps(root);
  mkdirSync(join(root, "bin"), { recursive: true });
  writeFileSync(join(root, "bin", "extra"), "#!/bin/sh\nexit 0\n");
  const result = audit(root);
  assert.equal(result.state, "FAIL");
  assert.ok(result.findings.some((finding) => finding.code === "SURFACE-MISSING" && finding.path === "bin/extra"));
});

test("pyproject parser only reads the project.scripts table", () => {
  const root = fixture();
  writeFileSync(
    join(root, "pyproject.toml"),
    '[project]\nname = "demo"\nrequires-python = ">=3.9"\n\n[project.scripts]\ntool = "pkg.mod:main"\n',
  );
  mkdirSync(join(root, "pkg"));
  writeFileSync(join(root, "pkg", "mod.py"), "def main():\n    return 0\n");
  const result = initOps(root);
  const contract = JSON.parse(readFileSync(join(root, "ops", "execution-contract.json"), "utf8"));
  assert.equal(result.surfaces, 2);
  assert.deepEqual(contract.surfaces.map((surface) => surface.path).sort(), ["bin/tool", "pkg/mod.py"]);
});

test("exceptions require a primitive and a bounded expiry", () => {
  const root = fixture();
  initOps(root);
  writeContract(root, (contract) => {
    contract.exceptions.push({ surface: "bin/tool", reason: "wildcard", expires_at: new Date(Date.now() + 60_000).toISOString() });
  });
  assert.equal(audit(root).state, "FAIL");
  writeContract(root, (contract) => {
    contract.exceptions = [
      {
        surface: "bin/tool",
        primitive: "setTimeout",
        reason: "too long",
        expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ];
  });
  assert.equal(audit(root).state, "FAIL");
});

test("contract edits fail until the ledger is sealed", () => {
  const root = fixture();
  initOps(root);
  writeContract(root, (contract) => {
    contract.exceptions.push({
      surface: "bin/tool",
      primitive: "setTimeout",
      reason: "binding test",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
  });
  const before = audit(root);
  assert.equal(before.state, "FAIL");
  assert.ok(before.findings.some((finding) => finding.code === "LEDGER-CONTRACT-MISMATCH"));
  assert.equal(before.ledger_contract_sha256.length, 64);
  sealContract(root);
  const after = audit(root);
  assert.equal(after.state, "LOCAL-PASS");
  assert.equal(after.contract_sha256, after.ledger_contract_sha256);
});

test("report discloses exclusions and counts excepted findings", () => {
  const root = fixture();
  initOps(root);
  const report = buildReport(root);
  assert.ok(report.coverage.excluded_dirs.includes("dist"));
  assert.equal(report.excepted_count, 0);
  assert.ok(report.claim.limits.some((limit) => limit.includes("excludes test/dist")));
});
