// Toy unit: hang — blocks far longer than any test timeout via `exec sleep`
// (learnings: execFile-without-input closes stdin, so hang fixtures must exec
// sleep, never cat). Fixture for AC (e): the adapter must SIGKILL the whole
// process group (node + sh + sleep) and record status timeout.
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export function checks() {
  return [true];
}

if (isMain) execSync("sleep 31.7", { stdio: "ignore" });
