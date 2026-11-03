#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const ENV = "ABATHUR_COPY_GATE_CMD";
const cmd = process.env[ENV];
if (!cmd || !cmd.trim()) {
  process.stdout.write(`COPY GATE UNDISPATCHABLE: ${ENV} is not set\n`);
  process.exitCode = 2;
} else {
  const result = spawnSync("/bin/sh", ["-c", cmd], { encoding: "utf8", timeout: 120_000 });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  process.exitCode = result.status ?? 1;
}
