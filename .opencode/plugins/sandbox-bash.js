// sandbox-bash v4 —— 项目级 bash 沙箱（v2 原生）
//
// 与 v1 的差别：不再无条件挂载 loop/bank.py 等 v1 专有路径。
// 自保护挂载改为“存在才挂载”，因此树里没有 loop/ 时沙箱仍能启动。
// 作用域铁律不变：只对 realpath(ctx.directory) 等于本仓根或位于其下的会话生效。
//
// 人类逃生阀：启动 opencode 前 `ABATHUR_SANDBOX=0`。
// 网络档位：默认断网；人类在启动前设 `ABATHUR_SANDBOX_NET=host` 才出网。

import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BWRAP_CANDIDATES = ["/usr/bin/bwrap", "/bin/bwrap", "/usr/local/bin/bwrap", "/usr/sbin/bwrap"];
const LOG = "/tmp/opencode/abathur-sandbox.log";

export function isUnder(rootReal, dirReal) {
  if (!rootReal || !dirReal) return false;
  if (dirReal === rootReal) return true;
  return dirReal.startsWith(rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep);
}

export function shouldWrap(directory, repoRoot) {
  if (!directory || !repoRoot) return false;
  let d, r;
  try { d = fs.realpathSync(directory); } catch { return false; }
  try { r = fs.realpathSync(repoRoot); } catch { return false; }
  return isUnder(r, d);
}

export function resolveBwrap() {
  for (const p of BWRAP_CANDIDATES) {
    try {
      const st = fs.lstatSync(p);
      if (!st.isFile() || st.uid !== 0 || (st.mode & 0o022)) continue;
      const r = spawnSync(p, ["--version"], { encoding: "utf8", timeout: 5000 });
      if (r.status === 0 && /bubblewrap/i.test(r.stdout || "")) return p;
    } catch { /* candidate absent */ }
  }
  return null;
}

/** Self-protection mounts: add only when the target exists in this tree. */
function roBindIfExists(argv, target) {
  try {
    if (fs.existsSync(target)) argv.push("--ro-bind", target, target);
  } catch { /* unreadable target: do not pin it */ }
}

export function buildArgv({ workspace, cmd, net = "none", bornAt, launcherStartedAt }) {
  const ws = workspace;
  const argv = [
    "--die-with-parent", "--new-session",
    "--unshare-user", "--unshare-pid",
    net === "none" ? "--unshare-net" : "--share-net",
    "--tmpfs", "/home/lab",
    "--bind", ws, ws,
    "--tmpfs", "/tmp",
    "--ro-bind", "/usr", "/usr",
    "--ro-bind", "/etc", "/etc",
    "--ro-bind", "/opt", "/opt",
  ];
  roBindIfExists(argv, path.join(ws, ".opencode"));
  roBindIfExists(argv, path.join(ws, "scripts"));
  roBindIfExists(argv, path.join(ws, "kernel"));
  if (net === "host") argv.push("--ro-bind", "/run/systemd/resolve", "/run/systemd/resolve");
  argv.push(
    "--symlink", "usr/bin", "/bin",
    "--symlink", "usr/lib", "/lib",
    "--symlink", "usr/lib64", "/lib64",
    "--symlink", "usr/sbin", "/sbin",
    "--dev", "/dev",
    "--proc", "/proc",
    "--clearenv",
    "--setenv", "HOME", "/home/lab",
    "--setenv", "PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "--setenv", "TERM", "xterm-256color",
    "--setenv", "TZ", process.env.TZ || "Asia/Shanghai",
    "--setenv", "CAGE_BORN_AT", bornAt,
    "--setenv", "LAUNCHER_STARTED_AT", launcherStartedAt,
    "--",
    "/bin/sh", "-c", cmd,
  );
  return argv;
}

function sq(s) { return "'" + String(s).replaceAll("'", "'\\''") + "'"; }

export function wrapCommand({ bwrap, workspace, cmd, net, bornAt, launcherStartedAt }) {
  return [bwrap, ...buildArgv({ workspace, cmd, net, bornAt, launcherStartedAt })]
    .map(a => (/^[-\w@%+=:,./]+$/.test(a) ? a : sq(a)))
    .join(" ");
}

function log(line) { try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); } catch { /* log is best-effort */ } }

function appendGateBlock(repoRoot, cls, gate, detail) {
  try {
    const dir = path.join(repoRoot, ".omo", "evidence");
    fs.mkdirSync(dir, { recursive: true });
    const body = {
      ts: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      class: cls,
      gate,
      detail: String(detail).slice(0, 300),
    };
    const canon = JSON.stringify(body, Object.keys(body).sort());
    const sha = createHash("sha256").update(canon).digest("hex");
    fs.appendFileSync(path.join(dir, "gate-blocks.jsonl"),
      JSON.stringify({ ...body, sha256: sha }) + "\n", "utf8");
  } catch (e) {
    log(`GATE-BLOCK-LOG-FAILED ${e?.message || e}`);
  }
}

export const SandboxBash = async ({ directory }) => {
  const repoRoot = path.resolve(HERE, "..", "..");
  if (!shouldWrap(directory, repoRoot)) return {};
  if (process.env.ABATHUR_SANDBOX === "0") { log("BYPASS env=ABATHUR_SANDBOX=0"); return {}; }

  const bwrap = resolveBwrap();
  if (!bwrap) {
    log("REFUSE no-trusted-bwrap");
    return {
      "tool.execute.before": async (input) => {
        if (input?.tool !== "bash") return;
        if (process.env.ABATHUR_SANDBOX_ALLOW_UNSANDBOXED === "1") return;
        throw new Error("sandbox unavailable: no trusted bwrap (set ABATHUR_SANDBOX_ALLOW_UNSANDBOXED=1 to accept unsandboxed bash)");
      },
    };
  }

  let net = process.env.ABATHUR_SANDBOX_NET === "host" ? "host" : "none";
  if (net === "host") {
    const audit = path.join(repoRoot, "scripts", "port-exec-audit.sh");
    if (fs.existsSync(audit)) {
      const a = spawnSync("/bin/bash", [audit], { encoding: "utf8", timeout: 15000 });
      if (a.status !== 0) { log(`REFUSE-host-tier audit_rc=${a.status}`); net = "none"; }
    } else {
      log("REFUSE-host-tier audit-script-absent");
      net = "none";
    }
  }

  log(`BOOT bwrap=${bwrap} net=${net} dir=${directory}`);
  const launcherStartedAt = new Date().toISOString();
  let cageSeq = 0;
  const COPY_MARKERS = ["--die-with-parent", "--unshare-all", "--unshare-user", "/usr/bin/bwrap ", "bwrap --"];
  return {
    "tool.execute.before": async (input, output) => {
      if (input?.tool !== "bash") return;
      const args = output?.args;
      if (!args || typeof args.command !== "string") return;
      const marker = COPY_MARKERS.find((m) => args.command.includes(m));
      if (marker) {
        log(`REFUSE copied-prefix marker=${marker}`);
        appendGateBlock(repoRoot, "bwrap-prefix-paste", "sandbox-bash.js", marker);
        throw new Error("SANDBOX-PREFIX-COPIED: this command already carries a sandbox prefix (usually pasted back from earlier output). Send the bare command only — wrapping is the plugin's job.");
      }
      const bornAt = new Date().toISOString();
      cageSeq += 1;
      log(`CAGE seq=${cageSeq} born=${bornAt} launcher=${launcherStartedAt}`);
      args.command = wrapCommand({ bwrap, workspace: directory, cmd: args.command, net, bornAt, launcherStartedAt });
    },
  };
};

export default SandboxBash;
