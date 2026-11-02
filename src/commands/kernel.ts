// `abathur kernel audit|reseal <label>` — seal lifecycle (todo 4 + batch-3 wound-2).
// audit is read-only drift report; reseal re-certifies the manifest from the
// CURRENT tree behind a promote-style human re-type (--confirm <label>) and
// appends a hash-chained receipt row to the genome ledger. This retires the
// seat-side out-of-band manifest edits (disclosed workaround era, closed).

import type { CommandSpec } from "../cli.js";
import { resolveConfigDir } from "../config.js";
import { requireGenomesByLabel } from "../core/genome.js";
import { auditKernel, buildManifest, manifestPathFor, serializeManifest } from "../core/kernel.js";
import { effectiveRepoPath } from "../core/spec.js";
import { Ledger } from "../core/ledger.js";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { EXIT_OK, blocked, cannotAnswer, type ExitCode } from "../exit.js";
import { writeStdout } from "../out.js";

function kernelAudit(configDir: string, args: readonly string[]): ExitCode {
  const label = args[0];
  if (label === undefined || label.length === 0) {
    cannotAnswer("kernel audit: missing <label> argument", "usage: abathur kernel audit <label>");
  }
  const scan = requireGenomesByLabel(configDir, label);
  for (const warning of scan.warnings) writeStdout(`warning: ${warning}`);
  const failures: string[] = [];
  for (const entry of scan.entries) {
    const audit = auditKernel(entry, configDir);
    if (audit.ok) {
      writeStdout(`sealed clean: '${entry.label}' (${entry.fingerprint})`);
    } else {
      failures.push(
        ...audit.drifted.map((d) => `${entry.label} (${entry.fingerprint}): ${d.path} ${d.kind}`),
      );
    }
  }
  if (failures.length > 0) {
    blocked(
      `kernel audit FAILED for '${label}':\n  - ${failures.slice(0, 10).join("\n  - ")}` +
        `${failures.length > 10 ? `\n  - (+${String(failures.length - 10)} more)` : ""}`,
      "restore the named files or resolve the drift at promote — 'genome add' cannot reseal",
    );
  }
  return EXIT_OK;
}

export const LEDGER_KIND_KERNEL_RESEAL = "kernel_reseal";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function kernelReseal(configDir: string, args: readonly string[]): ExitCode {
  const [label, flag, confirm] = args;
  if (label === undefined || label.length === 0 || args.length !== 3 || flag !== "--confirm" || confirm !== label) {
    cannotAnswer(
      "kernel reseal: expected <label> --confirm <label> (human confirmation re-types the label)",
      "usage: abathur kernel reseal <label> --confirm <label>",
    );
  }
  const scan = requireGenomesByLabel(configDir, label);
  for (const warning of scan.warnings) writeStdout(`warning: ${warning}`);
  for (const entry of scan.entries) {
    const audit = auditKernel(entry, configDir);
    if (audit.ok) {
      writeStdout(`kernel reseal: '${entry.label}' (${entry.fingerprint}) already clean — nothing written`);
      continue;
    }
    const repoRoot = effectiveRepoPath(entry.spec.repoPath);
    const manifestFile = manifestPathFor(configDir, entry.fingerprint);
    let oldText = "";
    try {
      oldText = readFileSync(manifestFile, "utf8");
    } catch {
      oldText = "";
    }
    const newText = serializeManifest(buildManifest(repoRoot, entry.spec.kernel.immutableGlobs));
    writeFileSync(manifestFile, newText, "utf8");
    const recheck = auditKernel(entry, configDir);
    if (!recheck.ok) {
      cannotAnswer(
        `kernel reseal: '${entry.label}' still drifting after rewrite (${String(recheck.drifted.length)} entries) — refusing to certify`,
        "audit and reseal must share glob/manifest semantics — investigate before trusting this seal",
      );
    }
    Ledger.open(repoRoot).append({
      kind: LEDGER_KIND_KERNEL_RESEAL,
      runId: "kernel-reseal",
      data: {
        at: new Date().toISOString(),
        label: entry.label,
        fingerprint: entry.fingerprint,
        drifted: audit.drifted.length,
        fromManifestSha256: sha256(oldText),
        toManifestSha256: sha256(newText),
      },
    });
    writeStdout(
      `kernel resealed: '${entry.label}' (${entry.fingerprint}) — ${String(audit.drifted.length)} drifted entr${audit.drifted.length === 1 ? "y" : "ies"} re-certified; receipt in ledger`,
    );
  }
  return EXIT_OK;
}

function runKernel(args: readonly string[]): ExitCode {
  const configDir = resolveConfigDir();
  const [sub, ...rest] = args;
  switch (sub) {
    case "audit":
      return kernelAudit(configDir, rest);
    case "reseal":
      return kernelReseal(configDir, rest);
    default:
      return cannotAnswer(
        `kernel: unknown subcommand '${sub ?? "<none>"}'`,
        "usage: abathur kernel audit <label> | abathur kernel reseal <label> --confirm <label>",
      );
  }
}

export const kernelCommand: CommandSpec = {
  name: "kernel",
  summary: "audit frozen kernel seals against the working tree",
  run: ({ args }) => runKernel(args),
};
