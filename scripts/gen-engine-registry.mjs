// Build-step generator for dist/engine-registry.json (Tier-1 design v9, M3).
//
// The registry is the plugin's contract for two facts about THIS build:
//   - writeCommands: argv prefixes of write-side commands (the T2 guard's
//     process-disproof match set; fail-closed: a command missing from the
//     classification below is a BUILD ERROR here, never a silent default).
//   - envKeys: every ABATHUR_[A-Z_]+ token referenced in src/ (drift tripwire:
//     the engine-registry test re-scans src/ and demands equality).
//   - injectableAllowlist: the exact key set the plugin's T3 shell.env hook may
//     inject from the trust-anchored config file (deliberately a subset of
//     envKeys: test seams and grader state are never file-injectable).
//
// Classification lives HERE (human-maintained): a command missing from the
// maps auto-defaults to whole-command write-side (fail-closed, logged); the
// engine-registry test pins the full emitted set so the default is visible.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(repoRoot, "src");

/** Read-only argv prefixes. Everything else a COMMANDS name can do is write-side. */
const READONLY_PREFIXES = [
  ["status"],
  ["kernel", "audit"],
  ["genome", "list"],
  ["genome", "show"],
  ["genome", "seals"],
  ["bundle", "inspect"],
];

/** Write-side argv prefixes for commands whose subcommands split read/write. */
const WRITE_PREFIXES_SPLIT = {
  genome: [
    ["genome", "add"],
    ["genome", "rm"],
  ],
  bundle: [["bundle", "export"]],
  kernel: [], // only read-only subcommands today
};

/** The plugin's T3 injection whitelist (v9: five keys, truly closed). */
const INJECTABLE_ALLOWLIST = [
  "PATH",
  "ABATHUR_CONFIG",
  "ABATHUR_SELF_REPO",
  "ABATHUR_HISTORIAN_REPO",
  "ABATHUR_DEBUG",
];

function commandNames() {
  const names = [];
  for (const file of readdirSync(path.join(srcDir, "commands"))) {
    if (!file.endsWith(".ts")) continue;
    const text = readFileSync(path.join(srcDir, "commands", file), "utf8");
    for (const match of text.matchAll(/name:\s*"([a-z-]+)"/g)) names.push(match[1]);
  }
  return [...new Set(names)].sort();
}

function envKeyScan() {
  const keys = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) {
        const text = readFileSync(full, "utf8");
        for (const match of text.matchAll(/ABATHUR_[A-Z_]+/g)) keys.add(match[0]);
      }
    }
  };
  walk(srcDir);
  return [...keys].sort();
}

const names = commandNames();
const classified = new Set();
for (const prefix of READONLY_PREFIXES) classified.add(prefix[0]);
for (const name of Object.keys(WRITE_PREFIXES_SPLIT)) classified.add(name);

const writeCommands = [];
const autoClassified = [];
for (const name of names) {
  if (!classified.has(name)) {
    // Fail-closed default (v9): an unclassified command is write-side as a
    // whole. Over-blocking is the safe direction; the consistency test makes
    // the auto-default visible so a human refines the maps when needed.
    writeCommands.push([name]);
    autoClassified.push(name);
  } else {
    const split = WRITE_PREFIXES_SPLIT[name];
    if (split === undefined) continue; // fully read-only command
    writeCommands.push(...split);
  }
}
if (autoClassified.length > 0) {
  console.log(`gen-engine-registry: auto-classified as whole-command write-side: ${autoClassified.join(", ")}`);
}

const registry = {
  schemaVersion: 1,
  writeCommands: writeCommands.sort((a, b) => a.join(" ").localeCompare(b.join(" "))),
  readonlyPrefixes: READONLY_PREFIXES,
  envKeys: envKeyScan(),
  injectableAllowlist: INJECTABLE_ALLOWLIST,
};

const outDir = path.join(repoRoot, "dist");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "engine-registry.json"), JSON.stringify(registry, null, 2) + "\n", "utf8");
console.log(
  `gen-engine-registry: ${String(names.length)} commands, ${String(writeCommands.length)} write prefixes, ${String(registry.envKeys.length)} env keys -> dist/engine-registry.json`,
);
