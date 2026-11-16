// sandbox-bash v6 —— 项目级 bash 沙箱（OpenCode V2 原生）
//
// v5→v6（W-C）：防粘贴守卫从"全文子串命中即拒"改为 shell 结构感知的执行位判定
// （detectNestedBwrap，导出纯函数+测试矩阵）。语义：命令*执行* bwrap 才拒；
// 正文*提及*前缀字串（引号数据、pgrep/grep/sed 模式）放行后照常包裹。
// 设计：work/abathur/2026-11-16-W-C-fix-design.md（含具名残余缺口清单）。
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

// ---------------- W-C nested-bwrap classifier (v6) ----------------
// Reject iff the command EXECUTES bwrap (a copied prefix sitting in a run
// position), not when its text merely MENTIONS sandbox flags (quoted data,
// pgrep/grep/sed patterns, echo payloads). Anti-paste guard, not a security
// boundary: program-specific exec doors outside the closed sets below, and
// file/variable payloads, are out of scope by design (named gaps in the fix
// design note). Fail-closed: parse failure and un-analyzable depths reject.

export const COPY_MARKERS = ["--die-with-parent", "--unshare-all", "--unshare-user", "/usr/bin/bwrap ", "bwrap --"];
const COPY_MARKER_FLAGS = new Set(["--die-with-parent", "--unshare-all", "--unshare-user"]);
const SHELL_WORDS = new Set(["sh", "bash", "dash", "zsh", "ksh", "ash", "csh", "tcsh", "fish"]);
const KEYWORD_WORDS = new Set(["if", "while", "until", "then", "elif", "else", "do", "done", "fi", "case", "esac", "{"]);
const LANG_INLINE_FLAGS = new Map([
  ["python", new Set(["-c"])], ["python2", new Set(["-c"])], ["python3", new Set(["-c"])],
  ["perl", new Set(["-e"])], ["ruby", new Set(["-e"])],
  ["node", new Set(["-e", "--eval"])], ["php", new Set(["-r"])],
]);
const LANG_EVAL_SUBCOMMANDS = new Map([["deno", new Set(["eval"])], ["bun", new Set(["-e", "eval"])]]);
const ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

function ex(shortVal, longVal) {
  return { short: new Set(shortVal ? shortVal.split(" ") : []), long: new Set(longVal ? longVal.split(" ") : []) };
}
// Executors: words that hand the command position to a later word. Closed set;
// a bwrap base word ANYWHERE in an executor segment rejects regardless of how
// far flag-skipping walked, so over-skip cannot become a false allow.
const EXECUTORS = new Map([
  ["sudo", ex("C D E h p R T U u g", "context cwd preserve-env set-home setenv login-class timeout user group host askpass")],
  ["doas", ex("s", "")],
  ["env", ex("S u", "split-string unset chdir block-signal unblock-signal ignore-signal default-signal signal")],
  ["nohup", ex("", "")],
  ["nice", ex("n adjust", "")],
  ["stdbuf", ex("o e i", "")],
  ["time", ex("o f", "")],
  ["setsid", ex("S", "")],
  ["ionice", ex("c n p", "class priority pid")],
  ["taskset", ex("c p", "cpu-list pid")],
  ["watch", ex("n", "interval")],
  ["command", ex("", "")],
  ["exec", ex("a", "")],
  ["!", ex("", "")],
  ["timeout", ex("s k status", "signal kill-after status")],
  ["xargs", ex("a d E e I J L m n P s", "delimiter eof eofre replace max-args max-procs max-lines max-chars open-brace arg-file")],
  ["parallel", ex("a d I j J N n s m", "jobs max-args max-lines nice delimiter delay")],
]);

function baseNameOf(word) {
  const s = String(word);
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}
function isFlagTok(t) { return !t.q && /^-.+/.test(t.v); }

function readBacktick(src, at) {
  let m = at + 1;
  let inner = "";
  while (m < src.length && src[m] !== "`") {
    if (src[m] === "\\") { inner += src[m + 1] ?? ""; m += 2; continue; }
    inner += src[m]; m++;
  }
  return { inner, end: m };
}
function readSubst(src, openIdx) {
  let depth = 1;
  let m = openIdx + 1;
  while (m < src.length) {
    const c = src[m];
    if (c === "\\") { m += 2; continue; }
    if (c === "'") { m++; while (m < src.length && src[m] !== "'") m++; m++; continue; }
    if (c === '"') { m++; while (m < src.length && src[m] !== '"') { if (src[m] === "\\") m++; m++; } m++; continue; }
    if (c === "`") { m = readBacktick(src, m).end + 1; continue; }
    if (c === "(") { depth++; m++; continue; }
    if (c === ")") { depth--; if (!depth) return { inner: src.slice(openIdx + 1, m), end: m }; m++; continue; }
    m++;
  }
  return { inner: src.slice(openIdx + 1), end: src.length - 1 };
}
function readWordAt(s, k) {
  let v = "";
  let q = false;
  let m = k;
  while (m < s.length && !/[\s;|&()<>]/.test(s[m])) {
    const c = s[m];
    if (c === "'" || c === '"') {
      const e = s.indexOf(c, m + 1);
      if (e < 0) { v += s.slice(m + 1); q = true; m = s.length; } else { v += s.slice(m + 1, e); q = true; m = e + 1; }
      continue;
    }
    if (c === "\\" && m + 1 < s.length) { v += s[m + 1]; m += 2; continue; }
    v += c; m++;
  }
  return { v, q, end: m };
}
function extractSubsts(src, substs) {
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") { i += 2; continue; }
    if (c === "'") { i++; while (i < src.length && src[i] !== "'") i++; i++; continue; }
    if (c === '"') { i++; while (i < src.length && src[i] !== '"') { if (src[i] === "\\") i++; i++; } i++; continue; }
    if (c === "$" && src[i + 1] === "(") { const r = readSubst(src, i + 1); substs.push(r.inner); i = r.end + 1; continue; }
    if (c === "`") { const r = readBacktick(src, i); substs.push(r.inner); i = r.end + 1; continue; }
    i++;
  }
}
function consumeHeredocs(src, from, list, substs) {
  let pos = from;
  for (const h of list) {
    let lineStart = pos;
    for (;;) {
      const nl = src.indexOf("\n", lineStart);
      const lineEnd = nl < 0 ? src.length : nl;
      const line = src.slice(lineStart, lineEnd);
      const probe = h.stripTabs ? line.replace(/^\t+/, "") : line;
      const isDelim = probe === h.delim;
      if (!h.quoted && !isDelim) extractSubsts(line, substs);
      lineStart = lineEnd + 1;
      if (isDelim || nl < 0) break;
    }
    pos = lineStart;
  }
  return pos - 1;
}

// Lex shell source into executable segments + nested substitution sources.
// Tokens: {v: unquoted value, q: any part was quoted}. Heredoc bodies with a
// quoted delimiter are pure data (dropped); unquoted bodies contribute only
// their command substitutions. Comments drop.
function parseShell(src) {
  const segments = [];
  let cur = [];
  const substs = [];
  const pending = [];
  let token = "";
  let tokenQuoted = false;
  let atWordStart = true;
  let prevSig = " ";
  const pushTok = () => {
    if (token !== "") { cur.push({ v: token, q: tokenQuoted }); token = ""; tokenQuoted = false; }
    atWordStart = true;
  };
  const pushSeg = () => { pushTok(); if (cur.length) { segments.push(cur); cur = []; } };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\n" || c === ";") {
      pushSeg();
      prevSig = ";";
      if (c === "\n" && pending.length) {
        i = consumeHeredocs(src, i + 1, pending.splice(0, pending.length), substs);
        prevSig = "\n";
      }
      continue;
    }
    if (c === "\\") {
      if (src[i + 1] === "\n") { i++; continue; }
      if (i + 1 < src.length) { token += src[i + 1]; atWordStart = false; prevSig = "w"; i++; }
      continue;
    }
    if (c === "'") {
      let m = i + 1;
      while (m < src.length && src[m] !== "'") m++;
      token += src.slice(i + 1, m);
      tokenQuoted = true; atWordStart = false; prevSig = "w"; i = m;
      continue;
    }
    if (c === '"') {
      i++; tokenQuoted = true; atWordStart = false; prevSig = "w";
      while (i < src.length && src[i] !== '"') {
        const d = src[i];
        if (d === "\\" && i + 1 < src.length) {
          const nx = src[i + 1];
          if (nx !== "\n") token += "$`\\".includes(nx) ? nx : d + nx;
          i += 2; continue;
        }
        if (d === "$" && src[i + 1] === "(") { const r = readSubst(src, i + 1); substs.push(r.inner); token += "\u0000"; i = r.end + 1; continue; }
        if (d === "`") { const r = readBacktick(src, i); substs.push(r.inner); token += "\u0000"; i = r.end + 1; continue; }
        token += d; i++;
      }
      continue;
    }
    if (c === "$" && src[i + 1] === "(") { const r = readSubst(src, i + 1); substs.push(r.inner); token += "\u0000"; atWordStart = false; prevSig = "w"; i = r.end + 1; continue; }
    if (c === "`") { const r = readBacktick(src, i); substs.push(r.inner); token += "\u0000"; atWordStart = false; prevSig = "w"; i = r.end + 1; continue; }
    if ((c === "<" || c === ">") && src[i + 1] === "(") {
      const r = readSubst(src, i + 1); substs.push(r.inner);
      pushTok(); prevSig = "w"; i = r.end + 1;
      continue;
    }
    if (c === "#" && atWordStart) {
      const nl = src.indexOf("\n", i);
      if (nl < 0) { i = src.length; break; }
      i = nl - 1; prevSig = ";";
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") { pushTok(); prevSig = " "; continue; }
    if (c === "|" || c === "&" || c === "(" || c === ")") {
      if (c === "&" && src[i + 1] === ">") { prevSig = ">"; i++; continue; }
      if (c === "&" && prevSig === ">") continue;
      pushSeg();
      while (i + 1 < src.length && (src[i + 1] === c || (c === "|" && src[i + 1] === "&"))) i++;
      prevSig = c;
      continue;
    }
    if (c === "<" || c === ">") {
      pushTok();
      let j = i + 1;
      let dbl = false;
      let minus = false;
      if (src[j] === c) { j++; dbl = true; }
      if (dbl && c === "<" && src[j] === "-") { j++; minus = true; }
      else if (dbl && c === "<" && src[j] === "<") { j++; i = j - 1; prevSig = ">"; continue; }
      if (dbl && c === "<") {
        while (j < src.length && (src[j] === " " || src[j] === "\t")) j++;
        const w = readWordAt(src, j);
        if (w.v) pending.push({ delim: w.v, stripTabs: minus, quoted: w.q });
        i = w.end - 1; prevSig = ">";
        continue;
      }
      if (src[j] === "&" || src[j] === "|" || src[j] === ">") j++;
      i = j - 1; prevSig = ">";
      continue;
    }
    token += c; atWordStart = false; prevSig = "w";
  }
  pushSeg();
  return { segments, substs };
}

function skipFlags(tokens, i, tbl) {
  while (i < tokens.length) {
    const t = tokens[i];
    if (!t.q && t.v.startsWith("--")) {
      const name = t.v.slice(2).split("=")[0];
      i++;
      if (!t.v.includes("=") && tbl.long.has(name)) i++;
      continue;
    }
    if (!t.q && /^-[^-]/.test(t.v)) {
      i++;
      if (t.v.length === 2 && tbl.short.has(t.v[1])) i++;
      continue;
    }
    break;
  }
  return i;
}

function scanSegment(tokens, depth, maxDepth) {
  if (depth > maxDepth) return { tier: "T7-DEPTH", detail: tokens.map((t) => t.v).join(" ").slice(0, 160) };
  let i = 0;
  while (i < tokens.length && !tokens[i].q && ASSIGN_RE.test(tokens[i].v)) i++;
  let hadExecutor = false;
  for (;;) {
    const w = tokens[i];
    if (!w || w.q) break;
    const kw = baseNameOf(w.v);
    if (KEYWORD_WORDS.has(w.v)) { i++; continue; }
    if (kw === "timeout") {
      hadExecutor = true;
      i = skipFlags(tokens, i + 1, EXECUTORS.get("timeout"));
      if (i < tokens.length && !isFlagTok(tokens[i])) i++; // the duration word
      continue;
    }
    const tbl = EXECUTORS.get(kw);
    if (!tbl) break;
    hadExecutor = true;
    i = skipFlags(tokens, i + 1, tbl);
  }
  if (hadExecutor) {
    for (const t of tokens) if (baseNameOf(t.v) === "bwrap") return { tier: "T1-WORD", detail: t.v };
  }
  const cmdTok = tokens[i];
  if (!cmdTok) return null;
  const base = baseNameOf(cmdTok.v);
  if (COPY_MARKER_FLAGS.has(cmdTok.v)) return { tier: "T2-PREFIX", detail: cmdTok.v };
  if (base === "bwrap") return { tier: "T1-WORD", detail: cmdTok.v };
  if (SHELL_WORDS.has(base)) {
    const cIdx = tokens.findIndex((t, k) => k > i && !t.q && /^-[A-Za-z]*c$/.test(t.v));
    if (cIdx >= 0) {
      for (let k = cIdx + 1; k < tokens.length; k++) {
        if (isFlagTok(tokens[k])) continue;
        return scanShell(tokens[k].v, depth + 1, maxDepth);
      }
    }
  }
  if (base === "eval") {
    for (let k = i + 1; k < tokens.length; k++) {
      const h = scanShell(tokens[k].v, depth + 1, maxDepth);
      if (h) return h;
    }
    return null;
  }
  if (base === "find") {
    for (let k = i + 1; k < tokens.length; k++) {
      const t = tokens[k];
      if (!t.q && ["-exec", "-execdir", "-ok", "-okdir"].includes(t.v)) {
        const sub = [];
        for (let m = k + 1; m < tokens.length; m++) {
          const s = tokens[m];
          if (!s.q && (s.v === ";" || s.v === "+" || s.v === "{}")) break;
          sub.push(s);
        }
        const h = scanSegment(sub, depth + 1, maxDepth);
        if (h) return h;
      }
    }
  }
  const langFlags = LANG_INLINE_FLAGS.get(base) || LANG_EVAL_SUBCOMMANDS.get(base);
  if (langFlags) {
    for (let k = i + 1; k < tokens.length; k++) {
      const t = tokens[k];
      if (!t.q && langFlags.has(t.v)) {
        const inline = tokens[k + 1] ? tokens[k + 1].v : "";
        if (/(^|[^A-Za-z0-9_./-])bwrap($|[^A-Za-z0-9_.-])/.test(inline) || COPY_MARKERS.some((mk) => inline.includes(mk))) {
          return { tier: "T6-LANG-INLINE", detail: inline.slice(0, 160) };
        }
      }
    }
  }
  return null;
}

function scanShell(src, depth, maxDepth) {
  if (depth > maxDepth) return { tier: "T7-DEPTH", detail: String(src).slice(0, 160) };
  const { segments, substs } = parseShell(src);
  for (const s of substs) {
    const h = scanShell(s, depth + 1, maxDepth);
    if (h) return h;
  }
  for (const seg of segments) {
    const h = scanSegment(seg, depth, maxDepth);
    if (h) return h;
  }
  return null;
}

export function detectNestedBwrap(cmd, { maxDepth = 4 } = {}) {
  try {
    return scanShell(String(cmd ?? ""), 1, maxDepth);
  } catch (e) {
    return { tier: "T0-PARSE-FAIL", detail: String(e?.message || e).slice(0, 160) };
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
      const hit = detectNestedBwrap(cmd);
      if (hit) {
        log(`REFUSE nested-bwrap tier=${hit.tier} detail=${hit.detail}`);
        appendGateBlock(repoRoot, "bwrap-prefix-paste", "sandbox-bash.js", `${hit.tier} ${hit.detail}`);
        throw new Error(`SANDBOX-PREFIX-COPIED: this command runs bwrap itself (${hit.tier}: ${hit.detail}) — nested sandbox launch, usually a wrapper prefix pasted back from earlier output. Send the bare command only; wrapping is the plugin's job. (Plain mentions of sandbox flags as command data are allowed since the W-C fix.)`);
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
