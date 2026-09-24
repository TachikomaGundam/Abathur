// Score-bank loader tests (acceptance-semantics redesign, 2026-09-24): the
// fail-closed activation law, exact shrinkage/quantum-floor arithmetic, row
// skipping with notices, corrupt-tail/backup exclusion and the gate-time
// candidate-tree exclusion hook the A9 backtest replays through.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { BANK_QUANTUM, BANK_THIN_DF, loadScoreBank } from "../core/evolve/score-bank.js";

const STATE_DIR = path.join(".state", "abathur");

interface RowSpec {
  readonly source: "candidate" | "incumbent";
  readonly head: string;
  readonly tree?: string | undefined;
  readonly units: ReadonlyArray<{ unitId: string; split: string; scores: readonly number[] }>;
  readonly complete?: boolean | undefined;
}

function generationLine(row: RowSpec): string {
  const data = {
    source: row.source,
    ...(row.source === "candidate" ? { candidateId: `c-${row.tree}`, treeSha: row.tree, commitSha: row.tree ?? "c" } : {}),
    headCommit: row.head,
    complete: row.complete ?? true,
    reps: 2,
    units: row.units.map((u) => ({ ...u, runIds: u.scores.map((_, i) => `r${String(i)}`), failures: [] })),
    counters: { candidates: row.source === "candidate" ? 1 : 0, modelCalls: 0, tokens: 1, wallS: 1 },
    manifest: [],
    benchProvenance: { benchType: "toy", versions: [] },
  };
  return `${JSON.stringify({ v: 1, ts: "2026-09-24T00:00:00.000Z", kind: "generation_complete", genId: "g-1", runId: "a-1", data })}\n`;
}

function withRepo(write: (repo: string) => void): void {
  const repo = mkdtempSync(path.join(os.tmpdir(), "abathur-bank-"));
  try {
    write(repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

function stateDir(repo: string): string {
  const dir = path.join(repo, STATE_DIR);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("loadScoreBank fail-closed activation", () => {
  it("no .state dir at all ⇒ null — and the loader never creates one (peekPlanState discipline)", () => {
    withRepo((repo) => {
      assert.equal(loadScoreBank(repo), null);
      assert.equal(existsSync(path.join(repo, STATE_DIR)), false);
    });
  });
  it("live ledger only ⇒ null — rotation is the activation law", () => {
    withRepo((repo) => {
      const dir = stateDir(repo);
      writeFileSync(path.join(dir, "ledger.jsonl"), generationLine({ source: "incumbent", head: "a".repeat(40), units: [{ unitId: "u", split: "train", scores: [0, 2, 1, 3] }] }));
      assert.equal(loadScoreBank(repo), null);
    });
  });
  it("ledger.corrupt-* is NOT a rotated archive; an empty dir ⇒ null", () => {
    withRepo((repo) => {
      const dir = stateDir(repo);
      writeFileSync(path.join(dir, "ledger.corrupt-20260924-9.jsonl"), generationLine({ source: "incumbent", head: "a".repeat(40), units: [{ unitId: "u", split: "train", scores: [0, 2, 1, 3] }] }));
      assert.equal(loadScoreBank(repo), null);
      rmSync(path.join(dir, "ledger.corrupt-20260924-9.jsonl"));
      writeFileSync(path.join(dir, "notes.txt"), "unrelated");
      assert.equal(loadScoreBank(repo), null);
    });
  });
  it("archive + live load; totalDf=0 (only single-rep groups ever) ⇒ null", () => {
    withRepo((repo) => {
      const dir = stateDir(repo);
      writeFileSync(path.join(dir, "ledger.campaign1-x.jsonl"), generationLine({ source: "incumbent", head: "a".repeat(40), units: [{ unitId: "u", split: "train", scores: [1] }, { unitId: "v", split: "val", scores: [0.5] }] }));
      writeFileSync(path.join(dir, "ledger.jsonl"), generationLine({ source: "incumbent", head: "b".repeat(40), units: [{ unitId: "u", split: "train", scores: [2] }] }));
      assert.equal(loadScoreBank(repo), null);
    });
  });
});

describe("loadScoreBank arithmetic", () => {
  const scatterRow = (head: string, tree: string | undefined, source: RowSpec["source"], scores: readonly number[]): string =>
    generationLine({ source, head, ...(tree === undefined ? {} : { tree }), units: [{ unitId: "u", split: "train", scores }] });

  it("pools within-group SS across lineages; thin df floors σ at the quantum; df≥6 keeps the shrunk σ", () => {
    withRepo((repo) => {
      const dir = stateDir(repo);
      // group g1 (campaign1 archive): [0,2] → mean 1, SS 2, df 1 — the ONLY scatter in the bank.
      writeFileSync(
        path.join(dir, "ledger.campaign1-x.jsonl"),
        `${scatterRow("a".repeat(40), undefined, "incumbent", [0, 2])}` +
          // group g2 (live): same unit, different lineage head, zero scatter
          scatterRow("b".repeat(40), undefined, "incumbent", [1, 1]),
      );
      writeFileSync(path.join(dir, "ledger.jsonl"), generationLine({ source: "candidate", head: "b".repeat(40), tree: "t1", units: [{ unitId: "q", split: "train", scores: [1, 1, 1, 1] }] }));
      const bank = loadScoreBank(repo);
      assert.ok(bank !== null);
      // totals: u groups df 1+1 (SS 2+0), q group df 3 (SS 0) ⇒ total df 5, prior σ² = 2/5.
      assert.equal(bank.totalDf, 5);
      assert.ok(Math.abs(bank.priorSigma - Math.sqrt(0.4)) < 1e-12);
      // unit u: σ̂² = 2/2 = 1; shrunk = (2·1 + 2·0.4)/4 = 0.7 ⇒ σ = √0.7 (floor 0.0884 does not bind).
      const u = bank.units.get("u");
      assert.ok(u !== undefined);
      assert.equal(u.df, 2);
      assert.ok(Math.abs(u.sigma - Math.sqrt(0.7)) < 1e-12, `sigma ${String(u.sigma)}`);
      // unit q: df 3, zero SS ⇒ shrunk toward the prior: (3·0 + 2·0.4)/5 = 0.16 ⇒ σ = 0.4 > floor.
      const q = bank.units.get("q");
      assert.ok(q !== undefined);
      assert.ok(Math.abs(q.sigma - 0.4) < 1e-12);
    });
  });

  it("zero-scatter bank: thin units sit exactly on BANK_QUANTUM, proven-quiet units (df≥6) on their shrunk σ", () => {
    withRepo((repo) => {
      const dir = stateDir(repo);
      const thin = generationLine({ source: "incumbent", head: "a".repeat(40), units: [{ unitId: "thin", split: "train", scores: [0.5, 0.5] }] });
      const wide = generationLine({ source: "incumbent", head: "b".repeat(40), units: [{ unitId: "wide", split: "train", scores: [1, 1, 1, 1, 1, 1] }] }) + generationLine({ source: "candidate", head: "b".repeat(40), tree: "x", units: [{ unitId: "wide", split: "train", scores: [1, 1, 1] }] });
      writeFileSync(path.join(dir, "ledger.campaign1-x.jsonl"), thin + wide);
      const bank = loadScoreBank(repo);
      assert.ok(bank !== null);
      assert.equal(bank.priorSigma, 0);
      assert.equal(bank.units.get("thin")?.sigma, BANK_QUANTUM); // shrunk 0 → floored
      assert.equal(bank.units.get("thin")?.df, 1);
      assert.equal(bank.units.get("wide")?.sigma, 0); // df 4+1+… ≥ BANK_THIN_DF, zero prior ⇒ stays 0
      assert.ok((bank.units.get("wide")?.df ?? 0) >= BANK_THIN_DF);
    });
  });
});

describe("loadScoreBank row hygiene", () => {
  it("corrupt JSON lines and schema-invalid rows are skipped with notices; valid rows still price", () => {
    withRepo((repo) => {
      const dir = stateDir(repo);
      const good = generationLine({ source: "incumbent", head: "a".repeat(40), units: [{ unitId: "u", split: "train", scores: [0, 2, 2, 0] }] });
      writeFileSync(
        path.join(dir, "ledger.campaign1-x.jsonl"),
        `${good}{"v":1,"ts":"x\n${generationLine({ source: "incumbent", head: "a".repeat(40), units: [{ unitId: "bad", split: "nope", scores: [1, 2] }] })}`,
      );
      const bank = loadScoreBank(repo);
      assert.ok(bank !== null);
      assert.ok(bank.units.has("u"));
      assert.equal(bank.units.has("bad"), false);
      assert.equal(bank.notices.length, 2);
      assert.match(bank.notices.join("\n"), /not JSON/);
      assert.match(bank.notices.join("\n"), /unreadable/);
    });
  });

  it("budget-truncated rows (complete:false) still contribute their real replicate scores", () => {
    withRepo((repo) => {
      const dir = stateDir(repo);
      writeFileSync(path.join(dir, "ledger.campaign1-x.jsonl"), generationLine({ source: "candidate", head: "a".repeat(40), tree: "t", complete: false, units: [{ unitId: "u", split: "train", scores: [0, 2] }] }));
      const bank = loadScoreBank(repo);
      assert.equal(bank?.units.get("u")?.df, 1);
    });
  });

  it("excludeCandidateTrees replays the gate-time world (rows written after evaluate)", () => {
    withRepo((repo) => {
      const dir = stateDir(repo);
      writeFileSync(
        path.join(dir, "ledger.campaign1-x.jsonl"),
        generationLine({ source: "incumbent", head: "a".repeat(40), units: [{ unitId: "u", split: "train", scores: [0, 2] }] }) +
          generationLine({ source: "candidate", head: "a".repeat(40), tree: "to-exclude", units: [{ unitId: "u", split: "train", scores: [4, 0] }] }),
      );
      const withIt = loadScoreBank(repo);
      const without = loadScoreBank(repo, { excludeCandidateTrees: ["to-exclude"] });
      assert.equal(withIt?.units.get("u")?.df, 2);
      assert.equal(without?.units.get("u")?.df, 1);
      assert.equal(withIt?.totalDf, 2);
      assert.equal(without?.totalDf, 1);
    });
  });

  it("excludeFiles hides a future campaign's ledger; null once no rotated archive remains", () => {
    withRepo((repo) => {
      const dir = stateDir(repo);
      writeFileSync(
        path.join(dir, "ledger.campaign1-x.jsonl"),
        generationLine({ source: "incumbent", head: "a".repeat(40), units: [{ unitId: "u", split: "train", scores: [0, 2, 2, 0] }] }),
      );
      writeFileSync(
        path.join(dir, "ledger.campaign2-y.jsonl"),
        generationLine({ source: "incumbent", head: "b".repeat(40), units: [{ unitId: "u", split: "train", scores: [1, 5] }] }),
      );
      assert.equal(loadScoreBank(repo)?.units.get("u")?.df, 4);
      const hidden = loadScoreBank(repo, { excludeFiles: ["ledger.campaign2-y.jsonl"] });
      assert.equal(hidden?.units.get("u")?.df, 3);
      assert.equal(hidden?.totalDf, 3);
      assert.equal(loadScoreBank(repo, { excludeFiles: ["ledger.campaign1-x.jsonl", "ledger.campaign2-y.jsonl"] }), null);
    });
  });
});
