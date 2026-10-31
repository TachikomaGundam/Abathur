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
  // Read-only reporter: regression duty + class map + recent bundle summaries.
  query: "loop/query_state.py",
  // Judge-bell planter: writes a planted fraudulent paper into the run dir; no model call.
  plant: "loop/plant_sr4_64_can.py",
  // Host-side only: the seat's bash sees a private tmpfs at /tmp, so it cannot rm a
  // half-seeded run dir itself. Judged runs are refused by loop/clean_run.py.
  clean: "loop/clean_run.py",
}
const GEN_RE = /^G[0-9]+[A-Z]*$/
const ITEM_RE = /^SR4-[0-9]+$/
const PYTHON = process.env.ABATHUR_PY || "/usr/bin/python3"
// Receipt addressing: the target session may host more than one agent (this repo's
// seat has shared a session with Sisyphus). A bare text injection is answered by
// whichever agent the session currently has selected, which is how receipts ended up
// in another agent's mouth (2026-10-31 report). Always name the seat explicitly.
const SEAT_AGENT = process.env.ABATHUR_SEAT_AGENT || "abathur"
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
  const readAddr = () => {
    try {
      const raw = fs.readFileSync(sidFile, "utf8").trim()
      if (!raw) return { id: undefined, verified: false }
      if (raw.startsWith("{")) {
        const j = JSON.parse(raw)
        return { id: j.id, verified: j.agent === SEAT_AGENT }
      }
      return { id: raw, verified: false }
    } catch { return { id: undefined, verified: false } }
  }
  const addr = readAddr()
  let lastSessionID = addr.id
  let lastSessionVerified = addr.verified
  if (lastSessionID && !lastSessionVerified) log(logfile, `RECEIPT-ADDR-UNVERIFIED ${lastSessionID}`)
  const remember = (sid, agent) => {
    if (!sid) return
    const verified = agent === SEAT_AGENT
    if (sid === lastSessionID && verified === lastSessionVerified) return
    lastSessionID = sid
    lastSessionVerified = verified
    try { fs.writeFileSync(sidFile, JSON.stringify({ id: sid, agent: agent || "unknown" })) } catch {}
  }
  let disposed = false

  const receipt = async (text) => {
    if (!lastSessionID) {
      log(logfile, "RECEIPT-SKIP no session address")
      return
    }
    try {
      await client.session.promptAsync({
        path: { id: lastSessionID },
        body: { agent: SEAT_AGENT, parts: [{ type: "text", text }] },
      })
      log(logfile, `RECEIPT-SENT sid=${lastSessionID} agent=${SEAT_AGENT} verified=${lastSessionVerified}`)
    } catch (e) {
      log(logfile, `RECEIPT-FAIL sid=${lastSessionID} ${e?.message || e}`)
    }
  }

  const COALESCE_MS = Number(process.env.ABATHUR_RECEIPT_COALESCE_MS || 45000)
  const BATCH_MAX = Number(process.env.ABATHUR_RECEIPT_BATCH_MAX || 8)
  const pending = []
  let flushTimer = null
  const flush = async () => {
    flushTimer = null
    if (!pending.length) return
    const batch = pending.splice(0, pending.length)
    log(logfile, `FLUSH n=${batch.length}`)
    await receipt(
      `[JOB-RECEIPT][seat=${SEAT_AGENT}] 合并回执 ${batch.length} 件（窗口 ${Math.round(COALESCE_MS / 1000)}s，本批等多于此值即投递）\n` +
      batch.map((b) => `- ${b}`).join("\n") +
      `\n结果文件均在 .omo/exam-queue/done/。按流水线继续下一步，不要问我进度。`
    )
  }
  const queueReceipt = (line) => {
    pending.push(line)
    if (pending.length >= BATCH_MAX) {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
      flush().catch((e) => log(logfile, `FLUSH-ERROR ${e?.message || e}`))
      return
    }
    if (!flushTimer) {
      flushTimer = setTimeout(() => { flush().catch((e) => log(logfile, `FLUSH-ERROR ${e?.message || e}`)) }, COALESCE_MS)
      flushTimer.unref?.()
    }
  }

  const reconcile = () => {
    const rf = path.join(queue, "running.json")
    let rec
    try { rec = JSON.parse(fs.readFileSync(rf, "utf8")) } catch { return }
    if (!rec || !rec.name || running === rec.name) return
    if (rec.pid && fs.existsSync(`/proc/${rec.pid}`)) return
    const target = path.join(done, `${rec.name}.result.json`)
    if (fs.existsSync(target)) {
      try { fs.rmSync(rf, { force: true }) } catch {}
      log(logfile, `RECONCILED ${rec.name} cleared-stale-noop`)
      return
    }
    const result = {
      gen: rec.gen, item: rec.item, stage: rec.stage, rc: -1, kind: "INTERRUPTED", elapsed_s: null,
      tail: "进程在结果落盘前消失；此前可能已有工件，先查 run dir 再决定重跑",
    }
    try { fs.writeFileSync(target, JSON.stringify(result, null, 1)) } catch (e) {
      log(logfile, `RECONCILE-FAIL ${rec.name} ${e?.message || e}`)
    }
    try { fs.rmSync(rf, { force: true }) } catch {}
    log(logfile, `RECONCILED ${rec.name} kind=INTERRUPTED`)
    queueReceipt(
      `作业中断：${rec.name}（gen=${rec.gen} item=${rec.item} stage=${rec.stage}）——终态记录已补写 kind=INTERRUPTED；` +
      `若工件已存在可先判卷，不要盲目重跑。结果文件 done/${rec.name}.result.json`
    )
  }
  reconcile()

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
    try {
      fs.writeFileSync(path.join(queue, "running.json"), JSON.stringify({
        name, ...req, started_at: new Date().toISOString(), pid: child.pid,
      }))
    } catch (e) { log(logfile, `RUNNING-WRITE-FAIL ${name} ${e?.message || e}`) }
    let out = ""
    const cap = (b) => { out = (out + b.toString()).slice(-200_000) }
    child.stdout.on("data", cap)
    child.stderr.on("data", cap)
    const timer = setTimeout(() => { try { child.kill("SIGKILL") } catch {} }, TIMEOUT_MS)
    child.on("close", (rc) => {
      clearTimeout(timer)
      const elapsed = Math.round((Date.now() - t0) / 100) / 10
      const result = { gen: req.gen, item: req.item, stage: req.stage, rc, kind: "OK", elapsed_s: elapsed, tail: out.slice(-4000) }
      try { fs.writeFileSync(path.join(done, `${name}.result.json`), JSON.stringify(result, null, 1)) } catch (e) {
        log(logfile, `RESULT-WRITE-FAIL ${name} ${e?.message || e}`)
      }
      try { fs.rmSync(path.join(queue, "running.json"), { force: true }) } catch {}
      log(logfile, `DONE ${name} rc=${rc} ${elapsed}s`)
      running = null
      queueReceipt(`gen=${req.gen} item=${req.item} stage=${req.stage} rc=${rc} 用时=${elapsed}s name=${name}`)
      resolve(result)
    })
  })

  const poll = async () => {
    if (disposed || running) return
    reconcile()
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
    fs.rmSync(file, { force: true })
    log(logfile, `TAKE ${name} ${req.gen}/${req.item}/${req.stage}`)
    await runJob(name, req)
  }

  const timer = setInterval(() => { poll().catch((e) => log(logfile, `POLL-ERROR ${e?.message || e}`)) }, POLL_MS)
  timer.unref?.()

  return {
    "chat.message": async (input) => remember(input?.sessionID, input?.agent),
    "tool.execute.before": async (input) => remember(input?.sessionID, input?.agent),
    dispose: async () => {
      disposed = true
      clearInterval(timer)
      if (flushTimer) clearTimeout(flushTimer)
      if (pending.length) log(logfile, `DISPOSE-DROP-PENDING n=${pending.length}`)
    },
  }
}
