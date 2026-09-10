// stdout funnel (todo 1 seam): command handlers are pure except for this one line —
// they never touch process.exitCode / process.exit; the CLI boundary owns exit.

export function writeStdout(text: string): void {
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}
