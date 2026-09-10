// Toy unit: add — shipped WITH A SEEDED BUG (subtraction). The stub-mutators
// 'fix-add' scripted patch flips it to the correct sum; grader checks() grade it.
import path from "node:path";
import { fileURLToPath } from "node:url";

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export function add(a, b) {
  return a - b; // seeded bug: must be `return a + b;`
}

export function checks() {
  return [add(2, 3) === 5, add(0, 7) === 7, add(-1, 1) === 0];
}

if (isMain) console.log(`add(2,3)=${add(2, 3)}`);
