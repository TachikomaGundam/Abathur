// sandbox-bash v3 —— 项目级 bash 沙箱（2026-10-30）
//
// 作用域铁律：本插件只能放在 <repo>/.opencode/plugins/，且只对 realpath(ctx.directory)
// 等于本仓根、或位于其下的会话生效。他线目录一律不包裹。
// 事故溯源：2026-10-30 全机故障 = 同源策略装进了 ~/.config 用户级与 root 快照，
// 导致所有产线会话 bash 被包裹。本文件禁止出现在那两个位置（安装脚本只读断言）。
//
// 人类逃生阀：启动 opencode 前 `ABATHUR_SANDBOX=0`。
// 网络档位：默认断网（net=none）；人类在启动前设 ABATHUR_SANDBOX_NET=host 才出网。
// 机器判据：scripts/sandbox-blast-radius.mjs。

import path from "node:path";
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { openSync as fsOpenAppend } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BWRAP_CANDIDATES = ["/usr/bin/bwrap", "/bin/bwrap", "/usr/local/bin/bwrap", "/usr/sbin/bwrap"];
const LOG = "/tmp/opencode/abathur-sandbox.log";

/** 组件边界的前缀判定：等于 root，或 root + 分隔符 开头。 */
export function isUnder(rootReal, dirReal) {
  if (!rootReal || !dirReal) return false;
  if (dirReal === rootReal) return true;
  return dirReal.startsWith(rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep);
}

/** 沙箱是否应作用于该会话目录。 */
export function shouldWrap(directory, repoRoot) {
  if (!directory || !repoRoot) return false;
  let d, r;
  try { d = fs.realpathSync(directory); } catch { return false; }
  try { r = fs.realpathSync(repoRoot); } catch { return false; }
  return isUnder(r, d);
}

/** 只认 root 属主、能跑 --version、自报 bubblewrap 的绝对路径。 */
export function resolveBwrap() {
  for (const p of BWRAP_CANDIDATES) {
    try {
      const st = fs.lstatSync(p);
      if (!st.isFile() || st.uid !== 0 || (st.mode & 0o022)) continue;
      const r = spawnSync(p, ["--version"], { encoding: "utf8", timeout: 5000 });
      if (r.status === 0 && /bubblewrap/i.test(r.stdout || "")) return p;
    } catch { /* 候选不存在 */ }
  }
  return null;
}

/** 构造 bwrap argv（测试与执行共用，单一来源）。 */
export function buildArgv({ workspace, cmd, net = "none" }) {
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
    // 自指防护：执行器本体与被测密钥必须只读（否则沙箱内改插件=下次会话逃逸）
    "--ro-bind", path.join(ws, ".opencode"), path.join(ws, ".opencode"),
    "--ro-bind", path.join(ws, "loop", "bank.py"), path.join(ws, "loop", "bank.py"),
    // 宿主侧执行面：作业脚本与插件母本必须只读（重装/被调度执行的代码不可被沙箱改写）
    "--ro-bind", path.join(ws, "scripts"), path.join(ws, "scripts"),
  ];
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
    "--",
    "/bin/sh", "-c", cmd,
  );
  return argv;
}

function sq(s) { return "'" + String(s).replaceAll("'", "'\\''") + "'"; }

export function wrapCommand({ bwrap, workspace, cmd, net }) {
  return [bwrap, ...buildArgv({ workspace, cmd, net })]
    .map(a => (/^[-\w@%+=:,./]+$/.test(a) ? a : sq(a)))
    .join(" ");
}

function log(line) { try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); } catch { /* 日志不可写不阻断 */ } }

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

  let net = process.env.ABATHUR_SANDBOX_NET === "host" ? "host" : "none";  // 默认断网；出网需人类显式设 host
  if (net === "host") {
    // R-9 闸门：宿主存在可执行端口时拒绝开 host 档
    const a = spawnSync("/bin/bash", [path.join(repoRoot, "scripts", "port-exec-audit.sh")], { encoding: "utf8", timeout: 15000 });
    if (a.status !== 0) { log(`REFUSE-host-tier audit_rc=${a.status} ${(a.stdout || "").trim().split("\n").slice(-2).join(" | ")}`); net = "none"; }
  }

  log(`BOOT bwrap=${bwrap} net=${net} dir=${directory}`);
  const COPY_MARKERS = ["--die-with-parent", "--unshare-all", "--unshare-user", "/usr/bin/bwrap ", "bwrap --"];
  return {
    "tool.execute.before": async (input, output) => {
      if (input?.tool !== "bash") return;
      const args = output?.args;
      if (!args || typeof args.command !== "string") return;
      const marker = COPY_MARKERS.find((m) => args.command.includes(m));
      if (marker) {
        log(`REFUSE copied-prefix marker=${marker}`);
        throw new Error("SANDBOX-PREFIX-COPIED: this command already carries a sandbox prefix (usually pasted back from earlier output). Send the bare command only — wrapping is the plugin's job.");
      }
      args.command = wrapCommand({ bwrap, workspace: directory, cmd: args.command, net });
    },
  };
};

export default SandboxBash;
