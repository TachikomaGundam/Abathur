// S4 engine seam — run-card injection in graders/historian/run-scenario.sh.
// Everything OFFLINE: a stub `opencode` (argv-recording + transcript-emitting
// node script) replaces the real agent; zero model calls. Pins (task-6 e2):
//  (1) no abathur-notes dir (or no *.md in it) ⇒ the captured brief is BYTE-
//      IDENTICAL to the bare awk-extracted scenario Brief and carries no
//      `## Run card` heading — the F1 invariant (incumbent transcripts must not
//      grow a run-card section);
//  (2) one note ⇒ the brief ends with "\n\n## Run card\n\n" + verbatim content;
//  (3) determinism: two consecutive runs over the same tree ⇒ byte-identical
//      prompt AND transcript files;
//  (4) stale-state: changing the note between runs changes the brief (old body
//      gone, new body present) and the transcript;
//  (5) PLUM A/B flow: a planted instruction note ⇒ appears in the brief ⇒
//      appears in the stub transcript's finalMessage (note⇒brief⇒transcript);
//  (6) multiple notes concatenate in LC_ALL=C filename order; an explicit 3rd
//      argv overrides the scenario-derived repoRoot.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, type TestContext } from "node:test";
import { promisify } from "node:util";

import { parseTranscript } from "../../graders/historian/grader-support.mjs";

const exec = promisify(execFile);

const SCRIPT = fileURLToPath(new URL("../../graders/historian/run-scenario.sh", import.meta.url));

/** Recorded scenario-Brief section — the exact bytes run-scenario.sh awk-extracts. */
const BRIEF_TEXT = "Do the seam thing.";
const SCENARIO = `# Scenario 01 — seam probe

## Brief
${BRIEF_TEXT}

## Expected Behavior

n/a for the stub lane.
`;

const STUB_OPENCODE = `#!/usr/bin/env node
// stub opencode: records the --message value to $STUB_PROMPT_FILE and the FULL
// argv (one token per line) to $STUB_ARGV_FILE, then echoes an opencode-format
// transcript on stdout (run-scenario.sh redirects it to $ABATHUR_TRANSCRIPT).
// The finalMessage is the prompt echoed back — so a planted instruction in the
// brief provably flows into the transcript.
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const i = args.indexOf("--message");
const message = i >= 0 ? args[i + 1] ?? "" : "";
const capture = process.env.STUB_PROMPT_FILE;
if (capture !== undefined && capture.length > 0) writeFileSync(capture, message, "utf8");
const argvCapture = process.env.STUB_ARGV_FILE;
if (argvCapture !== undefined && argvCapture.length > 0) writeFileSync(argvCapture, args.join("\\n") + "\\n", "utf8");
const out = (doc) => process.stdout.write(JSON.stringify(doc) + "\\n");
out({ type: "step_start", part: { type: "step-start" } });
out({ type: "step_finish", part: { type: "step-finish", reason: "stop", tokens: { total: 42 } } });
out({ type: "text", part: { type: "text", text: message } });
`;

interface Harness {
  readonly repoRoot: string;
  readonly promptFile: string;
  readonly transcript: string;
  readonly bin: string;
}

function harness(t: TestContext): Harness {
  const root = mkdtempSync(path.join(tmpdir(), "seam-rs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const binDir = path.join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const stub = path.join(binDir, "oc-stub");
  writeFileSync(stub, STUB_OPENCODE, "utf8");
  chmodSync(stub, 0o755);
  const repoRoot = path.join(root, "repo");
  mkdirSync(path.join(repoRoot, "scenarios"), { recursive: true });
  writeFileSync(path.join(repoRoot, "scenarios", "01-seam.md"), SCENARIO, "utf8");
  return {
    repoRoot,
    promptFile: path.join(root, "prompt.txt"),
    transcript: path.join(root, "transcript.jsonl"),
    bin: binDir,
  };
}

/** Invokes the shipped contract `bash run-scenario.sh <unit.id> <scenario-file>`. */
async function runScenario(
  h: Harness,
  opts: { readonly args?: readonly string[]; readonly scenario?: string; readonly argvFile?: string; readonly env?: Record<string, string | undefined> } = {},
): Promise<void> {
  const scenarioFile = opts.scenario ?? path.join(h.repoRoot, "scenarios", "01-seam.md");
  const argv = [SCRIPT, "scenario-01", scenarioFile, ...(opts.args ?? [])];
  await exec("bash", argv, {
    env: {
      ...process.env,
      ABATHUR_TRANSCRIPT: h.transcript,
      STUB_PROMPT_FILE: h.promptFile,
      opencodeBin: path.join(h.bin, "oc-stub"),
      ...(opts.argvFile === undefined ? {} : { STUB_ARGV_FILE: opts.argvFile }),
      ...(opts.env ?? {}),
    },
  });
}

function prompt(h: Harness): string {
  return readFileSync(h.promptFile, "utf8");
}

function writeNote(h: Harness, name: string, body: string): void {
  const dir = path.join(h.repoRoot, "abathur-notes");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), body, "utf8");
}

const RUN_CARD_HEADING = "## Run card";

test("no-notes: captured brief is byte-identical to the bare scenario Brief (F1 invariant)", async (t) => {
  const h = harness(t);
  await runScenario(h);
  assert.equal(prompt(h), BRIEF_TEXT, "brief must carry exactly the awk-extracted Brief bytes");
  assert.ok(!prompt(h).includes(RUN_CARD_HEADING), "no notes ⇒ no run-card section ever");
});

test("empty-notes-dir: a notes directory without *.md changes nothing", async (t) => {
  const h = harness(t);
  mkdirSync(path.join(h.repoRoot, "abathur-notes"), { recursive: true });
  writeFileSync(path.join(h.repoRoot, "abathur-notes", "ignore.txt"), "not a card\n", "utf8");
  await runScenario(h);
  assert.equal(prompt(h), BRIEF_TEXT);
  assert.ok(!prompt(h).includes(RUN_CARD_HEADING));
});

test("one-note: brief ends with '## Run card' + verbatim note content", async (t) => {
  const h = harness(t);
  const note = "Prefer concise incident pages with a Related Pages tail.\n";
  writeNote(h, "style.md", note);
  await runScenario(h);
  const expected = `${BRIEF_TEXT}\n\n${RUN_CARD_HEADING}\n\n${note.replace(/\n+$/, "")}`;
  assert.equal(prompt(h), expected, "run card is appended fenced under its heading, verbatim");
});

test("determinism: two consecutive runs over the same tree ⇒ byte-identical prompt + transcript", async (t) => {
  const h = harness(t);
  writeNote(h, "a.md", "card alpha\n");
  await runScenario(h);
  const firstPrompt = prompt(h);
  const firstTranscript = readFileSync(h.transcript, "utf8");
  await runScenario(h);
  assert.equal(prompt(h), firstPrompt, "prompt bytes must not move between identical runs");
  assert.equal(readFileSync(h.transcript, "utf8"), firstTranscript, "transcript bytes must not move");
});

test("stale-state: changing the note between runs changes the brief and the transcript", async (t) => {
  const h = harness(t);
  writeNote(h, "a.md", "alpha card body\n");
  await runScenario(h);
  const before = prompt(h);
  writeNote(h, "a.md", "beta card body\n");
  await runScenario(h);
  const after = prompt(h);
  assert.ok(before.includes("alpha card body") && !after.includes("alpha card body"));
  assert.ok(after.includes("beta card body"));
  assert.notEqual(after, before, "a changed tree must produce a changed brief");
});

test("PLUM flow: planted instruction reaches brief ⇒ stub transcript finalMessage", async (t) => {
  const h = harness(t);
  writeNote(h, "plum.md", "Reply with the single word PLUM at the very end.\n");
  await runScenario(h);
  assert.ok(prompt(h).includes("Reply with the single word PLUM at the very end."));
  const meta = parseTranscript(readFileSync(h.transcript, "utf8"));
  assert.match(meta.finalMessage, /PLUM/, "note ⇒ brief ⇒ transcript delivery must be provable");
});

test("multi-note: concatenated in LC_ALL=C filename order", async (t) => {
  const h = harness(t);
  writeNote(h, "zeta.md", "zeta body\n");
  writeNote(h, "alpha.md", "alpha body\n");
  await runScenario(h);
  const p = prompt(h);
  assert.equal(
    p,
    `${BRIEF_TEXT}\n\n${RUN_CARD_HEADING}\n\nalpha body\n\nzeta body`,
    "cat order = sorted filenames, contents joined verbatim",
  );
});

test("explicit repoRoot argv overrides the scenario-derived one", async (t) => {
  const h = harness(t);
  writeNote(h, "a.md", "incumbent-tree card\n"); // derived from scenario dir: NOT used
  const otherRoot = path.join(path.dirname(h.repoRoot), "elsewhere");
  mkdirSync(path.join(otherRoot, "abathur-notes"), { recursive: true });
  writeFileSync(path.join(otherRoot, "abathur-notes", "a.md"), "elsewhere card\n", "utf8");
  await runScenario(h, { args: [otherRoot] });
  assert.ok(prompt(h).includes("elsewhere card"), "argv repoRoot wins");
  assert.ok(!prompt(h).includes("incumbent-tree card"));
});

// Model pinning (task-06 follow-up): the transcript JSONL carries NO model
// identity and bundle provenance copies spec.bench.agentModel verbatim
// (bundle-common.ts) — an unpinned `opencode run` measures the provider
// DEFAULT while the ledger claims the spec value. ABATHUR_AGENT_MODEL is the
// engine's existing sandboxEnv channel (fixture.ts); the script must honor it
// with --model, and unset/empty must keep argv byte-identical (F1).

function argvTokens(file: string): string[] {
  return readFileSync(file, "utf8").split("\n").slice(0, -1);
}

const BASELINE_ARGV = ["run", "--command", "historian", "--auto", "--format", "json", "--message", BRIEF_TEXT];

test("model pin: ABATHUR_AGENT_MODEL set ⇒ argv carries --model <value>, brief still flows", async (t) => {
  const h = harness(t);
  const argvFile = path.join(path.dirname(h.promptFile), "argv-pinned.txt");
  await runScenario(h, {
    argvFile,
    env: { ABATHUR_AGENT_MODEL: "testprov/testmodel" },
  });
  const tokens = argvTokens(argvFile);
  const i = tokens.indexOf("--model");
  assert.notEqual(i, -1, `--model missing from argv: ${JSON.stringify(tokens)}`);
  assert.equal(tokens[i + 1], "testprov/testmodel");
  assert.equal(tokens.at(-2), "--message", "pin must not disturb the brief channel");
  assert.equal(prompt(h), BRIEF_TEXT);
});

test("model pin: ABATHUR_AGENT_MODEL unset ⇒ argv byte-identical to the pre-fix baseline", async (t) => {
  const h = harness(t);
  const argvFile = path.join(path.dirname(h.promptFile), "argv-unset.txt");
  await runScenario(h, { argvFile, env: { ABATHUR_AGENT_MODEL: undefined } });
  assert.deepEqual(argvTokens(argvFile), BASELINE_ARGV);
});

test("model pin: ABATHUR_AGENT_MODEL empty string ⇒ treated as unset (same argv)", async (t) => {
  const h = harness(t);
  const argvFile = path.join(path.dirname(h.promptFile), "argv-empty.txt");
  await runScenario(h, { argvFile, env: { ABATHUR_AGENT_MODEL: "" } });
  assert.deepEqual(argvTokens(argvFile), BASELINE_ARGV);
});
