// Toy unit: mutate — run() writes ./poison.txt into the sandbox cwd (state mutation;
// import for grading stays pure via the isMain guard). Fixture for AC (c):
// reset+seed must restore a byte-identical tree digest.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isMain =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export function checks() {
  return [true];
}

if (isMain) {
  writeFileSync(path.join(process.cwd(), "poison.txt"), "mutated\n");
  console.log("mutated sandbox state");
}
