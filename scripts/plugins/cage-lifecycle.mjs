// cage-lifecycle.mjs —— 会话笼子与 launcher 的出生时间判定（2026-10-31）
//
// 事故：SimpleCut 会话的沙盒自 2026-10-28 起是无网络旧笼（净接口仅 lo、uid_map 单行、
// pidns 内 shell 恒为 pid2、挂载指纹 /var/tmp/abathur.CmX18Guq），基础设施修复后
// 该会话仍绑定旧笼，杀 pid1/pid2 均被同命名空间重生，服务重启亦不回收。
// 同族前案：2026-10-22 僵尸进程活过修复。
//
// 判定规则（唯一来源）：笼子出生时间早于 launcher 自身启动时间 => DISCARDED。
// 反向不成立：launcher 重启后复用一个更晚出生的笼子是允许的（热迁移场景）。
// 任何一侧时间缺失 => UNKNOWN（fail-closed，调用方必须重建而不是沿用）。

export const VERDICT = Object.freeze({
  FRESH: "FRESH",
  DISCARDED: "DISCARDED",
  UNKNOWN: "UNKNOWN",
});

/**
 * @param {{cageBornAt?: string|number|Date|null, launcherStartedAt?: string|number|Date|null}} input
 * @returns {{verdict: string, reason: string, deltaMs: number|null}}
 */
export function classifyCage({ cageBornAt, launcherStartedAt } = {}) {
  const cage = toMs(cageBornAt);
  const launcher = toMs(launcherStartedAt);
  if (cage === null || launcher === null) {
    return { verdict: VERDICT.UNKNOWN, reason: "missing birth time on one side", deltaMs: null };
  }
  const deltaMs = cage - launcher;
  if (deltaMs < 0) {
    return { verdict: VERDICT.DISCARDED, reason: "cage was born before this launcher started", deltaMs };
  }
  return { verdict: VERDICT.FRESH, reason: "cage was born after this launcher started", deltaMs };
}

/** 任一形态（epoch ms、ISO、Date）转毫秒；不可解析返回 null 而不是 NaN。 */
export function toMs(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) return Number(trimmed);
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** 只有 FRESH 允许沿用；其余一律要求重建。 */
export function mustRebuild(result) {
  return !result || result.verdict !== VERDICT.FRESH;
}
