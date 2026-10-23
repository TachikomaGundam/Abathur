// Install-contract pins (incident 2026-10-23, sibyl-20261023T094435Z-d2a1 must-fixes):
// the 0.4.0 incident shipped an engines declaration the dependency closure could
// not honor. These tests pin the declaration surface so a rebuild or a dependency
// form flip cannot silently regress it again.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function readJson(rel: string): Record<string, unknown> {
  const text = readFileSync(path.join(repoRoot, rel), "utf8");
  // tsconfig files are JSONC: strip full-line comments before parsing.
  const stripped = rel.includes("tsconfig") ? text.replace(/^\s*\/\/.*$/gm, "") : text;
  return JSON.parse(stripped) as Record<string, unknown>;
}

test("engines floor is the measured minimum (decision: loop/proposals/engine-engines-decision-20261023.md)", () => {
  const pkg = readJson("package.json");
  const engines = pkg["engines"] as Record<string, unknown>;
  assert.equal(
    engines["node"],
    ">=22.22.1",
    "engines floor = the lowest node this repo's full suite is measured green on; do not re-widen or re-tighten without a measured matrix",
  );
});

test("@opencode-ai/plugin is peer-optional, never a runtime dependency (F5 flip-flop stopper)", () => {
  const pkg = readJson("package.json");
  const deps = (pkg["dependencies"] ?? {}) as Record<string, unknown>;
  const peers = pkg["peerDependencies"] as Record<string, unknown>;
  const meta = pkg["peerDependenciesMeta"] as Record<string, Record<string, unknown>>;
  assert.ok(!("@opencode-ai/plugin" in deps), "SDK must not be a runtime dep (drags the effect-beta -> ini chain onto every install)");
  assert.equal(peers["@opencode-ai/plugin"], ">=1.19.3");
  assert.equal(meta["@opencode-ai/plugin"]?.["optional"], true);
});

test("production dependency closure carries no beta/prerelease packages (Q4 gate 4)", () => {
  const lock = readJson("package-lock.json");
  const packages = lock["packages"] as Record<string, Record<string, unknown>>;
  const offenders: string[] = [];
  for (const [where, entry] of Object.entries(packages)) {
    if (where === "") continue;
    if (entry["dev"] === true) continue;
    const version = String(entry["version"] ?? "");
    if (/-(beta|alpha|rc)\./.test(version)) offenders.push(`${where}@${version}`);
  }
  assert.deepEqual(offenders, [], "non-dev closure must be prerelease-free");
});

test("production dependency closure does not contain the ini chain at all", () => {
  const lock = readJson("package-lock.json");
  const packages = lock["packages"] as Record<string, Record<string, unknown>>;
  const root = packages[""] as Record<string, unknown>;
  const rootDeps = (root["dependencies"] ?? {}) as Record<string, unknown>;
  assert.ok(!("@opencode-ai/plugin" in rootDeps), "root runtime deps must not include the plugin SDK");
  for (const [where, entry] of Object.entries(packages)) {
    if (!/node_modules\/(ini|effect)$/.test(where)) continue;
    assert.equal(entry["dev"], true, `${where} may exist only as a dev-side entry`);
  }
});

test("plugin adapter typecheck config exists and covers the adapter", () => {
  const cfg = readJson("tsconfig.plugin.json");
  assert.deepEqual(cfg["include"], ["plugin/abathur.ts"]);
});
