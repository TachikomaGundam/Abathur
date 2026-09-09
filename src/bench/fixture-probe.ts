// Startup engine probes for the fixture-scenarios adapter (todo 6, plan 117-124):
// `<opencodeBin> --version` parsed as semver and enforced against
// spec.opencodeBinVersion.minVersion, plus every spec.requires[] binary probed by
// argv spawn (PATH lookup, never a shell). Any failure is exit 2 BEFORE a unit
// runs; every observed version string lands in the returned provenance list.

import { cannotAnswer } from "../exit.js";
import { loadConfig, type ConfigEnv } from "../config.js";
import type { GenomeSpec } from "../core/spec.js";
import { firstLine, runChild, type ProvenanceVersion } from "./adapter.js";
import { compareSemver, parseSemver, semverFromText, type SemverVersion } from "./fixture-support.js";

const PROBE_TIMEOUT_S = 30;

type RequiredPrereq = NonNullable<GenomeSpec["requires"]>[number];

export function resolveOpencodeBin(
  opts: { readonly opencodeBin?: string | undefined; readonly env?: ConfigEnv | undefined },
): string {
  if (opts.opencodeBin !== undefined) return opts.opencodeBin;
  return loadConfig(opts.env ?? process.env).config.opencodeBin ?? "opencode";
}

export async function probeEngines(
  spec: GenomeSpec,
  bin: string,
  repoRoot: string,
): Promise<readonly ProvenanceVersion[]> {
  const observed = await probeOpencodeVersion(bin, repoRoot);
  const min = spec.opencodeBinVersion?.minVersion;
  if (min !== undefined) {
    const minVersion = parseSemver(min);
    if (minVersion === null) {
      cannotAnswer(`fixture: opencodeBinVersion.minVersion '${min}' is not a semver`);
    }
    if (compareSemver(observed.version, minVersion) < 0) {
      cannotAnswer(
        `fixture: opencode ${observed.raw} is older than required minVersion ${min}`,
        "upgrade the opencode binary (config opencodeBin)",
      );
    }
  }
  const versions: ProvenanceVersion[] = [
    { bin: "node", version: process.version },
    { bin, version: observed.raw },
  ];
  for (const req of spec.requires ?? []) {
    versions.push(await probeRequires(req, repoRoot));
  }
  return versions;
}

async function probeOpencodeVersion(
  bin: string,
  cwd: string,
): Promise<{ raw: string; version: SemverVersion }> {
  const probe = await runChild({ argv: [bin, "--version"], cwd, timeoutS: PROBE_TIMEOUT_S });
  if (probe.kind !== "exited" || probe.exitCode !== 0) {
    cannotAnswer(
      `fixture: '${bin} --version' failed (${probe.reason}) — no unit will run`,
      "set opencodeBin in config or install a supported opencode",
    );
  }
  const observed = semverFromText(probe.stdout);
  if (observed === null) {
    cannotAnswer(
      `fixture: cannot parse a semver from '${bin} --version' output: ${firstLine(probe.stdout) || "no output"}`,
    );
  }
  return observed;
}

async function probeRequires(req: RequiredPrereq, cwd: string): Promise<ProvenanceVersion> {
  const outcome = await runChild({
    argv: [req.cmd, ...(req.args ?? ["--version"])],
    cwd,
    timeoutS: PROBE_TIMEOUT_S,
  });
  if (outcome.kind === "spawn_failed") {
    cannotAnswer(
      `fixture: required prerequisite '${req.cmd}' is missing: ${outcome.reason}`,
      "install it or fix spec.requires before benching",
    );
  }
  if (outcome.kind !== "exited" || outcome.exitCode !== req.probeExit) {
    cannotAnswer(
      `fixture: prerequisite '${req.cmd}' probe expected exit ${String(req.probeExit)}, got ${outcome.reason}`,
    );
  }
  return {
    bin: req.cmd,
    version: firstLine(outcome.stdout) || firstLine(outcome.stderr) || "no version output",
  };
}
