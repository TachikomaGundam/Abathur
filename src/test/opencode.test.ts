// Opencode plugin-adapter acceptance pins (plan abathur-opencode-plugin, todo 1).
// CLI convention per genome.test.ts: spawn the BUILT dist/cli.js with a sandboxed
// HOME (tmpdir) + ABATHUR_CONFIG, so install/status/uninstall never touch the
// real ~/.config/opencode. The packaged plugin assets are additionally pinned
// here as plain text (marker first line, no shell, version parity) — the real
// opencode runtime consumes them uncompiled, so these string gates are the CI.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
/** Repo root as seen from dist/test/: package.json and plugin/ sit one level up each. */
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const pluginAssetPath = path.join(repoRoot, "plugin", "abathur.ts");
const commandAssetPath = path.join(repoRoot, "plugin", "abathur-command.md");

const PLUGIN_MARKER = "// abathur-opencode-plugin v";
const COMMAND_MARKER = "<!-- abathur-opencode-command -->";
/** D7 discipline extends to the shipped plugin/ dir even though the gate walks only src/. */
const FORBIDDEN_NEEDLES = ["/home/lab", "historian"];

// ------------------------------------------------------------------- fixtures

async function freshDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), `abathur-${prefix}-`));
}

function keep(t: TestContext, dir: string): string {
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** Sandboxed HOME: opencode targets resolve under <home>/.config/opencode, config under <home>/.config/abathur. */
async function makeEnv(t: TestContext): Promise<{ home: string; env: NodeJS.ProcessEnv }> {
  const home = keep(t, await freshDir("oc-home"));
  const configDir = path.join(home, ".config", "abathur");
  await mkdir(configDir, { recursive: true });
  const configPath = path.join(configDir, "config.jsonc");
  await writeFile(configPath, "// isolated test config\n{}\n", "utf8");
  return { home, env: { ...process.env, ABATHUR_CONFIG: configPath, HOME: home } };
}

function abathur(
  env: NodeJS.ProcessEnv,
  ...args: string[]
): { status: number; stdout: string; stderr: string } {
  const run = spawnSync(process.execPath, [cliPath, ...args], { env, encoding: "utf8" });
  return { status: run.status ?? -1, stdout: run.stdout, stderr: run.stderr };
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function targetPaths(home: string): { pluginTs: string; commandMd: string } {
  const dir = path.join(home, ".config", "opencode");
  return {
    pluginTs: path.join(dir, "plugins", "abathur.ts"),
    commandMd: path.join(dir, "commands", "abathur.md"),
  };
}

async function packagedBytes(): Promise<{ ts: Buffer; md: Buffer }> {
  return {
    ts: await readFile(pluginAssetPath),
    md: await readFile(commandAssetPath),
  };
}

// --------------------------------------------------------------- install

test("install: writes both targets byte-identical to packaged assets + restart/bench notes", async (t) => {
  const { home, env } = await makeEnv(t);
  const packaged = await packagedBytes();
  const { pluginTs, commandMd } = targetPaths(home);

  const run = abathur(env, "opencode", "install");
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
  assert.ok(run.stdout.includes(pluginTs), `output must name ${pluginTs}: ${run.stdout}`);
  assert.ok(run.stdout.includes(commandMd), `output must name ${commandMd}: ${run.stdout}`);
  assert.ok(/restart opencode/.test(run.stdout), `restart note missing: ${run.stdout}`);
  assert.ok(/mirror/.test(run.stdout), `bench-mirror warning missing: ${run.stdout}`);
  assert.deepEqual(await readFile(pluginTs), packaged.ts);
  assert.deepEqual(await readFile(commandMd), packaged.md);
});

test("install: idempotent — second run says up to date, bytes untouched", async (t) => {
  const { home, env } = await makeEnv(t);
  const { pluginTs, commandMd } = targetPaths(home);
  assert.equal(abathur(env, "opencode", "install").status, 0);

  const second = abathur(env, "opencode", "install");
  assert.equal(second.status, 0, `${second.stdout}${second.stderr}`);
  const upToDate = second.stdout.split("\n").filter((line) => line.includes("up to date"));
  assert.equal(upToDate.length, 2, `both targets must report up to date: ${second.stdout}`);
  const after = await packagedBytes();
  assert.deepEqual(await readFile(pluginTs), after.ts);
  assert.deepEqual(await readFile(commandMd), after.md);
});

test("install: foreign target without our marker ⇒ exit 2 naming the path, NOTHING written", async (t) => {
  const { home, env } = await makeEnv(t);
  const { pluginTs, commandMd } = targetPaths(home);
  const foreign = "// someone else's plugin, no marker\nexport default { id: 'other' };\n";
  await mkdir(path.dirname(pluginTs), { recursive: true });
  await writeFile(pluginTs, foreign, "utf8");

  const run = abathur(env, "opencode", "install");
  assert.equal(run.status, 2, `${run.stdout}${run.stderr}`);
  const combined = `${run.stdout}${run.stderr}`;
  assert.ok(combined.includes(pluginTs), `refusal must name the path: ${combined}`);
  assert.equal(await readFile(pluginTs, "utf8"), foreign, "foreign bytes must survive");
  // Atomicity: the refusal must happen before ANY write, so the command target stays absent.
  await assert.rejects(readFile(commandMd), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
});

test("install: a DIRECTORY at a target path is refused (exit 2, named) — never entered or destroyed", async (t) => {
  const { home, env } = await makeEnv(t);
  const { pluginTs, commandMd } = targetPaths(home);
  await mkdir(pluginTs, { recursive: true });
  const inner = path.join(pluginTs, "someone-elses-plugin.ts");
  await writeFile(inner, "// lives inside, must survive\n", "utf8");

  const run = abathur(env, "opencode", "install");
  assert.equal(run.status, 2, `${run.stdout}${run.stderr}`);
  const combined = `${run.stdout}${run.stderr}`;
  assert.ok(combined.includes(pluginTs), `refusal must name the path: ${combined}`);
  assert.ok((await readFile(inner, "utf8")).includes("must survive"), "directory contents untouched");
  // Atomicity still holds: validation precedes every write, so the sibling stays absent.
  await assert.rejects(readFile(commandMd), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
});

test("install: a SYMLINK at a target path is refused (exit 2) — inspected by lstat, never followed", async (t) => {
  const { home, env } = await makeEnv(t);
  const { pluginTs, commandMd } = targetPaths(home);
  // The marker check alone would pass here: readFileSync follows the link, and the
  // old write would then destroy the external file. lstat must refuse the link itself.
  const real = path.join(home, "elsewhere", "real-file.ts");
  await mkdir(path.dirname(real), { recursive: true });
  const original = `${PLUGIN_MARKER} 0.0.1\n// real file outside the opencode tree\n`;
  await writeFile(real, original, "utf8");
  await mkdir(path.dirname(pluginTs), { recursive: true });
  await symlink(real, pluginTs);

  const run = abathur(env, "opencode", "install");
  assert.equal(run.status, 2, `${run.stdout}${run.stderr}`);
  assert.ok(`${run.stdout}${run.stderr}`.includes(pluginTs), `refusal must name the path: ${run.stdout}${run.stderr}`);
  assert.equal(await readFile(real, "utf8"), original, "file behind the link must be untouched");
  assert.equal((await lstat(pluginTs)).isSymbolicLink(), true, "the symlink itself must survive too");
  await assert.rejects(readFile(commandMd), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
});

test("install: our marker'd older file is overwritten with packaged bytes", async (t) => {
  const { home, env } = await makeEnv(t);
  const { pluginTs } = targetPaths(home);
  await mkdir(path.dirname(pluginTs), { recursive: true });
  await writeFile(pluginTs, `${PLUGIN_MARKER} 0.0.1\n// ancient draft\n`, "utf8");

  const run = abathur(env, "opencode", "install");
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
  assert.ok(run.stdout.includes(pluginTs));
  const packaged = await packagedBytes();
  assert.deepEqual(await readFile(pluginTs), packaged.ts);
});

test("install: mkdir -p creates the plugins/ and commands/ dirs in a virgin HOME", async (t) => {
  const { home, env } = await makeEnv(t);
  const { pluginTs, commandMd } = targetPaths(home);
  assert.equal(abathur(env, "opencode", "install").status, 0);
  // Reading succeeded only because the directories were created on demand.
  assert.ok((await readFile(pluginTs, "utf8")).startsWith(PLUGIN_MARKER));
  assert.ok((await readFile(commandMd, "utf8")).startsWith(COMMAND_MARKER));
});

test("opencode: unknown subcommand and stray args exit 2 with usage", async (t) => {
  const { env } = await makeEnv(t);
  const unknown = abathur(env, "opencode", "frobnicate");
  assert.equal(unknown.status, 2);
  assert.ok(`${unknown.stdout}${unknown.stderr}`.includes("unknown subcommand"));

  const none = abathur(env, "opencode");
  assert.equal(none.status, 2);

  const stray = abathur(env, "opencode", "install", "--force");
  assert.equal(stray.status, 2);
  assert.ok(`${stray.stdout}${stray.stderr}`.includes("unexpected argument"));
});

// ---------------------------------------------------------------- status

test("status: virgin HOME ⇒ absent; after install ⇒ up-to-date with packaged sha256", async (t) => {
  const { home, env } = await makeEnv(t);
  const packaged = await packagedBytes();

  const fresh = abathur(env, "opencode", "status");
  assert.equal(fresh.status, 0, fresh.stderr);
  const absent = fresh.stdout.split("\n").filter((line) => line.includes(": absent"));
  assert.equal(absent.length, 2, `both targets absent initially: ${fresh.stdout}`);

  assert.equal(abathur(env, "opencode", "install").status, 0);
  const ok = abathur(env, "opencode", "status");
  assert.equal(ok.status, 0);
  const { pluginTs, commandMd } = targetPaths(home);
  const pluginRow = ok.stdout.split("\n").find((line) => line.startsWith(pluginTs));
  const commandRow = ok.stdout.split("\n").find((line) => line.startsWith(commandMd));
  assert.ok(pluginRow !== undefined && commandRow !== undefined, `both rows present: ${ok.stdout}`);
  assert.ok(pluginRow.includes(": up-to-date"), `plugin up-to-date: ${pluginRow}`);
  assert.ok(commandRow.includes(": up-to-date"), `command up-to-date: ${commandRow}`);
  assert.ok(pluginRow.includes(`installed=${sha256(packaged.ts)}  packaged=${sha256(packaged.ts)}`), pluginRow);
  assert.ok(commandRow.includes(`installed=${sha256(packaged.md)}  packaged=${sha256(packaged.md)}`), commandRow);
});

test("status: outdated (our marker, different bytes) and foreign (no marker) are distinct", async (t) => {
  const { home, env } = await makeEnv(t);
  const { pluginTs, commandMd } = targetPaths(home);
  await mkdir(path.dirname(pluginTs), { recursive: true });
  await writeFile(pluginTs, `${PLUGIN_MARKER} 0.0.1\n// stale\n`, "utf8");
  await mkdir(path.dirname(commandMd), { recursive: true });
  await writeFile(commandMd, "not ours at all\n", "utf8");

  const run = abathur(env, "opencode", "status");
  assert.equal(run.status, 0);
  assert.ok(run.stdout.includes(": outdated"), `stale ours → outdated: ${run.stdout}`);
  assert.ok(run.stdout.includes(": foreign"), `unmarked → foreign: ${run.stdout}`);
});

// ------------------------------------------------------------- uninstall

test("uninstall: removes both of ours; second run reports absent and still exits 0", async (t) => {
  const { home, env } = await makeEnv(t);
  const { pluginTs, commandMd } = targetPaths(home);
  assert.equal(abathur(env, "opencode", "install").status, 0);

  const off = abathur(env, "opencode", "uninstall");
  assert.equal(off.status, 0, `${off.stdout}${off.stderr}`);
  await assert.rejects(readFile(pluginTs), (e: NodeJS.ErrnoException) => e.code === "ENOENT");
  await assert.rejects(readFile(commandMd), (e: NodeJS.ErrnoException) => e.code === "ENOENT");

  const again = abathur(env, "opencode", "uninstall");
  assert.equal(again.status, 0);
  assert.equal(again.stdout.split("\n").filter((l) => l.includes("absent")).length, 2);
});

test("uninstall: refuses foreign file and leaves the sibling of ours in place", async (t) => {
  const { home, env } = await makeEnv(t);
  const { pluginTs, commandMd } = targetPaths(home);
  assert.equal(abathur(env, "opencode", "install").status, 0);
  await writeFile(commandMd, "hijacked, marker gone\n", "utf8");

  const run = abathur(env, "opencode", "uninstall");
  assert.equal(run.status, 2, `${run.stdout}${run.stderr}`);
  assert.ok(`${run.stdout}${run.stderr}`.includes(commandMd), "refusal names the foreign path");
  // Atomicity: nothing removed — our plugin file must still be installed.
  assert.ok((await readFile(pluginTs, "utf8")).startsWith(PLUGIN_MARKER));
  assert.ok((await readFile(commandMd, "utf8")).includes("hijacked"));
});

// --------------------------------------------------- packaged asset sanity

test("plugin/abathur.ts: V1 shape — marker, default {id, server}, tool allowlist, argv-only spawn", async () => {
  const bytes = await readFile(pluginAssetPath, "utf8");
  const firstLine = bytes.split("\n")[0] ?? "";
  assert.ok(firstLine.startsWith(PLUGIN_MARKER), `first line must be the marker: ${firstLine}`);

  const version = firstLine.slice(PLUGIN_MARKER.length).trim();
  const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as {
    version: string;
  };
  assert.equal(version, pkg.version, "plugin marker version must equal package.json version");

  assert.ok(/export default\s*\{/.test(bytes), "V1 default export object required");
  assert.ok(bytes.includes('id: "abathur"'), "file plugins must export id (resolvePluginId)");
  assert.ok(/server:\s*async\s*\(\)/.test(bytes), "server must be an async function (readV1Plugin)");
  assert.ok(bytes.includes("tool.schema"), "args must be built via tool.schema (no local zod dep)");

  // Exact-array pin (0.2.1): parse the ALLOWED_COMMANDS literal from source — membership
  // checks alone would let promote/tombstone creep back in via order or extras.
  const literal = bytes.match(/const ALLOWED_COMMANDS[^=]*=\s*\[([^\]]*)\]/);
  assert.ok(literal !== null, "ALLOWED_COMMANDS array literal must exist");
  const allowed = [...(literal[1] ?? "").matchAll(/"([^"]+)"/g)].map((found) => found[1] ?? "");
  assert.deepEqual(allowed, ["genome", "run", "status", "bundle", "graft", "self-eval", "kernel", "--help"]);
  assert.ok(!allowed.includes("promote"), "promote is terminal-only — must not be tool-reachable");
  assert.ok(!allowed.includes("tombstone"), "tombstone is terminal-only — must not be tool-reachable");

  assert.ok(bytes.includes("execFile"), "must spawn via execFile argv-only");
  assert.ok(!/shell\s*:\s*true/.test(bytes), "shell:true is banned");
  assert.ok(bytes.includes("ABATHUR_BIN"), "bin overridable via ABATHUR_BIN");
});

test("plugin/abathur.ts: config hook self-registers /abathur — template byte-mirrors the command md body", async () => {
  const bytes = await readFile(pluginAssetPath, "utf8");

  // Route B needs the config hook: opencode hands plugins the fully-merged config
  // (file commands already inside cfg.command), so a `??=` injection registers
  // /abathur ONLY when no commands/abathur.md exists — Route A bytes/behaviour
  // stay untouched and the name-keyed command map guarantees no duplicate entry.
  assert.ok(/config:\s*async\s*\(cfg:\s*Config\)/.test(bytes), "config hook with typed cfg required");
  assert.ok(bytes.includes('import { tool, type Config }'), "Config type imported from @opencode-ai/plugin");
  assert.ok(/cfg\.command\s*\?\?=\s*\{\}/.test(bytes), "cfg.command must be lazily created with ??=");
  assert.ok(/cfg\.command\.abathur\s*\?\?=/.test(bytes), "entry must be ??= — a file-installed command is never overwritten");
  assert.ok(
    bytes.includes('description: "Drive the abathur evolution harness (usage: /abathur <command> [args...])"'),
    "injected description must be pinned verbatim",
  );

  // Extract the template literal (inner backticks appear escaped as \`) and byte-compare.
  const literal = bytes.match(/const COMMAND_TEMPLATE = `((?:[^`\\]|\\.)*)`;/);
  assert.ok(literal !== null, "COMMAND_TEMPLATE literal must exist");
  const template = (literal[1] ?? "").replaceAll("\\`", "`");

  const md = await readFile(commandAssetPath, "utf8");
  assert.ok(md.startsWith(COMMAND_MARKER), "md must still carry its first-line marker");
  const body = md.slice(md.indexOf("\n") + 1); // everything after the marker line
  assert.ok(body.startsWith("Drive the abathur evolution harness"), "body start sanity");
  assert.equal(template, body, "injected template must byte-equal the command md minus its marker line");
});

test("plugin/abathur-command.md: first-line marker, $ARGUMENTS, points at the abathur tool", async () => {
  const text = await readFile(commandAssetPath, "utf8");
  assert.equal(text.split("\n")[0], COMMAND_MARKER, "first line must be the command marker");
  assert.ok(text.includes("$ARGUMENTS"), "template must forward $ARGUMENTS");
  assert.ok(text.includes("`abathur` tool"), "must instruct the agent to use the abathur tool");
});

test("shipped plugin assets carry zero machine literals (D7 discipline extended to plugin/)", async () => {
  for (const file of [pluginAssetPath, commandAssetPath]) {
    const text = await readFile(file, "utf8");
    for (const needle of FORBIDDEN_NEEDLES) {
      assert.ok(!text.includes(needle), `${path.relative(repoRoot, file)} must not contain '${needle}'`);
    }
  }
});

test("npm name route: exports['./server'] ships the marker'd plugin + runtime dep declared", async () => {
  const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as {
    version: string;
    files?: string[];
    exports?: Record<string, unknown>;
    dependencies?: Record<string, string>;
  };

  // opencode picks the server entry via exports["./server"] (extractExportValue
  // accepts a plain string; plugin/shared.ts resolvePackageEntrypoint).
  const serverEntry = pkg.exports?.["./server"];
  assert.equal(typeof serverEntry, "string", "./server export must be a plain string path");
  const server = serverEntry as string;
  const target = path.resolve(repoRoot, server);
  const head = (await readFile(target, "utf8")).split("\n")[0] ?? "";
  assert.ok(head.startsWith(PLUGIN_MARKER), `server entry must start with the plugin marker: ${head}`);

  // The tarball must actually contain that file or the name route installs nothing to import.
  assert.ok((pkg.files ?? []).some((entry) => server.startsWith(`./${entry}/`)),
    "server entry must live under a published files[] directory");

  // Arborist installs the package's dependencies next to it in opencode's cache —
  // that sibling copy is how the shipped import of @opencode-ai/plugin resolves (OMO mechanism).
  const dep = pkg.dependencies?.["@opencode-ai/plugin"];
  assert.equal(typeof dep, "string", "@opencode-ai/plugin must be a runtime dependency");
  assert.ok((dep ?? "").length > 0, "dependency range must not be empty");

  // Route B must serve the same bytes the route A installer copies: both resolve to plugin/abathur.ts.
  assert.equal(serverEntry, "./plugin/abathur.ts", "server entry and installer asset must be one file");
});

test("CLI help: opencode is a registered top-level command", async (t) => {
  const { env } = await makeEnv(t);
  const help = abathur(env, "--help");
  assert.equal(help.status, 0);
  assert.ok(help.stdout.includes("opencode"), `usage must list opencode: ${help.stdout}`);
});
