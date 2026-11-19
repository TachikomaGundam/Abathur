#!/usr/bin/env node
// Sweep the obligation work tree vs the authoritative ledger pointers.
//   cd "$(git rev-parse --show-toplevel)" && node scripts/obligation-audit.mjs
//   node scripts/obligation-audit.mjs --work <root> --ledger <file> [--ledger ...]
// Default work root: operator state work dir; default ledger corpus: every
// .omo/ledger-entry*.txt in this repo. Runs host-side: inside the bwrap cage
// the state home is tmpfs-hidden and the audit fail-closes CANNOT-ANSWER rc=2.
// Exit: 0 COVERED / 1 GAPS (unregistered obligations listed) / 2 CANNOT-ANSWER.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { auditObligations, EXIT } from "../kernel/governance/obligation-audit.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const workRoot = resolve(argVal("--work", join(process.env.HOME ?? "", ".local/state/abathur/work")));
const ledgerArgs = argv.map((a, i) => (argv[i - 1] === "--ledger" ? a : null)).filter(Boolean);

if (!existsSync(workRoot) || !statSync(workRoot).isDirectory()) {
  process.stdout.write(JSON.stringify({ verdict: "CANNOT-ANSWER", reasons: [`work-root-unreadable:${workRoot}`] }) + "\n");
  process.exit(EXIT["CANNOT-ANSWER"]);
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, out);
    else if (st.isFile()) {
      try { out.push({ path: abs, content: readFileSync(abs, "utf8") }); } catch { /* unreadable: skip content, basename-only can't register */ }
    }
  }
  return out;
}

let ledgerFiles = ledgerArgs;
if (!ledgerFiles.length) {
  ledgerFiles = readdirSync(join(REPO, ".omo"))
    .filter((n) => /^ledger-entry\d+\.txt$/.test(n))
    .map((n) => join(REPO, ".omo", n));
}
if (!ledgerFiles.length) {
  process.stdout.write(JSON.stringify({ verdict: "CANNOT-ANSWER", reasons: ["ledger-corpus-absent"] }) + "\n");
  process.exit(EXIT["CANNOT-ANSWER"]);
}
const ledgerText = ledgerFiles.map((p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } }).join("\n");

const result = auditObligations({ workFiles: walk(workRoot, []), ledgerText });
process.stdout.write(JSON.stringify(result) + "\n");
process.exit(EXIT[result.verdict] ?? 2);
