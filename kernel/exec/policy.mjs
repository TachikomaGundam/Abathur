// R1 execution-runner policy: argv-only target requests, closed input
// allowlists, and the bwrap command shape. This module does not execute a
// target; it validates and stages what the runner is allowed to execute.
import { existsSync, lstatSync, mkdirSync, readdirSync, copyFileSync, renameSync, rmSync } from "node:fs";
import { basename, isAbsolute, join, normalize, relative, resolve } from "node:path";

export class R1Error extends Error {
  constructor(code, message) {
    super(message);
    this.name = "R1Error";
    this.code = code;
  }
}

/** Semi-trusted target classes R1 may execute. */
export const TARGET_CLASSES = new Set(["tests", "harness", "build", "package", "wave-cell"]);

/** Classes that must never run under R1; they need a stronger boundary. */
export const ADVERSARIAL_CLASSES = new Set(["exam-seat", "mutator", "untrusted"]);

export const LIMITS = {
  maxTimeoutMs: 600_000,
  maxArtifactBytes: 256 * 1024 * 1024,
  maxArgv: 256,
  maxArgBytes: 64 * 1024,
};

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "csh", "tcsh"]);

export function validateRequest(request) {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw new R1Error("R1-REQUEST-INVALID", "request must be an object");
  }
  if (!Array.isArray(request.argv) || request.argv.length === 0) {
    throw new R1Error("R1-ARGV-REQUIRED", "argv must be a non-empty array (no shell string)");
  }
  if (request.argv.length > LIMITS.maxArgv) {
    throw new R1Error("R1-ARGV-TOO-LONG", `argv exceeds ${String(LIMITS.maxArgv)} entries`);
  }
  for (const arg of request.argv) {
    if (typeof arg !== "string" || arg.includes("\0")) {
      throw new R1Error("R1-ARGV-INVALID", "every argv entry must be a NUL-free string");
    }
    if (Buffer.byteLength(arg) > LIMITS.maxArgBytes) {
      throw new R1Error("R1-ARGV-TOO-LONG", "an argv entry exceeds the size limit");
    }
  }
  if (SHELLS.has(basename(request.argv[0]))) {
    throw new R1Error("R1-SHELL-REFUSED", "shell entrypoints are refused; pass a program argv");
  }
  if (typeof request.class !== "string" || request.class.length === 0) {
    throw new R1Error("R1-CLASS-REQUIRED", "target class is required");
  }
  if (ADVERSARIAL_CLASSES.has(request.class)) {
    throw new R1Error("R1-ADVERSARIAL-TARGET", `${request.class} targets require R2/R3`);
  }
  if (!TARGET_CLASSES.has(request.class)) {
    throw new R1Error("R1-CLASS-UNKNOWN", `unknown target class: ${request.class}`);
  }
  if (typeof request.cwd !== "string" || !request.cwd.startsWith("/run/warden/")) {
    throw new R1Error("R1-CWD-INVALID", "cwd must be an absolute path under /run/warden");
  }
  if (normalize(request.cwd) !== request.cwd || request.cwd.includes("..")) {
    throw new R1Error("R1-CWD-INVALID", "cwd must be normalized and must not contain ..");
  }
  if (!Number.isInteger(request.timeoutMs) || request.timeoutMs <= 0 || request.timeoutMs > LIMITS.maxTimeoutMs) {
    throw new R1Error("R1-TIMEOUT-INVALID", `timeoutMs must be 1..${String(LIMITS.maxTimeoutMs)}`);
  }
  const cap = request.artifactCapBytes ?? LIMITS.maxArtifactBytes;
  if (!Number.isInteger(cap) || cap <= 0 || cap > LIMITS.maxArtifactBytes) {
    throw new R1Error("R1-CAP-INVALID", `artifactCapBytes must be 1..${String(LIMITS.maxArtifactBytes)}`);
  }
  if (request.input !== undefined && (typeof request.input !== "string" || !isAbsolute(request.input))) {
    throw new R1Error("R1-INPUT-INVALID", "input must be an absolute host path");
  }
  if (request.input !== undefined && (!Array.isArray(request.allow) || request.allow.length === 0)) {
    throw new R1Error("R1-ALLOWLIST-REQUIRED", "input requires a non-empty closed allowlist");
  }
  if (typeof request.stateDir !== "string" || !isAbsolute(request.stateDir)) {
    throw new R1Error("R1-STATE-INVALID", "stateDir must be an absolute host path");
  }
  return {
    ...request,
    artifactCapBytes: cap,
    env: sanitizeEnv(request.env ?? {}),
  };
}

/** Keep only a small, non-secret environment. The probe adds HOME/PATH/TMPDIR. */
export function sanitizeEnv(env) {
  const out = {};
  for (const key of ["PATH", "LANG", "LC_ALL", "TZ"]) {
    const value = env[key];
    if (typeof value === "string" && value.length <= 4096 && !value.includes("\0")) out[key] = value;
  }
  return out;
}

function globToRegExp(glob) {
  let out = "^";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      out += ".*";
      i += 1;
      if (glob[i + 1] === "/") i += 1;
    } else if (ch === "*") {
      out += "[^/]*";
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`${out}$`);
}

function matches(rel, allow) {
  return allow.some((pattern) => globToRegExp(pattern).test(rel));
}

/**
 * Stage a closed-allowlist copy of input into dest. Symlinks are refused, not
 * followed; .git is never copied. `allow` entries are relative globs.
 */
export function stageInput({ input, dest, allow }) {
  if (!Array.isArray(allow) || allow.length === 0) {
    throw new R1Error("R1-ALLOWLIST-REQUIRED", "input staging requires a non-empty allowlist");
  }
  mkdirSync(join(dest, ".."), { recursive: true });
  if (input !== undefined && !existsSync(input)) throw new R1Error("R1-INPUT-MISSING", input);
  if (input !== undefined && !lstatSync(input).isDirectory()) throw new R1Error("R1-INPUT-INVALID", "input must be a directory");
  const tmp = `${dest}.tmp-${String(process.pid)}-${String(Date.now())}`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  let files = 0;
  try {
    if (input !== undefined) {
      const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const abs = join(dir, entry.name);
          const rel = relative(input, abs).split("\\").join("/");
          if (rel === ".git" || rel.startsWith(".git/")) continue;
          const stat = lstatSync(abs);
          if (stat.isSymbolicLink()) {
            if (matches(rel, allow)) {
              throw new R1Error("R1-INPUT-SYMLINK", `refusing to stage symlink ${rel}`);
            }
            continue;
          }
          if (stat.isDirectory()) {
            walk(abs);
            continue;
          }
          if (!stat.isFile()) continue;
          if (!matches(rel, allow)) continue;
          const target = resolve(tmp, rel);
          const relToDest = relative(tmp, target);
          if (relToDest.startsWith("..") || isAbsolute(relToDest)) {
            throw new R1Error("R1-INPUT-ESCAPE", `allowlist escaped staging dir: ${rel}`);
          }
          mkdirSync(join(target, ".."), { recursive: true });
          copyFileSync(abs, target);
          files += 1;
        }
      };
      walk(input);
    }
    rmSync(dest, { recursive: true, force: true });
    renameSync(tmp, dest);
  } catch (error) {
    rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
  return { files };
}

/**
 * Build the bwrap argv. `seccompFd` and `artifactFd` are inherited fds; the
 * caller owns them. The probe is the PID-1 entrypoint.
 */
export function buildBwrapArgv({
  bwrapPath = "/usr/bin/bwrap",
  probePath,
  inputPath,
  requestPath,
  outputPath = "/run/warden/artifacts",
  cwd = "/run/warden/artifacts",
  argv,
  seccompFd,
  artifactFd = 3,
  env = {},
}) {
  if (!isAbsolute(bwrapPath) || !isAbsolute(probePath) || !isAbsolute(inputPath) || !isAbsolute(requestPath)) {
    throw new R1Error("R1-BWRAP-PATH", "bwrap/probe/input/request paths must be absolute host paths");
  }
  if (!Array.isArray(argv) || argv.length === 0) throw new R1Error("R1-ARGV-REQUIRED", "argv required");
  const out = [
    bwrapPath,
    "--die-with-parent",
    "--new-session",
    "--as-pid-1",
    "--unshare-user",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--unshare-net",
    "--unshare-cgroup",
    "--disable-userns",
    "--cap-drop", "ALL",
    "--size", "67108864", "--tmpfs", "/home",
    "--size", "536870912", "--tmpfs", "/tmp",
    "--size", "536870912", "--tmpfs", "/run/warden",
    "--ro-bind", probePath, "/run/warden/r1-probe.py",
    "--ro-bind", inputPath, "/run/warden/input",
    "--ro-bind", requestPath, "/run/warden/request.json",
    "--ro-bind", "/usr", "/usr",
    "--symlink", "usr/bin", "/bin",
    "--symlink", "usr/lib", "/lib",
    "--symlink", "usr/lib64", "/lib64",
    "--symlink", "usr/sbin", "/sbin",
    "--dev", "/dev",
    "--size", "67108864", "--tmpfs", "/dev/shm",
    "--proc", "/proc",
    "--clearenv",
    "--setenv", "HOME", "/home",
    "--setenv", "PATH", "/usr/local/bin:/usr/bin:/bin",
    "--setenv", "TMPDIR", "/tmp",
    "--setenv", "TZ", env.TZ ?? "UTC",
    "--sync-fd", String(artifactFd),
  ];
  if (seccompFd !== undefined) out.push("--seccomp", String(seccompFd));
  out.push(
    "--",
    "/usr/bin/python3",
    "/run/warden/r1-probe.py",
    "/run/warden/request.json",
    cwd,
    outputPath,
    String(artifactFd),
  );
  return out;
}

export function bwrapVersion(text) {
  const match = /bubblewrap\s+(\d+)\.(\d+)\.(\d+)/i.exec(text) ?? /(\d+)\.(\d+)\.(\d+)/.exec(text);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), text: match[0] };
}
