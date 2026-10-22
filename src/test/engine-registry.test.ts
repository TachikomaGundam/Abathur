// Engine-registry pins (Tier-1 v9, M3): dist/engine-registry.json is the
// plugin's contract. These tests re-derive both fields from src/ and demand
// equality — a new ABATHUR_ env key or a new command turns the build red.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function scanEnvKeys(): string[] {
  const keys = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) {
        for (const match of readFileSync(full, "utf8").matchAll(/ABATHUR_[A-Z_]+/g)) keys.add(match[0]);
      }
    }
  };
  walk(path.join(repoRoot, "src"));
  return [...keys].sort();
}

function commandNames(): string[] {
  const names = new Set<string>();
  const dir = path.join(repoRoot, "src", "commands");
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".ts")) continue;
    for (const match of readFileSync(path.join(dir, file), "utf8").matchAll(/name:\s*"([a-z-]+)"/g)) {
      names.add(match[1] ?? "");
    }
  }
  return [...names].sort();
}

interface Registry {
  readonly schemaVersion: number;
  readonly writeCommands: string[][];
  readonly readonlyPrefixes: string[][];
  readonly envKeys: string[];
  readonly injectableAllowlist: string[];
}

const registry = JSON.parse(
  readFileSync(path.join(repoRoot, "dist", "engine-registry.json"), "utf8"),
) as Registry;

test("registry envKeys equal a fresh src/ scan (drift tripwire)", () => {
  assert.deepEqual(registry.envKeys, scanEnvKeys());
});

test("every cli command is covered by the registry's read/write classification", () => {
  const covered = new Set<string>();
  for (const prefix of registry.writeCommands) covered.add(prefix[0] ?? "");
  for (const prefix of registry.readonlyPrefixes) covered.add(prefix[0] ?? "");
  for (const name of commandNames()) {
    assert.ok(covered.has(name), `command '${name}' is not classified in engine-registry.json`);
  }
});

test("T3 injectable allowlist is the pinned five-key closed set", () => {
  assert.deepEqual(registry.injectableAllowlist, [
    "PATH",
    "ABATHUR_CONFIG",
    "ABATHUR_SELF_REPO",
    "ABATHUR_HISTORIAN_REPO",
    "ABATHUR_DEBUG",
  ]);
});

test("registry carries the pinned write-prefix set (fail-closed direction)", () => {
  const expected = [
    ["bundle", "export"],
    ["genome", "add"],
    ["genome", "rm"],
    ["graft"],
    ["opencode"],
    ["promote"],
    ["re-adjudicate"],
    ["retract"],
    ["run"],
    ["self-eval"],
    ["tombstone"],
  ];
  assert.deepEqual(registry.writeCommands, expected);
});
