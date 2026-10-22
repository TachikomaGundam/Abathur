// T4 batch 6 — real concurrency: two independent node subprocesses appending to the
// SAME ledger through the mkdir-lock; every entry must land and the whole chain must
// verify (interleaving must not tear entries or break prev-hash linkage).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { T4_HEADER_RE, verifyTailChain } from '../plugin/abathur.js';

const roots: string[] = [];
function freshRoot(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `abathur-conc-${tag}-`));
  roots.push(dir);
  return dir;
}
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

const here = path.dirname(fileURLToPath(import.meta.url)); // <repo>/.plugintest-dist/plugintest
const pluginJs = path.resolve(here, '..', 'plugin', 'abathur.js');

const RUNNER = `
import { appendLedger } from ${JSON.stringify(pluginJs)};
const [ledgerPath, sid, count] = process.argv.slice(1);
for (let i = 0; i < Number(count); i += 1) {
  const res = appendLedger({ ledgerPath, kind: 'declaration', body: sid + ' entry ' + String(i), sessionID: sid, now: () => new Date() });
  if (!res.ok) { console.error(JSON.stringify(res)); process.exit(1); }
}
console.log('done');
`;

function runAppender(sid: string, ledgerPath: string, count: number): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', RUNNER, ledgerPath, sid, String(count)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

test('T4 concurrency: two subprocesses × 5 appends — all land, chain verifies end to end', async () => {
  const dir = freshRoot('dual');
  const ledgerPath = path.join(dir, 'INTENT-LEDGER.md');
  writeFileSync(ledgerPath, '# genesis\n');

  const [a, b] = await Promise.all([runAppender('ses_A', ledgerPath, 5), runAppender('ses_B', ledgerPath, 5)]);
  assert.equal(a.code, 0, `ses_A appender failed: ${a.stderr}`);
  assert.equal(b.code, 0, `ses_B appender failed: ${b.stderr}`);

  const content = readFileSync(ledgerPath, 'utf8');
  const headers = content.split('\n').filter((line) => T4_HEADER_RE.test(line));
  assert.equal(headers.length, 10, `expected 10 T4 entries, got ${String(headers.length)}`);
  assert.equal(headers.filter((h) => h.includes('sid=ses_A')).length, 5);
  assert.equal(headers.filter((h) => h.includes('sid=ses_B')).length, 5);

  const chain = verifyTailChain(content, 10); // k covers every appended entry
  assert.equal(chain.ok, true, `chain broke at line ${String(chain.breakLine ?? -1)}`);
  assert.equal(chain.checked, 10);
});
