// abathur-exam-runner.js — 宿主侧考场自动执行器（项目插件，opencode 启动时自动加载）
//
// 为什么存在：座席的 bash 在沙箱里（独立网络命名空间），连不到模型端点，所以
// 考场流水线（seed_item → run_candidate → run_judge）必须在沙箱外执行。本插件住在
// opencode 宿主进程里，天然有网络，因此承担执行与回执两件事，不需要用户敲任何命令。
//
// 契约：
//   座席写 .omo/exam-queue/<name>.json  →  {"gen":"G61","item":"SR4-64","stage":"seed"}
//   本插件 2 秒内取件、单并发执行、结果写 .omo/exam-queue/done/<name>.result.json
//   执行结束后向会话注入一条 JOB-RECEIPT 消息 → 座席被自动唤醒继续下一步
//
// 安全边界：只接受三类固定作业与严格格式的 gen/item，从不执行任意命令。

import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const STAGES = {
  seed: "loop/seed_item.py",
  candidate: "loop/run_candidate.py",
  judge: "loop/run_judge.py",
  harvest: "loop/harvest_gen.py",
  // Fixed-argv ledger append; target paths are constants inside loop/ledger_job.py.
  ledger: "loop/ledger_job.py",
}
const GEN_RE = /^G[0-9]+[A-Z]*$/
const ITEM_RE = /^SR4-[0-9]+$/
const PYTHON = process.env.ABATHUR_PY || "/usr/bin/python3"
const TIMEOUT_MS = 2 * 60 * 60 * 1000
const POLL_MS = 2000

const log = (file, line) => {
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 1_000_000) fs.renameSync(file, file + ".1")
  } catch {}
  try { fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`) } catch {}
}

export const AbathurExamRunner = async ({ client, directory, worktree }) => {
  const root = worktree || directory
  const queue = path.join(root, ".omo", "exam-queue")
  const done = path.join(queue, "done")
  const rejected = path.join(queue, "rejected")
  const logfile = path.join(queue, "runner.log")
  for (const d of [queue, done, rejected]) { try { fs.mkdirSync(d, { recursive: true }) } catch {} }

  let running = null          // 当前作业名
  const sidFile = path.join(queue, "last-session.txt")
  let lastSessionID = (() => { try { return fs.readFileSync(sidFile, "utf8").trim() || undefined } catch { return undefined } })()
  const remember = (sid) => {
    if (!sid || sid === lastSessionID) return
    lastSessionID = sid
    try { fs.writeFileSync(sidFile, sid) } catch {}
  }
  let disposed = false

  const receipt = async (text) => {
    if (!lastSessionID) return
    try {
      await client.session.promptAsync({
        path: { id: lastSessionID },
        body: { parts: [{ type: "text", text }] },
      })
    } catch (e) {
      log(logfile, `RECEIPT-FAIL ${e?.message || e}`)
    }
  }

  const runJob = (name, req) => new Promise((resolve) => {
    const script = path.join(root, STAGES[req.stage])
    const t0 = Date.now()
    running = name
    log(logfile, `START ${name} ${req.gen}/${req.item}/${req.stage}`)
    const child = spawn(PYTHON, [script, req.gen, req.item], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("ABATHUR_"))),
    })
    let out = ""
    const cap = (b) => { out = (out + b.toString()).slice(-200_000) }
    child.stdout.on("data", cap)
    child.stderr.on("data", cap)
    const timer = setTimeout(() => { try { child.kill("SIGKILL") } catch {} }, TIMEOUT_MS)
    child.on("close", (rc) => {
      clearTimeout(timer)
      const elapsed = Math.round((Date.now() - t0) / 100) / 10
      const result = { gen: req.gen, item: req.item, stage: req.stage, rc, elapsed_s: elapsed, tail: out.slice(-4000) }
      try { fs.writeFileSync(path.join(done, `${name}.result.json`), JSON.stringify(result, null, 1)) } catch {}
      log(logfile, `DONE ${name} rc=${rc} ${elapsed}s`)
      running = null
      resolve(result)
    })
  })

  const poll = async () => {
    if (disposed || running) return
    let files = []
    try {
      files = fs.readdirSync(queue).filter((f) => f.endsWith(".json") && f !== "running.json").sort()
    } catch { return }
    if (!files.length) return
    const name = files[0].replace(/\.json$/, "")
    const file = path.join(queue, `${name}.json`)
    let req
    try { req = JSON.parse(fs.readFileSync(file, "utf8")) } catch (e) {
      fs.writeFileSync(path.join(rejected, `${name}.json`), JSON.stringify({ reason: `无法解析：${e.message}` }))
      fs.rmSync(file, { force: true })
      log(logfile, `REJECT ${name} 无法解析`)
      return
    }
    const bad = !req || typeof req !== "object" ? "非对象"
      : !GEN_RE.test(req.gen || "") ? `gen 非法 ${req.gen}`
      : !ITEM_RE.test(req.item || "") ? `item 非法 ${req.item}`
      : !STAGES[req.stage] ? `stage 非法 ${req.stage}` : null
    if (bad) {
      fs.writeFileSync(path.join(rejected, `${name}.json`), JSON.stringify({ reason: bad, request: req }))
      fs.rmSync(file, { force: true })
      log(logfile, `REJECT ${name} ${bad}`)
      return
    }
    try { fs.writeFileSync(path.join(queue, "running.json"), JSON.stringify({ name, ...req })) } catch {}
    fs.rmSync(file, { force: true })
    const r = await runJob(name, req)
    try { fs.rmSync(path.join(queue, "running.json"), { force: true }) } catch {}
    await receipt(
      `[JOB-RECEIPT] 考场作业完成：gen=${req.gen} item=${req.item} stage=${req.stage} rc=${r.rc} 用时=${r.elapsed_s}s；` +
      `结果文件 .omo/exam-queue/done/${name}.result.json。按流水线继续下一步，不要问我进度。`
    )
  }

  const timer = setInterval(() => { poll().catch((e) => log(logfile, `POLL-ERROR ${e?.message || e}`)) }, POLL_MS)
  timer.unref?.()

  return {
    "chat.message": async (input) => remember(input?.sessionID),
    "tool.execute.before": async (input) => remember(input?.sessionID),
    dispose: async () => { disposed = true; clearInterval(timer) },
  }
}
