// Toy unit: sub — the required val-split unit; correct baseline (score 1.0).
import path from "node:path";
import { fileURLToPath } from "node:url";

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export function sub(a, b) {
  return a - b;
}

export function checks() {
  return [sub(9, 4) === 5, sub(0, 0) === 0, sub(-3, -3) === 0];
}

if (isMain) console.log(`sub(9,4)=${sub(9, 4)}`);
