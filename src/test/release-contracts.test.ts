// release-contracts.test.ts — pins for the 庭C correction pack (0.4.0):
// env-contract vs plugin INJECTABLE_KEYS, genome-paths coverage, checklist /
// README / skill-surface coherence. Pure file-level pins (no spawning).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Minimal JSONC stripper (line // comments + trailing commas) for config files. */
function readJsonc(rel: string): any {
  const raw = readFileSync(path.join(REPO, rel), "utf8");
  const stripped = raw
    .split("\n")
    .map((l) => {
      const i = l.indexOf("//");
      return i >= 0 ? l.slice(0, i) : l;
    })
    .join("\n")
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(stripped);
}

test("env-contract injectableKeys == plugin INJECTABLE_KEYS (single source)", () => {
  const contract = readJsonc("config/env-contract.jsonc");
  const pluginSrc = readFileSync(path.join(REPO, "plugin", "abathur.ts"), "utf8");
  const m = pluginSrc.match(/INJECTABLE_KEYS\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, "plugin INJECTABLE_KEYS literal not found");
  const pluginKeys = [...(m[1] as string).matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
  assert.deepEqual([...contract.injectableKeys].sort(), pluginKeys);
  // every key must carry a semantics entry (no silent keys)
  for (const k of contract.injectableKeys) {
    assert.ok(typeof contract.semantics[k] === "string" && contract.semantics[k].length > 0, `missing semantics for ${k}`);
  }
});

test("genome-paths.jsonc covers every ${VAR} literal used by genomes/**", () => {
  const mapping = readJsonc("config/genome-paths.jsonc");
  const knownEnvs = new Set(Object.values(mapping).map((v: any) => v.repoEnv as string));
  const varRe = /\$\{([A-Z0-9_]+)\}/g;
  const used = new Set<string>();
  const walk = (dir: string): void => {
    for (const ent of readdirSync(dir)) {
      const p = path.join(dir, ent);
      if (statSync(p).isDirectory()) walk(p);
      else if (ent.endsWith(".jsonc")) {
        // Only repoPath values are in scope — templates legitimately use
        // ${VAR} for URLs/keys that never resolve through the FS seam.
        for (const line of readFileSync(p, "utf8").split("\n")) {
          if (!/"repoPath"\s*:/.test(line)) continue;
          for (const mm of line.matchAll(varRe)) used.add(mm[1] as string);
        }
      }
    }
  };
  walk(path.join(REPO, "genomes"));
  walk(path.join(REPO, "config", "genomes"));
  for (const v of used) {
    assert.ok(knownEnvs.has(v), `genome repoPath uses \${${v}} but config/genome-paths.jsonc has no entry for it`);
  }
});

test("release checklist references the two contract scripts", () => {
  const checklist = readFileSync(path.join(REPO, "docs", "release", "CHECKLIST.md"), "utf8");
  assert.ok(checklist.includes("check-engine-version.sh"), "checklist missing check-engine-version.sh");
  assert.ok(checklist.includes("c-face-smoke.sh"), "checklist missing c-face-smoke.sh");
  assert.ok(checklist.includes("release-lease.sh acquire"), "checklist missing lease step");
});

test("README carries the Tier-1 honest capability-limits section", () => {
  const readme = readFileSync(path.join(REPO, "README.md"), "utf8");
  assert.ok(readme.includes("honest capability limits"), "README missing capability-limits section");
  assert.ok(readme.includes("FALLBACK-PROBE"), "README limits section must name the degraded mode");
});

test("packaged skill exists and references real loop paths", () => {
  const skill = readFileSync(path.join(REPO, "skills", "abathur-loop", "SKILL.md"), "utf8");
  assert.ok(skill.includes("name: abathur-loop"));
  assert.ok(skill.includes("loop/bank.py"), "skill must reference loop/bank.py");
  assert.ok(!skill.includes(".omo/loop/"), "skill must not reference the .omo/loop/ mispath");
  const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));
  assert.ok(pkg.files.includes("skills"), "package.json files must ship skills/");
});

test("package.json files is exactly the narrow D-face allowlist (0.2.8/0.2.9 pollution lesson)", () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));
  const expected = [
    "dist/bench", "dist/cli.js", "dist/commands", "dist/config.js", "dist/core",
    "dist/exit.js", "dist/genomes", "dist/jsonc.js", "dist/out.js",
    "dist/release-state.js", "dist/util", "dist/version.js",
    "dist/version-manifest.json", "dist/engine-registry.json",
    "config/abathur.jsonc", "docs/immutable-kernel.md", "plugin", "skills",
  ];
  assert.deepEqual([...pkg.files].sort(), [...expected].sort(),
    "files allowlist drifted — widening it reopens the foreign-material channel (0.2.9 shipped 25 pcb-agent files)");
  assert.ok(!pkg.files.includes("graders"), "graders/ is per-line bench material — never shipped");
});
