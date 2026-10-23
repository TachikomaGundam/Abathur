#!/usr/bin/env node
// plan-seg-check.mjs — PLAN-SEG 机械校验器（planning-capability-design-20261022 v5 §5 的判定面）
// 用法: node plan-seg-check.mjs <ledger-file> [--plan <plan-file>] [--seglogs <dir>]
// 退出码: 0=全部通过 1=有违规(逐条打印) 2=用法/环境错误
// 判定面(机械可判): 字段齐备与顺序 / 段号连续 / 五格非占位 / plan 哈希匹配(--plan 时) /
// END 条目格式与日志哈希(--seglogs 时)。不判定"做得对不对"。
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const US = "\x1f"; // ASCII 0x1F 单位分隔符
const SEG_TAGS = ["plan", "seg", "目标", "路径", "验收", "禁项", "回滚"];
const END_TAGS = ["seg", "cmd", "exit", "log_sha256"];
const PLACEHOLDER = /^(无|N\/A|TBD|待定|略)$/i;
const HEX64 = /^[0-9a-f]{64}$/;

function fail(msg, violations) { violations.push(msg); }

function parseEntry(line, tags) {
  // 行形态: [PLAN-SEG]␟k1=v1␟k2=v2…  或  [PLAN-SEG-END]␟…
  const m = line.match(/^\[(PLAN-SEG(?:-END)?)\](.*)$/);
  if (!m) return null;
  const kind = m[1];
  const parts = m[2].split(US).filter((p) => p.length > 0);
  const out = { kind, fields: {} };
  for (let i = 0; i < tags.length; i++) {
    const p = parts[i];
    if (p === undefined) return { kind, error: `字段数不足: 期望 ${tags.length} 个, 实得 ${parts.length}` };
    const eq = p.indexOf("=");
    if (eq < 0 || p.slice(0, eq) !== tags[i]) {
      return { kind, error: `字段 ${i + 1} 应为 ${tags[i]}= 开头, 实得: ${p.slice(0, 24)}…` };
    }
    out.fields[tags[i]] = p.slice(eq + 1);
  }
  if (parts.length > tags.length) return { kind, error: `字段数超出: 期望 ${tags.length}, 实得 ${parts.length}` };
  return out;
}

function planHash(planFile) {
  // §2: 五格值逐格 trim、NFC、按 目标\n路径\n验收\n禁项\n回滚\n 拼接, UTF-8, sha256 前16
  const lines = readFileSync(planFile, "utf8").split("\n").filter((l) => l.trim() !== "");
  const grids = {};
  for (const l of lines) {
    const eq = l.indexOf("=");
    if (eq > 0) grids[l.slice(0, eq).trim()] = l.slice(eq + 1).trim();
  }
  const order = ["目标", "路径", "验收", "禁项", "回滚"];
  for (const g of order) if (!(g in grids)) throw new Error(`计划工件缺 ${g} 格`);
  const norm = order.map((g) => grids[g].normalize("NFC")).join("\n") + "\n";
  return createHash("sha256").update(norm, "utf8").digest("hex").slice(0, 16);
}

function main(argv) {
  const violations = [];
  const args = argv.slice(2);
  if (args.length < 1) { console.error("usage: node plan-seg-check.mjs <ledger> [--plan f] [--seglogs d]"); return 2; }
  const ledgerFile = args[0];
  const planFile = args.includes("--plan") ? args[args.indexOf("--plan") + 1] : null;
  const seglogs = args.includes("--seglogs") ? args[args.indexOf("--seglogs") + 1] : null;
  if (!existsSync(ledgerFile)) { console.error(`账本不存在: ${ledgerFile}`); return 2; }

  let expectHash = null;
  if (planFile) {
    try { expectHash = planHash(planFile); }
    catch (e) { console.error(`计划工件解析失败: ${e.message}`); return 2; }
  }

  const lines = readFileSync(ledgerFile, "utf8").split("\n");
  const segs = [];
  const ends = [];
  for (const [ln, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line.startsWith("[PLAN-SEG")) continue;
    const isEnd = line.startsWith("[PLAN-SEG-END]");
    const e = parseEntry(line, isEnd ? END_TAGS : SEG_TAGS);
    if (!e) continue;
    if (e.error) { fail(`L${ln + 1}: ${e.error}`, violations); continue; }
    (isEnd ? ends : segs).push({ ...e, ln: ln + 1 });
  }

  if (segs.length === 0) fail("账本中无 PLAN-SEG 条目", violations);

  // 段号连续: P1..Pn 无缺口无重复
  const seen = new Set();
  segs.forEach((s, i) => {
    const want = `P${i + 1}`;
    if (s.fields.seg !== want) fail(`L${s.ln}: 段号不连续, 期望 ${want}, 实得 ${s.fields.seg}`, violations);
    if (seen.has(s.fields.seg)) fail(`L${s.ln}: 段号重复 ${s.fields.seg}`, violations);
    seen.add(s.fields.seg);
  });

  // plan 哈希一致性 + 与工件对账
  const planIds = new Set(segs.map((s) => s.fields.plan));
  if (planIds.size > 1) fail(`同一账本出现多个 plan 哈希: ${[...planIds].join(",")} —— 多版本计划冲突, 须裁定`, violations);
  if (expectHash) {
    for (const s of segs) {
      if (s.fields.plan !== expectHash) {
        fail(`L${s.ln}: plan=${s.fields.plan} 与工件现值 ${expectHash} 不符 —— 计划漂移, 停段重宣布`, violations);
      }
    }
  }

  // 五格非占位(§1 封闭判据)
  for (const s of segs) {
    const f = s.fields;
    for (const g of ["目标", "路径", "禁项", "回滚"]) {
      if (PLACEHOLDER.test(f[g].trim())) fail(`L${s.ln}: ${g} 格为占位符「${f[g]}」`, violations);
    }
    if (!f["目标"].trim()) fail(`L${s.ln}: 目标格为空`, violations);
    if (!f["路径"].split(/\s+/).some((t) => t.startsWith("/"))) {
      fail(`L${s.ln}: 路径格无绝对路径「${f["路径"].slice(0, 40)}」`, violations);
    }
    const acc = f["验收"].trim();
    if (!acc || PLACEHOLDER.test(acc) || !/[\s=\/|]/.test(acc)) {
      fail(`L${s.ln}: 验收格无可复算命令「${acc.slice(0, 40)}」`, violations);
    }
    if (/^不适用$/.test(f["禁项"].trim())) fail(`L${s.ln}: 禁项格裸『不适用』无引用`, violations);
  }

  // END 条目: 对应段已开工、exit 数字、log_sha256 64-hex、(--seglogs 时)日志实存且哈希相符
  for (const e of ends) {
    if (!seen.has(e.fields.seg)) fail(`L${e.ln}: END 段 ${e.fields.seg} 无对应开工条目`, violations);
    if (!/^\d+$/.test(e.fields.exit)) fail(`L${e.ln}: exit 非数字「${e.fields.exit}」`, violations);
    if (!HEX64.test(e.fields.log_sha256)) fail(`L${e.ln}: log_sha256 非 64-hex`, violations);
    if (seglogs && HEX64.test(e.fields.log_sha256)) {
      const p = `${seglogs}/${e.fields.seg}.log`;
      if (!existsSync(p)) fail(`L${e.ln}: 段日志缺失 ${p}`, violations);
      else {
        const h = createHash("sha256").update(readFileSync(p)).digest("hex");
        if (h !== e.fields.log_sha256) fail(`L${e.ln}: ${p} 哈希不符(账本 ${e.fields.log_sha256.slice(0, 12)}… ≠ 盘上 ${h.slice(0, 12)}…)`, violations);
      }
    }
  }

  if (violations.length) {
    for (const v of violations) console.error(`VIOLATION ${v}`);
    return 1;
  }
  console.log(`plan-seg-check: PASS (segs=${segs.length} ends=${ends.length}${expectHash ? ` plan=${expectHash}` : ""})`);
  return 0;
}

process.exit(main(process.argv));
