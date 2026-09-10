// Task-14: the historian genome instance + the additive dry-run requires-probe.
// Everything here stays offline: fake repos in tmp dirs, `test -f` probes only.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { loadGenomeSpecFile } from "../core/spec.js";
import { registerGenome, requireGenomesByLabel } from "../core/genome.js";
import { runEvolution } from "../core/evolve/run-loop.js";
import { ExitSignal } from "../exit.js";

const exec = promisify(execFile);

const EXAMPLE = path.join(import.meta.dirname, "..", "..", "config", "genomes", "historian.example.jsonc");

/** Replace every ${NAME} with a deterministic fake value (materialization stand-in). */
function materialize(text: string): string {
  return text.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_all, name: string) => {
    if (name.endsWith("WIKI_BASE")) return "http://wiki.invalid:3000";
    if (name.endsWith("WIKI_OPS")) return "/fake/opt/wiki-ops/wiki-ops.py";
    if (name.includes("REPO")) return "/fake/repo";
    return "/fake/" + name.toLowerCase();
  });
}

function materializeToFile(): string {
  const out = path.join(mkdtempSync(path.join(tmpdir(), "t14-gen-")), "historian.jsonc");
  writeFileSync(out, materialize(readFileSync(EXAMPLE, "utf8")), "utf8");
  return out;
}

test("historian.example.jsonc: zero machine literals, placeholders only", () => {
  const text = readFileSync(EXAMPLE, "utf8");
  assert.doesNotMatch(text, /\/home\//, "repo-tracked config must not embed /home/... literals");
  assert.match(text, /\$\{ABATHUR_HISTORIAN_REPO\}/);
  assert.match(text, /\$\{ABATHUR_WIKI_BASE\}/);
});

test("historian.example.jsonc materializes into a valid GenomeSpec (plan 181-188 contract)", () => {
  const spec = loadGenomeSpecFile(materializeToFile());
  assert.equal(spec.label, "historian");
  assert.equal(spec.bench.type, "opencode-fixture-scenarios");
  assert.equal(spec.bench.units.length, 9);
  assert.deepEqual(spec.bench.units.map((u) => u.id), [
    "scenario-01", "scenario-02", "scenario-03", "scenario-04", "scenario-05",
    "scenario-06", "scenario-07", "scenario-08", "scenario-09",
  ]);
  const train = spec.bench.units.filter((u) => u.split === "train").map((u) => u.id);
  const val = spec.bench.units.filter((u) => u.split === "val").map((u) => u.id);
  assert.deepEqual(train, ["scenario-01", "scenario-02", "scenario-03", "scenario-05", "scenario-06", "scenario-07", "scenario-08"]);
  assert.deepEqual(val, ["scenario-04", "scenario-09"]);
  // unit paths are repo-RELATIVE: bundle self-description digests tree content (bundle-common.ts:97).
  assert.equal(spec.bench.units[0]?.path, "scenarios/01-new-finding.md");
  assert.equal(spec.bench.units[8]?.path, "scenarios/09-timeline-week-groups.md");
  assert.deepEqual(spec.bench.stats, { halfWidth: 0.15, minEffect: 0.1, nReps: { initial: 1, max: 3 } });
  assert.ok(spec.bench.timeoutS >= 600, "real agent runs need a generous per-unit cap");
  assert.ok(spec.bench.agentModel !== undefined && spec.bench.agentModel.includes("/"));
  assert.match(spec.bench.seedCommand ?? "", /seed_sandbox\.sh/);
  assert.match(spec.bench.resetCommand ?? "", /reset-sandbox\.sh/);
  assert.match(spec.bench.runCommand, /run-scenario\.sh/);
  assert.match(spec.bench.graderCommand, /graders\/historian\/grader\.mjs/);
  assert.equal(spec.bench.judgeCommand, undefined); // unwired: judgeModel rule stays vacuous
  assert.ok(spec.requires !== undefined && spec.requires.length === 2);
  assert.ok(spec.kernel.immutableGlobs.includes("scenarios/**"));
  assert.ok(spec.kernel.immutableGlobs.includes("rubric.md"));
  assert.ok(spec.budget.maxCandidates >= 1);
});

// ------------------------------------------------- dry-run requires probes

async function fixtureRepo(files: Record<string, string>): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "t14-fr-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.join(dir, path.dirname(name)), { recursive: true });
    writeFileSync(path.join(dir, name), text, "utf8");
  }
  await exec("git", ["init", "-b", "main", dir]);
  await exec("git", ["-C", dir, "add", "-A"]);
  await exec("git", [
    "-C", dir,
    "-c", "user.name=t", "-c", "user.email=t@t",
    "commit", "-m", "seed",
  ]);
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
      units: [
        { id: "u1", path: "units/u1.md", split: "train" },
        { id: "u2", path: "units/u2.md", split: "val" },
      ],
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
  const configDir = mkdtempSync(path.join(tmpdir(), "t14-cfg-"));
  const specFile = path.join(configDir, "spec.jsonc");
  writeFileSync(specFile, JSON.stringify(specDoc, null, 2), "utf8");
  const label = String(specDoc.label);
  registerGenome(configDir, specFile);
  const entry = requireGenomesByLabel(configDir, label).entries[0];
  if (entry === undefined) throw new Error(`entry ${label} missing after register`);
  return runEvolution({ entry, configDir, dryRun: true });
}

test("dry-run (fixture type): requires probes run WITHOUT spawning opencode and print OK", async () => {
  const repo = await fixtureRepo({ "sealed.txt": "seal\n", "units/u1.md": "a\n", "units/u2.md": "b\n" });
  const out = await dryRun(fixtureSpec(repo, "probe-ok", "sealed.txt"));
  assert.equal(out.exitCode, 0);
  assert.ok(out.lines.some((l) => /requires probes: 1\/1 OK/.test(l)), out.lines.join("\n"));
});

test("dry-run (fixture type): failing requires probe exits 2 naming the prerequisite, before any plan", async () => {
  const repo = await fixtureRepo({ "sealed.txt": "seal\n", "units/u1.md": "a\n", "units/u2.md": "b\n" });
  await assert.rejects(
    () => dryRun(fixtureSpec(repo, "probe-bad", "missing-file.txt")),
    (e: unknown) => e instanceof ExitSignal && e.code === 2 && /missing-file\.txt/.test(e.message),
  );
});

test("dry-run (toy type, no requires): no probe line", async () => {
  const repo = await fixtureRepo({ "sealed.txt": "seal\n", "units/u1.md": "a\n", "units/u2.md": "b\n" });
  const out = await dryRun(fixtureSpec(repo, "toy-nodefault", "sealed.txt", { type: "toy", withRequires: false }));
  assert.equal(out.exitCode, 0);
  assert.ok(!out.lines.some((l) => /requires probes/.test(l)), out.lines.join("\n"));
});
