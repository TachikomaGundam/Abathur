// abathur-opencode-plugin v0.2.9
// Official opencode plugin adapter for the abathur evolution harness.
// Registers ONE agent tool, `abathur`, that shells out to the abathur CLI —
// argv-only (node:child_process execFile, never a shell), top-level commands
// restricted to an allowlist, hard timeout, capped output. The CLI itself
// remains the human gate; this adapter only lets a session *ask* abathur.
//
// Tier-1 (design: loop/proposals/plugin-tier1-design-20261020.md v9) adds the
// discipline surface around that tool:
//   T1 system-note injection (experimental.chat.system.transform)
//   T2 guard on {edit,write,apply_patch} touching the closed guard surface
//      while a campaign occupancy signal is live (tool.execute.before throw;
//      Phase-0 S1 proved the throw reaches the model) + bash after-warn
//   T3 shell-env injection from the human-keyed manifest (shell.env hook)
//   T4 managed ledger append tool (mkdir-lock mirrored from the engine,
//      forward-chain entries, torn-line repair)
//   T5 read-only occupancy probe tool (same implementation the gate uses)
//   T6 packaged persona via cfg.agent.abathur (config hook)
// allow: SIZE_OK — single-file shipping constraint: the Route-A installer
// byte-copies THIS file and the package-surface pins require the server entry
// and the installer asset to be one file; splitting would break both routes.
//
// V1 plugin format (opencode >= 1.14): default export { id, server }, where
// server(input, options) resolves to Hooks; Hooks.tool is a
// { [name]: ToolDefinition } record (see @opencode-ai/plugin).
// This file is shipped as-is (package.json "files") and reaches a session by
// two routes, neither compiling it through abathur's tsc. Both deliver the
// tool AND the /abathur slash command:
// (A) copied into ~/.config/opencode/plugins/ by `abathur opencode install`,
//     which also drops commands/abathur.md; "@opencode-ai/plugin" then
//     resolves in opencode's config-directory node_modules.
// (B) served as the package's "./server" export when the npm package name is
//     listed in opencode.jsonc "plugin" — opencode's arborist install places
//     @opencode-ai/plugin (runtime dependency) next to the package in its
//     cache, so the same import resolves there too; with no commands/abathur.md
//     on disk, the config hook below self-registers the command instead.

import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  writeSync,
  writeFileSync,
  closeSync,
  fsyncSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { tool, type Config } from "@opencode-ai/plugin";
import type { Hooks, PluginInput } from "@opencode-ai/plugin";

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

// ═══════════════════════════════════════════════════════════════════════════
// Tier-1 shared primitives
// ═══════════════════════════════════════════════════════════════════════════

type Warn = (message: string) => void;
const defaultWarn: Warn = (message) => {
  process.stderr.write(`abathur-plugin: ${message}\n`);
};

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Repo-relative ledger path (design T1/T4: single authoritative location). */
const LEDGER_RELATIVE = path.join(".omo", "evidence", "INTENT-LEDGER.md");
/** Repo-relative campaign lock path — mirrors the engine's CAMPAIGN_LOCK_RELATIVE (src/core/campaign-lock.ts). */
const CAMPAIGN_LOCK_RELATIVE = path.join(".omo", "evidence", "campaign.lock.json");

/**
 * T2 guard surface — closed enumeration, single authoritative source is the
 * design doc (v9 §T2); this constant is its code incarnation. The lock file is
 * ON the surface: it blocks the write tool from overwriting the lock to fake a
 * dead pid into a stale verdict (the engine writes the lock directly and never
 * through edit/write tools, so it is unaffected).
 */
export const GUARD_SURFACE: readonly string[] = [
  path.join("loop", "bank.py"),
  path.join("loop", "draw.py"),
  LEDGER_RELATIVE,
  CAMPAIGN_LOCK_RELATIVE,
];

/** T3 static whitelist fallback (design v9 §T3: true closed enumeration, no prefix wildcards).
 * The authoritative source at runtime is engine-registry.json's injectableAllowlist; this
 * constant is the registry-absent fallback and the pin the consistency test checks against. */
export const STATIC_INJECTABLE_ALLOWLIST: readonly string[] = [
  "PATH",
  "ABATHUR_CONFIG",
  "ABATHUR_SELF_REPO",
  "ABATHUR_HISTORIAN_REPO",
  "ABATHUR_DEBUG",
];

/** Version-probe spawn timeout (design: 2s). */
const PROBE_TIMEOUT_MS = 2_000;
/** Contract re-probe TTL (design: 60s). */
const PROBE_TTL_MS = 60_000;
/** T1 display cache TTL — presentation only; the T2 gate NEVER uses a cached verdict. */
const DISPLAY_TTL_MS = 60_000;
/** Lock freshness window: mtime older than this with a live pid = 占用待裁 (treat occupied + warn). */
const LOCK_FRESH_MS = 15 * 60_000;
/** /proc start-time tolerance (design: proc_start ≤ startedAt ≤ proc_start + 5s). */
const PROC_START_TOLERANCE_S = 5;
/** mkdir-lock stale grace — same value as the engine's STALE_GRACE_MS (src/core/locks.ts:83). */
const STALE_GRACE_MS = 250;
/** T4 lock acquisition budget before fail-closed refusal. */
const T4_LOCK_TIMEOUT_MS = 5_000;
/** Forward-chain verification depth. */
const CHAIN_TAIL_K = 3;
/** T2 override consumption windows. */
const OVERRIDE_WINDOW_MS = 15 * 60_000;
const HUMAN_REF_WINDOW_MS = 24 * 60 * 60_000;
/** T3 manifest location — human-key face, same directory as opencode.jsonc. */
const SHELL_ENV_RELATIVE = path.join(".config", "opencode", "abathur-shell-env.json");

// ───────────────────────────────────────────────────────────────────────────
// Engine contract: version probe + registry (design §占用信号·模式集漂移义务)
// ───────────────────────────────────────────────────────────────────────────

export interface EngineRegistry {
  readonly schemaVersion: number;
  readonly writeCommands: readonly (readonly string[])[];
  readonly readonlyPrefixes: readonly (readonly string[])[];
  readonly envKeys: readonly string[];
  readonly injectableAllowlist?: readonly string[];
}

export type EngineContract =
  | {
      readonly mode: "full";
      readonly engineVersion: string;
      readonly registry: EngineRegistry;
      readonly binRealpath: string | null;
      readonly cliRealpath: string | null;
      readonly registryPath: string;
      readonly injectableAllowlist: readonly string[];
    }
  | {
      readonly mode: "fallback-probe";
      readonly reason: string;
      readonly binRealpath: string | null;
      readonly cliRealpath: string | null;
    };

/**
 * Capability-based gating, NOT semver comparison (design refinement, ledger-recorded):
 * `abathur --version` succeeding is itself a 0.4.0-train capability (the flag did not
 * exist before), and the registry must parse. A main-lineage engine reports 0.2.9 while
 * carrying the full 0.4.0 capability set — a semver gate would misclassify it.
 */
export interface ContractOpts {
  readonly binPath?: string;
  readonly now?: () => Date;
  readonly warn?: Warn;
  readonly probeTimeoutMs?: number;
}

interface ContractCacheEntry {
  readonly key: string;
  readonly atMs: number;
  readonly contract: EngineContract;
}
let contractCache: ContractCacheEntry | null = null;

/** Test seam: drop the cached contract (TTL cache is module-level). */
export function resetContractCache(): void {
  contractCache = null;
}

/** Scan PATH for an executable named `name` — the `command -v` equivalent without a shell. */
function scanPathForBin(name: string): string | null {
  const pathVar = process.env["PATH"] ?? "";
  for (const dir of pathVar.split(":")) {
    if (dir.length === 0) continue;
    const candidate = path.join(dir, name);
    try {
      const st = statSync(candidate);
      if (st.isFile() && (st.mode & 0o111) !== 0) return candidate;
    } catch {
      // not here — keep scanning
    }
  }
  return null;
}

function safeRealpath(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

/** From the resolved engine binary, walk up to the package root and return {registryPath, cliRealpath}. */
function locateRegistry(binReal: string): { registryPath: string; cliRealpath: string | null } | null {
  let dir = path.dirname(binReal);
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(dir, "dist", "engine-registry.json");
    if (existsSync(candidate)) {
      const cli = path.join(dir, "dist", "cli.js");
      return { registryPath: candidate, cliRealpath: safeRealpath(cli) };
    }
    // npm global layout: bin/<name> → ../lib/node_modules/<pkg>/dist/cli.js — the
    // realpath'd bin often IS dist/cli.js, in which case dirname is already dist/.
    const direct = path.join(dir, "engine-registry.json");
    if (path.basename(dir) === "dist" && existsSync(direct)) {
      const cli = path.join(dir, "cli.js");
      return { registryPath: direct, cliRealpath: safeRealpath(cli) };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function parseRegistry(raw: string): EngineRegistry | null {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const rec = value as Record<string, unknown>;
  if (rec["schemaVersion"] !== 1) return null;
  const isPrefixList = (v: unknown): v is readonly (readonly string[])[] =>
    Array.isArray(v) && v.every((entry) => Array.isArray(entry) && entry.every((tok) => typeof tok === "string"));
  if (!isPrefixList(rec["writeCommands"])) return null;
  const envKeys = rec["envKeys"];
  if (!Array.isArray(envKeys) || !envKeys.every((k) => typeof k === "string")) return null;
  const readonlyPrefixes = isPrefixList(rec["readonlyPrefixes"]) ? rec["readonlyPrefixes"] : [];
  const allow = rec["injectableAllowlist"];
  const injectableAllowlist =
    Array.isArray(allow) && allow.every((k) => typeof k === "string") ? (allow as readonly string[]) : undefined;
  return {
    schemaVersion: 1,
    writeCommands: rec["writeCommands"] as readonly (readonly string[])[],
    readonlyPrefixes,
    envKeys: envKeys as readonly string[],
    ...(injectableAllowlist === undefined ? {} : { injectableAllowlist }),
  };
}

export function loadEngineContract(opts: ContractOpts = {}): EngineContract {
  const now = opts.now ?? ((): Date => new Date());
  const warn = opts.warn ?? defaultWarn;
  const timeoutMs = opts.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
  const binPath = opts.binPath ?? resolveBin();
  const found = binPath.includes("/") ? binPath : scanPathForBin(binPath);
  const key = found ?? binPath;
  const atMs = now().getTime();
  if (contractCache !== null && contractCache.key === key && atMs - contractCache.atMs < PROBE_TTL_MS) {
    return contractCache.contract;
  }
  const binReal = found === null ? null : safeRealpath(found);
  let contract: EngineContract;
  if (found === null) {
    contract = { mode: "fallback-probe", reason: `engine binary '${binPath}' not found on PATH`, binRealpath: null, cliRealpath: null };
    warn(`FALLBACK-PROBE: ${contract.reason} — occupancy guard degrades to process disproof only`);
  } else {
    const probe = spawnSync(found, ["--version"], { timeout: timeoutMs, encoding: "utf8" });
    const version = typeof probe.stdout === "string" ? probe.stdout.trim() : "";
    if (probe.status !== 0 || version.length === 0) {
      // Pre-0.4.0-train engines do not know --version; capability gate, not semver gate.
      contract = {
        mode: "fallback-probe",
        reason: `engine at ${found} does not answer --version (pre-0.4.0 train or probe timeout ${String(timeoutMs)}ms)`,
        binRealpath: binReal,
        cliRealpath: null,
      };
      warn(`FALLBACK-PROBE: ${contract.reason} — occupancy guard degrades to process disproof only`);
    } else {
      const located = binReal === null ? null : locateRegistry(binReal);
      if (located === null) {
        contract = {
          mode: "fallback-probe",
          reason: `engine ${version} at ${found} has no dist/engine-registry.json — upgrade the engine`,
          binRealpath: binReal,
          cliRealpath: null,
        };
        warn(`FALLBACK-PROBE: ${contract.reason}`);
      } else {
        let registry: EngineRegistry | null = null;
        try {
          registry = parseRegistry(readFileSync(located.registryPath, "utf8"));
        } catch {
          registry = null;
        }
        if (registry === null) {
          contract = {
            mode: "fallback-probe",
            reason: `engine-registry.json at ${located.registryPath} is corrupt or unknown schema`,
            binRealpath: binReal,
            cliRealpath: located.cliRealpath,
          };
          warn(`FALLBACK-PROBE: ${contract.reason} (fail-closed on key/pattern sets)`);
        } else {
          const fromRegistry = registry.injectableAllowlist;
          let injectableAllowlist: readonly string[];
          if (fromRegistry === undefined) {
            injectableAllowlist = STATIC_INJECTABLE_ALLOWLIST;
            warn(`engine-registry.json lacks injectableAllowlist — falling back to the static five-key allowlist`);
          } else {
            injectableAllowlist = fromRegistry;
          }
          contract = {
            mode: "full",
            engineVersion: version,
            registry,
            binRealpath: binReal,
            cliRealpath: located.cliRealpath,
            registryPath: located.registryPath,
            injectableAllowlist,
          };
        }
      }
    }
  }
  contractCache = { key, atMs, contract };
  return contract;
}

// ───────────────────────────────────────────────────────────────────────────
// Occupancy engine (design §占用信号): lock + heartbeat + process disproof.
// Two channels; ANY idle verdict must clear disproof first.
// ───────────────────────────────────────────────────────────────────────────

export interface LockPayload {
  readonly pid: number;
  readonly startedAt: string;
  readonly runId: string;
  readonly engineVersion: string;
}

export type LockRead =
  | { readonly kind: "absent" }
  | { readonly kind: "corrupt"; readonly reason: string }
  | { readonly kind: "payload"; readonly payload: LockPayload; readonly mtimeMs: number };

export function readLock(lockPath: string): LockRead {
  let raw: string;
  let mtimeMs: number;
  try {
    raw = readFileSync(lockPath, "utf8");
    mtimeMs = statSync(lockPath).mtimeMs;
  } catch {
    return { kind: "absent" };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return { kind: "corrupt", reason: "lock file is not valid JSON" };
  }
  if (typeof value !== "object" || value === null) return { kind: "corrupt", reason: "lock file is not an object" };
  const rec = value as Record<string, unknown>;
  const pid = rec["pid"];
  const startedAt = rec["startedAt"];
  const runId = rec["runId"];
  const engineVersion = rec["engineVersion"];
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return { kind: "corrupt", reason: "pid is not a positive integer" };
  if (typeof startedAt !== "string" || Number.isNaN(Date.parse(startedAt))) return { kind: "corrupt", reason: "startedAt is not an ISO timestamp" };
  if (typeof runId !== "string" || typeof engineVersion !== "string") return { kind: "corrupt", reason: "runId/engineVersion missing" };
  return { kind: "payload", payload: { pid, startedAt, runId, engineVersion }, mtimeMs };
}

/** Six canonical verdict states (design §占用信号 + §测试与验收 "占用六态"). */
export type OccupancyState =
  | "occupied" // lock fresh, pid alive, start-time within tolerance
  | "occupied-pending" // 占用待裁: pid alive but heartbeat stale, or /proc unreadable — treat as occupied + warn
  | "corrupt-occupied" // lock unreadable → fail-closed as occupied
  | "disproof-occupied" // idle-looking lock state, but a live write-face engine process exists (covers silent lock-write failure)
  | "stale-idle" // stale lock candidate cleared by disproof → idle (lock remnant reported)
  | "idle"; // no lock, disproof clear

export interface OccupancyVerdict {
  readonly state: OccupancyState;
  readonly lock: LockPayload | null;
  readonly reason: string;
  readonly disproofHits: readonly string[];
  readonly fallbackProbe: boolean;
}

/** Injectables so tests never touch the real /proc or real processes. */
export interface ProcFacts {
  pidAlive(pid: number): boolean;
  /** Process start as epoch seconds, or null when /proc is unreadable for this pid. */
  procStartEpoch(pid: number): number | null;
  scanCmdlines(): readonly { pid: number; uid: number | null; argv: readonly string[] }[];
}

let clkTckCache: number | null = null;
function clkTck(): number | null {
  if (clkTckCache !== null) return clkTckCache;
  const probe = spawnSync("getconf", ["CLK_TCK"], { timeout: PROBE_TIMEOUT_MS, encoding: "utf8" });
  if (probe.status === 0) {
    const parsed = Number.parseInt(typeof probe.stdout === "string" ? probe.stdout.trim() : "", 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      clkTckCache = parsed;
      return parsed;
    }
  }
  return null;
}

export function realProcFacts(procRoot = "/proc"): ProcFacts {
  return {
    pidAlive(pid: number): boolean {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EPERM") return true; // exists, owned by someone else — alive (design: EPERM 视为活)
        if (code === "ESRCH") return false;
        return true; // unknown error → conservative: treat as alive
      }
    },
    procStartEpoch(pid: number): number | null {
      try {
        const stat = readFileSync(path.join(procRoot, String(pid), "stat"), "utf8");
        // comm (field 2) may contain spaces/parens — locate the LAST ')' (design pin).
        const lastParen = stat.lastIndexOf(")");
        if (lastParen < 0) return null;
        const fields = stat.slice(lastParen + 2).split(" ");
        // After comm: field 3 (state) is index 0 → field 22 (starttime) is index 19.
        const starttimeRaw = fields[19];
        if (starttimeRaw === undefined) return null;
        const starttime = Number.parseFloat(starttimeRaw);
        if (!Number.isFinite(starttime)) return null;
        const tick = clkTck();
        if (tick === null) return null;
        const procStat = readFileSync(path.join(procRoot, "stat"), "utf8");
        const btimeLine = procStat.split("\n").find((line) => line.startsWith("btime "));
        if (btimeLine === undefined) return null;
        const btime = Number.parseFloat(btimeLine.slice(6).trim());
        if (!Number.isFinite(btime)) return null;
        return btime + starttime / tick;
      } catch {
        return null;
      }
    },
    scanCmdlines(): readonly { pid: number; uid: number | null; argv: readonly string[] }[] {
      const out: { pid: number; uid: number | null; argv: readonly string[] }[] = [];
      let entries: string[];
      try {
        entries = readdirSync(procRoot);
      } catch {
        return out;
      }
      const selfUid = typeof process.getuid === "function" ? process.getuid() : null;
      for (const entry of entries) {
        if (!/^\d+$/.test(entry)) continue;
        const pid = Number.parseInt(entry, 10);
        try {
          const st = statSync(path.join(procRoot, entry));
          const uid = st.uid;
          // Cross-user filter: another user's engine process is not our occupancy.
          if (selfUid !== null && uid !== selfUid) continue;
          const raw = readFileSync(path.join(procRoot, entry, "cmdline"));
          const argv = raw.toString("utf8").split("\0").filter((tok) => tok.length > 0);
          if (argv.length === 0) continue;
          out.push({ pid, uid, argv });
        } catch {
          // process vanished mid-scan or unreadable — skip
        }
      }
      return out;
    },
  };
}

/** argv token-exact matching (design pin: 禁子串命中). Returns hit descriptions. */
export function disproofScan(contract: EngineContract, proc: ProcFacts, selfPid: number): readonly string[] {
  // Registry present → authoritative write-face prefixes. FALLBACK-PROBE → frozen
  // pre-0.4.0 prefix set (the drift obligation is suspended with the registry; named
  // in the verdict as fallbackProbe=true so consumers know the set may lag).
  const writePrefixes: readonly (readonly string[])[] =
    contract.mode === "full" ? contract.registry.writeCommands : [["run"], ["promote"], ["readjudicate"], ["tombstone"], ["retract"], ["kernel"], ["opencode"]];
  const identities = new Set<string>();
  if (contract.binRealpath !== null) identities.add(contract.binRealpath);
  if (contract.cliRealpath !== null) identities.add(contract.cliRealpath);
  if (identities.size === 0) {
    const guess = safeRealpath(resolveBin().includes("/") ? resolveBin() : scanPathForBin(resolveBin()) ?? "");
    if (guess !== null && guess.length > 0) identities.add(guess);
  }
  const hits: string[] = [];
  for (const { pid, argv } of proc.scanCmdlines()) {
    if (pid === selfPid) continue; // pgrep 自匹配 / plugin's own process must never count
    const head = argv[0];
    if (head === undefined) continue;
    let sub: readonly string[] | null = null;
    const headReal = safeRealpath(head);
    if (headReal !== null && identities.has(headReal)) {
      // Forms: bare `abathur run`, absolute-path executable, npx/symlink wrapper (realpath 归一).
      sub = argv.slice(1);
    } else if (argv.length >= 2 && /(^|\/)node(\d+)?$/.test(head)) {
      // Form: `node <abs>/dist/cli.js run`
      const scriptReal = safeRealpath(argv[1] ?? "");
      if (scriptReal !== null && identities.has(scriptReal)) sub = argv.slice(2);
    }
    if (sub === null) continue;
    for (const prefix of writePrefixes) {
      if (prefix.length === 0) continue;
      let match = sub.length >= prefix.length;
      for (let i = 0; match && i < prefix.length; i += 1) {
        if (sub[i] !== prefix[i]) match = false;
      }
      if (match) {
        hits.push(`pid ${String(pid)}: ${argv.join(" ")}`);
        break;
      }
    }
  }
  return hits;
}

export interface OccupancyOpts {
  readonly lockPath: string;
  readonly contract: EngineContract;
  readonly now?: () => Date;
  readonly warn?: Warn;
  readonly proc?: ProcFacts;
  readonly selfPid?: number;
}

export function occupancy(opts: OccupancyOpts): OccupancyVerdict {
  const now = opts.now ?? ((): Date => new Date());
  const warn = opts.warn ?? defaultWarn;
  const proc = opts.proc ?? realProcFacts();
  const selfPid = opts.selfPid ?? process.pid;
  const fallbackProbe = opts.contract.mode === "fallback-probe";
  const lockRead = readLock(opts.lockPath);

  const withDisproof = (base: { state: OccupancyState; lock: LockPayload | null; reason: string }): OccupancyVerdict => {
    const hits = disproofScan(opts.contract, proc, selfPid);
    if (hits.length > 0) {
      const note = base.state === "idle" || base.state === "stale-idle"
        ? `${base.reason}; disproof found live write-face engine process(es) — 占用+告警 (covers silent lock-write failure)`
        : base.reason;
      warn(`occupancy: disproof hit — ${hits.join(" | ")}`);
      return { state: "disproof-occupied", lock: base.lock, reason: note, disproofHits: hits, fallbackProbe };
    }
    return { state: base.state, lock: base.lock, reason: base.reason, disproofHits: [], fallbackProbe };
  };

  switch (lockRead.kind) {
    case "corrupt": {
      // fail-closed (design: 锁文件损坏 ⇒ 按占用+告警)
      warn(`occupancy: campaign lock corrupt (${lockRead.reason}) — fail-closed as OCCUPIED`);
      return { state: "corrupt-occupied", lock: null, reason: `lock corrupt: ${lockRead.reason} (fail-closed)`, disproofHits: [], fallbackProbe };
    }
    case "absent": {
      return withDisproof({ state: "idle", lock: null, reason: "no campaign lock present" });
    }
    case "payload": {
      const { payload, mtimeMs } = lockRead;
      const ageMs = now().getTime() - mtimeMs;
      if (!proc.pidAlive(payload.pid)) {
        return withDisproof({
          state: "stale-idle",
          lock: payload,
          reason: `lock holder pid ${String(payload.pid)} is dead (stale candidate) — disproof cleared`,
        });
      }
      const startedEpoch = Date.parse(payload.startedAt) / 1000;
      const procStart = proc.procStartEpoch(payload.pid);
      if (procStart === null) {
        // /proc unreadable ⇒ 占用待裁, never stale (design pin)
        warn(`occupancy: pid ${String(payload.pid)} alive but /proc start-time unreadable — 占用待裁 (treated as occupied)`);
        return { state: "occupied-pending", lock: payload, reason: "pid alive, start-time unverifiable (/proc unreadable) — 占用待裁", disproofHits: [], fallbackProbe };
      }
      if (startedEpoch < procStart || startedEpoch > procStart + PROC_START_TOLERANCE_S) {
        // pid reused by an unrelated process → stale candidate
        return withDisproof({
          state: "stale-idle",
          lock: payload,
          reason: `pid ${String(payload.pid)} alive but start-time outside tolerance (proc_start=${procStart.toFixed(0)} startedAt=${startedEpoch.toFixed(0)}) — pid reuse, stale candidate`,
        });
      }
      if (ageMs > LOCK_FRESH_MS) {
        warn(`occupancy: lock heartbeat stale (${Math.round(ageMs / 60_000)}min > 15min) with live pid — 占用待裁 (treated as occupied)`);
        return { state: "occupied-pending", lock: payload, reason: `pid alive but heartbeat ${Math.round(ageMs / 60_000)}min old — 占用待裁`, disproofHits: [], fallbackProbe };
      }
      return {
        state: "occupied",
        lock: payload,
        reason: `campaign ${payload.runId} (pid ${String(payload.pid)}, engine ${payload.engineVersion}) holds the lock; heartbeat ${Math.round(ageMs / 1000)}s old`,
        disproofHits: [],
        fallbackProbe,
      };
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Repo-root resolution (guard surface + lock + ledger all hang off it)
// ───────────────────────────────────────────────────────────────────────────

/** Candidate repo roots, realpath-deduped: $ABATHUR_SELF_REPO first (authoritative when set),
 * then the session directory ONLY when it is itself an abathur repo (carries the ledger
 * marker) — an unrelated project must never have its same-named files treated as guard
 * surface (repo-identity gate, same marker as T1). */
export function guardRoots(directory: string, env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const roots: string[] = [];
  const push = (candidate: string | undefined): void => {
    if (candidate === undefined || candidate.length === 0) return;
    const real = safeRealpath(candidate) ?? path.resolve(candidate);
    if (!roots.includes(real)) roots.push(real);
  };
  push(env["ABATHUR_SELF_REPO"]);
  const dirReal = safeRealpath(directory) ?? path.resolve(directory);
  if (existsSync(path.join(dirReal, LEDGER_RELATIVE))) push(directory);
  return roots;
}

// ───────────────────────────────────────────────────────────────────────────
// T2 guard surface matching: path equality + (device,inode) equality
// ───────────────────────────────────────────────────────────────────────────

export interface GuardMatch {
  readonly surface: string;
  readonly via: "path" | "inode";
}

function statOrNull(p: string): { dev: number; ino: number } | null {
  try {
    const st = statSync(p);
    return { dev: st.dev, ino: st.ino };
  } catch {
    return null;
  }
}

/**
 * Match a write target against the guard surface under every candidate root.
 * Dimensions (design §T2): normalized path equality AND (device,inode) equality
 * (hardlink bypass closed; residual: bind mounts with different devices — named gap).
 * Missing targets (write creating a new file) match by normalized path against
 * the surface path, since no inode exists yet.
 */
export function matchGuarded(filePath: string, ctxDirectory: string, roots: readonly string[]): GuardMatch | null {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(ctxDirectory, filePath);
  const norm = path.resolve(abs);
  // realpath for existing files; for not-yet-existing targets, realpath the parent dir.
  let real = safeRealpath(norm);
  if (real === null) {
    const parentReal = safeRealpath(path.dirname(norm));
    real = parentReal === null ? null : path.join(parentReal, path.basename(norm));
  }
  const targetStat = statOrNull(real ?? norm);
  for (const root of roots) {
    for (const surface of GUARD_SURFACE) {
      const surfaceAbs = path.resolve(root, surface);
      if (norm === surfaceAbs || (real !== null && real === surfaceAbs)) {
        return { surface, via: "path" };
      }
      const surfaceReal = safeRealpath(surfaceAbs);
      const surfaceStat = surfaceReal === null ? null : statOrNull(surfaceReal);
      if (targetStat !== null && surfaceStat !== null && targetStat.dev === surfaceStat.dev && targetStat.ino === surfaceStat.ino) {
        return { surface, via: "inode" };
      }
    }
  }
  return null;
}

/** Write-target extraction per tool (design §T2: apply_patch enumerates EVERY hunk path). */
export function extractWriteTargets(toolName: string, args: unknown): readonly string[] {
  if (toolName === "edit" || toolName === "write" || toolName === "multiedit") {
    if (typeof args === "object" && args !== null) {
      const rec = args as Record<string, unknown>;
      const fp = rec["filePath"];
      if (typeof fp === "string" && fp.length > 0) return [fp];
    }
    return [];
  }
  if (toolName === "apply_patch") {
    const targets: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === "string") {
        for (const line of value.split("\n")) {
          const m = line.match(/^\*\*\* (?:Add File|Update File|Delete File|Move File to): (.+)$/);
          const name = m?.[1]?.trim();
          if (name !== undefined && name.length > 0) targets.push(name);
        }
      } else if (typeof value === "object" && value !== null) {
        for (const v of Object.values(value as Record<string, unknown>)) collect(v);
      }
    };
    collect(args);
    return targets;
  }
  return [];
}

// ───────────────────────────────────────────────────────────────────────────
// T4 ledger append: mkdir lock (engine protocol mirror) + forward chain + torn repair
// ───────────────────────────────────────────────────────────────────────────

export const T4_KINDS: readonly string[] = ["declaration", "guard-override", "lock-takeover", "evidence-note"];

export interface ChainFields {
  readonly prev: string;
  readonly kind: string;
  readonly sid: string;
  readonly ts: string;
  readonly ref?: string;
  readonly target?: string;
}

export function chainLine(fields: ChainFields): string {
  const parts = [`prev=${fields.prev}`, `kind=${fields.kind}`, `sid=${fields.sid}`, `ts=${fields.ts}`];
  if (fields.ref !== undefined) parts.push(`ref=${fields.ref}`);
  if (fields.target !== undefined) parts.push(`target=${fields.target}`);
  return `<!-- abathur-chain ${parts.join(" ")} -->`;
}

const CHAIN_RE = /^<!-- abathur-chain prev=([0-9a-f]{64}) kind=(\S+) sid=(\S+) ts=(\S+?)(?: ref=([0-9a-f]{64}))?(?: target=(\S+))? -->$/;

export function parseChainLine(line: string): ChainFields | null {
  const m = line.trim().match(CHAIN_RE);
  if (m === null) return null;
  const [, prev, kind, sid, ts, ref, target] = m;
  if (prev === undefined || kind === undefined || sid === undefined || ts === undefined) return null;
  return {
    prev,
    kind,
    sid,
    ts,
    ...(ref === undefined ? {} : { ref }),
    ...(target === undefined ? {} : { target }),
  };
}

/** Entry header shape — T1 title lines and the audit both parse this. */
export const T4_HEADER_RE = /^## \[abathur-t4 kind=(\S+) sid=(\S+) ts=(\S+)]/;

export function resolveLedgerPath(explicit: string | undefined, env: NodeJS.ProcessEnv = process.env): { ledgerPath: string } | { error: string } {
  if (explicit !== undefined && explicit.length > 0) {
    if (!path.isAbsolute(explicit)) return { error: `explicit ledger path must be absolute: ${explicit}` };
    return { ledgerPath: explicit };
  }
  const selfRepo = env["ABATHUR_SELF_REPO"];
  if (selfRepo === undefined || selfRepo.length === 0) {
    // design pin: fail-closed naming the variable
    return { error: "cannot resolve the ledger: $ABATHUR_SELF_REPO is not set and no explicit absolute path was given (fail-closed)" };
  }
  return { ledgerPath: path.join(selfRepo, LEDGER_RELATIVE) };
}

/**
 * Forward-chain verification over the tail: every chain-marked entry among the
 * last k must carry prev == sha256(line immediately before its header). Entries
 * without chain markers are legacy/genesis territory and are skipped.
 */
export function verifyTailChain(content: string, k: number = CHAIN_TAIL_K): { ok: boolean; breakLine: number | null; checked: number } {
  const lines = content.split("\n");
  // Trailing newline produces a final empty element — drop it for indexing.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  let checked = 0;
  for (let i = lines.length - 1; i >= 0 && checked < k; i -= 1) {
    const fields = parseChainLine(lines[i] ?? "");
    if (fields === null) continue;
    // Find this entry's header (nearest preceding T4 header line).
    let headerIdx = -1;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (T4_HEADER_RE.test(lines[j] ?? "")) {
        headerIdx = j;
        break;
      }
      if (parseChainLine(lines[j] ?? "") !== null) break; // previous entry's chain line — stop
    }
    if (headerIdx < 0) return { ok: false, breakLine: i + 1, checked };
    const prevLine = headerIdx === 0 ? "" : (lines[headerIdx - 1] ?? "");
    if (sha256(prevLine) !== fields.prev) return { ok: false, breakLine: i + 1, checked };
    checked += 1;
  }
  return { ok: true, breakLine: null, checked };
}

export interface T4Result {
  readonly ok: boolean;
  readonly error?: string;
  readonly breakLine?: number;
  readonly takeover?: boolean;
  readonly tornRepairedSha?: string;
  readonly chainChecked?: number;
}

interface T4LockHandle {
  readonly lockDir: string;
  readonly tookOver: boolean;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function pidDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/** mkdir-lock acquisition, strictly mirroring the engine protocol (design §T4):
 * ESRCH-dead or owner.json-missing-past-STALE_GRACE are the ONLY takeover conditions;
 * a live holder is never reclaimed regardless of lock age; takeover = renameSync to
 * .stale-<nonce> + re-mkdir + rmSync sweep (never rm+mkdir in place). */
function acquireT4Lock(ledgerPath: string, now: () => Date): T4LockHandle | { error: string } {
  const lockDir = `${ledgerPath}.lock`;
  const ownerFile = path.join(lockDir, "owner.json");
  const deadline = now().getTime() + T4_LOCK_TIMEOUT_MS;
  let tookOver = false;
  for (;;) {
    try {
      mkdirSync(lockDir);
      writeFileSync(ownerFile, `${JSON.stringify({ pid: process.pid, acquiredAt: now().toISOString() })}\n`);
      return { lockDir, tookOver };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        return { error: `cannot create lock dir ${lockDir}: ${(error as Error).message}` };
      }
    }
    // Lock exists — inspect the owner. Takeover conditions are CLOSED (design §T4):
    // holder pid dead (ESRCH), or owner.json missing/malformed AND past STALE_GRACE.
    // A live holder is never reclaimed regardless of lock age.
    let takeover = false;
    let ownerPid: number | null = null;
    try {
      const ownerRaw = readFileSync(ownerFile, "utf8");
      const owner = JSON.parse(ownerRaw) as { pid?: unknown };
      if (typeof owner.pid === "number") ownerPid = owner.pid;
    } catch {
      ownerPid = null; // missing or malformed → grace path below
    }
    if (ownerPid !== null) {
      if (ownerPid === process.pid) {
        return { error: `lock dir ${lockDir} is held by THIS process (reentrant append is a bug)` };
      }
      if (pidDead(ownerPid)) takeover = true; // ESRCH — dead holder
    } else {
      try {
        const ageMs = now().getTime() - statSync(lockDir).mtimeMs;
        if (ageMs > STALE_GRACE_MS) takeover = true;
      } catch {
        takeover = true; // lock dir vanished under us — retry loop will mkdir
      }
    }
    if (takeover) {
      const stale = `${lockDir}.stale-${String(now().getTime())}-${String(process.pid)}`;
      try {
        renameSync(lockDir, stale); // atomic takeover claim
      } catch {
        // Another taker won the race — loop and re-assess.
        if (now().getTime() >= deadline) return { error: `t4 lock timeout (${String(T4_LOCK_TIMEOUT_MS)}ms) on ${lockDir}` };
        sleepSync(50);
        continue;
      }
      try {
        mkdirSync(lockDir);
        writeFileSync(ownerFile, `${JSON.stringify({ pid: process.pid, acquiredAt: now().toISOString(), tookOverFrom: stale })}\n`);
        tookOver = true;
      } catch (error2) {
        return { error: `takeover re-claim failed: ${(error2 as Error).message}` };
      }
      rmSync(stale, { recursive: true, force: true }); // mirror locks.ts:153 sweep
      return { lockDir, tookOver };
    }
    if (now().getTime() >= deadline) {
      return { error: `t4 lock timeout (${String(T4_LOCK_TIMEOUT_MS)}ms): holder is alive — a live holder is never reclaimed` };
    }
    sleepSync(50);
  }
}

function releaseT4Lock(lockDir: string): void {
  // Release requires owner.pid match (design pin).
  try {
    const owner = JSON.parse(readFileSync(path.join(lockDir, "owner.json"), "utf8")) as { pid?: unknown };
    if (owner.pid === process.pid) rmSync(lockDir, { recursive: true, force: true });
  } catch {
    // owner unreadable — leave the dir; the next acquirer's grace logic handles it
  }
}

function appendRaw(ledgerPath: string, text: string): void {
  const fd = openSync(ledgerPath, "a");
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export interface AppendLedgerOpts {
  readonly ledgerPath: string;
  readonly kind: string;
  readonly body: string;
  readonly sessionID: string;
  readonly ref?: string;
  readonly target?: string;
  readonly now?: () => Date;
  readonly warn?: Warn;
}

/** Full managed-append protocol: lock → torn repair → pre-chain verify → O_APPEND+fsync → post-chain verify → release. */
export function appendLedger(opts: AppendLedgerOpts): T4Result {
  const now = opts.now ?? ((): Date => new Date());
  if (!T4_KINDS.includes(opts.kind)) {
    return { ok: false, error: `kind '${opts.kind}' outside the closed whitelist {${T4_KINDS.join(", ")}}` };
  }
  const acquired = acquireT4Lock(opts.ledgerPath, now);
  if ("error" in acquired) return { ok: false, error: acquired.error };
  const { lockDir, tookOver } = acquired;
  try {
    // Torn-line repair (design §T4): crash between write and fsync leaves a half line.
    let tornSha: string | undefined;
    let pre = "";
    try {
      const buf = readFileSync(opts.ledgerPath);
      if (buf.length > 0 && buf[buf.length - 1] !== 0x0a) {
        const lastNl = buf.lastIndexOf(0x0a);
        const torn = buf.subarray(lastNl + 1);
        truncateSync(opts.ledgerPath, lastNl + 1);
        tornSha = sha256(torn.toString("utf8"));
      }
      pre = readFileSync(opts.ledgerPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return { ok: false, error: `cannot read ledger: ${(error as Error).message}` };
      }
      pre = ""; // ledger absent → the append below creates it
    }
    const emit = (kind: string, body: string, extra?: { ref?: string; target?: string }): void => {
      // prev = sha256 of the line immediately before this entry's header ("" for a fresh file).
      const lines = pre.split("\n");
      if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
      const lastLine = lines.length === 0 ? "" : (lines[lines.length - 1] ?? "");
      const ts = now().toISOString();
      const prev = sha256(lastLine);
      const firstBodyLine = body.split("\n")[0] ?? "";
      const header = `## [abathur-t4 kind=${kind} sid=${opts.sessionID} ts=${ts}] ${firstBodyLine}`;
      const fields: ChainFields = {
        prev,
        kind,
        sid: opts.sessionID,
        ts,
        ...(extra?.ref === undefined ? {} : { ref: extra.ref }),
        ...(extra?.target === undefined ? {} : { target: extra.target }),
      };
      const restLines = body.split("\n").slice(1);
      const block = [header, ...restLines, chainLine(fields), ""].join("\n");
      // Torn repair above guarantees the file is empty or ends with '\n'.
      const separator = pre.length > 0 && !pre.endsWith("\n") ? "\n" : "";
      appendRaw(opts.ledgerPath, `${separator}${block}`);
      pre = `${pre}${separator}${block}`;
    };
    if (tornSha !== undefined) {
      emit("evidence-note", `torn-line repair: truncated incomplete tail bytes (sha256 of removed bytes: ${tornSha}) before appending`);
    }
    if (tookOver) {
      emit("lock-takeover", `t4 lock takeover: previous holder dead or owner.json missing past ${String(STALE_GRACE_MS)}ms grace (rename-then-reclaim, engine protocol mirror)`);
    }
    // Pre-append chain verification — refuse BEFORE writing when the tail is already broken.
    const preVerify = verifyTailChain(pre);
    if (!preVerify.ok) {
      return {
        ok: false,
        error: "ledger tail chain verification failed — refusing to append (fail-closed)",
        ...(preVerify.breakLine === null ? {} : { breakLine: preVerify.breakLine }),
      };
    }
    emit(opts.kind, opts.body, {
      ...(opts.ref === undefined ? {} : { ref: opts.ref }),
      ...(opts.target === undefined ? {} : { target: opts.target }),
    });
    const post = readFileSync(opts.ledgerPath, "utf8");
    const postVerify = verifyTailChain(post);
    if (!postVerify.ok) {
      return {
        ok: false,
        error: "read-back chain verification failed after append (fail-closed)",
        ...(postVerify.breakLine === null ? {} : { breakLine: postVerify.breakLine }),
      };
    }
    return {
      ok: true,
      takeover: tookOver,
      ...(tornSha === undefined ? {} : { tornRepairedSha: tornSha }),
      chainChecked: postVerify.checked,
    };
  } finally {
    releaseT4Lock(lockDir);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// T2 override consumption (four verifications, design §T2 — 缺一拒放)
// ───────────────────────────────────────────────────────────────────────────

export interface OverrideVerdict {
  readonly allowed: boolean;
  readonly reason: string;
  readonly entryLine?: number;
}

const HUMAN_APPROVAL_RE = /人类批准|机主|owner批准|批准条目|逐字/;
const LINE_TS_RE = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/;

function lineTimestamp(line: string): number | null {
  const m = line.match(LINE_TS_RE);
  if (m === null || m[1] === undefined) return null;
  const parsed = Date.parse(m[1]);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Find the newest guard-override entry authorizing THIS session + THIS target and
 * run the four verifications:
 *  ① ref hash locates a human-approval ledger line, ≤24h old, naming the target file
 *  ② override sid === current write session
 *  ③ override ts ≤15min old
 *  ④ override entry passes the tail k=3 forward-chain verification
 * Named gap G-OVERRIDE-FORGE (design): the plugin cannot mechanically prove the
 * referenced line truly came from a human — a bash-written fake is only caught
 * by after-the-fact audit. Strength = locatable human trace + raised forging
 * cost + audit accountability, NOT cryptographic verification.
 */
export function findGuardOverride(opts: {
  ledgerPath: string;
  sessionID: string;
  targetSurface: string;
  now: () => Date;
}): OverrideVerdict {
  let content: string;
  try {
    content = readFileSync(opts.ledgerPath, "utf8");
  } catch {
    return { allowed: false, reason: "ledger unreadable — override cannot be verified (fail-closed)" };
  }
  const lines = content.split("\n");
  const nowMs = opts.now().getTime();
  const tailVerify = verifyTailChain(content);
  // Scan from the tail for the newest matching override entry.
  let chainSeen = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const fields = parseChainLine(lines[i] ?? "");
    if (fields === null) continue;
    chainSeen += 1;
    if (fields.kind !== "guard-override") continue;
    const headerIdx = (() => {
      for (let j = i - 1; j >= 0; j -= 1) {
        if (T4_HEADER_RE.test(lines[j] ?? "")) return j;
        if (parseChainLine(lines[j] ?? "") !== null) return -1;
      }
      return -1;
    })();
    if (headerIdx < 0) continue;
    // ② session identity
    if (fields.sid !== opts.sessionID) continue; // not ours — keep scanning for one that is
    // ③ freshness
    const entryTs = Date.parse(fields.ts);
    if (Number.isNaN(entryTs) || nowMs - entryTs > OVERRIDE_WINDOW_MS) {
      return { allowed: false, reason: `③ override entry older than 15min (ts=${fields.ts}) — refuse`, entryLine: headerIdx + 1 };
    }
    // target binding
    if (fields.target !== opts.targetSurface) continue;
    // ④ chain membership: entry must sit inside the verified tail (k=3) and the tail must verify
    if (!tailVerify.ok) {
      return { allowed: false, reason: `④ ledger tail chain broken at line ${String((tailVerify.breakLine ?? 0) + 1)} — override cannot be trusted (fail-closed)`, entryLine: headerIdx + 1 };
    }
    if (chainSeen > CHAIN_TAIL_K) {
      return { allowed: false, reason: `④ override entry lies outside the verified tail (k=${String(CHAIN_TAIL_K)}) — a lone entry off-chain is refused`, entryLine: headerIdx + 1 };
    }
    // ① human-approval reference
    const ref = fields.ref;
    if (ref === undefined) {
      return { allowed: false, reason: "① override entry cites no human-approval line hash (ref=…) — refuse", entryLine: headerIdx + 1 };
    }
    let refFound = false;
    for (const line of lines) {
      if (sha256(line) !== ref) continue;
      refFound = true;
      const refTs = lineTimestamp(line);
      if (refTs === null || nowMs - refTs > HUMAN_REF_WINDOW_MS) {
        return { allowed: false, reason: "① cited human-approval line has no parsable timestamp or is older than 24h — refuse", entryLine: headerIdx + 1 };
      }
      if (!HUMAN_APPROVAL_RE.test(line)) {
        return { allowed: false, reason: "① cited line carries no human-approval marker (人类批准/机主/批准条目/逐字) — refuse", entryLine: headerIdx + 1 };
      }
      const targetBase = path.basename(opts.targetSurface);
      if (!line.includes(opts.targetSurface) && !line.includes(targetBase)) {
        return { allowed: false, reason: `① cited approval does not name the target file (${opts.targetSurface}) — approval is per-file, refuse`, entryLine: headerIdx + 1 };
      }
      break;
    }
    if (!refFound) {
      return { allowed: false, reason: "① ref hash does not locate any ledger line — refuse", entryLine: headerIdx + 1 };
    }
    return { allowed: true, reason: "override verified ①②③④ (per-file, per-24h-window authorization; every pass is logged)", entryLine: headerIdx + 1 };
  }
  return { allowed: false, reason: "no guard-override entry for this session+target found in the ledger" };
}

// ───────────────────────────────────────────────────────────────────────────
// T1 system note (display face — the gate's trust NEVER comes from here)
// ───────────────────────────────────────────────────────────────────────────

const SYSTEM_NOTE_CAP_BYTES = 2048;

/** Byte-safe UTF-8 truncation. String.slice counts UTF-16 code units while the cap is
 * in UTF-8 bytes (CJK = 3 bytes/char), so a char-slice can overshoot the byte cap.
 * Shrink in chunks until under budget, then drop a dangling high surrogate at the cut. */
function truncateUtf8(text: string, maxBytes: number): string {
  let out = text.slice(0, Math.max(0, maxBytes));
  while (Buffer.byteLength(out, "utf8") > maxBytes) {
    out = out.slice(0, Math.max(0, out.length - 32));
  }
  const lastUnit = out.charCodeAt(out.length - 1);
  if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) out = out.slice(0, out.length - 1);
  return out;
}

function ledgerTailTitles(ledgerPath: string, n = 3): readonly string[] {
  let content: string;
  try {
    content = readFileSync(ledgerPath, "utf8");
  } catch {
    return [];
  }
  const headers = content.split("\n").filter((line) => line.startsWith("## ["));
  if (headers.length > 0) return headers.slice(-n);
  const nonEmpty = content.split("\n").filter((line) => line.trim().length > 0);
  return nonEmpty.slice(-n).map((line) => (line.length > 160 ? `${line.slice(0, 157)}...` : line));
}

interface NoteCacheEntry {
  readonly atMs: number;
  readonly text: string;
}
const noteCache = new Map<string, NoteCacheEntry>();

export function buildSystemNote(opts: {
  repoRoot: string;
  directory: string;
  contract: EngineContract;
  now: () => Date;
  warn?: Warn;
}): string {
  const cacheKey = opts.repoRoot;
  const atMs = opts.now().getTime();
  const cached = noteCache.get(cacheKey);
  if (cached !== undefined && atMs - cached.atMs < DISPLAY_TTL_MS) return cached.text;
  let text: string;
  try {
    const ledgerPath = path.join(opts.repoRoot, LEDGER_RELATIVE);
    const verdict = occupancy({
      lockPath: path.join(opts.repoRoot, CAMPAIGN_LOCK_RELATIVE),
      contract: opts.contract,
      now: opts.now,
      warn: opts.warn ?? defaultWarn,
    });
    const mode = verdict.fallbackProbe ? `FALLBACK-PROBE (${opts.contract.mode === "fallback-probe" ? opts.contract.reason : "degraded"})` : `full (engine ${opts.contract.mode === "full" ? opts.contract.engineVersion : "?"})`;
    const lockDesc = verdict.lock === null ? "无锁" : `pid=${String(verdict.lock.pid)} runId=${verdict.lock.runId} startedAt=${verdict.lock.startedAt} engineVersion=${verdict.lock.engineVersion}`;
    const parts = [
      "[abathur] 开工状态注入 (T1 展示面; 闸的信任永不来自本块)",
      `模式: ${mode}`,
      `占用: ${verdict.state} — ${verdict.reason} [${lockDesc}]`,
    ];
    if (verdict.disproofHits.length > 0) parts.push(`反证命中: ${verdict.disproofHits.join(" | ")}`);
    parts.push("账本尾 3 条:");
    for (const title of ledgerTailTitles(ledgerPath)) parts.push(`  ${title.slice(0, 300)}`);
    text = parts.join("\n");
  } catch {
    text = "[abathur] 状态未取到";
  }
  if (Buffer.byteLength(text, "utf8") > SYSTEM_NOTE_CAP_BYTES) {
    text = `${truncateUtf8(text, SYSTEM_NOTE_CAP_BYTES - 20)}\n[truncated]`;
  }
  noteCache.set(cacheKey, { atMs, text });
  return text;
}

/** Test seam: clear the T1 display cache. */
export function resetNoteCache(): void {
  noteCache.clear();
}

// ───────────────────────────────────────────────────────────────────────────
// T3 shell-env injection (position IS the trust anchor)
// ───────────────────────────────────────────────────────────────────────────

export interface ShellEnvOpts {
  readonly directory: string;
  readonly home?: string;
  readonly warn?: Warn;
  readonly contract?: EngineContract;
}

export function shellEnvFor(opts: ShellEnvOpts): Record<string, string> | null {
  const warn = opts.warn ?? defaultWarn;
  const home = opts.home ?? process.env["HOME"] ?? homedir();
  const manifestPath = path.join(home, SHELL_ENV_RELATIVE);
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  } catch {
    if (existsSync(manifestPath)) warn(`abathur-shell-env.json at ${manifestPath} is malformed — ignored (injection skipped, session not blocked)`);
    return null;
  }
  if (typeof manifest !== "object" || manifest === null) return null;
  const rec = manifest as Record<string, unknown>;
  const repoRoot = rec["repoRoot"];
  if (typeof repoRoot !== "string" || repoRoot.length === 0) return null; // no pin → no injection
  const env = rec["env"];
  if (typeof env !== "object" || env === null) return null;
  const pinnedReal = safeRealpath(repoRoot);
  const dirReal = safeRealpath(opts.directory);
  if (pinnedReal === null || dirReal === null || pinnedReal !== dirReal) return null;
  const allowlist =
    opts.contract !== undefined && opts.contract.mode === "full"
      ? opts.contract.injectableAllowlist
      : STATIC_INJECTABLE_ALLOWLIST;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
    if (!allowlist.includes(key)) {
      warn(`abathur-shell-env.json key '${key}' is outside the closed allowlist — rejected`);
      continue;
    }
    if (typeof value !== "string") {
      warn(`abathur-shell-env.json key '${key}' value is not a string — rejected`);
      continue;
    }
    out[key] = key === "PATH" ? `${value}:${process.env["PATH"] ?? ""}` : value; // PATH prepend-only
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// T6 packaged persona (single source; zero machine-local paths — D7 discipline)
// ───────────────────────────────────────────────────────────────────────────

const AGENT_PERSONA_PROMPT = `You are Abathur, the institutional evolution driver's operating seat.

Your constitution is the Abathur seat doctrine in the USER-LEVEL AGENTS.md (already loaded
into your session — it is the single source of truth). If it is absent, STOP and say so
instead of improvising a persona.

Hard lines (non-negotiable, details live in the doctrine):
- Never self-approve promotions; promote/tombstone/retract belong to a human terminal.
- Every "done" claim carries a machine receipt taken from the system clock, never from memory.
- Before mutating harness state, consult institutional memory per the doctrine.
- Verbatim-authorized instructions are executed, then verified by reading back actual output.

Prefer the \`abathur\` tool for CLI work, \`abathur_campaign_status\` before touching
guard-surface files, and \`abathur_ledger_append\` as the ONLY managed write channel to
the intent ledger.`;

// ═══════════════════════════════════════════════════════════════════════════
// Slash-command template (byte-mirror pin: src/test/opencode.test.ts)
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// Plugin entry
// ═══════════════════════════════════════════════════════════════════════════

const WRITE_TOOLS: readonly string[] = ["edit", "write", "apply_patch", "multiedit"];

function blockText(verdict: OccupancyVerdict, target: string, overrideReason: string): string {
  const lines = [
    `abathur guard (T2): REFUSED write to guard-surface file '${target}'.`,
    `occupancy=${verdict.state} — ${verdict.reason}`,
  ];
  if (verdict.fallbackProbe) lines.push("mode=FALLBACK-PROBE (engine <0.4.0 capability — disproof channel is primary)");
  for (const hit of verdict.disproofHits) lines.push(`disproof: ${hit}`);
  lines.push(
    "The exam bank / ledger / lock are frozen while a campaign is occupied (queue, never write).",
    `override attempt failed: ${overrideReason}`,
    "Lawful override path: a human approval ledger line (≤24h, naming this file) + abathur_ledger_append kind=guard-override with ref=<sha256 of that line> and target=<file>, from THIS session, consumed within 15min.",
  );
  return lines.join("\n");
}

export default {
  id: "abathur",
  server: async (input: PluginInput) => {
    const sessionDirectory = input.directory;
    const sharedNow = (): Date => new Date();
    const contract = (): EngineContract => loadEngineContract({ now: sharedNow });
    const primaryRoot = (): string => {
      const selfRepo = process.env["ABATHUR_SELF_REPO"];
      if (selfRepo !== undefined && selfRepo.length > 0) return safeRealpath(selfRepo) ?? selfRepo;
      return safeRealpath(sessionDirectory) ?? sessionDirectory;
    };

    // Hooks-typed literal: parameter shapes come from the host interface (its own
      // `args: any` surface), so this file writes no local `any`.
    const hooks: Hooks = {
      // Self-registering /abathur + T6 packaged persona: opencode calls hook.config(cfg)
      // once per instance after ALL config sources are merged — file-based commands are
      // already in cfg.command by then (config.ts merges {command,commands}/**/*.md;
      // the hook fires from plugin/index.ts after config.get()). `??=` keeps a
      // Route-A commands/abathur.md authoritative (identical behaviour to 0.2.2)
      // and only fills the gap for Route B; the command map is keyed by name, so a
      // same-name file + injection never duplicates the entry. Proven upstream
      // mechanism: opencode-acp registers its /acp command exactly this way.
      config: async (cfg: Config) => {
        cfg.command ??= {};
        cfg.command.abathur ??= {
          description: "Drive the abathur evolution harness (usage: /abathur <command> [args...])",
          template: COMMAND_TEMPLATE,
        };
        // T6: persona single source = this package (one-way derivation). A user-level
        // agents/abathur*.md (Tier-0) takes precedence when present — `??=` never
        // overwrites a configured agent; the packaged persona only fills the gap.
        const cfgRec = cfg as unknown as Record<string, unknown>;
        const agents = (cfgRec["agent"] ??= {}) as Record<string, unknown>;
        agents["abathur"] ??= {
          description: "Abathur evolution-harness operating seat (packaged persona; constitution lives in the user-level AGENTS.md)",
          prompt: AGENT_PERSONA_PROMPT,
        };
      },

      // T2: the gate. Fresh occupancy read on EVERY guarded write call — never cached.
      "tool.execute.before": async (hookInput, output) => {
        if (!WRITE_TOOLS.includes(hookInput.tool)) return;
        const ctxDirectory = sessionDirectory;
        const roots = guardRoots(ctxDirectory);
        const targets = extractWriteTargets(hookInput.tool, output.args);
        const guarded: { target: string; match: GuardMatch }[] = [];
        for (const target of targets) {
          const match = matchGuarded(target, ctxDirectory, roots);
          if (match !== null) guarded.push({ target, match });
        }
        if (guarded.length === 0) return;
        const root = primaryRoot();
        const verdict = occupancy({
          lockPath: path.join(root, CAMPAIGN_LOCK_RELATIVE),
          contract: contract(),
          now: sharedNow,
        });
        const occupiedStates: readonly OccupancyState[] = ["occupied", "occupied-pending", "corrupt-occupied", "disproof-occupied"];
        if (!occupiedStates.includes(verdict.state)) return; // idle family: writes allowed
        const resolvedLedger = resolveLedgerPath(undefined);
        const ledgerPath = "ledgerPath" in resolvedLedger ? resolvedLedger.ledgerPath : path.join(root, LEDGER_RELATIVE);
        for (const entry of guarded) {
          const override = findGuardOverride({
            ledgerPath,
            sessionID: hookInput.sessionID,
            targetSurface: entry.match.surface,
            now: sharedNow,
          });
          if (!override.allowed) {
            // Phase-0 S1: throwing here blocks the call AND the message reaches the model.
            throw new Error(blockText(verdict, entry.target, override.reason));
          }
          // Allowed — every pass leaves an auditable gate-decision line (best effort).
          appendLedger({
            ledgerPath,
            kind: "evidence-note",
            body: `guard-override consumed: session ${hookInput.sessionID} wrote '${entry.match.surface}' under occupancy=${verdict.state} (override entry line ${String(override.entryLine ?? 0)})`,
            sessionID: hookInput.sessionID,
            now: sharedNow,
          });
        }
      },

      // T2 compensation layer: bash is NOT gate-managed (named bypass) — warn-only
      // heuristic when command text mentions a guard-surface file name.
      "tool.execute.after": async (hookInput, output) => {
        if (hookInput.tool !== "bash") return;
        const command = typeof hookInput.args?.command === "string" ? hookInput.args.command : "";
        if (command.length === 0) return;
        const mentioned = GUARD_SURFACE.filter((surface) => command.includes(path.basename(surface)));
        if (mentioned.length === 0) return;
        const extra = command.includes("campaign.lock.json") && /\brm\b/.test(command) ? " (rm against the campaign lock — occupancy-signal destruction is an incident-class act)" : "";
        output.output += `\n[abathur-guard] warning: bash command text mentions guard-surface file(s): ${mentioned.join(", ")}${extra}. The bash bypass is not gate-managed (named residual); the ledger-declaration obligation for lawful writes remains at the rule layer.`;
      },

      // T3: human-keyed manifest at ~/.config/opencode/abathur-shell-env.json; injection
      // only when PluginOptions-pinned repoRoot matches this call's cwd by realpath.
      "shell.env": async (hookInput, output) => {
        const injected = shellEnvFor({ directory: hookInput.cwd ?? sessionDirectory, contract: contract() });
        if (injected === null) return;
        for (const [key, value] of Object.entries(injected)) output.env[key] = value;
      },

      // T1: startup-state injection. Gate: the session directory carries the ledger.
      // S2 hard constraint: merge into system[0] ONLY — never add a second system message.
      "experimental.chat.system.transform": async (_hookInput, output) => {
        const dirReal = safeRealpath(sessionDirectory) ?? sessionDirectory;
        if (!existsSync(path.join(dirReal, LEDGER_RELATIVE))) return; // outside the gate: zero injection
        const note = buildSystemNote({ repoRoot: dirReal, directory: dirReal, contract: contract(), now: sharedNow });
        if (output.system.length === 0) {
          output.system.push(note);
          return;
        }
        const head = output.system[0] ?? "";
        output.system[0] = `${head}\n\n${note}`;
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

        // T5: read-only occupancy probe — same implementation the gate uses (single source),
        // reports both channels side by side for humans and for T1 display.
        abathur_campaign_status: tool({
          description:
            "Read-only probe of the abathur campaign occupancy signal: the campaign lock " +
            "verdict AND the independent process-disproof channel, side by side, from the " +
            "same implementation the write gate uses. Call this before touching guard-surface " +
            "files (loop/bank.py, loop/draw.py, the intent ledger, the campaign lock) or when " +
            "asked whether a campaign is running. Never mutates anything.",
          args: {
            repo: tool.schema
              .string()
              .optional()
              .describe("repo root to probe (default: $ABATHUR_SELF_REPO, else the session directory)"),
          },
          execute: async (args, context) => {
            context.metadata({ title: "abathur campaign status" });
            const root = args.repo !== undefined && args.repo.length > 0
              ? (safeRealpath(args.repo) ?? args.repo)
              : primaryRoot();
            const c = contract();
            const lockPath = path.join(root, CAMPAIGN_LOCK_RELATIVE);
            const verdict = occupancy({ lockPath, contract: c, now: sharedNow });
            const lockRead = readLock(lockPath);
            const sections = [
              `repo: ${root}`,
              `mode: ${c.mode === "full" ? `full — engine ${c.engineVersion}, registry ${c.registryPath} (sha256 ${sha256(readFileSync(c.registryPath, "utf8"))})` : `FALLBACK-PROBE — ${c.mode === "fallback-probe" ? c.reason : "?"}`}`,
              `channel 1 (lock): ${lockRead.kind === "payload" ? JSON.stringify(lockRead.payload) : lockRead.kind}`,
              `channel 2 (disproof): ${verdict.disproofHits.length === 0 ? "no live write-face engine process matched" : verdict.disproofHits.join(" | ")}`,
              `verdict: ${verdict.state} — ${verdict.reason}`,
            ];
            return sections.join("\n");
          },
        }),

        // T4: the ONLY managed write channel to the intent ledger.
        abathur_ledger_append: tool({
          description:
            "Append an entry to the abathur intent ledger through the managed channel: " +
            "mkdir-lock mutual exclusion (engine protocol mirror), torn-line repair, " +
            "forward-chain verification (fail-closed), session-ID audit binding. The kind " +
            "is a closed whitelist: declaration, guard-override, lock-takeover, " +
            "evidence-note. HUMAN APPROVAL entries never go through this tool — they are " +
            "terminal-written. guard-override entries are consumed by the write gate " +
            "(four verifications) and require ref=sha256 of a human-approval ledger line " +
            "(≤24h, naming the target file) plus target=the guard-surface file.",
          args: {
            kind: tool.schema
              .enum(["declaration", "guard-override", "lock-takeover", "evidence-note"])
              .describe("entry kind (closed whitelist)"),
            body: tool.schema.string().describe("entry body text (first line becomes the title line)"),
            ref: tool.schema
              .string()
              .optional()
              .describe("guard-override only: sha256 of the cited human-approval ledger line"),
            target: tool.schema
              .string()
              .optional()
              .describe("guard-override only: the guard-surface file being authorized (repo-relative)"),
            path: tool.schema
              .string()
              .optional()
              .describe("explicit ABSOLUTE ledger path (default: $ABATHUR_SELF_REPO/.omo/evidence/INTENT-LEDGER.md)"),
          },
          execute: async (args, context) => {
            context.metadata({ title: `ledger append (${args.kind})` });
            const resolved = resolveLedgerPath(args.path);
            if ("error" in resolved) return `abathur_ledger_append: ${resolved.error}`;
            const result = appendLedger({
              ledgerPath: resolved.ledgerPath,
              kind: args.kind,
              body: args.body,
              sessionID: context.sessionID,
              ...(args.ref === undefined ? {} : { ref: args.ref }),
              ...(args.target === undefined ? {} : { target: args.target }),
              now: sharedNow,
            });
            if (!result.ok) {
              const where = result.breakLine === undefined ? "" : ` (chain break at line ${String(result.breakLine)})`;
              return `abathur_ledger_append: REFUSED — ${result.error ?? "unknown"}${where}`;
            }
            const extras: string[] = [];
            if (result.takeover === true) extras.push("lock-takeover occurred (previous holder dead/stale)");
            if (result.tornRepairedSha !== undefined) extras.push(`torn line repaired (removed-bytes sha256 ${result.tornRepairedSha})`);
            extras.push(`tail chain verified (k=${String(result.chainChecked ?? 0)})`);
            return `abathur_ledger_append: appended kind=${args.kind} to ${resolved.ledgerPath} — ${extras.join("; ")}`;
          },
        }),
      },
    };
    return hooks;
  },
};
