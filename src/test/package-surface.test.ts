import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packagePath = fileURLToPath(new URL("../../package.json", import.meta.url));
const manifest: unknown = JSON.parse(readFileSync(packagePath, "utf8"));

const RUNTIME_DIST_ENTRIES = [
  "dist/bench",
  "dist/cli.js",
  "dist/commands",
  "dist/config.js",
  "dist/core",
  "dist/exit.js",
  "dist/genomes",
  "dist/jsonc.js",
  "dist/out.js",
  "dist/release-state.js",
  "dist/util",
  "dist/version-manifest.json",
  "dist/version.js",
] as const;
const PORTABLE_DOCUMENTATION = "docs/immutable-kernel.md";

function packageFiles(): readonly string[] {
  if (typeof manifest !== "object" || manifest === null || !("files" in manifest)) {
    throw new Error("test package manifest has no files list");
  }
  const { files } = manifest;
  if (!Array.isArray(files) || !files.every((entry) => typeof entry === "string")) {
    throw new Error("test package files list is invalid");
  }
  return files;
}

test("package surface: runtime dist is explicit and compiled tests are excluded", () => {
  const files = packageFiles();

  assert.equal(files.includes("dist"), false);
  assert.equal(files.includes("dist/test"), false);
  assert.equal(files.includes("graders"), false);
  assert.equal(files.includes("docs"), false);
  assert.equal(files.includes(PORTABLE_DOCUMENTATION), true);
  assert.equal(files.includes("graders/historian"), false);
  assert.equal(files.includes("config/genomes/historian.example.jsonc"), false);
  for (const entry of RUNTIME_DIST_ENTRIES) assert.equal(files.includes(entry), true);
});

test("package contract: runtime floor and optional plugin boundary match the verified closure", () => {
  if (typeof manifest !== "object" || manifest === null || !("engines" in manifest) || !("dependencies" in manifest) || !("peerDependencies" in manifest) || !("peerDependenciesMeta" in manifest)) {
    throw new Error("test package manifest has no runtime contract");
  }
  const { engines, dependencies, peerDependencies, peerDependenciesMeta } = manifest;
  assert.deepEqual(engines, { node: "^22.22.2 || ^24.15.0 || >=26.0.0" });
  assert.equal(
    typeof dependencies === "object" && dependencies !== null && "@opencode-ai/plugin" in dependencies,
    false,
  );
  assert.equal(
    typeof peerDependencies === "object" && peerDependencies !== null && "@opencode-ai/plugin" in peerDependencies
      ? peerDependencies["@opencode-ai/plugin"]
      : undefined,
    "1.19.3",
  );
  assert.deepEqual(
    typeof peerDependenciesMeta === "object" && peerDependenciesMeta !== null && "@opencode-ai/plugin" in peerDependenciesMeta
      ? peerDependenciesMeta["@opencode-ai/plugin"]
      : undefined,
    { optional: true },
  );
});

test("package contract: the plugin adapter is type-checked by a wired project", () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const pluginConfig = JSON.parse(readFileSync(join(root, "tsconfig.plugin.json"), "utf8")) as unknown;
  if (typeof pluginConfig !== "object" || pluginConfig === null || !("include" in pluginConfig)) {
    throw new Error("tsconfig.plugin.json has no include list");
  }
  assert.deepEqual(pluginConfig.include, ["plugin/abathur.ts"]);
  if (typeof manifest !== "object" || manifest === null || !("scripts" in manifest)) {
    throw new Error("test package manifest has no scripts");
  }
  const { scripts } = manifest;
  const testScript = typeof scripts === "object" && scripts !== null && "test" in scripts ? scripts.test : undefined;
  if (typeof testScript !== "string") throw new Error("npm test script missing");
  assert.ok(testScript.includes("typecheck:plugin"), "npm test must run the plugin typecheck");
});

test("package surface: core package excludes optional historian integration", () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const files = packageFiles().flatMap((entry) => listFiles(root, entry));
  assert.deepEqual(files.filter((file) => file.startsWith("graders/historian/") || file === "config/genomes/historian.example.jsonc"), []);
});

test("package surface: shipped toy genome requires an explicit toy workspace", () => {
  const genomePath = fileURLToPath(new URL("../../genomes/toy-smoke/genome.jsonc", import.meta.url));
  const source = readFileSync(genomePath, "utf8");
  assert.match(source, /"repoPath"\s*:\s*"\$\{ABATHUR_TOY_REPO\}"/);
});

test("package surface: shipped assets contain no localhost fallback", () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const files = packageFiles().flatMap((entry) => listFiles(root, entry));
  const fallbackFiles = files.filter((file) => readFileSync(join(root, file), "utf8").includes(":-http://localhost"));

  assert.deepEqual(fallbackFiles, []);
});

test("package surface: portable files contain no machine-root evidence", () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const files = packageFiles().flatMap((entry) => listFiles(root, entry));
  const machineRootFiles = files.filter((file) => readFileSync(join(root, file), "utf8").includes("/home/lab"));

  assert.deepEqual(machineRootFiles, []);
});

function listFiles(root: string, packagePath: string): readonly string[] {
  const absolutePath = join(root, packagePath);
  if (statSync(absolutePath).isFile()) return [packagePath];

  return readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) => {
    const childPath = join(absolutePath, entry.name);
    return entry.isDirectory()
      ? listFiles(root, relative(root, childPath))
      : [relative(root, childPath)];
  });
}
