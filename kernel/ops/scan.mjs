import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import {
  OpsError,
  contractPath,
  ledgerPath,
  loadContract,
  sha256,
  sha256File,
  validateContract,
} from "./contract.mjs";

const SKIP = new Set([".git", "node_modules", ".omo", ".codegraph", "dist", "build", "coverage", ".next", ".cache"]);
const TEST_DIRS = new Set(["test", "tests", "spec", "specs", "__tests__", "fixtures"]);
const CODE_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".sh", ".bash", ".rb", ".go", ".rs", ".java", ".kt"]);
const WAIT_PATTERNS = [
  { primitive: "time.sleep", re: /\btime\.sleep\s*\(/ },
  { primitive: "asyncio.sleep", re: /\basyncio\.sleep\s*\(/ },
  { primitive: "setTimeout", re: /\bsetTimeout\s*\(/ },
  { primitive: "Atomics.wait", re: /\bAtomics\.wait\s*\(/ },
  { primitive: "sleep-command", re: /(^|[;&|]\s*)sleep\s+\d/ },
];

export const SCAN_COVERAGE = Object.freeze({
  excluded_dirs: [...SKIP, ...TEST_DIRS].sort(),
  skips_symlinks: true,
  max_depth: 8,
  code_extensions: [...CODE_EXT].sort(),
  wait_primitives: WAIT_PATTERNS.map((item) => item.primitive),
  unsupported_wait_languages: ["go", "rs", "java", "kt", "rb"],
});

function walk(root, dir = root, depth = 0) {
  if (depth > 8) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      if (TEST_DIRS.has(name)) continue;
      out.push(...walk(root, path, depth + 1));
    } else if (CODE_EXT.has(extname(name))) {
      out.push(path);
    }
  }
  return out;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function pyprojectScripts(text) {
  const targets = [];
  let inScripts = false;
  for (const line of text.split("\n")) {
    const table = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (table) {
      inScripts = table[1].trim() === "project.scripts";
      continue;
    }
    if (!inScripts) continue;
    const entry = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*"([^"]+)"/);
    if (entry) targets.push(entry[2]);
  }
  return targets;
}

export function detectSurfaces(root) {
  const base = resolve(root);
  const found = new Map();
  const add = (path, kind) => {
    const rel = relative(base, path);
    if (!rel || rel.startsWith("..")) return;
    found.set(rel, { path: rel, kind, invocation: "argv", wait: "none" });
  };

  const pkgPath = join(base, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = readJson(pkgPath);
    if (pkg?.bin && typeof pkg.bin === "object") {
      for (const target of Object.values(pkg.bin)) {
        if (typeof target === "string") add(join(base, target), "npm-bin");
      }
    }
    if (pkg?.scripts && typeof pkg.scripts === "object") {
      for (const [name, command] of Object.entries(pkg.scripts)) {
        if (typeof command === "string" && !/^(echo|true|false)\b/.test(command)) {
          found.set(`package.json#scripts.${name}`, {
            path: `package.json#scripts.${name}`,
            kind: "npm-script",
            invocation: "shell",
            wait: "none",
          });
        }
      }
    }
  }

  const pyproject = join(base, "pyproject.toml");
  if (existsSync(pyproject)) {
    for (const target of pyprojectScripts(readFileSync(pyproject, "utf8"))) {
      const modulePath = target.split(":")[0].replace(/\./g, "/");
      const candidate = join(base, modulePath);
      add(existsSync(`${candidate}.py`) ? `${candidate}.py` : candidate, "pyproject-script");
    }
  }

  const binDir = join(base, "bin");
  if (existsSync(binDir)) {
    for (const name of readdirSync(binDir)) {
      const path = join(binDir, name);
      const stat = lstatSync(path);
      if (!stat.isSymbolicLink() && stat.isFile()) add(path, "bin-file");
    }
  }

  for (const path of walk(base)) {
    if (path.endsWith(".sh") || path.endsWith(".bash")) add(path, "shell-script");
  }

  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function scanWaitPrimitives(root) {
  const findings = [];
  for (const path of walk(resolve(root))) {
    const text = readFileSync(path, "utf8");
    const lines = text.split("\n");
    for (const [index, line] of lines.entries()) {
      for (const { primitive, re } of WAIT_PATTERNS) {
        if (re.test(line)) {
          findings.push({
            path: relative(resolve(root), path),
            line: index + 1,
            primitive,
            text: line.trim().slice(0, 160),
          });
        }
      }
    }
  }
  return findings;
}

function exceptionCovers(contract, finding) {
  return (contract.exceptions ?? []).find((exception) => {
    if (exception.surface !== finding.path) return false;
    if (exception.primitive !== finding.primitive) return false;
    return Date.parse(exception.expires_at) > Date.now();
  });
}

function expiredExceptions(contract) {
  return (contract.exceptions ?? []).filter((exception) => Date.parse(exception.expires_at) <= Date.now());
}

function readLedger(root) {
  const path = ledgerPath(root);
  if (!existsSync(path)) return { ok: false, code: "NO-PROPAGATION-LEDGER", path };
  const entries = [];
  for (const [index, line] of readFileSync(path, "utf8").split("\n").entries()) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return { ok: false, code: "PROPAGATION-INVALID", path, line: index + 1 };
    }
    if (entry.seq !== index) {
      return { ok: false, code: "PROPAGATION-CHAIN-BROKEN", path, detail: `seq ${entry.seq} at line ${index + 1}` };
    }
    const previous = index ? entries[index - 1].sha256 ?? null : null;
    if ((entry.prev ?? null) !== previous) {
      return { ok: false, code: "PROPAGATION-CHAIN-BROKEN", path, detail: `prev mismatch at line ${index + 1}` };
    }
    const { sha256: recorded, ...body } = entry;
    if (!recorded || recorded !== sha256(JSON.stringify(body))) {
      return { ok: false, code: "PROPAGATION-CHAIN-BROKEN", path, detail: `hash mismatch at line ${index + 1}` };
    }
    entries.push(entry);
  }
  return { ok: true, path, entries, sha256: sha256File(path) };
}

function contractSurfaceChecks(base, declared, detected) {
  const findings = [];
  const declaredPaths = new Set(declared.map((surface) => surface.path));
  const detectedPaths = new Set(detected.map((surface) => surface.path));
  for (const surface of detected) {
    if (!declaredPaths.has(surface.path)) {
      findings.push({ code: "SURFACE-MISSING", path: surface.path, detail: "detected but not declared" });
    }
  }
  for (const surface of declared) {
    if (!detectedPaths.has(surface.path)) {
      findings.push({ code: "SURFACE-STALE", path: surface.path, detail: "declared but not detected" });
    }
    if (!surface.path.includes("#") && !existsSync(join(base, surface.path))) {
      findings.push({ code: "SURFACE-PATH-MISSING", path: surface.path, detail: "declared path does not exist" });
    }
  }
  return findings;
}

export function audit(root) {
  const base = resolve(root);
  const loaded = loadContract(base);
  const scanner = sha256File(new URL("./scan.mjs", import.meta.url));
  const reasons = [];
  const findings = [];
  const detected = detectSurfaces(base);

  if (!loaded.ok) {
    if (loaded.code === "NO-CONTRACT") {
      return {
        state: "UNVERIFIED",
        claim: "LOCAL-INTEGRITY-ONLY",
        reasons: [{ code: "NO-CONTRACT", detail: contractPath(base) }],
        findings: [],
        surfaces: detected,
        detected_surfaces: detected,
        excepted: [],
        excepted_count: 0,
        coverage: SCAN_COVERAGE,
        scanner_sha256: scanner,
        contract_sha256: null,
        ledger_sha256: null,
        ledger_entries: 0,
      };
    }
    return {
      state: "FAIL",
      claim: "LOCAL-INTEGRITY-ONLY",
      reasons: [{ code: loaded.code, detail: loaded.detail ?? loaded.path }],
      findings: [],
      surfaces: [],
      detected_surfaces: detected,
      excepted: [],
      excepted_count: 0,
      coverage: SCAN_COVERAGE,
      scanner_sha256: scanner,
      contract_sha256: null,
      ledger_sha256: null,
      ledger_entries: 0,
    };
  }

  const problems = validateContract(loaded.contract);
  if (problems.length) {
    return {
      state: "FAIL",
      claim: "LOCAL-INTEGRITY-ONLY",
      reasons: problems.map((problem) => ({ code: "CONTRACT-INVALID", detail: problem })),
      findings: [],
      surfaces: loaded.contract.surfaces ?? [],
      detected_surfaces: detected,
      excepted: [],
      excepted_count: 0,
      coverage: SCAN_COVERAGE,
      scanner_sha256: scanner,
      contract_sha256: loaded.sha256,
      ledger_sha256: null,
      ledger_entries: 0,
    };
  }

  for (const exception of expiredExceptions(loaded.contract)) {
    findings.push({ code: "EXCEPTION-EXPIRED", path: exception.surface, expires_at: exception.expires_at });
  }

  findings.push(...contractSurfaceChecks(base, loaded.contract.surfaces, detected));

  const excepted = [];
  for (const finding of scanWaitPrimitives(base)) {
    if (exceptionCovers(loaded.contract, finding)) {
      excepted.push(finding);
      continue;
    }
    findings.push({ code: "WAIT-PRIMITIVE", ...finding });
  }

  const ledger = readLedger(base);
  let ledgerContractSha = null;
  if (!ledger.ok) {
    reasons.push({ code: ledger.code, detail: ledger.detail ?? ledger.path });
  } else if (!ledger.entries.length) {
    reasons.push({ code: "EMPTY-PROPAGATION-LEDGER", detail: ledger.path });
  } else if (ledger.entries[0].type !== "genesis") {
    reasons.push({ code: "LEDGER-NO-GENESIS", detail: ledger.path });
  } else {
    const binding = [...ledger.entries].reverse().find((entry) => entry.contract_sha256);
    if (!binding) {
      reasons.push({ code: "LEDGER-NO-CONTRACT-BINDING", detail: ledger.path });
    } else {
      ledgerContractSha = binding.contract_sha256;
      if (binding.contract_sha256 !== loaded.sha256) {
        findings.push({ code: "LEDGER-CONTRACT-MISMATCH", path: "ops/propagation.jsonl", detail: "ledger does not bind the current contract" });
      }
    }
  }

  if (!loaded.contract.surfaces.length) reasons.push({ code: "NO-SURFACES", detail: contractPath(base) });

  const state = findings.length ? "FAIL" : reasons.length ? "UNVERIFIED" : "LOCAL-PASS";
  if (state === "LOCAL-PASS") {
    reasons.push({ code: "LOCAL-ONLY", detail: "no external anchor; same-uid forgery is not detected" });
  }

  return {
    state,
    claim: "LOCAL-INTEGRITY-ONLY",
    reasons,
    findings,
    surfaces: loaded.contract.surfaces,
    detected_surfaces: detected,
    excepted,
    excepted_count: excepted.length,
    coverage: SCAN_COVERAGE,
    scanner_sha256: scanner,
    contract_sha256: loaded.sha256,
    ledger_sha256: ledger.sha256 ?? null,
    ledger_entries: ledger.entries?.length ?? 0,
    ledger_contract_sha256: ledgerContractSha,
  };
}

export function createContract(root, force = false) {
  const base = resolve(root);
  const path = contractPath(base);
  if (existsSync(path) && !force) {
    throw new OpsError("CONTRACT-EXISTS", `${path} already exists; use --force to replace it`);
  }
  const surfaces = detectSurfaces(base);
  const contract = {
    schema: "abathur.ops.contract.v1",
    project: base.split("/").filter(Boolean).pop() || "project",
    owner: "local",
    created_at: new Date().toISOString(),
    surfaces,
    exceptions: [],
  };
  return { path, contract, surfaces, text: `${JSON.stringify(contract, null, 2)}\n` };
}
