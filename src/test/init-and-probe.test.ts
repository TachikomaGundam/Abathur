// init command + install-probe tests (ruling 75ee mechanisms).

import assert from "node:assert/strict";
import { existsSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runInit } from "../commands/init.js";
import { deploymentSurfaces } from "../core/surfaces.js";
import { assertCampaignInstallIntegrity } from "../core/install-probe.js";
import { ExitSignal } from "../exit.js";

async function freshHome(t: { after: (fn: () => unknown) => void }): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "abathur-init-"));
  t.after(() => {
    rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test("deploymentSurfaces honors $ABATHUR_HOME and $ABATHUR_CONFIG", () => {
  const surfaces = deploymentSurfaces({
    HOME: "/h",
    ABATHUR_HOME: "/data",
    ABATHUR_CONFIG: "/cfg/conf.jsonc",
  });
  assert.deepEqual(surfaces, ["/cfg", "/data", path.join("/data", "anchor")]);
});

test("runInit creates every surface idempotently", async (t) => {
  const home = await freshHome(t);
  const env = { HOME: home };
  assert.equal(runInit(env), 0);
  for (const dir of deploymentSurfaces(env)) assert.ok(existsSync(dir), dir);
  assert.equal(runInit(env), 0); // second run: present, still ok
});

test("runInit fails closed when a surface is a file", async (t) => {
  const home = await freshHome(t);
  const blocker = path.join(home, ".config");
  mkdirSync(blocker, { recursive: true });
  writeFileSync(path.join(blocker, "abathur"), "not a dir");
  assert.throws(() => runInit({ HOME: home }), (e: unknown) => e instanceof ExitSignal && e.code === 2);
});

function installedTree(root: string): { cli: string; binDir: string } {
  const pkgDir = path.join(root, "lib", "node_modules", "@tachikomagundam", "abathur");
  const cli = path.join(pkgDir, "dist", "cli.js");
  mkdirSync(path.dirname(cli), { recursive: true });
  writeFileSync(cli, "// fixture");
  const binDir = path.join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  symlinkSync(cli, path.join(binDir, "abathur"));
  return { cli, binDir };
}

test("install probe: matching PATH shim passes", async (t) => {
  const root = await freshHome(t);
  const { cli, binDir } = installedTree(path.join(root, "prefix"));
  assertCampaignInstallIntegrity(path.join(binDir, "abathur"), { PATH: binDir });
  assertCampaignInstallIntegrity(realpathSync(cli), { PATH: binDir });
});

test("install probe: shadowed PATH shim is refused (exit 1)", async (t) => {
  const root = await freshHome(t);
  const a = installedTree(path.join(root, "prefixA"));
  const b = installedTree(path.join(root, "prefixB"));
  assert.throws(
    () => assertCampaignInstallIntegrity(path.join(b.binDir, "abathur"), { PATH: `${a.binDir}${path.delimiter}${b.binDir}` }),
    (e: unknown) => e instanceof ExitSignal && e.code === 1,
  );
});

test("install probe: dev worktree argv1 skips the check", async (t) => {
  const root = await freshHome(t);
  const a = installedTree(path.join(root, "prefixA"));
  const devCli = path.join(root, "worktree", "dist", "cli.js");
  mkdirSync(path.dirname(devCli), { recursive: true });
  writeFileSync(devCli, "// dev");
  assertCampaignInstallIntegrity(devCli, { PATH: a.binDir });
});
