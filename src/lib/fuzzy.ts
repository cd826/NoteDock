/**
 * 轻量模糊匹配（⌘P 快速打开）：不引第三方依赖。
 * 规则：query 为子序列匹配；连续命中与前缀命中加分；返回 null 表示不匹配。
 * 全部按小写比较。
 */
export interface FuzzyResult {
  /** 0 = 完美（前缀），越大越差；null = 不匹配 */
  score: number;
}

export function fuzzyMatch(text: string, query: string): FuzzyResult | null {
  const t = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return { score: 0 };
  if (t.includes(q)) {
    // 前缀命中最优，其余包含按位置靠前加分
    const idx = t.indexOf(q);
    return { score: idx === 0 ? 0 : 10 + idx };
  }
  // 子序列匹配
  let ti = 0;
  let score = 100;
  let lastHit = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    if (lastHit >= 0 && found !== lastHit + 1) score += 5; // 跳跃惩罚
    lastHit = found;
    ti = found + 1;
  }
  return { score: score + t.length * 0.1 };
}
