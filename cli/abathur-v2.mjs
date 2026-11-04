#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadRegistry, validateRegistry } from "../kernel/planning/registry.mjs";
import { generateRules } from "../kernel/planning/generate.mjs";
import { examIds, findItem } from "../exam/bank.mjs";
import { draw } from "../exam/draw.mjs";
import { runExam } from "../exam/runner.mjs";
import { verifyChain, sha256File, appendEntry } from "../kernel/evidence/index.mjs";
import { anchor, mirrorGeneration } from "../kernel/evidence/anchor.mjs";
import { reclaim, retention, watermark } from "../kernel/hygiene/index.mjs";
import { DEFAULT_LANES, attributeWrite, foreignWrite } from "../kernel/lane/index.mjs";
import { gate } from "../kernel/gate/index.mjs";
import { loadIdentities, checkCommitIdentity } from "../kernel/identity/index.mjs";
import { checkInside, deny, resolveRun, reconcileRuns, stateDir } from "../kernel/surface/index.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

function usage(code = 2) {
  const text = `usage: abathur <command> [options]

commands:
  rules validate
  rules generate [--out <path>]
  surface show
  surface check <path>
  gate run
  exam draw --seed <seed> [--count <n>] [--canary]
  exam run <item-id> --mode bell|live
  evidence verify <ledger>
  evidence anchor <ledger>
  evidence mirror <root>
  hygiene reclaim <manifest.json>
  hygiene retention <dir> --keep <n>
  hygiene watermark <path> --max-bytes <n>
  lane check <path>
  lane attribute <path> --actor <name> --ts <iso> [--identity-ok]
  plan check <plan.md>
  promote|tombstone|publish [--id <id>]  (human gate: prints a prescription)
`;
  process.stdout.write(text);
  return code;
}

function parseFlags(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      rest.push(token);
    }
  }
  return { flags, rest };
}

function cmdRules(rest, flags) {
  if (rest[0] === "validate") {
    const registry = loadRegistry();
    const problems = validateRegistry(registry, examIds());
    if (problems.length) {
      for (const problem of problems) process.stdout.write(`RULE VIOLATION: ${problem}\n`);
      process.stdout.write(`RULES INVALID n=${problems.length} rc=1\n`);
      return 1;
    }
    process.stdout.write(`RULES OK clauses=${registry.clauses.length} sha256=${registry.sha256} rc=0\n`);
    return 0;
  }
  if (rest[0] === "generate") {
    const result = generateRules(undefined);
    const out = flags.out ? resolve(flags.out) : resolve(ROOT, "rules/generated/RULES.md");
    const run = resolveRun();
    if (!run.ok) {
      process.stdout.write(`${JSON.stringify({ rc: 2, code: run.code, detail: run.detail })}\n`);
      return 2;
    }
    const roots = [run.record.root, stateDir()];
    const bounds = checkInside(out, roots);
    if (!bounds.ok) {
      const refusal = deny("rules.generate", bounds.target ?? out, roots);
      process.stdout.write(`${JSON.stringify(refusal)}\n`);
      return refusal.rc;
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, result.text);
    process.stdout.write(`GENERATED ${out} sha256=${result.sha256} registry=${result.registrySha256} rc=0\n`);
    return 0;
  }
  return usage();
}

function cmdGate(rest) {
  if (rest[0] !== "run") return usage();
  if (process.env.ABATHUR_GATE_NESTED === "1") {
    process.stdout.write("GATE NESTED: refusing to run a gate inside a gate check rc=2\n");
    return 2;
  }
  const registry = loadRegistry();
  const problems = validateRegistry(registry, examIds());
  if (problems.length) {
    for (const problem of problems) process.stdout.write(`GATE BLOCKED: ${problem}\n`);
    return 1;
  }
  let failed = 0;
  for (const clause of registry.clauses) {
    const result = spawnSync("/bin/sh", ["-c", clause.check.cmd], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, ABATHUR_GATE_NESTED: "1" },
    });
    const rc = result.status ?? 1;
    if (rc !== clause.check.expect_rc) {
      failed += 1;
      process.stdout.write(`CHECK FAILED ${clause.id} rc=${rc} expected=${clause.check.expect_rc}\n`);
    }
  }
  process.stdout.write(`GATE ${failed === 0 ? "GREEN" : "RED"} clauses=${registry.clauses.length} failed=${failed} rc=${failed === 0 ? 0 : 1}\n`);
  return failed === 0 ? 0 : 1;
}

function cmdExam(rest, flags) {
  if (rest[0] === "draw") {
    if (!flags.seed) return usage();
    const ids = draw({ seed: String(flags.seed), count: flags.count ? Number(flags.count) : undefined, canary: Boolean(flags.canary) });
    process.stdout.write(`${JSON.stringify({ seed: String(flags.seed), ids })}\n`);
    return 0;
  }
  if (rest[0] === "run") {
    const item = findItem(rest[1]);
    if (!item) {
      process.stdout.write(`EXAM UNKNOWN ITEM ${String(rest[1])} rc=1\n`);
      return 1;
    }
    const mode = flags.mode === "live" ? "live" : "bell";
    const result = runExam({ item, mode });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.rc;
  }
  return usage();
}

function cmdEvidence(rest, flags) {
  if (rest[0] === "verify") {
    const path = rest[1] ?? flags.ledger;
    if (!path) return usage();
    const problems = verifyChain(path);
    if (problems.length) {
      for (const problem of problems) process.stdout.write(`CHAIN VIOLATION: ${problem}\n`);
      return 1;
    }
    process.stdout.write(`CHAIN OK ${path} sha256=${sha256File(path)} rc=0\n`);
    return 0;
  }
  if (rest[0] === "anchor") {
    const path = rest[1];
    if (!path) return usage();
    const problems = verifyChain(path);
    if (problems.length) return 1;
    const result = anchor(sha256File(path));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.rc;
  }
  if (rest[0] === "mirror") {
    const root = rest[1];
    if (!root) return usage();
    const mirror = mirrorGeneration(root);
    process.stdout.write(`${JSON.stringify({ root: mirror.root, count: mirror.count, digest: mirror.digest })}\n`);
    return 0;
  }
  return usage();
}

function cmdHygiene(rest, flags) {
  if (rest[0] === "reclaim") {
    const path = rest[1];
    if (!path) return usage();
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    const result = reclaim(manifest.root ?? "/tmp", manifest);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.rc;
  }
  if (rest[0] === "retention") {
    const dir = rest[1];
    const keep = Number(flags.keep ?? 0);
    if (!dir) return usage();
    const result = retention(dir, keep);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.rc;
  }
  if (rest[0] === "watermark") {
    const path = rest[1];
    const maxBytes = Number(flags["max-bytes"] ?? 0);
    if (!path) return usage();
    const result = watermark(path, maxBytes);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.rc;
  }
  return usage();
}

function cmdLane(rest, flags) {
  if (rest[0] === "check") {
    const path = rest[1];
    if (!path) return usage();
    const result = foreignWrite(DEFAULT_LANES, path);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.foreign ? 1 : 0;
  }
  if (rest[0] === "attribute") {
    const path = rest[1];
    if (!path) return usage();
    const identity = flags["identity-ok"] ? { status: "ATTRIBUTED" } : { status: "UNATTRIBUTED" };
    const result = attributeWrite(DEFAULT_LANES, {
      path,
      actor: flags.actor,
      ts: flags.ts,
      identity,
      contentOwner: flags["content-owner"],
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.status === "ATTRIBUTED" ? 0 : 2;
  }
  return usage();
}

function cmdSurface(rest) {
  const run = resolveRun();
  if (rest[0] === "show") {
    process.stdout.write(`${JSON.stringify(run)}\n`);
    return run.ok ? 0 : 2;
  }
  if (rest[0] === "check" && rest[1]) {
    if (!run.ok) {
      process.stdout.write(`${JSON.stringify({ rc: 2, code: run.code, detail: run.detail })}\n`);
      return 2;
    }
    const bounds = checkInside(rest[1], [run.record.root, stateDir()]);
    process.stdout.write(`${JSON.stringify({ ...bounds, surface: run.record.surface, root: run.record.root })}\n`);
    return bounds.ok ? 0 : 2;
  }
  return usage();
}

function cmdPlan(rest) {
  if (rest[0] !== "check" || !rest[1]) return usage();
  const result = spawnSync(process.execPath, [resolve(ROOT, "scripts", "plan-check.mjs"), rest[1]], {
    encoding: "utf8",
    timeout: 60_000,
  });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  return result.status ?? 1;
}

function cmdIdentity(rest, flags) {
  if (rest[0] !== "check") return usage();
  const identities = loadIdentities();
  const result = checkCommitIdentity({ name: flags.name, email: flags.email }, identities);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.status === "ATTRIBUTED" ? 0 : 1;
}

function main(argv) {
  const [command, ...tail] = argv;
  const { flags, rest } = parseFlags(tail);
  if (!command || command === "--help" || command === "-h") return usage(0);
  try { reconcileRuns(); } catch { /* best effort; a failed sweep must not block commands */ }
  if (command === "rules") return cmdRules(rest, flags);
  if (command === "gate") return cmdGate(rest);
  if (command === "surface") return cmdSurface(rest);
  if (command === "exam") return cmdExam(rest, flags);
  if (command === "evidence") return cmdEvidence(rest, flags);
  if (command === "hygiene") return cmdHygiene(rest, flags);
  if (command === "lane") return cmdLane(rest, flags);
  if (command === "plan") return cmdPlan(rest);
  if (command === "identity") return cmdIdentity(rest, flags);
  if (["promote", "tombstone", "publish"].includes(command)) {
    const result = gate(command, flags.id ?? ROOT);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.rc;
  }
  return usage();
}

process.exitCode = main(process.argv.slice(2));
