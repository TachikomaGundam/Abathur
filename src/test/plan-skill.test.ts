// plan-skill.test.ts — abathur-plan 能力（SKILL.md + plan-seg-check.mjs）的钉字与行为测试
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const SKILL = join(ROOT, "..", "skills", "abathur-plan", "SKILL.md");
const CHECKER = join(ROOT, "..", "skills", "abathur-plan", "plan-seg-check.mjs");

const US = "\x1f";

function segLine(plan: string, seg: string, over: Record<string, string> = {}): string {
  const f = {
    plan, seg,
    "目标": over["目标"] ?? "迁移锚链出仓树",
    "路径": over["路径"] ?? "/home/lab/a/.omo/anchor",
    "验收": over["验收"] ?? "bash verify.sh | tee out.log",
    "禁项": over["禁项"] ?? "不留软链",
    "回滚": over["回滚"] ?? "mv 四件回旧目录",
  };
  return ["[PLAN-SEG]", ...["plan", "seg", "目标", "路径", "验收", "禁项", "回滚"].map((k) => `${k}=${f[k as keyof typeof f]}`)].join(US);
}

function planFileOf(dir: string): { path: string; hash: string } {
  const grids: [string, string][] = [
    ["目标", "迁移锚链出仓树"], ["路径", "/home/lab/a/.omo/anchor"],
    ["验收", "bash verify.sh"], ["禁项", "不留软链"], ["回滚", "mv 回旧目录"],
  ];
  const p = join(dir, "PLAN.txt");
  writeFileSync(p, grids.map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  const norm = grids.map(([, v]) => v.normalize("NFC")).join("\n") + "\n";
  const hash = createHash("sha256").update(norm, "utf8").digest("hex").slice(0, 16);
  return { path: p, hash };
}

function runChecker(args: string[]): { status: number; out: string } {
  const r = spawnSync(process.execPath, [CHECKER, ...args], { encoding: "utf8" });
  return { status: r.status ?? 2, out: `${r.stdout}${r.stderr}` };
}

test("SKILL.md 存在且 frontmatter 具名 abathur-plan", () => {
  const s = readFileSync(SKILL, "utf8");
  assert.match(s, /^name: abathur-plan$/m);
  assert.match(s, /PLAN-SEG/);
});

test("checker: 合法账本 PASS（含 plan 哈希对账与段日志）", () => {
  const dir = mkdtempSync(join(tmpdir(), "planseg-"));
  const { path: planPath, hash } = planFileOf(dir);
  const seglogs = join(dir, "plan-segs");
  mkdirSync(seglogs);
  writeFileSync(join(seglogs, "P1.log"), "p1 output\n");
  const logHash = createHash("sha256").update(readFileSync(join(seglogs, "P1.log"))).digest("hex");
  const ledger = [
    segLine(hash, "P1"),
    segLine(hash, "P2", { "目标": "第二段", "验收": "ls /tmp | wc -l" }),
    ["[PLAN-SEG-END]", `seg=P1`, `cmd=bash verify.sh 2>&1 | tee ${join(seglogs, "P1.log")}`, "exit=0", `log_sha256=${logHash}`].join(US),
    "",
  ].join("\n");
  const lf = join(dir, "ledger.md");
  writeFileSync(lf, ledger);
  const r = runChecker([lf, "--plan", planPath, "--seglogs", seglogs]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /PASS/);
});

test("checker: 段号断裂/占位符/哈希漂移/日志哈希不符 各被抓", () => {
  const dir = mkdtempSync(join(tmpdir(), "planseg-bad-"));
  const { path: planPath, hash } = planFileOf(dir);
  const seglogs = join(dir, "plan-segs");
  mkdirSync(seglogs);
  writeFileSync(join(seglogs, "P1.log"), "tampered\n");
  const ledger = [
    segLine(hash, "P1", { "目标": "待定" }),                      // 占位符
    segLine("0000000000000000", "P3"),                            // 段号跳 P2 + plan 哈希漂移
    segLine(hash, "P3", { "禁项": "不适用" }),                    // 裸不适用 + 段号重复
    ["[PLAN-SEG-END]", "seg=P1", "cmd=ls /", "exit=0", `log_sha256=${"0".repeat(64)}`].join(US), // 日志哈希不符
    ["[PLAN-SEG-END]", "seg=P9", "cmd=ls /", "exit=x", `log_sha256=${"1".repeat(64)}`].join(US), // 无开工段 + exit 非数字
    "",
  ].join("\n");
  const lf = join(dir, "ledger.md");
  writeFileSync(lf, ledger);
  const r = runChecker([lf, "--plan", planPath, "--seglogs", seglogs]);
  assert.equal(r.status, 1);
  assert.match(r.out, /占位符/);
  assert.match(r.out, /段号不连续/);
  assert.match(r.out, /计划漂移/);
  assert.match(r.out, /裸『不适用』|裸「不适用」|无引用/);
  assert.match(r.out, /哈希不符/);
  assert.match(r.out, /无对应开工条目/);
  assert.match(r.out, /exit 非数字/);
  assert.match(r.out, /多个 plan 哈希/);
});

test("checker: 无 PLAN-SEG 条目的账本 = 违规（存在性判据）", () => {
  const dir = mkdtempSync(join(tmpdir(), "planseg-none-"));
  const lf = join(dir, "ledger.md");
  writeFileSync(lf, "# nothing here\n");
  const r = runChecker([lf]);
  assert.equal(r.status, 1);
  assert.match(r.out, /无 PLAN-SEG/);
});

test("checker: 用法错误 rc=2", () => {
  const r = runChecker([]);
  assert.equal(r.status, 2);
});

test("插件 AGENT_PROMPT 提及 abathur-plan 技能", () => {
  const plugin = readFileSync(join(ROOT, "..", "plugin", "abathur.ts"), "utf8");
  assert.match(plugin, /abathur-plan/);
});

test("仓级 AGENTS.md 含 PLAN-SEG 计划面章节", (t) => {
  // 发布包（孤儿分支）按 v0.3.0 先例不含仓级 AGENTS.md（内部座席操作面，不进公开面）；
  // 该语境下本钉字跳过——skip 具名原因，不静默。
  if (!existsSync(join(ROOT, "..", "AGENTS.md"))) {
    t.skip("release packet face: repo AGENTS.md intentionally excluded");
    return;
  }
  const agents = readFileSync(join(ROOT, "..", "AGENTS.md"), "utf8");
  assert.match(agents, /PLAN-SEG/);
});
