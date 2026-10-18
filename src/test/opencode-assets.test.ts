import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const pluginAssetPath = path.join(repoRoot, "plugin", "abathur.ts");
const commandAssetPath = path.join(repoRoot, "plugin", "abathur-command.md");
const PLUGIN_MARKER = "// abathur-opencode-plugin v";
const COMMAND_MARKER = "<!-- abathur-opencode-command -->";
const FORBIDDEN_NEEDLES = ["/home/lab", "historian"];

test("plugin/abathur.ts: V1 shape — marker, default {id, server}, tool allowlist, argv-only spawn", async () => {
  const bytes = await readFile(pluginAssetPath, "utf8");
  const firstLine = bytes.split("\n")[0] ?? "";
  assert.ok(firstLine.startsWith(PLUGIN_MARKER), `first line must be the marker: ${firstLine}`);
  const version = firstLine.slice(PLUGIN_MARKER.length).trim();
  const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as { version: string };
  assert.equal(version, pkg.version, "plugin marker version must equal package.json version");
  assert.ok(/export default\s*\{/.test(bytes), "V1 default export object required");
  assert.ok(bytes.includes('id: "abathur"'), "file plugins must export id (resolvePluginId)");
  assert.ok(/server:\s*async\s*\(\)/.test(bytes), "server must be an async function (readV1Plugin)");
  assert.ok(bytes.includes("tool.schema"), "args must be built via tool.schema (no local zod dep)");
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
  assert.ok(/config:\s*async\s*\(cfg:\s*Config\)/.test(bytes), "config hook with typed cfg required");
  assert.ok(bytes.includes('import { tool, type Config }'), "Config type imported from @opencode-ai/plugin");
  assert.ok(/cfg\.command\s*\?\?=\s*\{\}/.test(bytes), "cfg.command must be lazily created with ??=");
  assert.ok(/cfg\.command\.abathur\s*\?\?=/.test(bytes), "entry must be ??= — a file-installed command is never overwritten");
  const literal = bytes.match(/const COMMAND_TEMPLATE = `((?:[^`\\]|\\.)*)`;/);
  assert.ok(literal !== null, "COMMAND_TEMPLATE literal must exist");
  const template = (literal[1] ?? "").replaceAll("\\`", "`");
  const md = await readFile(commandAssetPath, "utf8");
  assert.ok(md.startsWith(COMMAND_MARKER), "md must still carry its first-line marker");
  assert.equal(template, md.slice(md.indexOf("\n") + 1), "injected template must byte-equal the command md minus its marker line");
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
    for (const needle of FORBIDDEN_NEEDLES) assert.ok(!text.includes(needle), `${path.relative(repoRoot, file)} must not contain '${needle}'`);
  }
});

test("npm name route: exports['./server'] ships the marker'd plugin + optional host peer declared", async () => {
  const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as {
    files?: string[]; exports?: Record<string, unknown>; dependencies?: Record<string, string>; peerDependencies?: Record<string, string>; peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  };
  const serverEntry = pkg.exports?.["./server"];
  assert.equal(typeof serverEntry, "string", "./server export must be a plain string path");
  const server = serverEntry as string;
  const head = (await readFile(path.resolve(repoRoot, server), "utf8")).split("\n")[0] ?? "";
  assert.ok(head.startsWith(PLUGIN_MARKER), `server entry must start with the plugin marker: ${head}`);
  assert.ok((pkg.files ?? []).some((entry) => server.startsWith(`./${entry}/`)), "server entry must live under a published files[] directory");
  assert.equal(pkg.dependencies?.["@opencode-ai/plugin"], undefined, "core must not install the plugin runtime");
  assert.equal(pkg.peerDependencies?.["@opencode-ai/plugin"], "1.19.3", "plugin peer must be exact");
  assert.equal(pkg.peerDependenciesMeta?.["@opencode-ai/plugin"]?.optional, true, "plugin peer must be optional");
  assert.equal(serverEntry, "./plugin/abathur.ts", "server entry and installer asset must be one file");
});
