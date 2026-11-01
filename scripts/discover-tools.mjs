#!/usr/bin/env node
// discover-tools.mjs —— 在不写死任何机具名称的前提下，找出本机可调度的工具。
//
// 三层，逐层降级，每层都留下“这条候选从哪来”的出处：
//   L1 登记表：$ABATHUR_TOOL_REGISTRY 指向的 JSON（机主维护，条目自带 capabilities）
//   L2 宿主配置：opencode 配置里的插件条目 → 包目录 → package.json 的 bin 名
//   L3 能力自述：对候选执行 `--describe`（JSON {name,capabilities,...}）；无自述则读 `--help` 文本
//
// 用法：
//   node scripts/discover-tools.mjs                       # 列出全部候选（JSON）
//   node scripts/discover-tools.mjs --capability gate.publish
// 退出码：0 找到（打印候选）／2 未找到（fail-closed）
//
// 判定口径：只有 L1 的显式声明与 L3 的 --describe 算 VERIFIED；help 文本推断一律标 INFERRED。
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const HOME = os.homedir()
const CACHE = path.join(HOME, ".cache", "opencode", "packages")
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")

const json = (p) => {
  try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch { return null }
}

function stripJsonc(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

function readConfig(p) {
  if (!fs.existsSync(p)) return null
  const raw = fs.readFileSync(p, "utf8")
  if (p.endsWith(".jsonc")) {
    try { return JSON.parse(stripJsonc(raw)) } catch { return null }
  }
  try { return JSON.parse(raw) } catch { return null }
}

function configPaths() {
  const explicit = process.env.ABATHUR_OPENCODE_CONFIG
  if (explicit) return [explicit]
  return [
    path.join(process.cwd(), "opencode.jsonc"),
    path.join(process.cwd(), "opencode.json"),
    path.join(HOME, ".config", "opencode", "opencode.jsonc"),
    path.join(HOME, ".config", "opencode", "opencode.json"),
  ]
}

function pluginEntries() {
  const out = []
  for (const p of configPaths()) {
    const cfg = readConfig(p)
    if (!cfg) continue
    const list = []
    for (const key of ["plugin", "plugins"]) {
      if (Array.isArray(cfg[key])) list.push(...cfg[key])
    }
    for (const entry of list) {
      if (typeof entry !== "string") continue
      if (entry.startsWith("file:") || entry.startsWith("/") || entry.startsWith(".")) {
        out.push({ source: p, spec: entry, dir: path.resolve(path.dirname(p), entry.replace(/^file:/, "")) })
        continue
      }
      const pkg = entry.split("@").length > 2 ? entry.slice(0, entry.lastIndexOf("@")) : entry
      const found = findPackageDir(pkg)
      if (found) out.push({ source: p, spec: entry, dir: found })
    }
  }
  return out
}

function findPackageDir(pkg) {
  const candidates = []
  const local = path.join(process.cwd(), "node_modules", pkg)
  candidates.push(local)
  if (fs.existsSync(CACHE)) {
    for (const name of fs.readdirSync(CACHE)) {
      if (name === pkg || name.startsWith(pkg + "@")) {
        candidates.push(path.join(CACHE, name, "node_modules", pkg))
      }
    }
  }
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "package.json"))) return c
  }
  return null
}

function binNames(dir) {
  const pkg = json(path.join(dir, "package.json"))
  if (!pkg) return []
  const bin = pkg.bin
  if (typeof bin === "string") return [[pkg.name || "bin", path.join(dir, bin)]]
  if (bin && typeof bin === "object") {
    return Object.entries(bin).map(([name, rel]) => [name, path.join(dir, rel)])
  }
  return []
}

function runProbe(cmd, args) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    timeout: 5000,
    env: { PATH: process.env.PATH, HOME, TERM: "dumb" },
  })
  return { rc: r.status, out: `${r.stdout || ""}${r.stderr || ""}`.trim() }
}

function describeOf(cmd, runner) {
  const probe = runProbe(runner, [cmd, "--describe"])
  if (probe.rc === 0) {
    const line = probe.out.splitlines?.().find((l) => l.trim().startsWith("{")) ||
      (probe.out.trim().startsWith("{") ? probe.out.trim() : null)
    if (line) {
      try {
        const d = JSON.parse(line)
        if (Array.isArray(d.capabilities)) return { verified: true, capabilities: d.capabilities, name: d.name }
      } catch {}
    }
  }
  const help = runProbe(runner, [cmd, "--help"])
  if (help.rc === 0 || help.out) {
    return { verified: false, capabilities: [], help: help.out.slice(0, 600) }
  }
  return null
}

function registryPath() {
  if (process.env.ABATHUR_TOOL_REGISTRY) return process.env.ABATHUR_TOOL_REGISTRY
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  for (const p of [path.join(xdg, "abathur", "tooling.json"), path.join(REPO, ".omo", "tooling.json")]) {
    if (fs.existsSync(p)) return p
  }
  return null
}

function registryEntries() {
  const p = registryPath()
  if (!p) return []
  const data = json(p)
  const list = Array.isArray(data) ? data : (data && Array.isArray(data.tools) ? data.tools : [])
  if (!list.length) return []
  return list
    .filter((e) => e && typeof e.cmd === "string")
    .map((e) => ({
      name: e.name || path.basename(e.cmd),
      cmd: e.cmd,
      args: Array.isArray(e.args) ? e.args : [],
      capabilities: Array.isArray(e.capabilities) ? e.capabilities : [],
      source: p,
      verified: true,
      origin: "registry",
    }))
}

function main() {
  const capIdx = process.argv.indexOf("--capability")
  const want = capIdx > 0 ? process.argv[capIdx + 1] : null

  const candidates = [...registryEntries()]
  const unresolved = []

  for (const entry of pluginEntries()) {
    const pkg = json(path.join(entry.dir, "package.json")) || {}
    const declared = Array.isArray(pkg.capabilities) ? pkg.capabilities
      : Array.isArray(pkg.omo?.capabilities) ? pkg.omo.capabilities : []
    if (declared.length) {
      candidates.push({
        name: pkg.name || entry.spec,
        cmd: null,
        args: [],
        capabilities: declared,
        source: entry.source,
        verified: false,
        origin: "package-declared",
        note: "the package states these capabilities; nothing was executed to confirm them",
      })
    }
    const bins = binNames(entry.dir)
    if (!bins.length) {
      unresolved.push({ source: entry.source, spec: entry.spec, reason: "package.json has no bin" })
      continue
    }
    for (const [name, binPath] of bins) {
      const nodeEntry = binPath.endsWith(".js") || binPath.endsWith(".mjs")
      const cmd = nodeEntry ? process.execPath : binPath
      const args = nodeEntry ? [binPath] : []
      const d = describeOf(binPath, nodeEntry ? process.execPath : binPath)
      if (!d) continue
      candidates.push({
        name,
        cmd,
        args,
        capabilities: d.capabilities,
        help: d.help,
        source: entry.source,
        verified: d.verified,
        origin: "plugin",
      })
    }
  }

  const matched = want
    ? candidates.filter((c) => c.capabilities.includes(want))
    : candidates
  const out = { wanted: want, candidates: matched, unresolved }
  console.log(JSON.stringify(out, null, 1))
  if (want && !matched.length) process.exit(2)
  return 0
}

main()
