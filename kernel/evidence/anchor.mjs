import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";

export const ANCHOR_ENV = "ABATHUR_ANCHOR_CMD";

/**
 * Run the operator-registered anchor command. Unconfigured = fail closed.
 * @param {string} tailHash
 * @param {NodeJS.ProcessEnv} [env]
 */
export function anchor(tailHash, env = process.env) {
  const cmd = env[ANCHOR_ENV];
  if (!cmd || !cmd.trim()) {
    return { rc: 2, code: "ANCHOR UNDISPATCHABLE", detail: `${ANCHOR_ENV} is not set` };
  }
  const result = spawnSync("/bin/sh", ["-c", cmd], {
    input: `${tailHash}\n`,
    encoding: "utf8",
    env,
    timeout: 30_000,
  });
  if (result.status === 0) {
    return { rc: 0, code: "ANCHOR-OK", detail: (result.stdout || "").trim() };
  }
  return {
    rc: result.status ?? 1,
    code: "ANCHOR-FAILED",
    detail: (result.stderr || result.stdout || String(result.error ?? "")).trim(),
  };
}

function walk(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      const stat = statSync(path);
      if (stat.isDirectory()) stack.push(path);
      else out.push(path);
    }
  }
  return out.sort();
}

/** Deterministic mirror manifest for one generation. */
export function mirrorGeneration(root) {
  const files = walk(root).map((path) => ({
    path,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  }));
  const digest = createHash("sha256").update(files.map((f) => `${f.sha256}  ${relative(root, f.path)}\n`).join("")).digest("hex");
  return { root, count: files.length, digest, files };
}
