import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { assertRunPath } from "./spawn.mjs";

export const SEAT_ENV = "ABATHUR_SEAT_CMD";
export const JUDGE_ENV = "ABATHUR_JUDGE_CMD";

function runCommand(cmd, input) {
  const result = spawnSync("/bin/sh", ["-c", cmd], { input, encoding: "utf8", timeout: 120_000 });
  return { rc: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/**
 * Bell mode plants a known-bad answer: the judge must return FAIL and
 * canary_kill=true. Live mode uses a legitimate answer and must return PASS
 * with canary_kill=false. Both paths require injected commands.
 *
 * @param {{item:Record<string, unknown>, mode:"bell"|"live", env?:NodeJS.ProcessEnv, seat?:Function, judge?:Function}} options
 */
export function runExam(options) {
  const env = options.env ?? process.env;
  const seatCmd = env[SEAT_ENV];
  const judgeCmd = env[JUDGE_ENV];
  if (!options.seat && (!seatCmd || !seatCmd.trim())) {
    return { rc: 2, code: "EXAM CHANNEL UNDISPATCHABLE", detail: `${SEAT_ENV} is not set` };
  }
  if (!options.judge && (!judgeCmd || !judgeCmd.trim())) {
    return { rc: 2, code: "EXAM CHANNEL UNDISPATCHABLE", detail: `${JUDGE_ENV} is not set` };
  }
  const prompt = JSON.stringify({ item: options.item, mode: options.mode });
  const seat = options.seat ?? ((text) => runCommand(seatCmd, text));
  const judge = options.judge ?? ((text) => runCommand(judgeCmd, text));
  const answer = seat(prompt);
  if (!answer || typeof answer.stdout !== "string") {
    return { rc: 1, code: "SEAT-NO-ANSWER" };
  }
  const verdict = judge(JSON.stringify({ item: options.item, answer: answer.stdout }));
  const text = verdict?.stdout ?? "";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { rc: 1, code: "JUDGE-BAD-OUTPUT", raw: text };
  }
  const aggregate = parsed.verdict;
  const killed = parsed.canary_kill === true;
  if (options.mode === "bell") {
    const ok = aggregate === "FAIL" && killed;
    return { rc: ok ? 0 : 1, code: ok ? "BELL-KILLED" : "BELL-MISSED", aggregate, canary_kill: killed };
  }
  const ok = aggregate === "PASS" && killed === false;
  return { rc: ok ? 0 : 1, code: ok ? "LIVE-PASS" : "LIVE-FAILED", aggregate, canary_kill: killed };
}

/** Write a long-run state file before detaching (never hold the foreground). */
export function recordLongRun(statePath, state) {
  assertRunPath(statePath, "statePath");
  writeFileSync(statePath, `${JSON.stringify({ ...state, ts: new Date().toISOString() }, null, 2)}\n`);
}
