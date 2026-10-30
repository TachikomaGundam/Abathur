#!/usr/bin/env node
// sandbox-blast-radius.mjs — 主体绑定与爆炸半径的机器判据（v9 §6.3）
// 退出码：0 全通过；1 任一断言失败。输出三行 JSON。

import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { shouldWrap, isUnder, buildArgv, wrapCommand, resolveBwrap } from "./plugins/sandbox-bash.js";

const REPO = path.resolve(import.meta.dirname, "..");
const results = [];
const fail = [];

// 1) 本席路径必须包裹；他线路径必须不包裹
const wrapSelf = shouldWrap(REPO, REPO);
if (!wrapSelf) fail.push("wrap_self");

const PEERS = [
  "/home/lab/workspace/harness/hr",
  "/home/lab/workspace/harness/PCB-Agent",
  "/home/lab/workspace/harness/VideoGen",
  "/home/lab/workspace/harness/SimpleCut",
];
const peerResults = PEERS.map(p => ({ path: p, wrapped: shouldWrap(p, REPO) }));
if (peerResults.some(r => r.wrapped)) fail.push("wrap_peer");

// 2) 组件边界：同名前缀的兄弟目录不得被误判为内部
const boundary = [
  { root: "/x/Abathur", dir: "/x/Abathur", want: true },
  { root: "/x/Abathur", dir: "/x/Abathur/sub", want: true },
  { root: "/x/Abathur", dir: "/x/Abathur-sibling", want: false },
  { root: "/x/Abathur", dir: "/x/Abathur2", want: false },
];
const boundaryBad = boundary.filter(b => isUnder(b.root, b.dir) !== b.want);
if (boundaryBad.length) fail.push("prefix_boundary");

// 3) argv 不变量：host 档不得含 --unshare-net；必须含 --unshare-pid
const argvHost = buildArgv({ workspace: REPO, cmd: "true", net: "host" });
const argvNone = buildArgv({ workspace: REPO, cmd: "true", net: "none" });
const hasUnshareNetHost = argvHost.includes("--unshare-net");
const hasUnsharePid = argvHost.includes("--unshare-pid");
const hasUnshareNetNone = argvNone.includes("--unshare-net");
if (!hasUnshareNetNone) fail.push("argv_default_missing_unshare_net");
if (hasUnshareNetHost) fail.push("argv_host_has_unshare_net");
if (!hasUnsharePid) fail.push("argv_missing_unshare_pid");

// 4) 实跑：沙箱内 /proc/self/cmdline 必须与 buildArgv 的尾部一致
let execMatches = false, execDetail = "";
const bwrap = resolveBwrap();
if (!bwrap) {
  fail.push("no_bwrap");
} else {
  const cmd = "printf 'NS=%s\\n' \"$(readlink /proc/self/ns/pid)\"; tr '\\0' '\\n' < /proc/self/cmdline";
  const wrapped = wrapCommand({ bwrap, workspace: REPO, cmd, net: "none" });
  const r = spawnSync("/bin/sh", ["-c", wrapped], { encoding: "utf8", timeout: 60000 });
  const lines = (r.stdout || "").split("\n").filter(Boolean);
  const nsLine = lines.find(l => l.startsWith("NS=")) || "";
  const cmdLines = lines.filter(l => !l.startsWith("NS="));
  const want = ["/bin/sh", "-c", cmd];
  const hostNs = "NS=" + fs.readlinkSync("/proc/self/ns/pid");
  execMatches = cmdLines.length === 3 && cmdLines.every((v, i) => v === want[i]) && nsLine !== "" && nsLine !== hostNs;
  execDetail = `rc=${r.status} ns_in=${nsLine} ns_host=${hostNs} lines=${JSON.stringify(cmdLines)}`;
  if (!execMatches) fail.push("argv_exec_mismatch");
}

const out = {
  wrap_self: wrapSelf,
  wrap_peer: { any: peerResults.some(r => r.wrapped), detail: peerResults },
  prefix_boundary: { bad: boundaryBad.length },
  argv: { has_unshare_net_host: hasUnshareNetHost, has_unshare_pid: hasUnsharePid, none_has_unshare_net: hasUnshareNetNone },
  argv_exec: { matches: execMatches, detail: execDetail },
};
console.log(JSON.stringify({ check: "wrap_self", ok: wrapSelf }));
console.log(JSON.stringify({ check: "wrap_peer", ok: peerResults.every(r => !r.wrapped), peers: peerResults }));
console.log(JSON.stringify({ check: "prefix_boundary", ok: boundaryBad.length === 0, cases: boundary.map(b => ({ root: b.root, dir: b.dir, want: b.want, got: isUnder(b.root, b.dir) })) }));
console.log(JSON.stringify({ check: "argv", ok: !hasUnshareNetHost && hasUnsharePid && hasUnshareNetNone && execMatches, exec_matches: execMatches, detail: execDetail }));
if (fail.length) {
  console.error("FAIL: " + fail.join(","));
  process.exit(1);
}
console.log("PASS");console.log("RC=0");
