// abathur-opencode-plugin v0.4.0
// Official opencode plugin adapter for the abathur evolution harness.
//
// Two layers ship in this one file (opencode loads it uncompiled, Route A via
// `abathur opencode install` copy, Route B via the package "./server" export):
//
// 1. CLI bridge (0.2.x): the `abathur` tool + self-registering /abathur
//    command. argv-only spawn, allowlist, promote/tombstone/retract stay
//    terminal-only human gates.
// 2. Tier-1 discipline layer (design: loop/proposals/plugin-tier1-design-20261020.md,
//    v9, sibyl-20261020T104515Z-89d1 APPROVE): T1 session-start status
//    injection (merged into system[0] ONLY — a second system message 400s on
//    the local provider, Phase-0 spike), T2 exam-file write guard (throw to
//    block, S1-proven), T3 whitelisted shell env injection (human-pinned
//    repoRoot required), T4 hash-chained ledger append tool with engine-
//    mirrored mkdir-lock takeover, T5 read-only campaign status tool, T6
//    packaged agent persona (user-level AGENTS.md remains the constitution).
//
// The pure logic lives in the marker-delimited ABATHUR-KIT section in PLAIN
// JAVASCRIPT (no TS syntax, no imports): src/test/plugin-tier1.test.ts
// extracts and unit-tests it. Keep that section type-annotation-free.

import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  accessSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { tool, type Config } from "@opencode-ai/plugin";
import type { PluginInput } from "@opencode-ai/plugin";

/** Spawn cap: a CLI call that outlives this is killed and reported, never awaited forever. */
const TIMEOUT_MS = 120_000;
/** Per-stream output cap fed back into the session; keeps one tool call from flooding context. */
const MAX_OUTPUT_BYTES = 64 * 1024;

/** The seven tool-reachable top-level commands plus --help. Anything else is refused locally.
 * promote/tombstone/retract are human gates and deliberately terminal-only (0.2.1/0.2.7): not reachable here. */
const ALLOWED_COMMANDS: readonly string[] = [
  "genome",
  "run",
  "status",
  "bundle",
  "graft",
  "self-eval",
  "kernel",
  "--help",
];

// == ABATHUR-KIT BEGIN (plain JS — extracted by tests; NO TS syntax, NO imports) ==
// All pure functions take dependencies as parameters so tests can eval this
// section standalone with `new Function("createHash", <section>)`.

function createAbathurKit(createHash) {
  const sha256hex = (text) => createHash("sha256").update(text, "utf8").digest("hex");

  // /proc/<pid>/stat: comm (field 2) may contain spaces and parens, so the
  // field split starts after the LAST right paren; starttime is field 22
  // overall, i.e. index 19 of the post-comm fields (post[0] = state = field 3).
  function parseProcStartJiffies(statText) {
    const close = statText.lastIndexOf(")");
    if (close < 0) return null;
    const rest = statText.slice(close + 1).trim().split(/\s+/);
    if (rest.length < 20) return null;
    const v = Number.parseInt(rest[19], 10);
    return Number.isFinite(v) ? v : null;
  }

  function boottimeFromProcStat(procStatText) {
    const m = procStatText.match(/^btime\s+(\d+)\s*$/m);
    return m === null ? null : Number.parseInt(m[1], 10);
  }

  const CLK_TCK = 100; // Linux default USER_HZ on x86_64/arm64; documented assumption.

  function procStartEpochSec(statText, btimeSec) {
    const jiffies = parseProcStartJiffies(statText);
    if (jiffies === null || btimeSec === null) return null;
    return btimeSec + jiffies / CLK_TCK;
  }

  const HEARTBEAT_STALE_MS = 15 * 60 * 1000;
  const START_TOLERANCE_SEC = 5;

  // verdict: "occupied" | "stale-candidate" | "pending" (pending = treat as
  // occupied + warn). Corrupt payloads are fail-closed "occupied".
  function judgeLock(payload, ctx) {
    if (
      payload === null ||
      typeof payload !== "object" ||
      typeof payload.pid !== "number" ||
      typeof payload.startedAt !== "string"
    ) {
      return { verdict: "occupied", reason: "lock-corrupt-fail-closed" };
    }
    const startedMs = Date.parse(payload.startedAt);
    if (Number.isNaN(startedMs)) return { verdict: "occupied", reason: "lock-corrupt-startedAt" };
    if (!ctx.pidAlive && ctx.eperm !== true) {
      return { verdict: "stale-candidate", reason: "pid-dead" };
    }
    if (ctx.procStartEpoch === null) {
      return { verdict: "pending", reason: "proc-unreadable" };
    }
    const startedSec = startedMs / 1000;
    if (!(ctx.procStartEpoch <= startedSec && startedSec <= ctx.procStartEpoch + START_TOLERANCE_SEC)) {
      return { verdict: "stale-candidate", reason: "pid-reused-start-mismatch" };
    }
    if (ctx.nowMs - ctx.mtimeMs > HEARTBEAT_STALE_MS) {
      return { verdict: "pending", reason: "heartbeat-stale-but-alive" };
    }
    return { verdict: "occupied", reason: "lock-fresh" };
  }

  function parseCmdline(buf) {
    return buf.toString("utf8").split("\0").filter((s) => s.length > 0);
  }

  // Identity = a token whose realpath equals the resolved abathur bin
  // (covers node <script>, absolute/symlink, npx-resolved forms), or argv[0]
  // literally the bin basename. Args = everything after that token; node
  // option tokens before the script path are never seen as commands because
  // identity anchors on the script-path token itself.
  function locateExecArgs(argv, binRealpath, binBasename, realpathFn) {
    for (let i = 0; i < argv.length; i++) {
      const tok = argv[i];
      if (i === 0 && tok === binBasename) return argv.slice(1);
      if (tok.includes("/")) {
        let rp;
        try {
          rp = realpathFn(tok);
        } catch {
          continue;
        }
        if (rp === binRealpath) return argv.slice(i + 1);
      }
    }
    return null;
  }

  // Token-exact prefix match against writeCommands (arrays of tokens).
  function matchWriteCommands(argsAfterExec, writeCommands) {
    for (const prefix of writeCommands) {
      if (argsAfterExec.length < prefix.length) continue;
      let eq = true;
      for (let i = 0; i < prefix.length; i++) {
        if (argsAfterExec[i] !== prefix[i]) {
          eq = false;
          break;
        }
      }
      if (eq) return prefix;
    }
    return null;
  }

  // ---- T4 ledger chain (format mirrors the stamp-v2 precedent: a boundary
  // entry opens the chained region; legacy entries before it are reported,
  // never rewritten).

  const T4_KINDS = ["declaration", "guard-override", "lock-takeover", "evidence-note"];
  const T4_HEADER_RE = /^## \[(.+?)\] \[t4:([\w-]+)\] session=(\S+) prev=(\S+)\s*$/;

  function splitLedgerEntries(text) {
    const lines = text.split("\n");
    const entries = [];
    let cur = null;
    lines.forEach((line, idx) => {
      if (line.startsWith("## [")) {
        if (cur !== null) entries.push(cur);
        cur = { startLine: idx + 1, header: line, lines: [line] };
      } else if (cur !== null) {
        cur.lines.push(line);
      }
    });
    if (cur !== null) entries.push(cur);
    return entries.map((e) => ({
      startLine: e.startLine,
      header: e.header,
      text: e.lines.join("\n").replace(/\n+$/, "") + "\n",
      t4: (() => {
        const m = e.header.match(T4_HEADER_RE);
        return m === null ? null : { tsIso: m[1], kind: m[2], session: m[3], prev: m[4] };
      })(),
    }));
  }

  function t4Entries(entries) {
    return entries.filter((e) => e.t4 !== null);
  }

  // Verify backward links for the last k chained entries (entry.prev must
  // equal sha256 of the previous chained entry's full text; the boundary
  // entry's prev=GENESIS is exempt by construction).
  function verifyChainTail(entries, k) {
    const chained = t4Entries(entries);
    if (chained.length === 0) return { ok: true, chainedCount: 0 };
    const start = Math.max(1, chained.length - k);
    for (let i = start; i < chained.length; i++) {
      const want = sha256hex(chained[i - 1].text);
      if (chained[i].t4.prev !== want) {
        return { ok: false, brokenAtLine: chained[i].startLine, expected: want, found: chained[i].t4.prev };
      }
    }
    return { ok: true, chainedCount: chained.length };
  }

  function buildT4Entry({ tsIso, kind, session, prev, bodyLines }) {
    const header = `## [${tsIso}] [t4:${kind}] session=${session} prev=${prev}`;
    return header + "\n" + bodyLines.join("\n") + "\n";
  }

  function buildBoundaryEntry({ tsIso, session }) {
    return buildT4Entry({
      tsIso,
      kind: "boundary",
      session,
      prev: "GENESIS",
      bodyLines: [
        "- T4 链界（schema:v2 镜像 stamp v2 先例）：自此条起逐枚锚定；此前条目为 legacy 无链区（只报数不强制，append-only 不毁史）。",
      ],
    });
  }

  // A torn tail = file not ending in "\n" (crash between write and fsync).
  function detectTornTail(text) {
    if (text.length === 0 || text.endsWith("\n")) return { repaired: text, removed: "" };
    const cut = text.lastIndexOf("\n") + 1;
    return { repaired: text.slice(0, cut), removed: text.slice(cut) };
  }

  // guard-override consumption-side verification (T2): returns the matching
  // approval line or null. ref = sha256 of the approval LINE (trimmed);
  // the line must carry a leading ISO timestamp and name the target path.
  function findApprovalLine(ledgerText, refHex, targetNeedles, nowMs, maxAgeMs) {
    for (const raw of ledgerText.split("\n")) {
      const line = raw.trim();
      if (!line.includes("[人类批准条目]")) continue;
      if (sha256hex(line) !== refHex) continue;
      const tm = line.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
      if (tm === null) return { ok: false, reason: "approval-line-has-no-timestamp" };
      const age = nowMs - Date.parse(tm[1]);
      if (!(age >= 0 && age <= maxAgeMs)) return { ok: false, reason: "approval-older-than-24h" };
      if (!targetNeedles.some((n) => line.includes(n))) {
        return { ok: false, reason: "approval-does-not-name-target" };
      }
      return { ok: true, line };
    }
    return { ok: false, reason: "approval-ref-not-found" };
  }

  const INJECTABLE_KEYS = ["PATH", "ABATHUR_CONFIG", "ABATHUR_SELF_REPO", "ABATHUR_HISTORIAN_REPO", "ABATHUR_DEBUG"];

  function filterEnvSpec(spec) {
    const accepted = {};
    const rejected = [];
    for (const k of Object.keys(spec)) {
      if (INJECTABLE_KEYS.includes(k)) accepted[k] = String(spec[k]);
      else rejected.push(k);
    }
    return { accepted, rejected };
  }

  return {
    sha256hex,
    parseProcStartJiffies,
    boottimeFromProcStat,
    procStartEpochSec,
    judgeLock,
    parseCmdline,
    locateExecArgs,
    matchWriteCommands,
    splitLedgerEntries,
    t4Entries,
    verifyChainTail,
    buildT4Entry,
    buildBoundaryEntry,
    detectTornTail,
    findApprovalLine,
    filterEnvSpec,
    INJECTABLE_KEYS,
    T4_KINDS,
    HEARTBEAT_STALE_MS,
    START_TOLERANCE_SEC,
  };
}

// == ABATHUR-KIT END ==

const kit = createAbathurKit(createHash);

// Last-resort write-command set for engines older than 0.4.0 (no
// engine-registry.json). A repo test pins this equal to the built registry.
const FALLBACK_WRITE_COMMANDS: readonly (readonly string[])[] = [
  ["bundle", "export"],
  ["genome", "add"],
  ["genome", "rm"],
  ["graft"],
  ["opencode"],
  ["promote"],
  ["re-adjudicate"],
  ["retract"],
  ["run"],
  ["self-eval"],
  ["tombstone"],
];

/** T2 guard surface (closed enum; design v9 single source). */
const GUARD_REL_PATHS: readonly string[] = [
  path.join("loop", "bank.py"),
  path.join("loop", "draw.py"),
  path.join(".omo", "evidence", "INTENT-LEDGER.md"),
  path.join(".omo", "evidence", "campaign.lock.json"),
];

const CAMPAIGN_LOCK_REL = path.join(".omo", "evidence", "campaign.lock.json");
const LEDGER_REL = path.join(".omo", "evidence", "INTENT-LEDGER.md");
const ENGINE_LOCK_MIN_VERSION = [0, 4, 0] as const;

function resolveBin(): string {
  const configured = process.env["ABATHUR_BIN"];
  return configured === undefined || configured.length === 0 ? "abathur" : configured;
}

interface CliResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly note: string;
}

/** The subset of the execFile error shape this adapter reads (node sets `code` to the numeric exit status on non-zero exits). */
interface SpawnError extends Error {
  readonly code?: string | number | null;
  readonly killed?: boolean;
  readonly signal?: string | null;
}

/** Never rejects: every spawn failure becomes a structured result the agent can read. */
function runCli(bin: string, argv: readonly string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(
      bin,
      [...argv],
      { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, shell: false },
      (error, stdout, stderr) => {
        const out = stdout.slice(0, MAX_OUTPUT_BYTES);
        const errOut = stderr.slice(0, MAX_OUTPUT_BYTES);
        if (error === null) {
          resolve({ status: 0, stdout: out, stderr: errOut, note: "" });
          return;
        }
        const failure = error as SpawnError;
        if (failure.code === "ENOENT") {
          resolve({
            status: 127,
            stdout: out,
            stderr: errOut,
            note: `binary '${bin}' not found — install abathur globally or point ABATHUR_BIN at it`,
          });
          return;
        }
        if (failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
          resolve({
            status: -1,
            stdout: out,
            stderr: errOut,
            note: `output truncated at ${String(MAX_OUTPUT_BYTES)} bytes (cap per stream)`,
          });
          return;
        }
        if (typeof failure.code !== "number") {
          const timedOut = failure.killed === true || (failure.signal !== undefined && failure.signal !== null);
          if (timedOut) {
            let note = `killed after ${String(TIMEOUT_MS / 1000)}s timeout (signal: ${String(failure.signal ?? "SIGTERM")})`;
            if (argv[0] === "run") {
              // The timeout kills the CLI only; mutator/bench children are detached by design.
              note +=
                " — abathur run spawns detached children (mutator/bench sessions) " +
                "that may still be running — the next 'abathur run' reaps them";
            }
            resolve({ status: 124, stdout: out, stderr: errOut, note });
            return;
          }
          resolve({ status: -1, stdout: out, stderr: errOut, note: `spawn failed: ${failure.message}` });
          return;
        }
        // Ordinary non-zero exit: the CLI's own verdict (blocked / cannot-answer).
        resolve({ status: failure.code, stdout: out, stderr: errOut, note: "" });
      },
    );
  });
}

// --------------------------------------------------------------------------
// Tier-1 IO layer (thin; every decision lives in the kit above)
// --------------------------------------------------------------------------

interface EngineProbe {
  readonly mode: "LOCK" | "FALLBACK-PROBE";
  readonly binRealpath: string | null;
  readonly version: string | null;
  readonly writeCommands: readonly (readonly string[])[];
  readonly notes: string[];
}

function findOnPath(name: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir.length === 0) continue;
    const candidate = path.join(dir, name);
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // keep scanning
    }
  }
  return null;
}

function versionAtLeast(version: string, min: readonly [number, number, number]): boolean {
  const parts = version.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return false;
  if (parts[0] !== min[0]) return (parts[0] ?? 0) > min[0];
  if (parts[1] !== min[1]) return (parts[1] ?? 0) > min[1];
  return (parts[2] ?? 0) >= min[2];
}

function probeEngineVersion(binRealpath: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(binRealpath, ["--version"], { timeout: 2000, maxBuffer: 4096, shell: false }, (error, stdout) => {
      if (error !== null) {
        resolve(null);
        return;
      }
      const v = stdout.trim();
      resolve(v.length > 0 ? v : null);
    });
  });
}

let engineProbeCache: { at: number; value: EngineProbe } | null = null;
const ENGINE_PROBE_TTL_MS = 60_000;

/** Version probe + registry read, 60s TTL. Never throws; degraded ⇒ FALLBACK-PROBE. */
async function probeEngine(): Promise<EngineProbe> {
  if (engineProbeCache !== null && Date.now() - engineProbeCache.at < ENGINE_PROBE_TTL_MS) {
    return engineProbeCache.value;
  }
  const notes: string[] = [];
  let value: EngineProbe;
  const binPath = findOnPath(resolveBin());
  if (binPath === null) {
    notes.push("abathur binary not found on PATH");
    value = { mode: "FALLBACK-PROBE", binRealpath: null, version: null, writeCommands: FALLBACK_WRITE_COMMANDS, notes };
  } else {
    let binRealpath: string;
    try {
      binRealpath = realpathSync(binPath);
    } catch {
      binRealpath = binPath;
    }
    const version = await probeEngineVersion(binRealpath);
    let registry: readonly (readonly string[])[] | null = null;
    try {
      const raw = JSON.parse(readFileSync(path.join(path.dirname(binRealpath), "engine-registry.json"), "utf8")) as {
        writeCommands?: string[][];
      };
      if (Array.isArray(raw.writeCommands)) registry = raw.writeCommands;
    } catch {
      notes.push("engine-registry.json missing/unreadable — upgrade engine to >=0.4.0");
    }
    if (version === null) {
      notes.push("abathur --version probe failed/timeout (2s)");
    } else if (!versionAtLeast(version, ENGINE_LOCK_MIN_VERSION)) {
      notes.push(`engine ${version} < 0.4.0 — no campaign lock writer`);
    }
    const capable = version !== null && versionAtLeast(version, ENGINE_LOCK_MIN_VERSION) && registry !== null;
    value = {
      mode: capable ? "LOCK" : "FALLBACK-PROBE",
      binRealpath,
      version,
      writeCommands: registry ?? FALLBACK_WRITE_COMMANDS,
      notes,
    };
  }
  engineProbeCache = { at: Date.now(), value };
  return value;
}

function pidAlive(pid: number): { alive: boolean; eperm: boolean } {
  try {
    process.kill(pid, 0);
    return { alive: true, eperm: false };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM") return { alive: true, eperm: true };
    return { alive: false, eperm: false };
  }
}

function procStartEpoch(pid: number): number | null {
  try {
    const statText = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    const procStat = readFileSync("/proc/stat", "utf8");
    return kit.procStartEpochSec(statText, kit.boottimeFromProcStat(procStat));
  } catch {
    return null;
  }
}

/** Process-level disproof scan over /proc. Token-exact; skips self and unreadable. */
function scanDisproof(binRealpath: string | null, writeCommands: readonly (readonly string[])[]): { pid: number; matched: readonly string[] }[] {
  if (binRealpath === null) return [];
  const hits: { pid: number; matched: readonly string[] }[] = [];
  const binBasename = path.basename(binRealpath) === "cli.js" ? "abathur" : path.basename(binRealpath);
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number.parseInt(entry, 10);
    if (pid === process.pid) continue;
    let argv: string[];
    try {
      argv = kit.parseCmdline(readFileSync(`/proc/${entry}/cmdline`));
    } catch {
      continue; // cross-user or vanished — never claimed as evidence
    }
    if (argv.length === 0) continue;
    const args = kit.locateExecArgs(argv, binRealpath, binBasename, realpathSync);
    if (args === null) continue;
    const matched = kit.matchWriteCommands(args, writeCommands);
    if (matched !== null) hits.push({ pid, matched });
  }
  return hits;
}

interface OccupancyVerdict {
  readonly occupied: boolean;
  readonly pending: boolean;
  readonly mode: "LOCK" | "FALLBACK-PROBE";
  readonly detail: string;
}

/** Fresh occupancy judgment (never reuses the display cache). Never throws. */
async function judgeOccupancy(repoRoot: string): Promise<OccupancyVerdict> {
  const probe = await probeEngine();
  const lockBase = process.env["ABATHUR_SELF_REPO"] ?? repoRoot;
  const lockPath = path.join(lockBase, CAMPAIGN_LOCK_REL);
  const disproof = () => {
    const hits = scanDisproof(probe.binRealpath, probe.writeCommands);
    if (hits.length > 0) {
      return {
        occupied: true,
        pending: false,
        mode: probe.mode,
        detail: `process disproof hit: ${hits.map((h) => `pid ${String(h.pid)} argv ${h.matched.join(" ")}`).join("; ")}`,
      } as OccupancyVerdict;
    }
    return null;
  };
  let lockState: "absent" | "stale-candidate" | "judged" = "absent";
  if (existsSync(lockPath)) {
    let payload: unknown = null;
    try {
      payload = JSON.parse(readFileSync(lockPath, "utf8"));
    } catch {
      payload = null; // corrupt ⇒ judgeLock fail-closed occupied
    }
    const lockPayload = payload as { pid?: number } | null;
    const alive = typeof lockPayload?.pid === "number" ? pidAlive(lockPayload.pid) : { alive: false, eperm: false };
    const verdict = kit.judgeLock(payload, {
      pidAlive: alive.alive,
      eperm: alive.eperm,
      procStartEpoch: typeof lockPayload?.pid === "number" ? procStartEpoch(lockPayload.pid) : null,
      mtimeMs: statSync(lockPath).mtimeMs,
      nowMs: Date.now(),
    });
    if (verdict.verdict === "occupied") {
      return { occupied: true, pending: false, mode: probe.mode, detail: `campaign lock: ${verdict.reason}` };
    }
    if (verdict.verdict === "pending") {
      return { occupied: true, pending: true, mode: probe.mode, detail: `占用待裁: ${verdict.reason}` };
    }
    lockState = "stale-candidate";
  }
  // Every "idle" exit passes the disproof scan first (covers lock-write failure).
  const disproved = disproof();
  if (disproved !== null) return disproved;
  return {
    occupied: false,
    pending: false,
    mode: probe.mode,
    detail: lockState === "stale-candidate" ? "stale lock + disproof clean" : "no lock + disproof clean",
  };
}

// --------------------------------------------------------------------------
// T4 ledger append: mkdir-lock + torn repair + hash chain (kit formats)
// --------------------------------------------------------------------------

const T4_LOCK_TIMEOUT_MS = 5000;
const T4_STALE_GRACE_MS = 250; // mirrors engine locks.ts STALE_GRACE_MS exactly

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface T4Lock {
  readonly dir: string;
  readonly tookOver: boolean;
  readonly release: () => void;
}

async function acquireT4Lock(lockDir: string): Promise<T4Lock> {
  const deadline = Date.now() + T4_LOCK_TIMEOUT_MS;
  let tookOver = false;
  for (;;) {
    try {
      mkdirSync(lockDir);
      writeFileSync(path.join(lockDir, "owner.json"), JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
      return {
        dir: lockDir,
        tookOver,
        release: () => {
          try {
            const owner = JSON.parse(readFileSync(path.join(lockDir, "owner.json"), "utf8")) as { pid?: number };
            if (owner.pid === process.pid) rmSync(lockDir, { recursive: true, force: true });
          } catch {
            // release is best-effort; a stranded dir is takeover-eligible by protocol
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Takeover eligibility mirrors the engine: dead owner (ESRCH), or a
      // missing owner.json older than the stale grace. A live holder is never
      // preempted, however old the lock.
      let eligible = false;
      try {
        const owner = JSON.parse(readFileSync(path.join(lockDir, "owner.json"), "utf8")) as { pid?: number };
        if (typeof owner.pid === "number" && !pidAlive(owner.pid).alive) eligible = true;
      } catch {
        try {
          eligible = Date.now() - statSync(lockDir).mtimeMs > T4_STALE_GRACE_MS;
        } catch {
          eligible = false;
        }
      }
      if (eligible) {
        const nonce = randomBytes(4).toString("hex");
        renameSync(lockDir, `${lockDir}.stale-${String(Date.now())}-${nonce}`);
        rmSync(`${lockDir}.stale-${String(Date.now())}-${nonce}`, { recursive: true, force: true });
        tookOver = true;
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`abathur_ledger_append: lock ${lockDir} held by a live writer for >${String(T4_LOCK_TIMEOUT_MS)}ms — refused (fail-closed)`);
      }
      await sleep(50);
    }
  }
}

// --------------------------------------------------------------------------
// /abathur slash-command template (unchanged 0.2.x surface)
// --------------------------------------------------------------------------

/**
 * /abathur slash-command template, injected into cfg.command.abathur by the
 * config hook for installs without a commands/abathur.md on disk (Route B).
 * Byte-mirror of plugin/abathur-command.md minus its first-line marker —
 * src/test/opencode.test.ts pins the equality.
 */
const COMMAND_TEMPLATE = `Drive the abathur evolution harness through the \`abathur\` tool on this machine.

User request: $ARGUMENTS

Interpret the request as one \`abathur\` CLI invocation: the first word is the
top-level command (\`genome\`, \`run\`, \`status\`, \`bundle\`, \`graft\`, \`self-eval\`,
\`kernel\`, or \`--help\`) and the rest are argv tokens. Call the \`abathur\` tool
with \`command\` set to the first word and \`extra\` set to the remaining tokens,
then report the CLI exit code (0 ok / 1 blocked decision / 2 cannot-answer)
and the relevant lines of its output. If no request was given, call the tool
with \`command: "--help"\` and summarize the command list. \`promote\`,
\`tombstone\` and \`retract\` cannot be called through the tool at all — the tool refuses them.
They are human gates that belong to a terminal: if the user asks for one,
tell them to run \`abathur promote …\` / \`abathur tombstone …\` / \`abathur retract …\` there.
`;

/** T6 packaged persona: portable seat description. The constitution lives in
 * the user-level AGENTS.md — never duplicated here (single source). */
const AGENT_PROMPT = `You are Abathur, the institutional evolution driver's operating seat.

Your complete constitution is the user-level AGENTS.md on this machine (the
abathur sections). If that constitution is absent, STOP and say so — do not
improvise the seat's rules.

Portable hard lines (the constitution is authoritative; this is the summary):
- Evidence over assertion: claims carry machine receipts (command output,
  file:line, hashes), never memory.
- Fail-closed outcomes (exit 1/2, CANNOT_ANSWER) are honest answers — report,
  never grind retries.
- promote/tombstone/retract and any publish/push are human-terminal gates.
- Read the intent ledger tail before mutating harness state; append your own
  receipts to it.
 - Use the abathur_ledger_append tool for ledger writes; use
  abathur_campaign_status before touching exam files.
- The campaign playbook ships as the `abathur-loop` skill in this package.
  If that skill is available, load it for exam-lane procedures; if it is
  absent (older/partial install), proceed with the constitution alone and
  note the gap honestly — never pretend to have read it.
- The planning protocol (PLAN-SEG: five-grid plans, ledger segments,
  mechanical checker) ships as the `abathur-plan` skill in this package.
  Load it before any multi-step planned work; if absent, note the gap.
`;

function isAbathurWorkspace(dir: string): boolean {
  return existsSync(path.join(dir, LEDGER_REL));
}

/** Display-side occupancy + ledger tail, 60s TTL (T1 only; T2 never reads this). */
let displayCache: { at: number; text: string } | null = null;
async function buildStatusBlock(dir: string): Promise<string> {
  if (displayCache !== null && Date.now() - displayCache.at < ENGINE_PROBE_TTL_MS) return displayCache.text;
  const lines: string[] = [];
  try {
    const ledgerPath = path.join(dir, LEDGER_REL);
    const raw = readFileSync(ledgerPath, "utf8");
    const headers = raw.split("\n").filter((l) => l.startsWith("## ["));
    lines.push("ledger tail:");
    for (const h of headers.slice(-3)) lines.push(`  ${h}`);
  } catch {
    lines.push("ledger tail: (unreadable)");
  }
  try {
    const occ = await judgeOccupancy(dir);
    lines.push(
      `campaign: ${occ.occupied ? (occ.pending ? "OCCUPIED-PENDING" : "OCCUPIED") : "idle"} [${occ.mode}] — ${occ.detail}`,
    );
  } catch (error) {
    lines.push(`campaign: status unavailable (${error instanceof Error ? error.message : String(error)})`);
  }
  let text = lines.join("\n");
  if (text.length > 2000) text = text.slice(0, 2000) + "…";
  displayCache = { at: Date.now(), text };
  return text;
}

function resolveAgainst(dir: string, p: string): string {
  const abs = path.isAbsolute(p) ? p : path.resolve(dir, p);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

/** Extract every file a write-shaped tool call targets (apply_patch enumerates all hunks). */
function extractTargetPaths(toolName: string, args: Record<string, unknown>): string[] {
  if (toolName === "edit" || toolName === "write") {
    return typeof args["filePath"] === "string" ? [args["filePath"]] : [];
  }
  if (toolName === "apply_patch") {
    const patch = [args["patch"], args["patchText"], args["input"]].find((v) => typeof v === "string") as
      | string
      | undefined;
    if (patch === undefined) return [];
    const out: string[] = [];
    for (const m of patch.matchAll(/^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(.+)$/gm)) {
      if (m[1] !== undefined) out.push(m[1].trim());
    }
    return out;
  }
  return [];
}

function guardHit(dir: string, target: string): string | null {
  const resolved = resolveAgainst(dir, target);
  for (const rel of GUARD_REL_PATHS) {
    const guardAbs = path.resolve(dir, rel);
    if (resolved === guardAbs || resolved === realpathSyncSafe(guardAbs)) return rel;
    // (device,inode) equality closes the hardlink bypass.
    try {
      const a = statSync(resolved);
      const b = statSync(guardAbs);
      if (a.dev === b.dev && a.ino === b.ino) return rel;
    } catch {
      // nonexistent target (create) or guard file absent — textual compare already done
    }
  }
  return null;
}

function realpathSyncSafe(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

const OVERRIDE_WINDOW_MS = 15 * 60 * 1000;
const APPROVAL_WINDOW_MS = 24 * 60 * 60 * 1000;

/** T2 override: consumption-side four verifications (design v9 T2 override). */
function checkOverride(dir: string, sessionID: string, guardRel: string): { pass: boolean; reason: string } {
  const ledgerPath = path.join(dir, LEDGER_REL);
  let text: string;
  try {
    text = readFileSync(ledgerPath, "utf8");
  } catch {
    return { pass: false, reason: "ledger-unreadable" };
  }
  const entries = kit.splitLedgerEntries(text);
  const now = Date.now();
  const overrides = kit
    .t4Entries(entries)
    .filter((e) => e.t4 !== null && e.t4.kind === "guard-override" && e.t4.session === sessionID)
    .filter((e) => {
      const age = now - Date.parse(e.t4!.tsIso);
      return age >= 0 && age <= OVERRIDE_WINDOW_MS;
    })
    .filter((e) => e.text.includes(`target=${guardRel}`));
  const newest = overrides.at(-1);
  if (newest === undefined || newest.t4 === null) return { pass: false, reason: "no-fresh-override-entry" };
  const refMatch = newest.text.match(/ref=([0-9a-f]{64})/);
  if (refMatch === null) return { pass: false, reason: "override-lacks-ref" };
  // Verification 4: the override entry itself passes the k=3 backward chain check.
  const chained = kit.t4Entries(entries);
  const idx = chained.findIndex((e) => e.startLine === newest.startLine);
  const windowStart = Math.max(1, idx - 2);
  for (let i = windowStart; i <= idx; i++) {
    const want = kit.sha256hex(chained[i - 1]!.text);
    if (chained[i]!.t4!.prev !== want) return { pass: false, reason: `override-chain-broken-at-line-${String(chained[i]!.startLine)}` };
  }
  // Verification 1: referenced human-approval line — hash-located, ≤24h, names the target.
  const approval = kit.findApprovalLine(
    text,
    refMatch[1] ?? "",
    [guardRel, path.basename(guardRel), path.resolve(dir, guardRel)],
    now,
    APPROVAL_WINDOW_MS,
  );
  if (!approval.ok) return { pass: false, reason: approval.reason ?? "approval-check-failed" };
  return { pass: true, reason: "override-4of4" };
}

export default {
  id: "abathur",
  server: async (input: PluginInput, options?: Record<string, unknown>) => ({
    // Self-registering /abathur: opencode calls hook.config(cfg) once per
    // instance after ALL config sources are merged — file-based commands are
    // already in cfg.command by then. `??=` keeps a Route-A commands/abathur.md
    // authoritative and only fills the gap for Route B.
    config: async (cfg: Config) => {
      cfg.command ??= {};
      cfg.command.abathur ??= {
        description: "Drive the abathur evolution harness (usage: /abathur <command> [args...])",
        template: COMMAND_TEMPLATE,
      };
      // T6: packaged persona. A user-level agents/abathur.md (Tier-0) takes
      // precedence by opencode's own layering; single-source stays the
      // user-level AGENTS.md constitution.
      const agentCfg = cfg as Config & { agent?: Record<string, unknown> };
      agentCfg.agent ??= {};
      agentCfg.agent["abathur"] ??= {
        description: "Abathur — institutional evolution driver seat (campaigns, genomes, ledger discipline)",
        mode: "all",
        prompt: AGENT_PROMPT,
      };
    },

    // T1: session-start status injection. HARD CONSTRAINT (Phase-0 S2): merge
    // into system[0] — a second system message 400s on the local provider.
    "experimental.chat.system.transform": async (_input: { sessionID?: string }, output: { system: string[] }) => {
      const dir = input.directory;
      if (!isAbathurWorkspace(dir)) return;
      let block: string;
      try {
        const text = await Promise.race([
          buildStatusBlock(dir),
          sleep(2000).then(() => "状态未取到（探测超时 2s 占位）"),
        ]);
        block = `\n\n[abathur-status]\n${text}\n[/abathur-status]`;
      } catch {
        block = "\n\n[abathur-status]\n状态未取到（探测异常占位）\n[/abathur-status]";
      }
      if (output.system.length === 0) output.system.push(block.trim());
      else output.system[0] = (output.system[0] ?? "") + block;
    },

    // T2: exam-file write guard. Throw to block (Phase-0 S1). Fresh occupancy
    // read on every call; the display cache is never consulted here.
    "tool.execute.before": async (
      hookInput: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> },
    ) => {
      const dir = input.directory;
      if (!isAbathurWorkspace(dir)) return;
      if (!["edit", "write", "apply_patch"].includes(hookInput.tool)) return;
      const targets = extractTargetPaths(hookInput.tool, output.args);
      for (const target of targets) {
        const guardRel = guardHit(dir, target);
        if (guardRel === null) continue;
        const occ = await judgeOccupancy(dir);
        if (!occ.occupied) continue;
        const override = checkOverride(dir, hookInput.sessionID, guardRel);
        if (override.pass) {
          process.stderr.write(
            `[abathur-guard] OVERRIDE-ALLOW ${guardRel} session=${hookInput.sessionID} (${override.reason})\n`,
          );
          continue;
        }
        throw new Error(
          `[abathur-guard] 写入被拦截：${guardRel} 属考题守卫面，campaign 在跑（${occ.detail}，模式 ${occ.mode}）。` +
            `override 通道：先以 abathur_ledger_append 落 kind=guard-override 条目（target=${guardRel} + ref=<人类批准行 sha256>），` +
            `四验证（24h 批准具名目标/同会话/15min 窗/链验）全过方放行。本次拒绝原因: ${override.reason}。`,
        );
      }
    },

    // T2 bash-side compensation: heuristic warn-only (variables/globs bypass
    // is a named residual in the design).
    "tool.execute.after": async (
      hookInput: { tool: string; sessionID: string; callID: string; args: Record<string, unknown> },
      output: { title: string; output: string; metadata: unknown },
    ) => {
      if (hookInput.tool !== "bash") return;
      const dir = input.directory;
      if (!isAbathurWorkspace(dir)) return;
      const command = typeof hookInput.args["command"] === "string" ? hookInput.args["command"] : "";
      if (command.length === 0) return;
      const touched = GUARD_REL_PATHS.filter((rel) => command.includes(path.basename(rel)));
      if (touched.length === 0) return;
      output.output +=
        `\n⚠️ [abathur-guard] 命令文本触及守卫面文件名（${touched.join(", ")}）：bash 通道不受 T2 拦截，` +
        `若这是对守卫面的写操作，须先落账本声明（L-SURFACE-ATTRIBUTION）；占用期写入=规程违规。`;
    },

    // T3: shell env injection. Enablement requires the human-pinned repoRoot
    // in this plugin's options (opencode.jsonc) AND cwd realpath equality —
    // no pin, no injection (fail-closed). The spec file lives on the human
    // key surface (~/.config/opencode/abathur-shell-env.json); repo-local
    // files are never read.
    "shell.env": async (envInput: { cwd: string }, output: { env: Record<string, string> }) => {
      const pinned = options?.["repoRoot"];
      if (typeof pinned !== "string" || pinned.length === 0) return;
      try {
        if (realpathSync(envInput.cwd) !== realpathSync(pinned)) return;
      } catch {
        return;
      }
      const specPath = path.join(os.homedir(), ".config", "opencode", "abathur-shell-env.json");
      let spec: unknown;
      try {
        spec = JSON.parse(readFileSync(specPath, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          process.stderr.write(`[abathur-shell-env] malformed ${specPath} — ignored (${error instanceof Error ? error.message : String(error)})\n`);
        }
        return;
      }
      if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
        process.stderr.write(`[abathur-shell-env] ${specPath} must be a JSON object — ignored\n`);
        return;
      }
      const { accepted, rejected } = kit.filterEnvSpec(spec as Record<string, unknown>);
      if (rejected.length > 0) {
        process.stderr.write(`[abathur-shell-env] rejected non-whitelisted keys: ${rejected.join(", ")}\n`);
      }
      if (typeof accepted["PATH"] === "string") {
        accepted["PATH"] = `${accepted["PATH"]}${path.delimiter}${process.env.PATH ?? ""}`;
      }
      Object.assign(output.env, accepted);
    },

    tool: {
      abathur: tool({
        description:
          "Run the abathur evolution-harness CLI on this machine. " +
          "Pass the top-level command word in `command` (one of: genome, run, status, " +
          "bundle, graft, self-eval, kernel, --help) and every " +
          "remaining argv token in `extra`. The call is spawned argv-only (no shell) " +
          "with a 120s timeout; the result text always ends with the CLI exit code " +
          "(0 ok, 1 blocked decision, 2 cannot-answer). Honest privilege note: this " +
          "tool carries bash-equivalent privilege — `run` and `genome` legitimately " +
          "spawn mutator/engine binaries by design — so the allowlist limits typos " +
          "and UX, not capability. `promote`, `tombstone` and `retract` are deliberately NOT " +
          "reachable here: they are human gates, run in a terminal.",
        args: {
          command: tool.schema
            .string()
            .describe("top-level abathur command, e.g. 'genome' or 'status' or '--help'"),
          extra: tool.schema
            .array(tool.schema.string())
            .optional()
            .describe("remaining argv tokens, e.g. ['add', '/path/to/genome.jsonc']"),
        },
        execute: async (args, context) => {
          const command = args.command.trim();
          if (!ALLOWED_COMMANDS.includes(command)) {
            return (
              `abathur: refused '${command}' — not an allowed top-level command. ` +
              `Allowed: ${ALLOWED_COMMANDS.join(", ")}. Put the command word in 'command' ` +
              `and every other token in 'extra'.`
            );
          }
          const argv: readonly string[] = [command, ...(args.extra ?? [])];
          context.metadata({ title: `abathur ${argv.join(" ")}` });
          const bin = resolveBin();
          const result = await runCli(bin, argv);
          const sections = [
            `$ abathur ${argv.join(" ")}`,
            `exit: ${String(result.status)}`,
          ];
          if (result.note.length > 0) sections.push(`note: ${result.note}`);
          sections.push(`--- stdout ---\n${result.stdout.length === 0 ? "(empty)" : result.stdout}`);
          sections.push(`--- stderr ---\n${result.stderr.length === 0 ? "(empty)" : result.stderr}`);
          return sections.join("\n");
        },
      }),

      // T4: the ledger's only managed write channel. Hash-chained entries
      // (schema v2 boundary precedent), mkdir-lock mutual exclusion with
      // engine-mirrored takeover, torn-tail repair, fail-closed everywhere.
      abathur_ledger_append: tool({
        description:
          "Append a hash-chained entry to the abathur INTENT-LEDGER (kinds: declaration, guard-override, " +
          "lock-takeover, evidence-note). Human-approval entries are NEVER written through this tool — " +
          "they belong to the terminal. Path resolution: explicit absolute `path`, else " +
          "$ABATHUR_SELF_REPO/.omo/evidence/INTENT-LEDGER.md; the variable unset is a hard error naming it. " +
          "Chain breakage, lock timeout (5s) and torn tails are handled fail-closed; the result text ends " +
          "with the new entry's self sha256.",
        args: {
          kind: tool.schema.string().describe("one of: declaration, guard-override, lock-takeover, evidence-note"),
          body: tool.schema.string().describe("entry body lines (markdown bullets), no leading '## ' header"),
          path: tool.schema.string().optional().describe("explicit absolute ledger path (overrides env resolution)"),
          target: tool.schema.string().optional().describe("guard-override only: guard-surface relative path"),
          ref: tool.schema
            .string()
            .optional()
            .describe("guard-override only: sha256 of the referenced human-approval ledger line"),
        },
        execute: async (args, context) => {
          const kind = args.kind.trim();
          if (!kit.T4_KINDS.includes(kind)) {
            throw new Error(`abathur_ledger_append: kind '${kind}' not in closed whitelist {${kit.T4_KINDS.join(", ")}}`);
          }
          if (kind === "guard-override" && (args.target === undefined || args.ref === undefined)) {
            throw new Error("abathur_ledger_append: guard-override requires target=<guard rel path> and ref=<approval line sha256>");
          }
          let ledgerPath = args.path;
          if (ledgerPath === undefined) {
            const selfRepo = process.env["ABATHUR_SELF_REPO"];
            if (selfRepo === undefined || selfRepo.length === 0) {
              throw new Error("abathur_ledger_append: $ABATHUR_SELF_REPO is not set — cannot resolve the ledger path (fail-closed by design)");
            }
            ledgerPath = path.join(selfRepo, LEDGER_REL);
          }
          const session = context.sessionID;
          const lockDir = `${ledgerPath}.t4lock.d`;
          const lock = await acquireT4Lock(lockDir);
          try {
            const extraEntries: string[] = [];
            if (lock.tookOver) {
              const ts = new Date().toISOString();
              extraEntries.push(
                kit.buildT4Entry({
                  tsIso: ts,
                  kind: "lock-takeover",
                  session,
                  prev: "PENDING", // rewritten below after chain read
                  bodyLines: [`- T4 锁目录接管（持锁 pid 死或 owner.json 缺失超 ${String(T4_STALE_GRACE_MS)}ms 宽限），协议镜像引擎 locks.ts。`],
                }),
              );
            }
            let text = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
            const torn = kit.detectTornTail(text);
            if (torn.removed.length > 0) {
              const fd = openSync(ledgerPath, "r+");
              try {
                ftruncateSync(fd, Buffer.byteLength(torn.repaired, "utf8"));
                fsyncSync(fd);
              } finally {
                closeSync(fd);
              }
              text = torn.repaired;
              extraEntries.push(
                kit.buildT4Entry({
                  tsIso: new Date().toISOString(),
                  kind: "evidence-note",
                  session,
                  prev: "PENDING",
                  bodyLines: [`- 撕行修复：截断 ${String(Buffer.byteLength(torn.removed, "utf8"))} 字节，被截内容 sha256=${kit.sha256hex(torn.removed)}`],
                }),
              );
            }
            let entries = kit.splitLedgerEntries(text);
            const pre = kit.verifyChainTail(entries, 3);
            if (!pre.ok) {
              throw new Error(
                `abathur_ledger_append: chain broken at line ${String(pre.brokenAtLine ?? 0)} — refused (fail-closed); repair requires a human terminal session`,
              );
            }
            if (kit.t4Entries(entries).length === 0) {
              extraEntries.unshift(kit.buildBoundaryEntry({ tsIso: new Date().toISOString(), session }));
            }
            const bodyLines = args.body.split("\n");
            if (kind === "guard-override") {
              bodyLines.unshift(`- target=${args.target ?? ""} ref=${args.ref ?? ""}`);
            }
            const mainEntry = kit.buildT4Entry({
              tsIso: new Date().toISOString(),
              kind,
              session,
              prev: "PENDING",
              bodyLines,
            });
            const toAppend = [...extraEntries, mainEntry];
            let appendText = "";
            for (const entryText of toAppend) {
              entries = kit.splitLedgerEntries(text + appendText);
              const chained = kit.t4Entries(entries);
              const prevHex = chained.length === 0 ? "GENESIS" : kit.sha256hex(chained[chained.length - 1]!.text);
              appendText += entryText.replace("prev=PENDING", `prev=${prevHex}`);
            }
            const fd2 = openSync(ledgerPath, "a");
            try {
              writeSync(fd2, appendText, undefined, "utf8");
              fsyncSync(fd2);
            } finally {
              closeSync(fd2);
            }
            // Read-back: the tail chain including the new entries must verify.
            const after = kit.splitLedgerEntries(readFileSync(ledgerPath, "utf8"));
            const post = kit.verifyChainTail(after, 3);
            if (!post.ok) {
              throw new Error(`abathur_ledger_append: post-write chain verification failed at line ${String(post.brokenAtLine ?? 0)}`);
            }
            const selfHex = kit.sha256hex(kit.t4Entries(after)[kit.t4Entries(after).length - 1]!.text);
            return [
              `appended ${String(toAppend.length)} entr${toAppend.length === 1 ? "y" : "ies"} to ${ledgerPath}`,
              `kind=${kind} session=${session}`,
              `chain: verified (tail k=3), self sha256=${selfHex}`,
              ...(lock.tookOver ? ["note: a stale T4 lock was taken over before appending"] : []),
            ].join("\n");
          } finally {
            lock.release();
          }
        },
      }),

      // T5: read-only occupancy report (human/display convenience; the guard
      // embeds the same kit logic rather than calling this tool).
      abathur_campaign_status: tool({
        description:
          "Read-only campaign occupancy report: campaign-lock criteria and the /proc write-command disproof " +
          "scan side by side, plus the engine probe mode (LOCK vs FALLBACK-PROBE). Purely observational.",
        args: {},
        execute: async (_args, context) => {
          context.metadata({ title: "abathur campaign status" });
          const dir = input.directory;
          const probe = await probeEngine();
          const lockPath = path.join(process.env["ABATHUR_SELF_REPO"] ?? dir, CAMPAIGN_LOCK_REL);
          const lines = [`mode: ${probe.mode}`, ...probe.notes.map((n) => `probe-note: ${n}`)];
          lines.push(`engine: ${probe.binRealpath ?? "(not on PATH)"} version=${probe.version ?? "unknown"}`);
          if (existsSync(lockPath)) {
            lines.push(`lock: ${lockPath}`);
            try {
              lines.push(`lock-payload: ${readFileSync(lockPath, "utf8").trim()}`);
            } catch {
              lines.push("lock-payload: (unreadable)");
            }
          } else {
            lines.push(`lock: absent (${lockPath})`);
          }
          const hits = scanDisproof(probe.binRealpath, probe.writeCommands);
          lines.push(hits.length === 0 ? "disproof: clean" : `disproof: ${hits.map((h) => `pid ${String(h.pid)} [${h.matched.join(" ")}]`).join("; ")}`);
          const occ = await judgeOccupancy(dir);
          lines.push(`verdict: ${occ.occupied ? (occ.pending ? "OCCUPIED (pending — treat as occupied)" : "OCCUPIED") : "idle"} — ${occ.detail}`);
          return lines.join("\n");
        },
      }),
    },
  }),
};
