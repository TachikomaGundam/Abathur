// Docs-currency gate (born INCIDENT-20261006-README-ROT: Sibyl ballots found the
// README shipping a dead install literal, a false dependency claim, and half-listed
// human gates — narrative drift nothing was checking). This test IS the gate:
// every claim class that rotted once is now machine-verified against the same
// authoritative sources the code uses (package.json, the COMMANDS registry).
//
// The README split into one English authority and one stamped Chinese translation.
// The split removes the second-authority drift; the stamp and the structural
// parity checks below are what keep the translation honest afterwards.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { COMMANDS } from "../cli.js";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const readme = readFileSync(path.join(REPO, "README.md"), "utf8");
const readmeZh = readFileSync(path.join(REPO, "README.zh.md"), "utf8");
const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  files: string[];
};

const locales = [
  { name: "en", text: readme },
  { name: "zh", text: readmeZh },
] as const;

function headingCount(text: string): number {
  return (text.match(/^## /gm) ?? []).length;
}

function fenceCount(text: string): number {
  return (text.match(/^```/gm) ?? []).length;
}

/** Relative link targets, minus the language switch (which intentionally differs). */
function linkTargets(text: string): string[] {
  return [...text.matchAll(/\]\(([^)]+)\)/g)]
    .flatMap((match) => (match[1] === undefined ? [] : [match[1]]))
    .filter(
      (target) =>
        !target.startsWith("http") &&
        !target.startsWith("#") &&
        target !== "README.md" &&
        target !== "README.zh.md",
    )
    .sort();
}

test("install path never pins a tarball version (glob only)", () => {
  for (const { name, text } of locales) {
    assert.doesNotMatch(
      text,
      /tachikomagundam-abathur-\d+\.\d+\.\d+\.tgz/,
      `${name}: a pinned x.y.z tgz literal rots every release — use the *-tgz glob form`,
    );
  }
});

test("runtime dependencies named truthfully (every real dep appears per locale)", () => {
  for (const { name, text } of locales) {
    for (const dep of Object.keys(pkg.dependencies)) {
      assert.ok(text.includes(dep), `${name}: README omits runtime dependency ${dep}`);
    }
  }
  // 0.4.1 contract: zod is the only runtime dep; the plugin SDK is an optional
  // peer and the README must say so in both locales (the 0.4.0 incident made
  // this claim load-bearing).
  assert.ok(readme.includes("optional peer"), "EN README must describe the SDK as an optional peer");
  assert.ok(readmeZh.includes("可选对等依赖"), "ZH README must describe the SDK as an optional peer");
});

test("every registered CLI command appears in both READMEs", () => {
  for (const spec of COMMANDS) {
    for (const { name, text } of locales) {
      assert.ok(text.includes(spec.name), `${name}: README never mentions command '${spec.name}'`);
    }
  }
});

test("human-gate enumeration is complete on BOTH halves", () => {
  for (const gate of ["promote", "tombstone", "retract"]) {
    for (const { name, text } of locales) {
      assert.ok(text.includes(gate), `${name}: gate '${gate}' missing entirely`);
    }
  }
  assert.ok(
    /`promote`,\s*`tombstone` and `retract` are deliberately NOT reachable/.test(readme),
    "EN gate sentence must list all three",
  );
  assert.ok(
    /`promote`、`tombstone` 与 `retract` 刻意\s*不可经由工具触达/.test(readmeZh),
    "ZH gate sentence must list all three (line-wrap tolerant)",
  );
});

test("opencode-status foreign semantics stay as the code behaves", () => {
  // status classifies 'foreign' and exits 0; only install/uninstall refuse (exit 2).
  assert.ok(!readme.includes("both commands refuse with exit 2"), "stale EN foreign claim");
  assert.ok(!readmeZh.includes("两条命令都会 exit 2"), "stale ZH foreign claim");
  assert.ok(readme.includes("reports the foreign state and exits 0"), "EN foreign/status pair missing");
  assert.ok(readmeZh.includes("只报告 foreign 状态并 exit 0"), "ZH foreign/status pair missing");
});

test("Chinese README is a stamped translation of the English authority", () => {
  const stamp = readmeZh.match(/<!-- translated-from: README\.md sha256=([0-9a-f]{64}) -->/);
  assert.ok(stamp, "README.zh.md must carry a translated-from stamp naming the English sha256");
  const actual = createHash("sha256").update(readme, "utf8").digest("hex");
  assert.equal(
    stamp[1],
    actual,
    "README.zh.md stamp is stale — re-translate from the current README.md, then update the stamp",
  );
});

test("bilingual structure stays aligned (headings, fences, relative links)", () => {
  assert.equal(headingCount(readmeZh), headingCount(readme), "section count drifted between locales");
  assert.equal(fenceCount(readmeZh), fenceCount(readme), "code-block count drifted between locales");
  assert.deepEqual(linkTargets(readmeZh), linkTargets(readme), "relative link sets drifted between locales");
});

test("mutator quick start ships a runnable example instead of an inline source dump", () => {
  const example = path.join(REPO, "examples", "toy-stub.mjs");
  for (const { name, text } of locales) {
    assert.ok(
      text.includes("examples/toy-stub.mjs"),
      `${name}: quick start must reference the shipped example`,
    );
    assert.ok(!text.includes("cat > toy-stub.mjs"), `${name}: quick start must not inline the source`);
  }
  assert.ok(pkg.files.includes("examples"), "package.json must publish examples/");
  assert.ok(pkg.files.includes("README.zh.md"), "package.json must publish README.zh.md");
  execFileSync(process.execPath, ["--check", example], { stdio: "pipe" });
});

test("the quick start still teaches that a mutator is a command template", () => {
  assert.ok(readme.includes("a mutator is an argv command template"), "EN contract sentence missing");
  assert.ok(readmeZh.includes("变异器是一条 argv 命令模板"), "ZH contract sentence missing");
});
