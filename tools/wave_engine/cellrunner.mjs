#!/usr/bin/env node
// Cell runner: the registered out-of-cage executor for seat-driven sandbox tests.
// Why: from inside the seat cage, CLONE_NEWNS is EPERM even after CLONE_NEWUSER
// (measured 2026-11-12 20:20:37), so the seat cannot build its own test cages.
// The runner starts once on the true face (owner key), then every sandbox test
// is queued, executed, and collected by the seat itself.
//
// Contract (fail-closed):
//   submit  validates a request against a strict schema and drops it in
//           .omo/spawn-queue/pending/. Only: signed mount template under
//           <repo>/templates, target=shell (cmd) or opencode (brief, template
//           must declare exe_dir), roots inside the allowlist.
//   serve   --once/--loop claims pending requests (atomic rename), runs them
//           through cellwrap (which enforces template signatures), and writes
//           a hashed result to done/. The runner never executes host commands.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
export const QUEUE = path.join(REPO, ".omo", "spawn-queue");
export const EXTRA_ROOT = "/home/lab/tmp/opencode";
export const TIMEOUT_CAP_S = 600;
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function sha256File(p) {
  return createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function realContained(p, rootReal) {
  let real;
  try {
    real = fs.realpathSync(p);
  } catch {
    return { ok: false, why: `cannot resolve: ${p}` };
  }
  const rel = path.relative(rootReal, real);
  return { ok: rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)), real, why: `escapes ${rootReal}: ${p}` };
}

/** Pure validator (unit-tested). Returns {ok, errors, rootsReal}. */
export function validateRequest(req, opts = {}) {
  const repoRoot = opts.repoRoot ?? REPO;
  const extraRoot = opts.extraRoot ?? EXTRA_ROOT;
  const repoReal = fs.realpathSync(repoRoot);
  const extraReal = fs.existsSync(extraRoot) ? fs.realpathSync(extraRoot) : null;
  const errors = [];
  if (!req || typeof req !== "object") return { ok: false, errors: ["request must be an object"], rootsReal: [] };
  if (typeof req.id !== "string" || !ID_RE.test(req.id)) errors.push(`id must match ${ID_RE}`);
  if (req.target !== "shell" && req.target !== "opencode") errors.push('target must be "shell" or "opencode"');
  if (req.target === "shell") {
    if (typeof req.cmd !== "string" || req.cmd.length === 0 || req.cmd.length > 8192) errors.push("cmd must be a 1..8192 char string");
  } else if (req.target === "opencode") {
    if (req.cmd !== undefined) errors.push("opencode target takes no cmd; the cell works from its brief");
    if (typeof req.brief !== "string" || req.brief.length === 0 || req.brief.length > 16384) errors.push("brief must be a 1..16384 char string for opencode target");
  }
  const timeout = req.timeout_s ?? 120;
  if (!(typeof timeout === "number" && timeout > 0 && timeout <= TIMEOUT_CAP_S)) errors.push(`timeout_s must be 1..${TIMEOUT_CAP_S}`);

  const insideRoots = [];
  for (const key of ["template", "signatures"]) {
    const c = realContained(req[key] ?? "", repoReal);
    if (!c.ok || !c.real.startsWith(path.join(repoReal, "templates"))) errors.push(`${key} must be under ${repoReal}/templates (${req[key]})`);
  }
  if (req.target === "opencode") {
    try {
      const t = JSON.parse(fs.readFileSync(req.template, "utf8"));
      if (!t.exe_dir) errors.push(`template ${req.template} lacks exe_dir required by the opencode target`);
    } catch (error) {
      errors.push(`template unreadable: ${error.message}`);
    }
  }
  const roots = Array.isArray(req.allowed_roots) ? req.allowed_roots : [];
  const rootsReal = [];
  for (const r of roots) {
    const c = realContained(r, repoReal);
    const e = extraReal ? realContained(r, extraReal) : { ok: false };
    if (c.ok) rootsReal.push(c.real);
    else if (e.ok) rootsReal.push(e.real);
    else errors.push(`allowed_root outside allowlist (repo|${extraRoot}): ${r}`);
  }
  if (rootsReal.length === 0) errors.push("allowed_roots must contain at least one existing in-allowlist root");
  const cwdC = [...rootsReal].some((rr) => {
    const c = realContained(req.cwd ?? "", rr);
    return c.ok;
  });
  if (!cwdC) errors.push(`cwd must exist inside one allowed root: ${req.cwd}`);
  if (req.brief_path !== undefined) {
    const c = realContained(req.brief_path, repoReal);
    const e = extraReal ? realContained(req.brief_path, extraReal) : { ok: false };
    if (!c.ok && !e.ok) errors.push(`brief_path outside allowlist: ${req.brief_path}`);
  }
  for (const r of req.read_roots ?? []) {
    const c = realContained(r, repoReal);
    if (!c.ok) errors.push(`read_root must exist inside the repo (v1): ${r}`);
  }
  return { ok: errors.length === 0, errors, rootsReal, timeout_s: timeout };
}

function atomicWrite(p, text) {
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, p);
}

export function submit(req, opts = {}) {
  const queue = opts.queue ?? QUEUE;
  const v = opts.validate === false ? { ok: true, errors: [] } : validateRequest(req, opts.validateOpts ?? {});
  if (!v.ok) return { ok: false, errors: v.errors };
  fs.mkdirSync(path.join(queue, "pending"), { recursive: true });
  const dest = path.join(queue, "pending", `${req.id}.request.json`);
  try {
    fs.writeFileSync(dest, `${JSON.stringify(req, null, 2)}\n`, { flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") return { ok: false, errors: [`request id already used: ${req.id}`] };
    throw error;
  }
  return { ok: true, path: dest, request_sha256: sha256File(dest) };
}

function bootLine() {
  fs.mkdirSync(QUEUE, { recursive: true });
  const line = {
    ts: new Date().toISOString(),
    pid: process.pid,
    node: process.version,
    exe: process.execPath,
    exe_sha256: sha256File(process.execPath),
    runner_sha256: sha256File(fileURLToPath(import.meta.url)),
  };
  fs.appendFileSync(path.join(QUEUE, "boot.log"), `${JSON.stringify(line)}\n`);
  return line;
}

/** Claim + execute one request file. Pure enough to unit-test the plumbing. */
export function runRequest(requestPath, opts = {}) {
  const queue = opts.queue ?? QUEUE;
  const req = JSON.parse(fs.readFileSync(requestPath, "utf8"));
  const request_sha256 = sha256File(requestPath);
  const runDir = path.join(queue, "runs", req.id);
  fs.mkdirSync(runDir, { recursive: true });
  const cell = {
    cell_id: req.id,
    cwd: req.cwd,
    allowed_roots: req.allowed_roots,
    read_roots: req.read_roots ?? [],
    forbidden_surfaces: req.forbidden_surfaces ?? [],
  };
  if (req.brief_path) cell.brief_path = req.brief_path;
  if (req.target === "opencode" && typeof req.brief === "string") {
    const briefPath = path.join(runDir, "brief.md");
    fs.writeFileSync(briefPath, req.brief.endsWith("\n") ? req.brief : `${req.brief}\n`);
    cell.brief_path = briefPath;
  }
  const cellPath = path.join(runDir, "cell.json");
  fs.writeFileSync(cellPath, `${JSON.stringify(cell, null, 2)}\n`);
  const started = new Date().toISOString();
  const argv = [
    path.join(HERE, "cellwrap.mjs"), "spawn",
    "--cell", cellPath,
    "--spool", path.join(runDir, "spool"),
    "--template", req.template,
    "--signatures", req.signatures,
  ];
  if (req.target === "opencode") argv.push("--target", "opencode", "--foreground");
  else argv.push("--target", "shell", "--cmd", req.cmd, "--foreground");
  const r = spawnSync(process.execPath, argv, {
    timeout: Math.round((req.timeout_s ?? 120) * 1000),
    maxBuffer: 8 * 1024 * 1024,
    encoding: "utf8",
  });
  const finished = new Date().toISOString();
  const outPath = path.join(runDir, "output.log");
  atomicWrite(outPath, `${r.stdout ?? ""}${r.stderr ? `\n---stderr---\n${r.stderr}` : ""}`);
  const spoolFiles = [];
  const spoolDir = path.join(runDir, "spool");
  if (fs.existsSync(spoolDir)) {
    for (const name of fs.readdirSync(spoolDir)) {
      const fp = path.join(spoolDir, name);
      if (fs.statSync(fp).isFile()) spoolFiles.push({ name, sha256: sha256File(fp), bytes: fs.statSync(fp).size });
    }
  }
  const result = {
    id: req.id,
    request_sha256,
    rc: r.status === null || r.status === undefined ? -1 : r.status,
    signal: r.signal ?? null,
    error: r.error ? String(r.error.message ?? r.error) : null,
    started_at: started,
    finished_at: finished,
    output: { path: outPath, sha256: sha256File(outPath) },
    spool: spoolFiles,
    template_sha256: sha256File(req.template),
  };
  return result;
}

export function serveOnce(opts = {}) {
  const queue = opts.queue ?? QUEUE;
  const pendingDir = path.join(queue, "pending");
  const runningDir = path.join(queue, "running");
  const doneDir = path.join(queue, "done");
  for (const d of [pendingDir, runningDir, doneDir]) fs.mkdirSync(d, { recursive: true });
  const processed = [];
  for (const name of fs.readdirSync(pendingDir).sort()) {
    if (!name.endsWith(".request.json")) continue;
    const pending = path.join(pendingDir, name);
    const claimed = path.join(runningDir, name);
    try {
      fs.renameSync(pending, claimed); // atomic claim; loser sees ENOENT and skips
    } catch {
      continue;
    }
    let result;
    try {
      result = runRequest(claimed, { queue });
    } catch (error) {
      result = { id: name.replace(".request.json", ""), rc: -2, error: `runner: ${error.message}`, started_at: new Date().toISOString(), finished_at: new Date().toISOString() };
    }
    atomicWrite(path.join(doneDir, `${result.id}.result.json`), `${JSON.stringify(result, null, 2)}\n`);
    fs.renameSync(claimed, path.join(doneDir, `${result.id}.request.json`));
    processed.push(result.id);
  }
  atomicWrite(path.join(queue, "heartbeat.json"), `${JSON.stringify({
    ts: new Date().toISOString(),
    pid: process.pid,
    processed: processed.length,
    pending_left: fs.readdirSync(pendingDir).filter((n) => n.endsWith(".request.json")).length,
  })}\n`);
  return processed;
}

/** Health snapshot for seats: never fails, always explainable. */
export function healthReport(opts = {}) {
  const queue = opts.queue ?? QUEUE;
  const readJsonSafe = (p) => {
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      return null;
    }
  };
  const count = (d) => {
    try {
      return fs.readdirSync(path.join(queue, d)).filter((n) => n.endsWith(".request.json")).length;
    } catch {
      return 0;
    }
  };
  const hb = readJsonSafe(path.join(queue, "heartbeat.json"));
  const ageS = hb ? Math.round((Date.now() - Date.parse(hb.ts)) / 1000) : null;
  let lastBoot = null;
  try {
    const lines = fs.readFileSync(path.join(queue, "boot.log"), "utf8").trim().split("\n");
    lastBoot = JSON.parse(lines[lines.length - 1]);
  } catch { /* no boot record yet */ }
  let doneNames = [];
  try {
    doneNames = fs.readdirSync(path.join(queue, "done")).filter((n) => n.endsWith(".result.json"));
  } catch { /* none yet */ }
  let lastResult = null;
  if (doneNames.length > 0) {
    const r = readJsonSafe(path.join(queue, "done", doneNames[doneNames.length - 1]));
    if (r) lastResult = { id: r.id, rc: r.rc, finished_at: r.finished_at };
  }
  // Cron cadence is 60s; 150s tolerance covers two ticks plus slack.
  return { ts: new Date().toISOString(), heartbeat: hb, heartbeat_age_s: ageS, alive: ageS !== null && ageS <= 150, queue: { pending: count("pending"), running: count("running"), done_files: doneNames.length }, last_result: lastResult, last_boot: lastBoot };
}

// ---- cron installation (product entry: abathur runner install|uninstall) ----
export const CRON_TAG = "# abathur-cellrunner";

export function cronLine(opts = {}) {
  const node = opts.node ?? "/usr/bin/node";
  return `* * * * * cd ${REPO} && ${node} ${path.join(REPO, "tools/wave_engine/cellrunner.mjs")} serve --once >/dev/null 2>&1 ${CRON_TAG}`;
}

export function mergeCron(existing, line) {
  const kept = String(existing ?? "").split("\n").filter((l) => !l.includes(CRON_TAG));
  const body = kept.join("\n").trimEnd();
  return `${body ? `${body}\n` : ""}${line}\n`;
}

/** Cage self-detection: our seat cage carries an AppArmor profile containing "bwrap".
 *  Installing cron from inside the cage would silently target a masked /var — worse
 *  than failing, it would be a false success. So: refuse from inside. */
export function inCage(opts = {}) {
  let profile = "";
  try {
    profile = fs.readFileSync(opts.attrCurrent ?? "/proc/self/attr/current", "utf8").trim();
  } catch {
    return { inside: true, profile: "unreadable" };
  }
  return { inside: /bwrap/i.test(profile), profile };
}

export function installCron(opts = {}) {
  const cage = inCage(opts);
  if (cage.inside) {
    return { ok: false, code: "CAGE-DETECTED", detail: `apparmor=${cage.profile}`, fix: "run this command on the true face (owner shell), not from a seat" };
  }
  if (!fs.existsSync(opts.crondPid ?? "/run/crond.pid")) {
    return { ok: false, code: "CRON-DAEMON-MISSING", fix: "start the cron daemon first (machine-level, owner key)" };
  }
  const line = cronLine(opts);
  if (opts.print) return { ok: true, printed: line };
  const cur = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  if (cur.status !== 0 && !/no crontab/i.test(cur.stderr ?? "")) {
    return { ok: false, code: "CRONTAB-READ-FAILED", detail: (cur.stderr ?? "").trim() };
  }
  const write = spawnSync("crontab", ["-"], { encoding: "utf8", input: mergeCron(cur.stdout, line) });
  if (write.status !== 0) return { ok: false, code: "CRONTAB-WRITE-FAILED", detail: (write.stderr ?? "").trim() };
  const back = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  const verified = String(back.stdout ?? "").includes(CRON_TAG);
  return { ok: verified, code: verified ? "INSTALLED" : "VERIFY-FAILED", installed: line, readback: verified };
}

export function uninstallCron(opts = {}) {
  const cage = inCage(opts);
  if (cage.inside) {
    return { ok: false, code: "CAGE-DETECTED", detail: `apparmor=${cage.profile}`, fix: "run on the true face (owner shell)" };
  }
  const cur = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  if (cur.status !== 0 && !/no crontab/i.test(cur.stderr ?? "")) {
    return { ok: false, code: "CRONTAB-READ-FAILED", detail: (cur.stderr ?? "").trim() };
  }
  const kept = String(cur.stdout ?? "").split("\n").filter((l) => !l.includes(CRON_TAG)).join("\n");
  const write = spawnSync("crontab", ["-"], { encoding: "utf8", input: `${kept.trimEnd()}\n` });
  if (write.status !== 0) return { ok: false, code: "CRONTAB-WRITE-FAILED", detail: (write.stderr ?? "").trim() };
  const back = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  return { ok: !String(back.stdout ?? "").includes(CRON_TAG), code: "REMOVED" };
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const nxt = argv[i + 1];
      out[a.slice(2)] = nxt !== undefined && !nxt.startsWith("--") ? argv[++i] : true;
    } else out._.push(a);
  }
  return out;
}

export function main(argv) {
  const mode = argv[0];
  if (mode === "submit") {
    const args = parseArgs(argv.slice(1));
    const req = JSON.parse(fs.readFileSync(path.resolve(args.request), "utf8"));
    const res = submit(req);
    process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    return res.ok ? 0 : 2;
  }
  if (mode === "serve") {
    const args = parseArgs(argv.slice(1));
    bootLine();
    if (args.loop) {
      for (;;) {
        serveOnce();
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
      }
    }
    process.stdout.write(`${JSON.stringify({ processed: serveOnce() })}\n`);
    return 0;
  }
  if (mode === "install") {
    const args = parseArgs(argv.slice(1));
    const result = installCron({ print: Boolean(args.print) });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 2;
  }
  if (mode === "uninstall") {
    const result = uninstallCron();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 2;
  }
  if (mode === "status") {
    const id = argv[1];
    if (id) {
      const p = path.join(QUEUE, "done", `${id}.result.json`);
      if (!fs.existsSync(p)) { process.stdout.write(`${JSON.stringify({ id, state: "pending-or-absent" })}\n`); return 1; }
      process.stdout.write(fs.readFileSync(p, "utf8"));
      return 0;
    }
    const report = healthReport();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.alive ? 0 : 3;
  }
  process.stderr.write("usage: cellrunner.mjs submit --request <file> | serve --once|--loop | install [--print] | uninstall | status [<id>]\n");
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  try {
    process.exitCode = main(process.argv.slice(2)) ?? 0;
  } catch (error) {
    process.stderr.write(`CELLRUNNER-FAIL ${error.code ?? "ERROR"}: ${error.message}\n`);
    process.exitCode = 2;
  }
}
