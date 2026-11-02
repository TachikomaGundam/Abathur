// Batch-3 wound-2 AC pins: `kernel reseal <label> --confirm <label>` re-certifies a
// drifted manifest from the CURRENT tree, refuses without the re-typed confirmation,
// re-audits clean after writing, and appends a kernel_reseal receipt row to the ledger.
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";

import { registerGenome, requireGenomesByLabel } from "../core/genome.js";
import { auditKernel, manifestPathFor, readManifestFile } from "../core/kernel.js";
import { prepareToyGenome } from "../bench/toy.js";

const CLI = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

interface Fix { root: string; configDir: string; repo: string }

async function fixture(t: TestContext): Promise<Fix> {
  const root = await mkdtemp(path.join(os.tmpdir(), "abathur-reseal-"));
  t.after(() => { spawnSync("rm", ["-rf", root], { encoding: "utf8" }); });
  const configDir = path.join(root, "config");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path.join(configDir, "config.jsonc"), '{ "opencodeBin": null }\n', "utf8");
  const repo = await prepareToyGenome(path.join(root, "genome"));
  registerGenome(configDir, path.join(repo, "genome.jsonc"));
  return { root, configDir, repo };
}

function cli(f: Fix, ...args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, ABATHUR_CONFIG: path.join(f.configDir, "config.jsonc"), HOME: path.join(f.root, "home"), XDG_CACHE_HOME: path.join(f.root, "xdg-cache") },
    encoding: "utf8", cwd: f.root,
  });
}

function tamperFirstSealed(f: Fix): string {
  const entry = requireGenomesByLabel(f.configDir, "toy-smoke").entries[0];
  if (entry === undefined) throw new Error("registration vanished");
  const manifest = readManifestFile(manifestPathFor(f.configDir, entry.fingerprint));
  if (manifest.length === 0) throw new Error("empty manifest");
  const target = path.join(f.repo, manifest[0]?.["path"] as string);
  writeFileSync(target, readFileSync(target, "utf8") + "\n// drift injected by test\n", "utf8");
  return manifest[0]?.["path"] as string;
}

test("reseal refuses missing/mismatched --confirm and writes nothing", async (t) => {
  {
    const f = await fixture(t as unknown as TestContext);
    const target = tamperFirstSealed(f);
    const audit0 = cli(f, "kernel", "audit", "toy-smoke");
    assert.equal(audit0.status, 1, `expected drift refusal, got: ${audit0.stderr}${audit0.stdout}`);
    const mpath = manifestPathFor(f.configDir, requireGenomesByLabel(f.configDir, "toy-smoke").entries[0]?.["fingerprint"] as string);
    const before = readFileSync(mpath, "utf8");
    const noConfirm = cli(f, "kernel", "reseal", "toy-smoke");
    assert.equal(noConfirm.status, 2, "no --confirm must be cannot-answer");
    const wrong = cli(f, "kernel", "reseal", "toy-smoke", "--confirm", "not-the-label");
    assert.equal(wrong.status, 2, "mismatched confirmation must be refused");
    const after = readFileSync(mpath, "utf8");
    assert.equal(after, before, "refused reseals must not touch the manifest");
    void target;
  }
});

test("reseal with re-typed label re-certifies, audit turns clean, receipt lands", async (t) => {
  {
    const f = await fixture(t as unknown as TestContext);
    tamperFirstSealed(f);
    assert.equal(cli(f, "kernel", "audit", "toy-smoke").status, 1);
    const res = cli(f, "kernel", "reseal", "toy-smoke", "--confirm", "toy-smoke");
    assert.equal(res.status, 0, `reseal failed: ${res.stderr}${res.stdout}`);
    assert.match(res.stdout, /kernel resealed/);
    assert.equal(cli(f, "kernel", "audit", "toy-smoke").status, 0, "audit must pass after reseal");
    const entry = requireGenomesByLabel(f.configDir, "toy-smoke").entries[0];
    const audit = auditKernel(entry as never, f.configDir);
    assert.ok(audit.ok);
    const ledgerFile = path.join(f.repo, ".state", "abathur", "ledger.jsonl");
    const lines = readFileSync(ledgerFile, "utf8").trimEnd().split("\n");
    const receipt = lines.at(-1);
    assert.ok(receipt !== undefined && JSON.parse(receipt)["kind"] === "kernel_reseal", "receipt row expected last");
    const data = JSON.parse(receipt as string)["data"] as Record<string, unknown>;
    assert.equal(typeof data["toManifestSha256"], "string");
    assert.notEqual(data["fromManifestSha256"], data["toManifestSha256"]);
  }
});

test("reseal on a clean seal is a no-op message", async (t) => {
  {
    const f = await fixture(t as unknown as TestContext);
    const res = cli(f, "kernel", "reseal", "toy-smoke", "--confirm", "toy-smoke");
    assert.equal(res.status, 0);
    assert.match(res.stdout, /already clean/);
  }
});
