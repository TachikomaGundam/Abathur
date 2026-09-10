// Exit-code contract (family-wide, border/README.md:289-296):
//   0 = ok/pass            1 = blocked/failed (decision)   2 = cannot-answer (tool error:
//                             config error, malformed input, missing engine, lock holder)
// Handlers never touch process directly: they return 0 or throw ExitSignal; the CLI
// boundary (src/cli.ts main) renders one clean line per failure and sets process.exitCode.

export const EXIT_OK = 0;
export const EXIT_BLOCKED = 1;
export const EXIT_CANNOT_ANSWER = 2;

export type ExitCode = typeof EXIT_OK | typeof EXIT_BLOCKED | typeof EXIT_CANNOT_ANSWER;

/** Control-flow exception carrying the process exit code for the current run. */
export class ExitSignal extends Error {
  constructor(
    readonly code: ExitCode,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "ExitSignal";
  }
}

/** Gate blocked the action (HIGH/CRITICAL verdict, refused promote, ...). */
export function blocked(message: string, hint?: string): never {
  throw new ExitSignal(EXIT_BLOCKED, message, hint);
}

/** The harness could not answer: config/engine/input error. Never exit 0 on this class. */
export function cannotAnswer(message: string, hint?: string): never {
  throw new ExitSignal(EXIT_CANNOT_ANSWER, message, hint);
}

/** Single-line rendering used by the CLI boundary for every ExitSignal. */
export function renderExitSignal(signal: ExitSignal): string {
  const base = `abathur: ${signal.message}`;
  return signal.hint === undefined ? base : `${base}\n  hint: ${signal.hint}`;
}
