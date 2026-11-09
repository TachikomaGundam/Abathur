/**
 * Controller-side R1 runner: one bwrap invocation per target call.
 *
 * The controller (this process) stays in the host environment. Only the
 * target argv crosses into the jail. Artifacts return over a dedicated stream
 * and are treated as data; nothing from the target is executed here.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSeccompFilter } from "./seccomp.mjs";
import {
  LIMITS,
  R1Error,
  buildBwrapArgv,
  sanitizeEnv,
  stageInput,
  validateRequest,
} from "./policy.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATE = path.join(os.homedir(), ".local", "state", "abathur", "exec");
const MAX_STREAM = LIMITS.artifactCapBytes;
const MAX_STDIO = 1024 * 1024;

function makeRunId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 14)}`;
}

function writeFileAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  const fd = fs.openSync(tmp, "r+");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

export function runTarget(request, options = {}) {
  const stateDir = path.resolve(request.stateDir ?? options.stateDir ?? process.env.ABATHUR_EXEC_DIR ?? DEFAULT_STATE);
  const validated = validateRequest({ ...request, stateDir });
  fs.mkdirSync(stateDir, { recursive: true });
  const runId = options.runId ?? makeRunId();
  const runDir = path.join(stateDir, "runs", runId);
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const inputHost = path.join(runDir, "input");
  stageInput({ input: validated.input, dest: inputHost, allow: validated.allow });

  const artifactDir = path.join(runDir, "artifacts");
  fs.mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
  const requestPath = path.join(runDir, "request.json");
  writeFileAtomic(requestPath, JSON.stringify({
    argv: validated.argv,
    env: sanitizeEnv(options.env ?? {}),
    cwd: validated.cwd,
    timeoutMs: validated.timeoutMs,
  }));

  const probePath = path.join(HERE, "r1-probe.py");
  const filter = buildSeccompFilter();
  const seccompPath = path.join(runDir, "seccomp.bpf");
  writeFileAtomic(seccompPath, filter);
  const seccompFd = fs.openSync(seccompPath, "r");
  const artifactFd = 3;
  const argv = buildBwrapArgv({
    bwrap: options.bwrap ?? "/usr/bin/bwrap",
    probePath,
    inputPath: inputHost,
    requestPath,
    cwd: validated.cwd,
    argv: validated.argv,
    artifactFd,
    seccompFd: 4,
    env: sanitizeEnv(options.env ?? {}),
  });

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), {
        stdio: ["ignore", "pipe", "pipe", "pipe", seccompFd],
        detached: true,
      });
    } catch (error) {
      fs.closeSync(seccompFd);
      reject(new R1Error("R1-SPAWN", error.message));
      return;
    }
    fs.closeSync(seccompFd);

    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let buffer = Buffer.alloc(0);
    let digest = createHash("sha256");
    let consumed = 0;
    let terminated = false;
    let streamError = null;
    let summary = null;
    const artifacts = [];
    let settled = false;

    const timer = setTimeout(() => {
      streamError = new R1Error("R1-TIMEOUT", `target exceeded ${validated.timeoutMs}ms`);
      killTree();
      finish(1);
    }, validated.timeoutMs);

    function killTree() {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        try { child.kill("SIGKILL"); } catch { /* already gone */ }
      }
    }

    function finish(code) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (streamError) {
        reject(streamError);
        return;
      }
      if (!terminated) {
        reject(new R1Error("R1-STREAM-TRUNCATED", "artifact stream ended without a terminator", { code }));
        return;
      }
      resolve({
        ok: code === 0,
        code,
        signal: summary?.signal ?? 0,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        artifacts,
        runDir,
        streamBytes: consumed,
      });
    }

    function consume() {
      while (!streamError) {
        const newline = buffer.indexOf(0x0a);
        if (newline < 0) return;
        const header = buffer.subarray(0, newline + 1);
        let frame;
        try {
          frame = JSON.parse(buffer.subarray(0, newline).toString("utf8"));
        } catch {
          streamError = new R1Error("R1-STREAM-INVALID", "non-JSON artifact frame");
          killTree();
          return;
        }
        if (frame.type === "file") {
          if (!Number.isSafeInteger(frame.size) || frame.size < 0) {
            streamError = new R1Error("R1-STREAM-INVALID", "bad file frame size");
            killTree();
            return;
          }
          if (buffer.length < newline + 1 + frame.size) return;
          const data = buffer.subarray(newline + 1, newline + 1 + frame.size);
          consumed += header.length + data.length;
          if (consumed > MAX_STREAM) {
            streamError = new R1Error("R1-STREAM-CAP", "artifact stream exceeded cap");
            killTree();
            return;
          }
          digest.update(header);
          digest.update(data);
          if (createHash("sha256").update(data).digest("hex") !== frame.sha256) {
            streamError = new R1Error("R1-STREAM-HASH-MISMATCH", `artifact hash mismatch: ${frame.path}`);
            killTree();
            return;
          }
          artifacts.push({ path: frame.path, size: data.length, sha256: frame.sha256, data: Buffer.from(data) });
          buffer = buffer.subarray(newline + 1 + frame.size);
          continue;
        }
        if (frame.type === "summary") {
          consumed += header.length;
          digest.update(header);
          summary = frame;
          buffer = buffer.subarray(newline + 1);
          continue;
        }
        if (frame.type === "terminator") {
          const actual = digest.digest("hex");
          if (frame.sha256 !== actual) {
            streamError = new R1Error("R1-STREAM-HASH-MISMATCH", "terminator hash mismatch");
            killTree();
            return;
          }
          terminated = true;
          buffer = buffer.subarray(newline + 1);
          continue;
        }
        if (frame.type === "error") {
          streamError = new R1Error(frame.code ?? "R1-STREAM-ERROR", frame.detail ?? "target reported an error");
          killTree();
          return;
        }
        streamError = new R1Error("R1-STREAM-INVALID", `unknown frame type ${frame.type}`);
        killTree();
        return;
      }
    }

    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDIO) {
        streamError = new R1Error("R1-STDOUT-CAP", "stdout exceeded cap");
        killTree();
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_STDIO) {
        streamError = new R1Error("R1-STDERR-CAP", "stderr exceeded cap");
        killTree();
        return;
      }
      stderr.push(chunk);
    });
    child.stdio[3].on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      consume();
    });
    child.stdio[3].on("error", (error) => {
      streamError = new R1Error("R1-STREAM-IO", error.message);
    });
    child.on("error", (error) => {
      streamError = new R1Error("R1-SPAWN", error.message);
      finish(1);
    });
    child.on("close", (code) => {
      consume();
      finish(code ?? 1);
    });
  });
}

export { validateRequest, buildBwrapArgv, stageInput } from "./policy.mjs";
export { probeBwrap } from "./bwrap.mjs";
