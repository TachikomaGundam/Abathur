// Toy unit: mul — correct baseline; grader score 1.0, pass true.
import path from "node:path";
import { fileURLToPath } from "node:url";

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export function mul(a, b) {
  return a * b;
}

export function checks() {
  return [mul(2, 3) === 6, mul(0, 7) === 0, mul(-2, 3) === -6];
}

if (isMain) console.log(`mul(2,3)=${mul(2, 3)}`);
