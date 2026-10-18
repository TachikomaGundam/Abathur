import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { requireGenomesByLabel, registerGenome } from "../core/genome.js";
import { runEvolution } from "../core/evolve/run-loop.js";
import { ExitSignal } from "../exit.js";

const exec = promisify(execFile);

async function fixtureRepo(files: Record<string, string>): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "requires-probe-repo-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.join(dir, path.dirname(name)), { recursive: true });
    writeFileSync(path.join(dir, name), text, "utf8");
  }
  await exec("git", ["init", "-b", "main", dir]);
  await exec("git", ["-C", dir, "add", "-A"]);
  await exec("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "seed"]);
  return dir;
}

interface FixtureSpecOpts {
  readonly type?: "toy" | "opencode-fixture-scenarios";
  readonly withRequires?: boolean;
}

function fixtureSpec(repo: string, label: string, probeFile: string, opts: FixtureSpecOpts = {}): Record<string, unknown> {
  const type = opts.type ?? "opencode-fixture-scenarios";
  const doc: Record<string, unknown> = {
    label,
    repoPath: repo,
    bench: {
      type,
      units: [{ id: "u1", path: "units/u1.md", split: "train" }, { id: "u2", path: "units/u2.md", split: "val" }],
      runCommand: "true {unit.id}",
      graderCommand: "true {unit.id}",
      ...(type === "opencode-fixture-scenarios" ? { agentModel: "family/model" } : {}),
      timeoutS: 600,
      stats: { halfWidth: 0.15, minEffect: 0.1, nReps: { initial: 1, max: 3 } },
    },
    budget: { maxCandidates: 1, maxModelCalls: 4, maxTokens: 1000, maxWallS: 1000 },
    kernel: { immutableGlobs: ["sealed.txt"] },
  };
  if (opts.withRequires ?? true) doc["requires"] = [{ cmd: "test", args: ["-f", probeFile], probeExit: 0 }];
  return doc;
}

async function dryRun(specDoc: Record<string, unknown>): Promise<{ exitCode: number; lines: readonly string[] }> {
  const configDir = mkdtempSync(path.join(tmpdir(), "requires-probe-config-"));
  const specFile = path.join(configDir, "spec.jsonc");
  writeFileSync(specFile, JSON.stringify(specDoc, null, 2), "utf8");
  const label = String(specDoc.label);
  registerGenome(configDir, specFile);
  const entry = requireGenomesByLabel(configDir, label).entries[0];
  if (entry === undefined) throw new Error(`entry ${label} missing after register`);
  return runEvolution({ entry, configDir, dryRun: true });
}

test("dry-run (fixture type): requires probes run without spawning OpenCode and print OK", async () => {
  const repo = await fixtureRepo({ "sealed.txt": "seal\n", "units/u1.md": "a\n", "units/u2.md": "b\n" });
  const out = await dryRun(fixtureSpec(repo, "probe-ok", "sealed.txt"));
  assert.equal(out.exitCode, 0);
  assert.ok(out.lines.some((line) => /requires probes: 1\/1 OK/.test(line)), out.lines.join("\n"));
});

test("dry-run (fixture type): a failed requires probe exits 2 before any plan", async () => {
  const repo = await fixtureRepo({ "sealed.txt": "seal\n", "units/u1.md": "a\n", "units/u2.md": "b\n" });
  await assert.rejects(
    () => dryRun(fixtureSpec(repo, "probe-bad", "missing-file.txt")),
    (error: unknown) => error instanceof ExitSignal && error.code === 2 && /missing-file\.txt/.test(error.message),
  );
});

test("dry-run (toy type, no requires): prints no probe line", async () => {
  const repo = await fixtureRepo({ "sealed.txt": "seal\n", "units/u1.md": "a\n", "units/u2.md": "b\n" });
  const out = await dryRun(fixtureSpec(repo, "toy-nodefault", "sealed.txt", { type: "toy", withRequires: false }));
  assert.equal(out.exitCode, 0);
  assert.ok(!out.lines.some((line) => /requires probes/.test(line)), out.lines.join("\n"));
});
