import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const NEEDLE = "child_" + "process";
const SPAWN_SYMBOLS = Object.freeze([
  "spawn",
  "spawnSync",
  "exec",
  "execSync",
  "execFile",
  "execFileSync",
  "fork",
]);
const EXCLUDED_DIRS = Object.freeze(new Set([".git", "node_modules", ".omo", ".codegraph"]));
const SCAN_EXTENSIONS = Object.freeze(new Set([".js", ".mjs", ".cjs"]));
const TEXT_LIMIT_BYTES = 2 * 1024 * 1024;

export const CONSTANTS = Object.freeze({
  RUNNER_PATH: "kernel/exec/runner.mjs",
  TRUSTED_PATHS: Object.freeze([
    "kernel/exec/bwrap.mjs",
    "scripts/scan-quality.mjs",
    "scripts/compare-baseline.mjs",
    ".opencode/plugins/sandbox-bash.js",
    "scripts/release-prepare.mjs",
    "scripts/scan-workfiles.mjs",
    "scripts/scan-package.mjs",
  ]),
  TEST_HARNESS_PATHS: Object.freeze([
    "test/cli.test.mjs",
    "test/containment.test.mjs",
    "test/copygate.test.mjs",
    "test/coupling.test.mjs",
    "test/plan-check.test.mjs",
    "test/ops.test.mjs",
    "test/receipts.test.mjs",
    "test/release-candidate.test.mjs",
    "test/surface-cwd.test.mjs",
    "test/surface-record.test.mjs",
  ]),
  LEGACY_BASELINE_PATHS: Object.freeze([
    "cli/abathur-v2.mjs",
    "exam/runner.mjs",
    "exam/spawn.mjs",
    "kernel/evidence/anchor.mjs",
    "kernel/judge/defects.mjs",
    "kernel/planning/review.mjs",
    "scripts/release-candidate.mjs",
    "scripts/copy-gate.mjs",
  ]),
  LEGACY_TARGET_BASELINE: 8,
  TEST_HARNESS_BASELINE: 10,
});

const CLASSES = new Set(["runner", "trusted-controller", "legacy-target", "test-harness"]);

export class GateError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "GateError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new GateError(code, message);
}

function toPosix(value) {
  return value.split(sep).join("/");
}

function readText(abs) {
  const stat = statSync(abs);
  if (stat.size > TEXT_LIMIT_BYTES) return null;
  const buffer = readFileSync(abs);
  if (buffer.includes(0)) return null;
  return buffer.toString("utf8");
}

function isInside(root, abs) {
  const rel = relative(root, abs);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
}

function walk(root, out = [], dir = root) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, name.name);
    if (name.isSymbolicLink()) continue;
    if (name.isDirectory()) {
      if (EXCLUDED_DIRS.has(name.name)) continue;
      walk(root, out, abs);
      continue;
    }
    if (!name.isFile()) continue;
    out.push(toPosix(relative(root, abs)));
  }
  return out;
}

export function containsSpawnToken(text) {
  return typeof text === "string" && text.includes(NEEDLE);
}

export function findSpawnFiles(root) {
  const realRoot = realpathSync(root);
  const files = [];
  for (const rel of walk(realRoot)) {
    const dot = rel.lastIndexOf(".");
    const ext = dot === -1 ? "" : rel.slice(dot);
    const hasKnownExt = SCAN_EXTENSIONS.has(ext);
    if (!hasKnownExt && ext !== "") continue;
    const abs = join(realRoot, rel);
    if (lstatSync(abs).isSymbolicLink()) continue;
    const text = readText(abs);
    if (text === null) continue;
    if (containsSpawnToken(text)) files.push(rel);
  }
  return files.sort();
}

function readPolicy(root, policyPath) {
  const abs = policyPath ?? join(root, "kernel", "exec", "spawn-policy.json");
  let raw;
  try {
    raw = readFileSync(abs, "utf8");
  } catch (error) {
    fail("SPAWN-POLICY-INVALID", `cannot read ${abs}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail("SPAWN-POLICY-INVALID", `cannot parse ${abs}: ${error.message}`);
  }
}

function asSet(values) {
  return new Set(values);
}

function sameSet(left, right) {
  if (left.size !== right.size) return false;
  for (const item of left) if (!right.has(item)) return false;
  return true;
}

export function validatePolicy(policy, root, constants = CONSTANTS) {
  const realRoot = realpathSync(root);
  if (!policy || !Array.isArray(policy.entries)) {
    fail("SPAWN-POLICY-INVALID", "policy.entries must be an array");
  }
  const seen = new Set();
  const counts = { runner: 0, "trusted-controller": 0, "legacy-target": 0, "test-harness": 0 };
  const byClass = {
    runner: new Set(),
    "trusted-controller": new Set(),
    "legacy-target": new Set(),
    "test-harness": new Set(),
  };
  for (const [index, entry] of policy.entries.entries()) {
    if (!entry || typeof entry !== "object") {
      fail("SPAWN-POLICY-INVALID", `entry ${index} is not an object`);
    }
    if (typeof entry.path !== "string" || entry.path.length === 0) {
      fail("SPAWN-POLICY-INVALID", `entry ${index} has no path`);
    }
    if (typeof entry.reason !== "string" || entry.reason.trim().length === 0) {
      fail("SPAWN-POLICY-INVALID", `entry ${index} has no reason`);
    }
    if (!CLASSES.has(entry.class)) {
      fail("SPAWN-POLICY-INVALID", `entry ${index} has unknown class ${entry.class}`);
    }
    const rel = toPosix(entry.path);
    if (rel.startsWith("/") || rel.split("/").includes("..")) {
      fail("SPAWN-PATH-ESCAPE", `entry ${index} path escapes the repo: ${entry.path}`);
    }
    const abs = resolve(realRoot, rel);
    if (!isInside(realRoot, abs)) {
      fail("SPAWN-PATH-ESCAPE", `entry ${index} resolves outside the repo: ${entry.path}`);
    }
    let stat;
    try {
      stat = lstatSync(abs);
    } catch {
      fail("SPAWN-STALE", `registry path does not exist: ${entry.path}`);
    }
    if (stat.isSymbolicLink()) {
      fail("SPAWN-PATH-ESCAPE", `registry path is a symlink: ${entry.path}`);
    }
    let real;
    try {
      real = realpathSync(abs);
    } catch {
      fail("SPAWN-STALE", `registry path cannot be resolved: ${entry.path}`);
    }
    if (!isInside(realRoot, real)) {
      fail("SPAWN-PATH-ESCAPE", `registry path resolves outside the repo: ${entry.path}`);
    }
    const key = toPosix(relative(realRoot, real));
    if (seen.has(key)) {
      fail("SPAWN-DUPLICATE", `registry path is duplicated: ${key}`);
    }
    seen.add(key);
    if (entry.class === "legacy-target") {
      if (typeof entry.nextStage !== "string" || entry.nextStage.trim().length === 0) {
        fail("SPAWN-POLICY-INVALID", `legacy-target ${entry.path} has no nextStage`);
      }
      if (!constants.LEGACY_BASELINE_PATHS.includes(key)) {
        fail("SPAWN-POLICY-INVALID", `legacy-target is not in the baseline: ${key}`);
      }
    }
    counts[entry.class] += 1;
    byClass[entry.class].add(key);
  }

  const runner = byClass.runner;
  if (!sameSet(runner, asSet([constants.RUNNER_PATH]))) {
    fail("SPAWN-POLICY-INVALID", `runner class must be exactly ${constants.RUNNER_PATH}`);
  }
  if (!sameSet(byClass["trusted-controller"], asSet(constants.TRUSTED_PATHS))) {
    fail("SPAWN-POLICY-INVALID", "trusted-controller paths do not match the code constants");
  }
  if (!sameSet(byClass["test-harness"], asSet(constants.TEST_HARNESS_PATHS))) {
    fail("SPAWN-POLICY-INVALID", "test-harness paths do not match the code constants");
  }
  if (counts["legacy-target"] > constants.LEGACY_TARGET_BASELINE) {
    fail(
      "SPAWN-POLICY-INVALID",
      `legacy-target count ${counts["legacy-target"]} exceeds baseline ${constants.LEGACY_TARGET_BASELINE}`,
    );
  }
  if (counts["test-harness"] > constants.TEST_HARNESS_BASELINE) {
    fail(
      "SPAWN-POLICY-INVALID",
      `test-harness count ${counts["test-harness"]} exceeds baseline ${constants.TEST_HARNESS_BASELINE}`,
    );
  }
  return { counts, paths: seen, byClass };
}

export function scanReexport(text) {
  if (typeof text !== "string" || !text.includes("export")) return false;
  const start = text.indexOf("export");
  const tail = text.slice(start, start + 2000);
  return SPAWN_SYMBOLS.some((symbol) => new RegExp(`\\b${symbol}\\b`).test(tail));
}

export function runGate(root = process.cwd(), options = {}) {
  const realRoot = realpathSync(root);
  const policy = options.policy ?? readPolicy(realRoot, options.policyPath);
  const constants = options.constants ?? CONSTANTS;
  const { counts, paths } = validatePolicy(policy, realRoot, constants);
  const discovered = findSpawnFiles(realRoot);
  const errors = [];
  const registered = new Set(paths);
  const discoveredSet = new Set(discovered);

  for (const rel of discovered) {
    if (!registered.has(rel)) {
      errors.push(`SPAWN-UNCLASSIFIED: ${rel} contains the spawn token but is not registered`);
    }
  }
  for (const rel of registered) {
    if (!discoveredSet.has(rel)) {
      errors.push(`SPAWN-STALE: ${rel} is registered but no longer contains the spawn token`);
    }
  }
  for (const rel of discovered) {
    if (registered.has(rel)) continue;
    const text = readText(join(realRoot, rel));
    if (text && scanReexport(text)) {
      errors.push(`SPAWN-REEXPORT: ${rel} re-exports a spawn symbol but is not registered`);
    }
  }

  return { ok: errors.length === 0, root: realRoot, counts, discovered, registered: [...registered].sort(), errors };
}

function main(argv) {
  let root = process.cwd();
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") {
      root = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--json") {
      json = true;
    } else {
      process.stderr.write(`spawn-gate: unknown argument ${argv[index]}\n`);
      return 2;
    }
  }
  try {
    const result = runGate(root);
    if (json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else if (result.ok) {
      process.stdout.write(
        `SPAWN-GATE OK files=${result.discovered.length} runner=${result.counts.runner} ` +
          `trusted=${result.counts["trusted-controller"]} legacy=${result.counts["legacy-target"]} ` +
          `test=${result.counts["test-harness"]}\n`,
      );
    } else {
      for (const error of result.errors) process.stderr.write(`${error}\n`);
    }
    return result.ok ? 0 : 2;
  } catch (error) {
    process.stderr.write(error instanceof GateError ? `${error.message}\n` : `spawn-gate: ${error.message}\n`);
    return 2;
  }
}

const invoked = process.argv[1] ? realpathSync(process.argv[1]) : "";
const self = fileURLToPath(import.meta.url);
if (invoked === self) {
  process.exitCode = main(process.argv.slice(2));
}
