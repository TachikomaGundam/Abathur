// Todo 2 acceptance pins for src/core/ids.ts (TDD RED first — plan AC a).
// Given/When/Then throughout; tmpdirs namespaced via mkdtemp, torn down in
// t.after so parallel checkouts never collide.

import assert from "node:assert/strict";
import { symlinkSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile, chmod, utimes } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  canonicalJson,
  fileTreeDigest,
  fingerprint,
  genId,
  runId,
  treeDigestAt,
  walkTree,
} from "../core/ids.js";

async function freshRoot(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), `abathur-ids-${prefix}-`));
}

// -------------------------------------------------------------- canonicalJson

test("canonicalJson: object key order and input whitespace never change output", () => {
  // Given two JSON texts with identical content but different key order/spacing
  const a = `{"b":1,"a":{"d":[1,{"z":null,"y":true}],"c":2}}`;
  const b = '{ "a" : { "c": 2, "d" : [ 1, { "y": true, "z": null } ] }, "b" : 1 }';
  // When canonicalized
  const ca = canonicalJson(JSON.parse(a));
  const cb = canonicalJson(JSON.parse(b));
  // Then identical, compact, keys sorted recursively
  assert.equal(ca, cb);
  assert.equal(ca, '{"a":{"c":2,"d":[1,{"y":true,"z":null}]},"b":1}');
  assert.ok(!ca.includes(" "));
});

test("canonicalJson: array order is data and is preserved verbatim", () => {
  assert.equal(canonicalJson([2, 1]), "[2,1]");
  assert.notEqual(canonicalJson([2, 1]), canonicalJson([1, 2]));
});

test("canonicalJson: object keys sort by UTF-16 code unit order, stably", () => {
  const out = canonicalJson({ é: 1, b: 2, A: 3, "0": 4 });
  assert.equal(out, '{"0":4,"A":3,"b":2,"é":1}');
});

test("canonicalJson: undefined object props dropped, array holes become null (JSON parity)", () => {
  assert.equal(canonicalJson({ a: 1, b: undefined }), '{"a":1}');
  assert.equal(canonicalJson([undefined, 1]), "[null,1]");
});

test("canonicalJson: finite floats serialize JSON-identically; non-finite fail closed", () => {
  assert.equal(canonicalJson({ x: -0.5, y: 1e21 }), '{"x":-0.5,"y":1e+21}');
  // JSON.stringify maps NaN/±Infinity to null — a silent collision we refuse.
  assert.throws(() => canonicalJson(Number.NaN), TypeError);
  assert.throws(() => canonicalJson({ x: Number.POSITIVE_INFINITY }), TypeError);
});

test("canonicalJson: fail-closed on non-JSON top-levels and exotic objects", () => {
  assert.throws(() => canonicalJson(undefined), TypeError);
  assert.throws(() => canonicalJson(() => 1), TypeError);
  assert.throws(() => canonicalJson(new Date(0)), TypeError); // plain-JSON only
});

// ------------------------------------------------------------------ fingerprint

test("fingerprint: 64-hex sha256, stable across key order, sensitive to one byte", () => {
  const fp1 = fingerprint({ b: [1, { d: "x", c: 2 }], a: null });
  const fp2 = fingerprint({ a: null, b: [1, { c: 2, d: "x" }] });
  const fp3 = fingerprint({ a: null, b: [1, { c: 2, d: "y" }] });
  assert.match(fp1, /^[0-9a-f]{64}$/);
  assert.equal(fp1, fp2);
  assert.notEqual(fp1, fp3);
});

// ------------------------------------------------------------------- tree digest

test("fileTreeDigest: order-independent over paths, rejects duplicate paths", () => {
  const f1 = { path: "a.txt", content: "hello\n" };
  const f2 = { path: "dir/b.txt", content: "world" };
  assert.equal(fileTreeDigest([f1, f2]), fileTreeDigest([f2, f1]));
  assert.match(fileTreeDigest([f1]), /^[0-9a-f]{64}$/);
  assert.throws(() => fileTreeDigest([f1, { ...f2, path: "a.txt" }]), /duplicate/i);
  assert.notEqual(fileTreeDigest([f1]), fileTreeDigest([{ ...f1, content: "hellp\n" }]));
});

test("treeDigestAt (AC a): chmod + mtime touch leave digest unchanged, one content byte flips it", async (t) => {
  const root = await freshRoot("tree");
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "dir"), { recursive: true });
  const a = path.join(root, "a.txt");
  await writeFile(a, "hello\n", "utf8");
  await writeFile(path.join(root, "dir", "b.txt"), new Uint8Array([1, 2, 250]), "utf8");

  // Given a stable tree
  const d0 = treeDigestAt(root);
  // When file metadata changes (chmod, mtime) but content does not
  await chmod(a, 0o600);
  const future = new Date(Date.UTC(2099, 0, 1));
  await utimes(a, future, future);
  // Then digest is unchanged — modes/mtimes excluded by construction
  assert.equal(treeDigestAt(root), d0);

  // When exactly one content byte flips
  await writeFile(a, "hallo\n", "utf8");
  // Then digest changes
  assert.notEqual(treeDigestAt(root), d0);
});

test("walkTree: sorted forward-slash relative paths, regular files only, empty tree OK", async (t) => {
  const root = await freshRoot("walk");
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(walkTree(root), []);
  await mkdir(path.join(root, "z", "y"), { recursive: true });
  await writeFile(path.join(root, "z", "b.txt"), "b", "utf8");
  await writeFile(path.join(root, "z", "y", "a.txt"), "a", "utf8");
  await writeFile(path.join(root, "m.txt"), "m", "utf8");
  const entries = walkTree(root);
  assert.deepEqual(
    entries.map((e) => e.path),
    ["m.txt", "z/b.txt", "z/y/a.txt"],
  );
  // Symlinks are not content-addressable by path alone — excluded from the tree
  symlinkSync("m.txt", path.join(root, "l.txt"));
  assert.deepEqual(
    walkTree(root).map((e) => e.path),
    ["m.txt", "z/b.txt", "z/y/a.txt"],
  );
});

// ------------------------------------------------------------------ genId/runId

test("genId: g-<ulctime>-<first8 of fingerprint>, clock-injectable", () => {
  const at = new Date(Date.UTC(2026, 8, 9, 14, 25, 30));
  assert.equal(genId("deadbeefcafe1234", at), "g-20260909T142530Z-deadbeef");
  assert.equal(genId("abc", at), "g-20260909T142530Z-abc"); // short seed: take what exists
  assert.match(genId("f".repeat(64)), /^g-\d{8}T\d{6}Z-f{8}$/); // default clock, 8-hex cut
  assert.throws(() => genId("", at), /fingerprint/);
});

test("runId: r-<genId>-<unitId>-<repIdx> with validated rep", () => {
  assert.equal(runId("g-20260909T142530Z-deadbeef", "mutate", 3), "r-g-20260909T142530Z-deadbeef-mutate-3");
  for (const bad of [-1, 1.5, Number.NaN]) {
    assert.throws(() => runId("g-x", "u", bad), /repIdx/);
  }
  assert.throws(() => runId("g-x", "", 0), /unitId/);
});
