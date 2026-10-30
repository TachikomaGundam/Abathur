// sandbox-tools —— 方案 D 的 D1：文件类工具的路径策略。
// 目标：宿主进程内的 read/write/edit/grep/glob 不能碰人类秘密面。
// 策略：家目录默认只放行 workspace；家外只拒具名秘密面。软墙，具名残余 R-D1。
// 人类逃生阀：ABATHUR_TOOLS=0（与 bash 的 ABATHUR_SANDBOX=0 同族）。
import path from "node:path"
import fs from "node:fs"

const HOME = "/home/lab"
const HOME_ALLOW = ["/home/lab/workspace"]
// 家目录内额外只读放行（不给写）：插件/技能需要读，但不允许改
const HOME_RO = ["/home/lab/.config/opencode/skills", "/home/lab/.config/opencode/agents", "/home/lab/.config/opencode/agent"]

// 家外一律拒的具名面
const SYSTEM_DENY = [
  "/etc/shadow", "/etc/gshadow", "/etc/sudoers", "/etc/sudoers.d", "/etc/abathur",
  "/etc/ssh/ssh_host_", "/root", "/var/log", "/var/spool/cron",
  "/proc/sys/kernel", "/sys/kernel",
]

const WRITE_TOOLS = new Set(["write", "edit", "patch", "multiedit"])

function realish(p) {
  try { return fs.realpathSync(p) } catch {
    try { return path.join(fs.realpathSync(path.dirname(p)), path.basename(p)) } catch { return path.resolve(p) }
  }
}

function inside(p, root) {
  const r = root.replace(/\/+$/, "")
  return p === r || p.startsWith(r + "/")
}

const DENY = (why) => { throw new Error("路径策略拒绝：" + why) }

export const SandboxTools = async () => ({
  "tool.execute.before": async (input, output) => {
    if (process.env.ABATHUR_TOOLS === "0") return
    if (!input || !WRITE_TOOLS.has(input.tool) && !["read", "grep", "glob", "list"].includes(input.tool)) return
    const a = output && output.args ? output.args : {}
    const raw = a.filePath || a.path || a.dir || a.cwd
    if (typeof raw !== "string" || raw === "") return
    const p = realish(raw)
    const writing = WRITE_TOOLS.has(input.tool)

    for (const d of SYSTEM_DENY) {
      if (inside(p, d) || p === d) DENY(d + "（系统秘密面）")
    }
    if (inside(p, HOME)) {
      const okRO = HOME_RO.some((r) => inside(p, r))
      const okRW = HOME_ALLOW.some((r) => inside(p, r))
      if (okRW) return
      if (okRO && !writing) return
      DENY(p + "（家目录内非工作区；写操作一律不允）")
    }
  },
})
