#!/usr/bin/env node
// Wave cell wrapper (Campaign B mount-isolation ruling, three adversarial rounds, 2026-11-12).
// Wraps one cell as an independent bwrap process tree: the cell's whole
// tool surface (shell, file tools, MCP) shares one mount namespace, so
// read/write denial is a mount fact, not a declaration.
//
// Fail-closed gates, in order:
//   1. template sha256 must have a human-signed entry (signed_by non-empty)
//      in the signature registry; --dry skips nothing except spawning.
//   2. bwrap probe (version + feature flags) reuses kernel/exec/bwrap.mjs.
//   3. every bind source passes dual-fetch identity (path stat vs fd fstat,
//      dev+ino must match) immediately before spawn — TOCTOU-equivalent,
//      residual window named, not claimed closed.
// Masked surfaces are ro-binds of an empty launcher-private tmpfs dir, so
// writes fail EROFS visibly (silent-success masking is banned, F12).
//
// Usage:
//   node tools/wave_engine/cellwrap.mjs template-sha <template.json>
//   node tools/wave_engine/cellwrap.mjs spawn --cell <cell.json> --spool <dir>
//        --template <t.json> --signatures <s.json>
//        [--target opencode|shell] [--cmd '<sh -c ...>'] [--foreground] [--dry]
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { findBwrap, probeBwrap, sha256File } from "../../kernel/exec/bwrap.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

export class WrapError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function loadTemplate(templatePath, signaturesPath) {
  const raw = fs.readFileSync(templatePath);
  const sha256 = createHash("sha256").update(raw).digest("hex");
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(signaturesPath, "utf8"));
  } catch (error) {
    throw new WrapError("SIGNATURES-UNREADABLE", `${signaturesPath}: ${error.message}`);
  }
  const entries = Array.isArray(registry.entries) ? registry.entries : [];
  const hit = entries.find(
    (e) => e && e.sha256 === sha256 && typeof e.signed_by === "string" && e.signed_by.trim() !== "",
  );
  if (!hit) {
    throw new WrapError(
      "TEMPLATE-UNSIGNED",
      `${templatePath} sha256=${sha256} has no signed entry in ${signaturesPath}; owner signs before any non-dry spawn`,
    );
  }
  return { template: JSON.parse(raw.toString("utf8")), sha256, signed_by: hit.signed_by };
}

/** Dual-fetch identity: path view vs fd view must agree (dev+ino). */
export function dualFetchIdentity(p) {
  let st;
  try {
    st = fs.statSync(p);
  } catch (error) {
    throw new WrapError("BIND-SOURCE-MISSING", `${p}: ${error.code ?? error.message}`);
  }
  const flags = fs.constants.O_RDONLY | (st.isDirectory() ? fs.constants.O_DIRECTORY : 0);
  const fd = fs.openSync(p, flags);
  try {
    const f = fs.fstatSync(fd);
    if (f.dev !== st.dev || f.ino !== st.ino) {
      throw new WrapError("BIND-SOURCE-DRIFT", `${p}: path view ${st.dev}:${st.ino} != fd view ${f.dev}:${f.ino}`);
    }
  } finally {
    fs.closeSync(fd);
  }
  return { dev: st.dev, ino: st.ino };
}

/** Pure argv builder (tested without spawning). */
export function buildCellArgv({ template, cell, paths }) {
  const home = template.home ?? "/home/lab";
  const argv = [
    "--die-with-parent", "--new-session",
    "--unshare-user", "--unshare-pid", "--unshare-ipc", "--unshare-uts", "--unshare-cgroup",
  ];
  if (template.net === "closed") argv.push("--unshare-net");
  argv.push(
    "--cap-drop", "ALL",
    "--tmpfs", "/",
    "--proc", "/proc",
    "--dev", "/dev",
    "--ro-bind", "/etc", "/etc",
    "--ro-bind", "/usr", "/usr",
    "--symlink", "/usr/bin", "/bin",
    "--symlink", "/usr/sbin", "/sbin",
    "--symlink", "/usr/lib", "/lib",
    "--symlink", "/usr/lib64", "/lib64",
    "--tmpfs", home,
  );
  for (const m of template.masked ?? []) argv.push("--ro-bind", paths.maskDir, m);
  argv.push("--tmpfs", "/wave");
  argv.push("--bind", paths.spool, "/wave/spool"); // the only durable writable surface
  if (paths.runRecord) argv.push("--ro-bind", paths.runRecord, "/abathur-run.json");
  if (paths.xdgConfig) argv.push("--ro-bind", paths.xdgConfig, "/wave/xdg-config");
  if (template.exe_dir) argv.push("--ro-bind", template.exe_dir, template.exe_dir);
  const allowed = cell.allowed_roots ?? [];
  for (const root of allowed) argv.push("--bind", root, root);
  for (const root of cell.read_roots ?? []) {
    if (allowed.some((a) => root === a || root.startsWith(a + "/"))) continue;
    argv.push("--ro-bind", root, root);
  }
  for (const entry of cell.forbidden_surfaces ?? []) {
    if (entry && typeof entry.path === "string") argv.push("--ro-bind", paths.maskDir, entry.path);
  }
  const env = {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: "/wave/home",
    XDG_CONFIG_HOME: "/wave/xdg-config",
    ...(template.cell_env ?? {}),
  };
  argv.push("--clearenv");
  for (const [k, v] of Object.entries(env)) argv.push("--setenv", k, String(v));
  argv.push("--tmpfs", "/wave/home", "--chdir", cell.cwd);
  return argv;
}

export function buildTargetArgv({ template, cell, waveId, target, shellCmd }) {
  if (target === "shell") {
    if (!shellCmd) throw new WrapError("SHELL-CMD-REQUIRED", "--target shell needs --cmd");
    return ["/usr/bin/env", "bash", "-lc", shellCmd];
  }
  if (!template.exe_dir) throw new WrapError("EXE-DIR-MISSING", "template has no exe_dir for opencode target");
  const exe = path.join(template.exe_dir, "opencode.exe");
  const prompt =
    `Wave ${waveId} cell ${cell.cell_id}: read your brief /wave/spool/brief.md and work inside cwd ${cell.cwd} ` +
    `(allowed_roots: ${(cell.allowed_roots ?? []).join(", ")}). This cell is mount-enforced: writes outside the ` +
    "binds fail visibly. When finished write /wave/spool/receipt.json containing " +
    '{status:"done", receipt_text:"...", artifacts:[{path:"<file under /wave/spool>",sha256:"<its sha256>"}]}; ' +
    'on failure write {status:"failed", note:"..."}. Do not touch wave state directly; the supervisor ingests the spool.';
  return [exe, "run", prompt];
}

export function buildRunRecord({ cell, waveId, template, bwrapProbe, cellwrapSha256 }) {
  const now = Date.now();
  return {
    id: `cellwrap-${now}-${createHash("sha256").update(`${waveId}/${cell.cell_id}/${now}`).digest("hex").slice(0, 16)}`,
    surface: "E0",
    root: cell.cwd,
    origin: "launcher",
    launcher: "cellwrap",
    pid: process.pid,
    template: { path: template.path, sha256: template.sha256, signed_by: template.signed_by },
    bwrap: { path: bwrapProbe.path, digest: bwrapProbe.digest, version: bwrapProbe.version.text },
    cellwrap_sha256: cellwrapSha256,
    cell: `${waveId}/${cell.cell_id}`,
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + 60 * 60 * 1000).toISOString(),
  };
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    else out._.push(a);
  }
  return out;
}

export function main(argv) {
  const mode = argv[0];
  if (mode === "template-sha") {
    process.stdout.write(`${sha256File(path.resolve(argv[1]))}\n`);
    return 0;
  }
  if (mode !== "spawn") throw new WrapError("USAGE", "mode must be template-sha or spawn");
  const args = parseArgs(argv.slice(1));
  const cellPath = path.resolve(args.cell ?? (() => { throw new WrapError("USAGE", "--cell required"); })());
  const spool = path.resolve(args.spool ?? (() => { throw new WrapError("USAGE", "--spool required"); })());
  const cell = JSON.parse(fs.readFileSync(cellPath, "utf8"));
  const waveId = path.basename(path.dirname(cellPath));
  const templatePath = path.resolve(args.template ?? path.join(REPO, "templates/wave-cell.json"));
  const signaturesPath = path.resolve(args.signatures ?? path.join(REPO, "templates/wave-cell.SIGNATURES.json"));

  const template = loadTemplate(templatePath, signaturesPath);
  template.path = templatePath;
  let bwrapProbe;
  try {
    bwrapProbe = probeBwrap(findBwrap());
  } catch (error) {
    if (!args.dry) throw error;
    bwrapProbe = { path: findBwrap(), digest: "dry-no-probe", version: { text: "dry-no-probe" } };
  }
  const maskBase = fs.existsSync("/run/user/1000") ? "/run/user/1000" : os.tmpdir();
  const maskRoot = fs.mkdtempSync(path.join(maskBase, "wave-cell-mask-")); // launcher-private empty dirs => EROFS masks
  const xdgRel = template.template?.xdg_config_dir_rel;
  const paths = {
    spool,
    maskDir: maskRoot,
    xdgConfig: xdgRel ? path.join(REPO, xdgRel) : null,
    runRecord: path.join(spool, "run.json"),
  };
  fs.mkdirSync(spool, { recursive: true });
  if (cell.brief_path && fs.existsSync(cell.brief_path)) fs.copyFileSync(cell.brief_path, path.join(spool, "brief.md"));

  for (const src of [spool, paths.xdgConfig, template.exe_dir, ...(cell.allowed_roots ?? []), ...(cell.read_roots ?? [])]) {
    if (src) dualFetchIdentity(src);
  }
  const record = buildRunRecord({
    cell,
    waveId,
    template: { path: templatePath, sha256: template.sha256, signed_by: template.signed_by },
    bwrapProbe,
    cellwrapSha256: sha256File(fileURLToPath(import.meta.url)),
  });
  const recordText = `${JSON.stringify(record, null, 2)}\n`;
  if (args.dry) {
    const argv2 = [
      bwrapProbe.path,
      ...buildCellArgv({ template: template.template, cell, paths }),
      ...buildTargetArgv({ template: template.template, cell, waveId, target: args.target ?? "opencode", shellCmd: typeof args.cmd === "string" ? args.cmd : null }),
    ];
    process.stdout.write(`${JSON.stringify({ dry: true, run_record: record, argv: argv2 }, null, 2)}\n`);
    return 0;
  }
  fs.writeFileSync(paths.runRecord, recordText);
  const child = spawn(
    bwrapProbe.path,
    [...buildCellArgv({ template: template.template, cell, paths }),
     ...buildTargetArgv({ template: template.template, cell, waveId, target: args.target ?? "opencode", shellCmd: typeof args.cmd === "string" ? args.cmd : null })],
    args.foreground
      ? { stdio: "inherit" }
      : { stdio: ["ignore", fs.openSync(path.join(spool, "spawn.log"), "a"), fs.openSync(path.join(spool, "spawn.log"), "a")], detached: true },
  );
  if (!args.foreground) child.unref();
  const result = {
    cell: `${waveId}/${cell.cell_id}`,
    pid: child.pid,
    run_record: paths.runRecord,
    template_sha256: template.sha256,
    bwrap_digest: bwrapProbe.digest,
    mask_root: maskRoot,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (args.foreground) {
    return new Promise((res) => child.on("exit", (code) => res(code ?? 1)));
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  Promise.resolve(main(process.argv.slice(2)))
    .then((code) => { if (typeof code === "number" && code !== 0) process.exit(code); })
    .catch((error) => {
      process.stderr.write(`CELLWRAP-FAIL ${error.code ?? "ERROR"}: ${error.message}\n`);
      process.exit(2);
    });
}
