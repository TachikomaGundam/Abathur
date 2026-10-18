import assert from "node:assert/strict";
import { chmodSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";

import { ExitSignal } from "../exit.js";
import { parseGenomeSpecDocument, type GenomeSpec } from "../core/spec.js";
import type { ScoreOutcome } from "../bench/adapter.js";
import { FixtureScenariosAdapter, type FixtureAdapterOptions } from "../bench/fixture.js";

export function keep(t: TestContext, dir: string): string {
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

export async function freshDir(t: TestContext, prefix: string): Promise<string> {
  return keep(t, await mkdtemp(path.join(os.tmpdir(), `abathur-${prefix}-`)));
}

export async function writeScript(dir: string, name: string, body: string): Promise<string> {
  const filePath = path.join(dir, name);
  await writeFile(filePath, body, "utf8");
  chmodSync(filePath, 0o755);
  return filePath;
}

export function isExit2(cause: unknown): boolean {
  return cause instanceof ExitSignal && cause.code === 2;
}

export const BIN_GOOD = `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = "--version" ]; then echo "1.2.3"; exit 0; fi
unit="\${2:-}"
case "$unit" in
  *poison*) echo dirty > poison.txt ;;
esac
if [ -n "\${ABATHUR_TRANSCRIPT:-}" ]; then
  mkdir -p "$(dirname "$ABATHUR_TRANSCRIPT")"
  printf 'transcript %s model=%s judge=%s home=%s\\n' \\
    "$unit" "\${ABATHUR_AGENT_MODEL:-none}" "\${ABATHUR_JUDGE_MODEL:-none}" "$HOME" \\
    > "$ABATHUR_TRANSCRIPT"
fi
echo "ran $unit"
echo '{"tokensEst":123,"turns":4}'
`;

export const BIN_HANG = `#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo "1.2.3"; exit 0; fi
exec sleep 29.31
`;

export const BIN_NO_VERSION = `#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo "unsupported flag" >&2; exit 1; fi
echo "ran \${2:-}"
`;

export const BIN_GARBAGE_VERSION = `#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo "banana split deluxe"; exit 0; fi
echo "ran \${2:-}"
`;

export const BIN_GARBAGE_RUN = `#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo "1.2.3"; exit 0; fi
echo 'garbage {{{ not json at all'
`;

export async function fixtureGenome(t: TestContext): Promise<string> {
  const genDir = path.join(await freshDir(t, "fixgen"), "germ");
  await mkdir(genDir, { recursive: true });
  await writeFile(path.join(genDir, "scenarios-one.md"), "alpha train scenario\n", "utf8");
  await writeFile(path.join(genDir, "scenarios-two.md"), "beta train scenario\n", "utf8");
  await writeFile(path.join(genDir, "scenarios-poison.md"), "gamma state-mutating train scenario\n", "utf8");
  await writeFile(path.join(genDir, "scenarios-val-canary-ZZHIDDEN.md"), "holdout val scenario ZZHIDDEN\n", "utf8");
  await writeScript(genDir, "reset.sh", `#!/usr/bin/env bash
set -euo pipefail
rm -rf "\${1:?sandbox}"
mkdir -p "\${1:?sandbox}"
`);
  await writeScript(genDir, "seed.sh", `#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
sandbox="\${1:?sandbox}"
mkdir -p "$sandbox/scenarios"
cp "$here"/scenarios-*.md "$sandbox/scenarios/"
cp "$here"/grader.mjs "$sandbox/grader.mjs"
touch "$sandbox/seeded.flag"
`);
  await writeFile(path.join(genDir, "grader.mjs"), `const [unitId] = process.argv.slice(2);
const table = {
  one: { score: 1, pass: true },
  two: { score: 0.5, pass: false },
  poison: { score: 0, pass: false },
  val: { score: 0.25, pass: false },
};
const row = table[unitId];
if (!row) { console.error("unknown unit " + unitId); process.exit(1); }
console.log(JSON.stringify({ unit: unitId, score: row.score, pass: row.pass, metrics: { tokensEst: 42, turns: 2 } }));
`, "utf8");
  await writeScript(genDir, "capture-opencode-bin.sh", `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "\${ABATHUR_OPENCODE_BIN:?missing ABATHUR_OPENCODE_BIN}" > opencode-bin.txt
`);
  return genDir;
}

export const TRAIN_UNITS: readonly { id: string; path: string; split: "train" }[] = [
  { id: "one", path: "scenarios/scenarios-one.md", split: "train" },
  { id: "two", path: "scenarios/scenarios-two.md", split: "train" },
];
export const VAL_UNIT = { id: "val", path: "scenarios/scenarios-val-canary-ZZHIDDEN.md", split: "val" } as const;
export const POISON_UNIT = { id: "poison", path: "scenarios/scenarios-poison.md", split: "train" } as const;

export interface SpecOverrides {
  readonly seedCommand?: string;
  readonly runCommand?: string;
  readonly captureOpencodeBin?: boolean;
  readonly minVersion?: string;
  readonly requires?: readonly { cmd: string; args?: readonly string[]; probeExit: number }[];
  readonly timeoutS?: number;
}

export function fixtureSpec(genDir: string, binPath: string, over: SpecOverrides = {}): GenomeSpec {
  return parseGenomeSpecDocument({
    label: "fixture-germ",
    repoPath: genDir,
    bench: {
      type: "opencode-fixture-scenarios",
      units: [...TRAIN_UNITS, VAL_UNIT],
      runCommand: over.captureOpencodeBin === true ? `${genDir}/capture-opencode-bin.sh` : over.runCommand ?? `${binPath} run {unit.path}`,
      seedCommand: over.seedCommand ?? `${genDir}/seed.sh {sandbox}`,
      resetCommand: `${genDir}/reset.sh {sandbox}`,
      graderCommand: "node grader.mjs {unit.id}",
      judgeCommand: "node judge.mjs {unit.id}",
      judgeModel: "test/judge",
      agentModel: "test/agent",
      timeoutS: over.timeoutS ?? 5,
      stats: { halfWidth: 0.1, minEffect: 0.05, nReps: { initial: 1, max: 2 } },
    },
    budget: { maxCandidates: 2, maxModelCalls: 10, maxTokens: 1000, maxWallS: 60 },
    kernel: { immutableGlobs: [] },
    requires: over.requires ?? [{ cmd: "node", args: ["--version"], probeExit: 0 }],
    opencodeBinVersion: { minVersion: over.minVersion ?? "1.0.0" },
  }, "<test>");
}

export async function fakeHome(t: TestContext): Promise<string> {
  const home = await freshDir(t, "fixhome");
  for (const rel of [".opencode/plugin/x.js", ".opencode/skills/s.md", ".opencode/node_modules/m/package.json", ".opencode/secrets.txt", ".bashrc", ".config/opencode/opencode.json", ".config/opencode/prompts/p.md"]) {
    const p = path.join(home, rel);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, rel === ".config/opencode/opencode.json" ? '{"theme":"dark"}\n' : `${rel}\n`, "utf8");
  }
  return home;
}

export interface AdapterFixture {
  readonly adapter: FixtureScenariosAdapter;
  readonly spec: GenomeSpec;
  readonly sandbox: string;
  readonly home: string;
  readonly configDir: string;
  readonly opencodeBin: string;
}

export async function adapterFixture(t: TestContext, body: string = BIN_GOOD, over: SpecOverrides = {}, opts: FixtureAdapterOptions = {}, binName = "oc-fake"): Promise<AdapterFixture> {
  const binDir = await freshDir(t, "fixbin");
  const binPath = await writeScript(binDir, binName, body);
  const genDir = await fixtureGenome(t);
  const home = await fakeHome(t);
  const configDir = path.join(home, ".config", "abathur");
  const spec = fixtureSpec(genDir, binPath, over);
  const sandbox = path.join(await freshDir(t, "fixsbx"), "sb");
  const adapter = new FixtureScenariosAdapter(spec, { env: { HOME: home }, home, configDir, opencodeBin: binPath, ...opts });
  return { adapter, spec, sandbox, home, configDir, opencodeBin: binPath };
}

export function manifestPath(sandbox: string): string {
  return path.join(sandbox, ".bench", "manifest.json");
}

export function scored(outcome: ScoreOutcome): { score: number; pass: boolean } {
  if (outcome.kind === "scored") return outcome.result;
  assert.fail(`expected scored, got inconclusive: ${outcome.reason}`);
}
