import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const WORK_PATH =
  /(^|\/)(handoffs?|dockets?|work|workfiles|notes|sessions|tmp|\.omo)(\/|$)/;
const TOOLS_PATH = /(^|\/)tools\//;
const BYTECODE_PATH = /(^|\/)__pycache__(\/|$)|\.pyc$/;

export function forbiddenPackagePath(path) {
  return (
    TOOLS_PATH.test(path) ||
    BYTECODE_PATH.test(path) ||
    WORK_PATH.test(path)
  );
}

export function inspectPackageFiles(files) {
  return files.filter((entry) => forbiddenPackagePath(entry.path));
}

function fail(message) {
  console.error(`PACKAGE-BOUNDARY: ${message}`);
  process.exit(1);
}

function run() {
  let raw;
  try {
    raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    console.error("PACKAGE-BOUNDARY: npm pack failed");
    process.exit(2);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("PACKAGE-BOUNDARY: npm pack did not return JSON");
    process.exit(2);
  }

  const pack = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!pack || !Array.isArray(pack.files)) {
    console.error("PACKAGE-BOUNDARY: npm pack returned no file list");
    process.exit(2);
  }

  const bad = inspectPackageFiles(pack.files);
  if (bad.length > 0) {
    fail(`forbidden entries: ${bad.map((entry) => entry.path).join(", ")}`);
  }

  const count = pack.entryCount ?? pack.files.length;
  const size = pack.unpackedSize ?? "unknown";
  console.log(`PACKAGE-BOUNDARY OK: ${count} files, ${size} bytes`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  run();
}
