/**
 * 连续漂移复核（纯函数，无 DOM 依赖）
 *
 * 读头在一次刷卡中持续缓慢变速：复核为每个原始间隔选择各自的整数局部时钟
 * τ[i] ∈ [80,120]（微秒），相邻局部时钟之差 |τ[i+1]-τ[i]| 不得超过检修员填写的
 * 上限 maxJump。每个间隔仍按既有规则相对自己的局部时钟判定长短型（互斥），
 * 整条记录再统一按短型成位、奇校验、帧结构与 LRC 校验——不切段、不逐项独立判定。
 *
 * 关键事实（与普通裁决相同，容差 6、τ ∈ 80..120）：
 *   长型窗口 [d-6, d+6] 与 [80,120] 相交 ⟺ d ∈ [74,126]
 *   短型窗口 [2d-6, 2d+6] 与 [80,120] 相交 ⟺ d ∈ [37,63]
 * 两区间不相交，因此每个间隔的长短型归属被其时长唯一确定，所有合法时钟轨迹
 * （完整见证）解出的数字串必然相同；复核的自由度仅在于为每个间隔选择窗口内的
 * 局部时钟。多数字串的汇总分支仍按规格完整实现（见 summarizeDriftWitnesses），
 * 以防参数调整后出现多解。
 *
 * 汇总方式与普通裁决一致：按解出的数字串汇总所有完整见证。同一数字串的多条
 * 轨迹中，用于图示的一条先取总跳变量 Σ|τ[i+1]-τ[i]| 最小，再取逐间隔时钟序列
 * 字典序最小。maxJump = 0 时合法轨迹只能是固定时钟，结果与普通裁决一致。
 */
import {
  TAU_MIN,
  TAU_MAX,
  TAU_TOLERANCE,
  decodeClasses,
  type BitGroup,
  type IntervalClass,
} from './decode';

/** 一个间隔在其局部时钟下的可行归属与对应的整数时钟窗口（含端点） */
export interface IntervalWindow {
  cls: IntervalClass;
  lo: number;
  hi: number;
}

/**
 * 计算单个间隔的可行分类与局部时钟窗口：长型要求 |d-τ|≤6，短型要求 |2d-τ|≤6，
 * τ 为 [80,120] 内整数。两者在现有参数下不会同时可行；皆不可行时返回 null
 * （该间隔在任何局部时钟下都无法分类，整条记录不存在见证）。
 */
export function intervalWindow(d: number): IntervalWindow | null {
  const loL = Math.max(TAU_MIN, d - TAU_TOLERANCE);
  const hiL = Math.min(TAU_MAX, d + TAU_TOLERANCE);
  if (loL <= hiL) return { cls: 'L', lo: loL, hi: hiL };
  const loS = Math.max(TAU_MIN, 2 * d - TAU_TOLERANCE);
  const hiS = Math.min(TAU_MAX, 2 * d + TAU_TOLERANCE);
  if (loS <= hiS) return { cls: 'S', lo: loS, hi: hiS };
  return null;
}

export interface ClockTrajectory {
  /** 逐间隔局部时钟（微秒），长度 = 间隔数 */
  clocks: number[];
  /** 总跳变量 Σ|clocks[i+1]-clocks[i]| */
  totalJump: number;
}

/**
 * 在逐间隔时钟窗口与相邻跳变上限下，求用于图示的最优时钟轨迹：
 * 先使总跳变量最小，再使逐间隔时钟序列字典序最小；无可行轨迹时返回 null。
 * 动态规划 + 自前向后贪心重建，O(n · 41²)。
 */
export function optimalClockTrajectory(windows: IntervalWindow[], maxJump: number): ClockTrajectory | null {
  const n = windows.length;
  if (n === 0) return null;

  // cost[i][t-lo_i] = 第 i 个间隔取时钟 t 时，从 i 到末尾的最小剩余跳变量
  const cost: number[][] = new Array(n);
  const last = windows[n - 1];
  cost[n - 1] = new Array(last.hi - last.lo + 1).fill(0);
  for (let i = n - 2; i >= 0; i--) {
    const w = windows[i];
    const wn = windows[i + 1];
    const arr = new Array(w.hi - w.lo + 1).fill(Infinity);
    for (let t = w.lo; t <= w.hi; t++) {
      const lo = Math.max(wn.lo, t - maxJump);
      const hi = Math.min(wn.hi, t + maxJump);
      let best = Infinity;
      for (let t2 = lo; t2 <= hi; t2++) {
        const c = Math.abs(t2 - t) + cost[i + 1][t2 - wn.lo];
        if (c < best) best = c;
      }
      arr[t - w.lo] = best;
    }
    cost[i] = arr;
  }

  let total = Infinity;
  for (let t = windows[0].lo; t <= windows[0].hi; t++) {
    total = Math.min(total, cost[0][t - windows[0].lo]);
  }
  if (!Number.isFinite(total)) return null;

  // 字典序最小重建：逐位取仍能达到最小总跳变量的最小时钟
  const clocks: number[] = [];
  let remaining = total;
  for (let i = 0; i < n; i++) {
    const w = windows[i];
    const prev = i === 0 ? null : clocks[i - 1];
    let chosen = -1;
    for (let t = w.lo; t <= w.hi; t++) {
      const edge = prev === null ? 0 : Math.abs(t - prev);
      if (edge > maxJump) continue;
      if (edge + cost[i][t - w.lo] === remaining) {
        chosen = t;
        remaining -= edge;
        break;
      }
    }
    if (chosen < 0) return null; // 不会发生（DP 与重建一致），防御性返回
    clocks.push(chosen);
  }
  return { clocks, totalJump: total };
}

/** 一条完整见证：合法时钟轨迹 + 该轨迹下整帧解码的全部信息 */
export interface DriftWitness extends ClockTrajectory {
  classes: IntervalClass[];
  bits: number[];
  members: number[][];
  groups: BitGroup[];
  codes: number[];
  digits: string;
}

export interface DriftDigitsEntry {
  digits: string;
  /** 该数字串用于图示的代表轨迹：总跳变量最小，其次时钟序列字典序最小 */
  best: DriftWitness;
}

export type DriftReview =
  | { status: 'unreadable' }
  | { status: 'decoded'; digits: string; best: DriftWitness }
  | { status: 'ambiguous'; entries: DriftDigitsEntry[] };

/** 见证排序：总跳变量小者优先；相同则逐间隔时钟序列字典序小者优先 */
export function preferWitness(a: DriftWitness, b: DriftWitness): boolean {
  if (a.totalJump !== b.totalJump) return a.totalJump < b.totalJump;
  const len = Math.min(a.clocks.length, b.clocks.length);
  for (let i = 0; i < len; i++) {
    if (a.clocks[i] !== b.clocks[i]) return a.clocks[i] < b.clocks[i];
  }
  return a.clocks.length < b.clocks.length;
}

/**
 * 把所有完整见证按解出的数字串汇总：
 * 无见证 -> unreadable；单一数字串 -> decoded（附代表轨迹）；
 * 多个数字串 -> ambiguous，按数字串字典序列出。
 */
export function summarizeDriftWitnesses(witnesses: DriftWitness[]): DriftReview {
  const byDigits = new Map<string, DriftWitness>();
  for (const w of witnesses) {
    const cur = byDigits.get(w.digits);
    if (!cur || preferWitness(w, cur)) byDigits.set(w.digits, w);
  }

  if (byDigits.size === 0) return { status: 'unreadable' };
  if (byDigits.size === 1) {
    const [digits, best] = [...byDigits.entries()][0];
    return { status: 'decoded', digits, best };
  }
  const entries: DriftDigitsEntry[] = [...byDigits.entries()]
    .map(([digits, best]) => ({ digits, best }))
    .sort((a, b) => (a.digits < b.digits ? -1 : a.digits > b.digits ? 1 : 0));
  return { status: 'ambiguous', entries };
}

/**
 * 连续漂移复核主入口：对整条记录联合求解（不切段、不逐项独立判定）。
 *
 * 由于每个间隔的长短型归属被时长唯一确定，所有完整见证的数字串相同；
 * 用最优轨迹（总跳变量最小、字典序最小）作为该串的代表见证提交汇总。
 */
export function reviewDrift(durations: number[], maxJump: number): DriftReview {
  const windows: IntervalWindow[] = [];
  const classes: IntervalClass[] = [];
  for (const d of durations) {
    const w = intervalWindow(d);
    if (!w) return { status: 'unreadable' };
    windows.push(w);
    classes.push(w.cls);
  }

  const decoded = decodeClasses(classes);
  if (!decoded.ok) return { status: 'unreadable' };

  const traj = optimalClockTrajectory(windows, maxJump);
  if (!traj) return { status: 'unreadable' };

  const witness: DriftWitness = {
    ...traj,
    classes,
    bits: decoded.bits,
    members: decoded.members,
    groups: decoded.groups,
    codes: decoded.codes,
    digits: decoded.digits,
  };
  return summarizeDriftWitnesses([witness]);
}

/**
 * 校验检修员填写的“相邻间隔允许的整数时钟跳变量”：必须为不小于 0 的整数。
 * 非法时调用方必须撤下旧漂移结论。
 */
export function validateJumpLimit(raw: string): { ok: true; value: number } | { ok: false; message: string } {
  const t = raw.trim();
  if (t === '') return { ok: false, message: '请填写相邻间隔允许的整数时钟跳变量' };
  if (!/^\d+$/.test(t)) return { ok: false, message: '跳变量必须为不小于 0 的整数（微秒）' };
  return { ok: true, value: Number(t) };
}
