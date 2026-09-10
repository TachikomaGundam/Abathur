// Shared fixtures for todo-2 tests (not a *.test.js, so the runner ignores it).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";

export const FIXED_CLOCK = { now: () => new Date(Date.UTC(2026, 8, 9, 12, 0, 0)) };

export interface DirPair {
  readonly genome: string;
  readonly config: string;
}

export async function freshPair(t: { after: (fn: () => unknown) => void }): Promise<DirPair> {
  const genome = await mkdtemp(path.join(os.tmpdir(), "abathur-led-germ-"));
  const config = await mkdtemp(path.join(os.tmpdir(), "abathur-led-cfg-"));
  t.after(() => {
    rm(genome, { recursive: true, force: true });
    rm(config, { recursive: true, force: true });
  });
  return { genome, config };
}

export function rawLines(file: string): string[] {
  const text = readFileSync(file, "utf8");
  assert.ok(text.endsWith("\n"), "append-only files must always end with a newline");
  return text.split("\n").slice(0, -1);
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
