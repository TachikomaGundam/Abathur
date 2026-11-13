// Unit tests for the wave cell wrapper (Campaign B). No spawning: pure builders,
// signature gate, and fail-closed paths. Fixtures live in the os temp root.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  WrapError,
  loadTemplate,
  buildCellArgv,
  buildTargetArgv,
  buildRunRecord,
} from "../cellwrap.mjs";

function fixture(tplObj, signed) {
  const dir = mkdtempSync(path.join(tmpdir(), "cellwrap-test-"));
  const tplPath = path.join(dir, "tpl.json");
  const raw = JSON.stringify(tplObj, null, 2);
  writeFileSync(tplPath, raw);
  const sha = createHash("sha256").update(raw).digest("hex");
  const sigPath = path.join(dir, "sig.json");
  writeFileSync(sigPath, JSON.stringify({
    entries: signed ? [{ sha256: sha, signed_by: "owner" }] : [],
  }));
  return { dir, tplPath, sigPath, sha };
}

const baseTpl = {
  version: 1, net: "host", home: "/home/lab",
  masked: ["/home/lab/.ssh"], exe_dir: "/opt/exe",
  xdg_config_dir_rel: "templates/t/xdg-config",
  cell_env: { LANG: "C.UTF-8" },
};
const baseCell = {
  cell_id: "alpha", cwd: "/work/a",
  allowed_roots: ["/work/a"], read_roots: ["/data/ro"],
  forbidden_surfaces: [{ path: "/data/forbidden" }],
};
const paths = { spool: "/spool/a", maskDir: "/mask", xdgConfig: "/xdg", runRecord: "/spool/a/run.json" };

test("unsigned template is refused fail-closed", () => {
  const f = fixture(baseTpl, false);
  assert.throws(() => loadTemplate(f.tplPath, f.sigPath), (e) => e instanceof WrapError && e.code === "TEMPLATE-UNSIGNED");
});

test("blank signed_by does not count as a signature", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cellwrap-blank-"));
  const tplPath = path.join(dir, "t.json");
  const raw = JSON.stringify(baseTpl);
  writeFileSync(tplPath, raw);
  const sha = createHash("sha256").update(raw).digest("hex");
  const sigPath = path.join(dir, "s.json");
  writeFileSync(sigPath, JSON.stringify({ entries: [{ sha256: sha, signed_by: "  " }] }));
  assert.throws(() => loadTemplate(tplPath, sigPath), (e) => e.code === "TEMPLATE-UNSIGNED");
});

test("signed template loads with hash and signer", () => {
  const f = fixture(baseTpl, true);
  const loaded = loadTemplate(f.tplPath, f.sigPath);
  assert.equal(loaded.sha256, f.sha);
  assert.equal(loaded.signed_by, "owner");
});

test("argv: net host keeps network, net closed unshares net", () => {
  const open = buildCellArgv({ template: baseTpl, cell: baseCell, paths });
  assert.ok(!open.includes("--unshare-net"));
  const closed = buildCellArgv({ template: { ...baseTpl, net: "closed" }, cell: baseCell, paths });
  assert.ok(closed.includes("--unshare-net"));
});

test("argv: hard invariants — caps dropped, user namespaces, single writable bind", () => {
  const argv = buildCellArgv({ template: baseTpl, cell: baseCell, paths });
  const j = argv.join("\u0000");
  assert.ok(j.includes("--cap-drop\u0000ALL"));
  assert.ok(argv.includes("--unshare-user") && argv.includes("--unshare-pid") && argv.includes("--die-with-parent"));
  // the ONLY --bind (rw) destinations: the in-cell spool and the cell's allowed roots
  const rwTargets = [];
  for (let i = 0; i < argv.length - 2; i += 1) {
    if (argv[i] === "--bind") rwTargets.push(argv[i + 2]);
  }
  assert.deepEqual(rwTargets.sort(), ["/wave/spool", "/work/a"]);
  assert.ok(argv.includes("/spool/a")); // spool source present in the pair
  // masks are ro-binds of the empty mask dir => EROFS, never a writable tmpfs
  const maskIdx = argv.indexOf("/home/lab/.ssh");
  assert.equal(argv[maskIdx - 2], "--ro-bind");
  assert.equal(argv[maskIdx - 1], "/mask");
  // read_roots mount ro, forbidden surfaces mount ro-masked
  assert.ok(j.includes("--ro-bind\u0000/data/ro\u0000/data/ro"));
  assert.ok(j.includes("--ro-bind\u0000/mask\u0000/data/forbidden"));
  assert.ok(j.includes("--ro-bind\u0000/etc\u0000/etc") && j.includes("--ro-bind\u0000/usr\u0000/usr"));
  assert.ok(j.includes("--ro-bind\u0000/spool/a/run.json\u0000/abathur-run.json"));
});

test("argv: read_root inside allowed_root is not remounted ro", () => {
  const cell = { ...baseCell, allowed_roots: ["/work"], read_roots: ["/work/a"] };
  const argv = buildCellArgv({ template: baseTpl, cell, paths });
  const idx = argv.indexOf("/work/a");
  assert.ok(idx < 0 || argv[idx - 2] !== "--ro-bind" || argv[idx - 1] !== "/work/a");
});

test("target: shell needs a command; opencode builds a spool-instructed prompt", () => {
  assert.throws(() => buildTargetArgv({ template: baseTpl, cell: baseCell, waveId: "w1", target: "shell" }),
    (e) => e.code === "SHELL-CMD-REQUIRED");
  const shell = buildTargetArgv({ template: baseTpl, cell: baseCell, waveId: "w1", target: "shell", shellCmd: "id" });
  assert.deepEqual(shell.slice(0, 3), ["/usr/bin/env", "bash", "-lc"]);
  const oc = buildTargetArgv({ template: baseTpl, cell: baseCell, waveId: "w1", target: "opencode" });
  // seed copy then exec "$@": prompt stays a real argv element, never shell-quoted
  assert.deepEqual(oc.slice(0, 3), ["/usr/bin/env", "bash", "-lc"]);
  assert.ok(oc[3].startsWith("mkdir -p /wave/home/.config/opencode") && oc[3].endsWith('exec "$@"'));
  assert.equal(oc[4], "cellseed");
  assert.ok(oc[5].endsWith("opencode.exe"));
  assert.ok(oc[6].includes("/wave/spool/receipt.json"));
  // template without xdg seed: no copy preamble
  const oc2 = buildTargetArgv({ template: { ...baseTpl, xdg_config_dir_rel: undefined }, cell: baseCell, waveId: "w1", target: "opencode" });
  assert.equal(oc2[3], 'exec "$@"');
});

test("run record: launcher-signed fields present", () => {
  const f = fixture(baseTpl, true);
  const loaded = loadTemplate(f.tplPath, f.sigPath);
  const rec = buildRunRecord({
    cell: baseCell, waveId: "w1",
    template: { path: f.tplPath, sha256: loaded.sha256, signed_by: loaded.signed_by },
    bwrapProbe: { path: "/usr/bin/bwrap", digest: "d1", version: { text: "0.11" } },
    cellwrapSha256: "c1",
  });
  assert.equal(rec.origin, "launcher");
  assert.equal(rec.surface, "E0");
  assert.equal(rec.template.sha256, loaded.sha256);
  assert.equal(rec.bwrap.digest, "d1");
  assert.ok(Date.parse(rec.expires_at) > Date.parse(rec.issued_at));
});
