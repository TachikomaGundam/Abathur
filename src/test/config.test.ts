// Todo 1 acceptance pins for src/config.ts (TDD RED first — plan protocol).
// Given/When/Then throughout; tmpdirs are namespaced per-run via mkdtemp and
// torn down in t.after so parallel checkouts of this repo never collide.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ConfigError,
  deepMerge,
  loadConfig,
  resolveConfigDir,
  resolveConfigPath,
  stripJsonc,
} from "../config.js";

/** Create a throwaway HOME whose ~/.config/abathur does not exist yet. */
async function freshRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "abathur-cfg-test-"));
}

function userConfigPath(home: string): string {
  return path.join(home, ".config", "abathur", "config.jsonc");
}

async function writeJsonc(filePath: string, text: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text, "utf8");
}

const repoDefault = fileURLToPath(new URL("../../config/abathur.jsonc", import.meta.url));

// ---------------------------------------------------------------- stripJsonc

test("stripJsonc: removes line and block comments and trailing commas", () => {
  const src = `{
  // line comment
  "a": 1, /* block
             comment */
  "b": [1, 2, 3,],
  "c": {"d": true,},
}`;
  const out = stripJsonc(src);
  assert.deepEqual(JSON.parse(out), { a: 1, b: [1, 2, 3], c: { d: true } });
});

test("stripJsonc: preserves comment-like text inside strings", () => {
  const src = `{"url": "http://example.com//x", "note": "a /* b */ c"} // real comment`;
  const out = stripJsonc(src);
  assert.deepEqual(JSON.parse(out), {
    url: "http://example.com//x",
    note: "a /* b */ c",
  });
});

// ----------------------------------------------------------------- deepMerge

test("deepMerge: merges nested objects, replaces arrays and scalars, overlay wins", () => {
  const base = { a: { x: 1, y: 2 }, arr: [1, 2], s: "base", keep: true };
  const overlay = { a: { y: 9, z: 3 }, arr: [9], s: "local" };
  assert.deepEqual(deepMerge(base, overlay), {
    a: { x: 1, y: 9, z: 3 },
    arr: [9],
    s: "local",
    keep: true,
  });
});

// ------------------------------------------------- strict schema (AC-2 core)

test("loadConfig: unknown key is rejected and named in the error", async (t) => {
  const root = await freshRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const cfg = path.join(root, "config.jsonc");
  await writeJsonc(cfg, `{ "unknownField": 1 }`);

  let caught: unknown;
  try {
    loadConfig({ ABATHUR_CONFIG: cfg, HOME: root });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof ConfigError, `expected ConfigError, got ${String(caught)}`);
  assert.equal(caught.kind, "unknown-key");
  assert.match(caught.message, /unknownField/);
  assert.ok(caught.keys?.includes("unknownField"));
  assert.equal(caught.filePath, cfg);
});

test("loadConfig: unknown key inside the local overlay is rejected too", async (t) => {
  const root = await freshRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const cfg = path.join(root, "config.jsonc");
  await writeJsonc(cfg, `{ "opencodeBin": null }`);
  await writeJsonc(path.join(root, "config.local.jsonc"), `{ "oops": true }`);

  assert.throws(
    () => loadConfig({ ABATHUR_CONFIG: cfg, HOME: root }),
    (error: unknown) =>
      error instanceof ConfigError &&
      error.kind === "unknown-key" &&
      error.keys?.includes("oops"),
  );
});

// ------------------------------------------------------------ overlay merge

test("loadConfig: *.local.jsonc deep-merges over the base file", async (t) => {
  const root = await freshRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const cfg = path.join(root, "config.jsonc");
  await writeJsonc(cfg, `{ "opencodeBin": "/usr/bin/opencode", "stateDir": "/srv/state" }`);
  await writeJsonc(cfg.replace(/\.jsonc$/, ".local.jsonc"), `{ "stateDir": "/scratch/state" }`);

  const loaded = loadConfig({ ABATHUR_CONFIG: cfg, HOME: root });
  assert.equal(loaded.config.opencodeBin, "/usr/bin/opencode"); // base survives
  assert.equal(loaded.config.stateDir, "/scratch/state"); // overlay wins
  assert.equal(loaded.path, cfg);
  assert.equal(loaded.overlayPath, path.join(root, "config.local.jsonc"));
});

test("loadConfig: no overlay present leaves overlayPath null", async (t) => {
  const root = await freshRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const cfg = path.join(root, "config.jsonc");
  await writeJsonc(cfg, `{ /* no overlay */ }`);

  const loaded = loadConfig({ ABATHUR_CONFIG: cfg, HOME: root });
  assert.equal(loaded.overlayPath, null);
  assert.equal(loaded.config.opencodeBin, null); // schema default applied
});

// ------------------------------------------------- fallback resolution order

test("resolveConfigPath: ABATHUR_CONFIG pointing at a missing file fails closed", async (t) => {
  const root = await freshRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const missing = path.join(root, "nope.jsonc");

  assert.throws(
    () => resolveConfigPath({ ABATHUR_CONFIG: missing, HOME: root }),
    (error: unknown) =>
      error instanceof ConfigError && error.kind === "unreadable" &&
      error.message.includes(missing),
  );
  // loadConfig surfaces the same failure class (unreadable => exit 2 contract)
  assert.throws(
    () => loadConfig({ ABATHUR_CONFIG: missing, HOME: root }),
    (error: unknown) => error instanceof ConfigError && error.kind === "unreadable",
  );
});

test("resolveConfigPath: ~/.config/abathur beats the repo default", async (t) => {
  const root = await freshRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const user = userConfigPath(root);
  await writeJsonc(user, `{ "stateDir": "/user/abathur-state" }`);

  assert.equal(resolveConfigPath({ HOME: root }), user);
  const loaded = loadConfig({ HOME: root });
  assert.equal(loaded.path, user);
  assert.equal(loaded.config.stateDir, "/user/abathur-state");
});

test("resolveConfigPath: falls back to repo config/abathur.jsonc when nothing else exists", async (t) => {
  const root = await freshRoot();
  t.after(() => rm(root, { recursive: true, force: true }));

  assert.equal(resolveConfigPath({ HOME: root }), repoDefault);
  const loaded = loadConfig({ HOME: root }); // must NOT crash — AC: fallback order
  assert.equal(loaded.path, repoDefault);
  assert.equal(loaded.config.opencodeBin, null);
});

test("resolveConfigDir: tracks the winner, canonical home when nothing exists", async (t) => {
  const root = await freshRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const cfg = path.join(root, "custom", "abathur.jsonc");
  await writeJsonc(cfg, `{}`);

  assert.equal(resolveConfigDir({ ABATHUR_CONFIG: cfg, HOME: root }), path.join(root, "custom"));

  const user = userConfigPath(root);
  await writeJsonc(user, `{}`);
  assert.equal(resolveConfigDir({ HOME: root }), path.join(root, ".config", "abathur"));

  const bare = await freshRoot();
  t.after(() => rm(bare, { recursive: true, force: true }));
  // repo default exists but is lower priority: with only HOME+no files, canonical home wins
  assert.equal(
    resolveConfigDir({ ABATHUR_CONFIG: undefined, HOME: bare }),
    path.join(bare, ".config", "abathur"),
  );
});

// ------------------------------------------------------------------ malformed

test("loadConfig: broken syntax yields kind=malformed with the file path, not a raw crash", async (t) => {
  const root = await freshRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const cfg = path.join(root, "config.jsonc");
  await writeJsonc(cfg, `{ "opencodeBin": }`); // JSON syntax error

  let caught: unknown;
  try {
    loadConfig({ ABATHUR_CONFIG: cfg, HOME: root });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof ConfigError);
  assert.equal(caught.kind, "malformed");
  assert.ok(caught.message.includes(cfg), "error message must name the offending file");
});

test("loadConfig: wrong leaf type is kind=invalid-value", async (t) => {
  const root = await freshRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const cfg = path.join(root, "config.jsonc");
  await writeJsonc(cfg, `{ "opencodeBin": 42 }`);

  assert.throws(
    () => loadConfig({ ABATHUR_CONFIG: cfg, HOME: root }),
    (error: unknown) => error instanceof ConfigError && error.kind === "invalid-value",
  );
});

// --------------------------------------------------------- readable artefacts

test("loadConfig: full happy path reads JSONC comments and overlay from disk", async (t) => {
  const root = await freshRoot();
  t.after(() => rm(root, { recursive: true, force: true }));
  const cfg = path.join(root, "config.jsonc");
  await writeJsonc(
    cfg,
    `{
       // machine values
       "opencodeBin": "/opt/opencode/bin/opencode",
       "stateDir": null, /* keep default home */
     }`,
  );

  const loaded = loadConfig({ ABATHUR_CONFIG: cfg, HOME: root });
  assert.equal(loaded.config.opencodeBin, "/opt/opencode/bin/opencode");
  const rawOverlay = await readFile(cfg, "utf8"); // sanity: fixture really on disk
  assert.ok(rawOverlay.includes("//"));
});
