import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const KERNEL = resolve(new URL("../kernel", import.meta.url).pathname);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (name.endsWith(".mjs")) out.push(path);
  }
  return out;
}

test("kernel modules never reach into a sibling module's internals", () => {
  const problems = [];
  for (const file of walk(KERNEL)) {
    const source = readFileSync(file, "utf8");
    const dir = file.slice(0, file.lastIndexOf("/"));
    for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      const specifier = match[1];
      const resolved = resolve(dir, specifier);
      if (resolved.startsWith(`${KERNEL}/`) && !resolved.startsWith(`${dir}/`)) {
        if (!resolved.endsWith("/index.mjs")) problems.push(`${file}: deep import ${specifier}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("kernel modules do not import from cli, exam, or scripts", () => {
  const problems = [];
  for (const file of walk(KERNEL)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/from\s+["'][^"']*(\/(cli|exam|scripts)\/)/g)) {
      problems.push(`${file}: imports ${match[1]}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("every kernel module exposes an index entry", () => {
  const modules = readdirSync(KERNEL).filter((name) => statSync(join(KERNEL, name)).isDirectory());
  assert.ok(modules.length >= 9);
  for (const name of modules) {
    assert.ok(readdirSync(join(KERNEL, name)).includes("index.mjs"), `${name} lacks index.mjs`);
  }
});
