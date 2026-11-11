// sandbox-bash v5 —— 项目级 bash 沙箱（OpenCode V2 原生）
//
// v4→v5：V1 `tool.execute.before` 工厂改为 V2 `ctx.shell.hook("create.before")`。
// V2 的 shell 创建事件自带 command/cwd，作用域按 event.cwd 判定（此前按会话目录），
// 与插件实例加载位置无关——别处的 shell 一律不包。
// 自保护挂载保持"存在才挂载"；作用域铁律不变：只包 realpath(cwd) 位于本仓根或其下的 shell。
//
// 人类逃生阀：启动 opencode 前 `ABATHUR_SANDBOX=0`。
// 网络档位：默认断网；人类在启动前设 `ABATHUR_SANDBOX_NET=host` 才出网（审计脚本必须绿）。
// V1 原版归档：/home/lab/workspace/debug/opencode-v1-plugins-archive-20261111/（见 README）。

import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRunRecord, pruneRuns } from "../../kernel/surface/record.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST_HOME = process.env.ABATHUR_HOST_HOME || os.homedir();
const BWRAP_CANDIDATES = ["/usr/bin/bwrap", "/bin/bwrap", "/usr/local/bin/bwrap", "/usr/sbin/bwrap"];
const LOG = "/tmp/opencode/abathur-sandbox.log";
const COPY_MARKERS = ["--die-with-parent", "--unshare-all", "--unshare-user", "/usr/bin/bwrap ", "bwrap --"];

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

export function buildArgv({ workspace, cmd, net = "none", bornAt, launcherStartedAt, runRecordPath, runId }) {
  const ws = workspace;
  const argv = [
    "--die-with-parent", "--new-session",
    "--unshare-user", "--unshare-pid",
    net === "none" ? "--unshare-net" : "--share-net",
    "--tmpfs", HOST_HOME,
    "--bind", ws, ws,
    "--tmpfs", "/tmp",
    "--ro-bind", "/usr", "/usr",
    "--ro-bind", "/etc", "/etc",
    "--ro-bind", "/opt", "/opt",
  ];
  roBindIfExists(argv, path.join(ws, ".opencode"));
  roBindIfExists(argv, path.join(ws, "scripts"));
  roBindIfExists(argv, path.join(ws, "kernel"));
  if (runRecordPath) argv.push("--ro-bind", runRecordPath, "/abathur-run.json");
  if (net === "host") argv.push("--ro-bind", "/run/systemd/resolve", "/run/systemd/resolve");
  argv.push(
    "--symlink", "usr/bin", "/bin",
    "--symlink", "usr/lib", "/lib",
    "--symlink", "usr/lib64", "/lib64",
    "--symlink", "usr/sbin", "/sbin",
    "--dev", "/dev",
    "--proc", "/proc",
    "--clearenv",
    "--setenv", "HOME", HOST_HOME,
    "--setenv", "PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "--setenv", "TERM", "xterm-256color",
    "--setenv", "TZ", process.env.TZ || "Asia/Shanghai",
    "--setenv", "CAGE_BORN_AT", bornAt,
    "--setenv", "LAUNCHER_STARTED_AT", launcherStartedAt,
  );
  if (runRecordPath) {
    argv.push("--setenv", "ABATHUR_RUN_RECORD", "/abathur-run.json");
    argv.push("--setenv", "ABATHUR_RUN_ID", runId);
  }
  argv.push("--", "/bin/sh", "-c", cmd);
  return argv;
}

function sq(s) { return "'" + String(s).replaceAll("'", "'\\''") + "'"; }

export function wrapCommand({ bwrap, workspace, cmd, net, bornAt, launcherStartedAt, runRecordPath, runId }) {
  return [bwrap, ...buildArgv({ workspace, cmd, net, bornAt, launcherStartedAt, runRecordPath, runId })]
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

const UNSANDBOXED_FLAG = "ABATHUR_SANDBOX_ALLOW_UNSANDBOXED";

export default {
  id: "abathur-sandbox-bash",
  async setup(ctx) {
    const repoRoot = path.resolve(HERE, "..", "..");
    if (!ctx?.shell?.hook) {
      // Fail-closed：没有 shell 钩子面就没有包裹能力，仓库 shell 不许裸奔。
      log("FATAL no ctx.shell hook surface; refusing to load without wrap capability");
      throw new Error("abathur-sandbox-bash: this OpenCode build exposes no ctx.shell hook; refusing to load fail-open");
    }
    if (process.env.ABATHUR_SANDBOX === "0") { log("BYPASS env=ABATHUR_SANDBOX=0"); return; }

    const bwrap = resolveBwrap();
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

    log(`BOOT v5 bwrap=${bwrap ?? "none"} net=${net} loc=${ctx?.location?.directory ?? "?"}`);
    const launcherStartedAt = new Date().toISOString();
    let cageSeq = 0;

    if (!bwrap) {
      await ctx.shell.hook("create.before", (event) => {
        if (!shouldWrap(event?.cwd, repoRoot)) return;
        if (process.env[UNSANDBOXED_FLAG] === "1") return;
        log(`REFUSE no-trusted-bwrap cwd=${event?.cwd}`);
        throw new Error(`sandbox unavailable: no trusted bwrap (set ${UNSANDBOXED_FLAG}=1 to accept unsandboxed bash)`);
      });
      return;
    }

    await ctx.shell.hook("create.before", (event) => {
      if (!shouldWrap(event?.cwd, repoRoot)) return;
      const cmd = event?.command;
      if (typeof cmd !== "string") {
        if (process.env[UNSANDBOXED_FLAG] === "1") return;
        log(`REFUSE command-shape cwd=${event?.cwd}`);
        throw new Error("sandbox fail-closed: shell create event carries no string command");
      }
      if (cmd.startsWith(`${bwrap} `)) return; // already wrapped by this plugin (reload reentry guard)
      const marker = COPY_MARKERS.find((m) => cmd.includes(m));
      if (marker) {
        log(`REFUSE copied-prefix marker=${marker}`);
        appendGateBlock(repoRoot, "bwrap-prefix-paste", "sandbox-bash.js", marker);
        throw new Error("SANDBOX-PREFIX-COPIED: this command already carries a sandbox prefix (usually pasted back from earlier output). Send the bare command only — wrapping is the plugin's job.");
      }
      const bornAt = new Date().toISOString();
      cageSeq += 1;
      let runRecord = null;
      try {
        pruneRuns();
        runRecord = createRunRecord({ surface: "E1", root: repoRoot, origin: "launcher" });
      } catch (error) {
        log(`RUN-RECORD-FAILED ${error?.message || error}`);
      }
      log(`CAGE seq=${cageSeq} born=${bornAt} launcher=${launcherStartedAt} run=${runRecord?.record?.id ?? "none"} cwd=${event.cwd}`);
      event.command = wrapCommand({
        bwrap,
        workspace: event.cwd,
        cmd,
        net,
        bornAt,
        launcherStartedAt,
        runRecordPath: runRecord?.path,
        runId: runRecord?.record?.id,
      });
    });
  },
};
