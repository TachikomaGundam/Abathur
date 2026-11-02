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
  const claimed = path.join(queue, "claimed")
  const logfile = path.join(queue, "runner.log")
  for (const d of [queue, done, rejected, claimed]) { try { fs.mkdirSync(d, { recursive: true }) } catch {} }

  // 两道执行面：候选/判卷会拉起模型会话，彼此争用同一个端点，故单独限流；
  // 其余阶段是秒级子进程，没有理由排在长作业后面（实测 131 件里 111 件 <1s）。
  const MODEL_STAGES = new Set(["candidate", "judge"])
  const MAX_MODEL = Number(process.env.ABATHUR_MAX_MODEL_JOBS || 1)
  const MAX_CHEAP = Number(process.env.ABATHUR_MAX_CHEAP_JOBS || 4)
  const active = new Map()    // name → {pid, stage}
  const runningNames = () => [...active.keys()]
  // Cross-process truth: claims are atomic renames into claimed/; each host owns
  // exactly one state file running-<pid>.json (single writer); lane counters sum
  // every live host's file. (Two-host double-take + shared-file wipe, 2026-11-02.)
  const ownFile = () => path.join(queue, `running-${process.pid}.json`)
  const writeOwn = () => {
    const jobs = [...active.entries()].map(([name, info]) => ({
      name, stage: info.stage, gen: info.gen, item: info.item,
      started_at: info.started_at, pid: info.pid, host_pid: process.pid,
    }))
    const tmp = `${ownFile()}.tmp`
    try {
      fs.writeFileSync(tmp, JSON.stringify({ jobs }))
      fs.renameSync(tmp, ownFile())
    } catch (e) { log(logfile, `RUNNING-WRITE-FAIL ${e?.message || e}`) }
  }
  const peerJobs = () => {
    const out = []
    let names = []
    try { names = fs.readdirSync(queue) } catch { return out }
    for (const f of names) {
      if (!/^running-\d+\.json$/.test(f)) continue
      const pid = Number(f.slice("running-".length, -".json".length))
      if (pid === process.pid) continue
      let rec
      try { rec = JSON.parse(fs.readFileSync(path.join(queue, f), "utf8")) } catch { continue }
      for (const job of Array.isArray(rec?.jobs) ? rec.jobs : []) {
        if (!job?.name) continue
        out.push({ ...job, host_pid: pid, file: f })
      }
    }
    return out
  }
  const alive = (pid) => !!pid && fs.existsSync(`/proc/${pid}`)
  const laneCounts = () => {
    let model = 0, cheap = 0
    for (const v of active.values()) MODEL_STAGES.has(v.stage) ? model++ : cheap++
    for (const p of peerJobs()) {
      if (!alive(p.host_pid) || !alive(p.pid)) continue
      MODEL_STAGES.has(p.stage) ? model++ : cheap++
    }
    // Legacy-format entries (pre-restart running.json, no host_pid) with a live
    // child must count too — otherwise a restart mid-job lets the fresh host
    // double-book the model lane while the orphan child is still working.
    // Observed 2026-11-02: TAKE ... model=0 while g80-4 child was alive.
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(queue, "running.json"), "utf8"))
      const jobs = Array.isArray(rec?.jobs) ? rec.jobs : (rec?.name ? [rec] : [])
      for (const j of jobs) {
        if (!j?.name || active.has(j.name)) continue
        if (!alive(j.pid)) continue
        MODEL_STAGES.has(j.stage) ? model++ : cheap++
      }
    } catch {}
    return { model, cheap }
  }
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

  const BATCH_MAX = Number(process.env.ABATHUR_RECEIPT_BATCH_MAX || 8)
  const MAX_WAIT_MS = Number(process.env.ABATHUR_RECEIPT_MAX_WAIT_MS || 20000)
  const QUIET_MS = Number(process.env.ABATHUR_RECEIPT_QUIET_MS || 1500)
  const SOLO_MS = Number(process.env.ABATHUR_RECEIPT_SOLO_MS || 1000)
  const BURST_MS = Number(process.env.ABATHUR_RECEIPT_BURST_MS || 5000)
  const arrivals = []
  const pending = []
  let flushTimer = null
  let firstPendingAt = null

  const medianArrival = () => {
    if (arrivals.length < 3) return Infinity
    const gaps = []
    for (let i = 1; i < arrivals.length; i++) gaps.push(arrivals[i] - arrivals[i - 1])
    gaps.sort((a, b) => a - b)
    return gaps[Math.floor(gaps.length / 2)]
  }

  const flush = async () => {
    flushTimer = null
    firstPendingAt = null
    if (!pending.length) return
    const batch = pending.splice(0, pending.length)
    log(logfile, `FLUSH n=${batch.length}`)
    await receipt(
      `[JOB-RECEIPT][seat=${SEAT_AGENT}] 合并回执 ${batch.length} 件\n` +
      batch.map((b) => `- ${b}`).join("\n") +
      `\n结果文件均在 .omo/exam-queue/done/。按流水线继续下一步，不要问我进度。`
    )
  }
  const queueReceipt = (line) => {
    const now = Date.now()
    arrivals.push(now)
    if (arrivals.length > 20) arrivals.shift()
    pending.push(line)
    if (pending.length >= BATCH_MAX) {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
      flush().catch((e) => log(logfile, `FLUSH-ERROR ${e?.message || e}`))
      return
    }
    if (!firstPendingAt) firstPendingAt = now
    const burst = medianArrival() < BURST_MS
    const dwell = burst ? QUIET_MS : SOLO_MS
    const waited = now - (firstPendingAt || now)
    if (waited >= MAX_WAIT_MS) {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
      flush().catch((e) => log(logfile, `FLUSH-ERROR ${e?.message || e}`))
      return
    }
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = setTimeout(() => {
      flush().catch((e) => log(logfile, `FLUSH-ERROR ${e?.message || e}`))
    }, Math.min(dwell, MAX_WAIT_MS - waited))
    flushTimer.unref?.()
    log(logfile, `PENDING n=${pending.length} mode=${burst ? "burst" : "solo"} dwell=${dwell}ms`)
  }

  const drainEntries = (jobs, source) => {
    const keep = []
    for (const job of jobs) {
      if (!job?.name) continue
      if (active.has(job.name)) { keep.push(job); continue }
      if (alive(job.host_pid ?? job.pid) && alive(job.pid)) { keep.push(job); continue }
      if (alive(job.pid)) { try { process.kill(job.pid, "SIGTERM") } catch {} }
      const target = path.join(done, `${job.name}.result.json`)
      const claimedFile = path.join(claimed, `${job.name}.json`)
      if (!fs.existsSync(target)) {
        let won = true
        if (fs.existsSync(claimedFile)) {
          try { fs.renameSync(claimedFile, `${claimedFile}.reclaimed`) } catch { won = false }
        }
        if (won) {
          const result = {
            gen: job.gen, item: job.item, stage: job.stage, rc: -1, kind: "INTERRUPTED", elapsed_s: null,
            tail: "进程在结果落盘前消失；此前可能已有工件，先查 run dir 再决定重跑",
          }
          try { fs.writeFileSync(target, JSON.stringify(result, null, 1), { flag: "wx" }) } catch { won = false }
          if (won) {
            log(logfile, `RECONCILED ${job.name} kind=INTERRUPTED src=${source}`)
            queueReceipt(
              `作业中断：${job.name}（gen=${job.gen} item=${job.item} stage=${job.stage}）——终态记录已补写 kind=INTERRUPTED；` +
              `若工件已存在可先判卷，不要盲目重跑。结果文件 done/${job.name}.result.json`
            )
          }
        }
      }
      try { fs.rmSync(claimedFile, { force: true }) } catch {}
    }
    return keep
  }

  const reconcile = () => {
    const legacy = path.join(queue, "running.json")
    try {
      const rec = JSON.parse(fs.readFileSync(legacy, "utf8"))
      const jobs = Array.isArray(rec?.jobs) ? rec.jobs : (rec?.name ? [rec] : [])
      const keep = drainEntries(jobs, "legacy").filter((j) => alive(j.pid))
      if (!keep.length) fs.rmSync(legacy, { force: true })
      else fs.writeFileSync(legacy, JSON.stringify({ jobs: keep }))
    } catch {}
    let names = []
    try { names = fs.readdirSync(queue) } catch { return }
    for (const f of names) {
      if (!/^running-\d+\.json$/.test(f)) continue
      const hostPid = Number(f.slice("running-".length, -".json".length))
      if (hostPid === process.pid) continue
      const fpath = path.join(queue, f)
      let rec
      try { rec = JSON.parse(fs.readFileSync(fpath, "utf8")) } catch { continue }
      const jobs = Array.isArray(rec?.jobs) ? rec.jobs : []
      const withHost = jobs.map((j) => (j ? { ...j, host_pid: j.host_pid ?? hostPid } : j))
      const keep = drainEntries(withHost, f).filter((j) => alive(j.host_pid) && alive(j.pid))
      if (!keep.length) { try { fs.rmSync(fpath, { force: true }) } catch {} }
      else { try { fs.writeFileSync(fpath, JSON.stringify({ jobs: keep })) } catch {} }
    }
  }

  reconcile()

  const persistRunning = () => writeOwn()

  const runJob = (name, req) => new Promise((resolve) => {
    const script = path.join(root, STAGES[req.stage])
    const t0 = Date.now()
    log(logfile, `START ${name} ${req.gen}/${req.item}/${req.stage}`)
    const child = spawn(PYTHON, [script, req.gen, req.item], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("ABATHUR_"))),
    })
    active.set(name, { pid: child.pid, stage: req.stage, gen: req.gen, item: req.item,
                       started_at: new Date().toISOString() })
    persistRunning()
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
      try { fs.rmSync(path.join(claimed, `${name}.json`), { force: true }) } catch {}
      log(logfile, `DONE ${name} rc=${rc} ${elapsed}s`)
      active.delete(name)
      if (active.size) writeOwn()
      else { try { fs.rmSync(ownFile(), { force: true }) } catch {} }
      queueReceipt(`gen=${req.gen} item=${req.item} stage=${req.stage} rc=${rc} 用时=${elapsed}s name=${name}`)
      resolve(result)
    })
  })

  const poll = async () => {
    if (disposed) return
    reconcile()
    let files = []
    try {
      files = fs.readdirSync(queue)
        .filter((f) => f.endsWith(".json") && f !== "running.json" && !/^running-\d+\.json$/.test(f))
        .sort()
    } catch { return }
    if (!files.length) return
    for (const f of files) {
      const name = f.replace(/\.json$/, "")
      const file = path.join(queue, f)
      const mine = path.join(claimed, f)
      try { fs.renameSync(file, mine) } catch { continue }
      let req
      try { req = JSON.parse(fs.readFileSync(mine, "utf8")) } catch (e) {
        fs.writeFileSync(path.join(rejected, `${name}.json`), JSON.stringify({ reason: `无法解析：${e.message}` }))
        fs.rmSync(mine, { force: true })
        log(logfile, `REJECT ${name} 无法解析`)
        continue
      }
      const bad = !req || typeof req !== "object" ? "非对象"
        : !GEN_RE.test(req.gen || "") ? `gen 非法 ${req.gen}`
        : !ITEM_RE.test(req.item || "") ? `item 非法 ${req.item}`
        : !STAGES[req.stage] ? `stage 非法 ${req.stage}` : null
      if (bad) {
        fs.writeFileSync(path.join(rejected, `${name}.json`), JSON.stringify({ reason: bad, request: req }))
        fs.rmSync(mine, { force: true })
        log(logfile, `REJECT ${name} ${bad}`)
        continue
      }
      const isModel = MODEL_STAGES.has(req.stage)
      const lanes = laneCounts()
      if (isModel ? lanes.model >= MAX_MODEL : lanes.cheap >= MAX_CHEAP) {
        try { fs.renameSync(mine, file) } catch {}
        continue
      }
      log(logfile, `TAKE ${name} ${req.gen}/${req.item}/${req.stage} lane=${isModel ? "model" : "cheap"} model=${lanes.model} cheap=${lanes.cheap}`)
      runJob(name, req).catch((e) => log(logfile, `JOB-ERROR ${name} ${e?.message || e}`))
    }
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
