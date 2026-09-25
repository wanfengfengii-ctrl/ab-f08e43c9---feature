/**
 * 连续漂移复核（continuous-drift review）
 *
 * 一次刷卡中读头时钟持续缓慢变速：为每个原始间隔 i 选择整数局部时钟
 * τ_i ∈ [TAU_MIN, TAU_MAX]（微秒），相邻局部时钟之差不得超过检修员填写的
 * 上限 maxJump（|τ_{i+1} - τ_i| ≤ maxJump，短型对内部的两个间隔同样相邻）。
 *
 * 每项仍须按既有规则成立（长短型互斥、短型成对、奇校验、帧与 LRC），
 * 不能将记录先切段或逐项独立判定——所有约束必须在同一条逐间隔时钟序列上
 * 共同成立。
 *
 * 搜索方式：
 *  1. 递归枚举“长型位 / 短型对位”铺法（每种铺法 = 一种逐间隔分类方式），
 *     同时以“给定已选分类后，间隔 i-1 可达局部时钟集合”前向剪枝——
 *     时钟序列必须从头至尾连续满足跳变上限，不存在分段或独立判定。
 *  2. 每种走到末尾的完整铺法在其分类序列上整体做帧校验（成位/奇校验/帧/LRC）。
 *  3. 通过帧校验的铺法，在“间隔 × 局部时钟”网格上做有界跳跃 DP，
 *     求总跳变量最小、平局时钟序列字典序最小的规范轨迹，并计数全部完整见证。
 *  4. 按解出的数字串汇总。
 *
 * 备注：在给定参数（τ ∈ 80..120、容差 6）下，时长 d 的可判长型区间
 * [74,126] 与可判短型区间 [37,63] 不相交，铺法实际上至多一种（单测覆盖），
 * 因此结果与固定时钟裁决一样只会是 decoded / unreadable；多串的枚举与
 * 字典序汇总仍按规格完整保留，以防参数调整后出现多解。
 */
import {
  TAU_MIN,
  TAU_MAX,
  classifyInterval,
  buildFrame,
  type IntervalClass,
  type FrameData,
} from './decode';

export const DRIFT_MIN_JUMP = 0;
/** τ ∈ 80..120，相邻时钟差最大不超过 40 */
export const DRIFT_MAX_JUMP = TAU_MAX - TAU_MIN;

export interface DriftWitness {
  /** 逐间隔整数局部时钟（微秒），长度 = 间隔数 */
  clocks: number[];
  /** 总跳变量 Σ|τ_{i+1} - τ_i| */
  totalJump: number;
  /** 每次跳变 τ_{i+1} - τ_i（带符号），长度 = 间隔数 - 1 */
  jumps: number[];
  /** 该见证解出的数字串 */
  digits: string;
}

interface DriftReviewBase {
  maxJump: number;
}

export interface DriftDecoded extends DriftReviewBase {
  status: 'decoded';
  digits: string;
  /** 图示用规范见证：先总跳变量最小、再逐间隔时钟序列字典序最小 */
  canonical: DriftWitness;
  /** 该上限下完整见证（合法时钟序列）总数 */
  witnessCount: bigint;
  /** 由见证类别确定的帧结构（图示/码表用） */
  frame: FrameData;
}

export interface DriftAmbiguousEntry {
  digits: string;
  canonical: DriftWitness;
  witnessCount: bigint;
  frame: FrameData;
}

export interface DriftAmbiguous extends DriftReviewBase {
  status: 'ambiguous';
  /** 按数字串字典序升序 */
  entries: DriftAmbiguousEntry[];
}

export interface DriftUnreadable extends DriftReviewBase {
  status: 'unreadable';
  /** 不可见证的结构性原因（仅作页面提示，结论仍为 unreadable） */
  reason: string;
}

export type DriftReview = DriftDecoded | DriftAmbiguous | DriftUnreadable;

/** 候选时钟集合（升序，供字典序 tie-break） */
const ALL_TAUS: readonly number[] = Array.from(
  { length: TAU_MAX - TAU_MIN + 1 },
  (_, i) => TAU_MIN + i,
);

/** 每个间隔分别可判长型/短型的局部时钟集合（升序） */
export interface ClassOptions {
  L: number[];
  S: number[];
}

export function classOptions(d: number): ClassOptions {
  const L: number[] = [];
  const S: number[] = [];
  for (const t of ALL_TAUS) {
    const c = classifyInterval(d, t);
    if (c === 'L') L.push(t);
    else if (c === 'S') S.push(t);
  }
  return { L, S };
}

/**
 * 当前参数下每个间隔在全时钟范围内“唯一可充当”的类别（长短型互斥定理）。
 * 'none' 表示任何时钟都无法分类，'both' 在本参数下不应出现。
 */
export function intervalStructure(d: number): IntervalClass | 'none' | 'both' {
  const { L, S } = classOptions(d);
  if (L.length > 0 && S.length > 0) return 'both';
  if (L.length > 0) return 'L';
  if (S.length > 0) return 'S';
  return 'none';
}

interface Cell {
  cost: number;
  seq: number[];
}

function compareSeq(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/**
 * 求规范时钟序列：总跳变量最小，平局取逐间隔时钟序列字典序最小。
 * 逐对相邻时钟差（含短型对内部）受 maxJump 限制；调用方须保证 allowed 非空。
 */
export function bestTrajectory(
  allowed: number[][],
  maxJump: number,
): { clocks: number[]; totalJump: number; jumps: number[] } | null {
  const n = allowed.length;
  if (n === 0) return null;

  // dp：Map<末时钟 t, 最优（最小代价、平局字典序最小）前缀>
  let dp = new Map<number, Cell>();
  for (const t of allowed[0]) dp.set(t, { cost: 0, seq: [t] });

  for (let i = 1; i < n && dp.size > 0; i++) {
    const next = new Map<number, Cell>();
    for (const t of allowed[i]) {
      let best: Cell | null = null;
      for (const [prev, cell] of dp) {
        const delta = Math.abs(t - prev);
        if (delta > maxJump) continue;
        const cand: Cell = { cost: cell.cost + delta, seq: [...cell.seq, t] };
        if (
          !best ||
          cand.cost < best.cost ||
          (cand.cost === best.cost && compareSeq(cand.seq, best.seq) < 0)
        ) {
          best = cand;
        }
      }
      if (best) next.set(t, best);
    }
    dp = next;
  }

  if (dp.size === 0) return null;
  let winner: Cell | null = null;
  for (const cell of dp.values()) {
    if (
      !winner ||
      cell.cost < winner.cost ||
      (cell.cost === winner.cost && compareSeq(cell.seq, winner.seq) < 0)
    ) {
      winner = cell;
    }
  }
  if (!winner) return null;

  const clocks = winner.seq;
  const jumps: number[] = [];
  for (let i = 1; i < clocks.length; i++) jumps.push(clocks[i] - clocks[i - 1]);
  return { clocks, totalJump: winner.cost, jumps };
}

/** 完整见证（合法逐间隔时钟序列）总数 */
export function countTrajectories(allowed: number[][], maxJump: number): bigint {
  if (allowed.length === 0) return 0n;
  let dp = new Map<number, bigint>();
  for (const t of allowed[0]) dp.set(t, 1n);
  for (let i = 1; i < allowed.length; i++) {
    const next = new Map<number, bigint>();
    for (const t of allowed[i]) {
      let sum = 0n;
      for (const [prev, cnt] of dp) {
        if (Math.abs(t - prev) <= maxJump) sum += cnt;
      }
      if (sum > 0n) next.set(t, sum);
    }
    dp = next;
  }
  let total = 0n;
  for (const cnt of dp.values()) total += cnt;
  return total;
}

interface Tiling {
  /** 每个间隔选择的类别 */
  classes: IntervalClass[];
  /** 每个间隔在所选类别下允许的局部时钟 */
  allowed: number[][];
}

/** 与 reachable 中某时钟相差不超过 maxJump 的 allowed 时钟（保持升序） */
function reachableNext(allowed: number[], reachable: Set<number>, maxJump: number): number[] {
  return allowed.filter((t) => {
    for (const p of reachable) if (Math.abs(t - p) <= maxJump) return true;
    return false;
  });
}

/**
 * 枚举所有完整铺法：逐位放长型（1 间隔）或短型对（2 间隔），
 * 并沿整条记录传播“可达局部时钟”集合剪枝，确保跳变约束连续成立。
 */
function enumerateTilings(durations: number[], maxJump: number): Tiling[] {
  const options = durations.map(classOptions);
  const n = durations.length;
  const out: Tiling[] = [];

  const walk = (
    i: number,
    classes: IntervalClass[],
    allowed: number[][],
    reach: Set<number> | null,
  ): void => {
    if (i === n) {
      out.push({ classes: [...classes], allowed: allowed.map((a) => [...a]) });
      return;
    }

    // 长型位：间隔 i 为 L
    const reachL = reach === null ? options[i].L : reachableNext(options[i].L, reach, maxJump);
    if (reachL.length > 0) {
      classes.push('L');
      allowed.push(reachL);
      walk(i + 1, classes, allowed, new Set(reachL));
      classes.pop();
      allowed.pop();
    }

    // 短型对位：间隔 i、i+1 均为 S（两者内部时钟差同样受限）
    if (i + 1 < n) {
      const reachS0 = reach === null ? options[i].S : reachableNext(options[i].S, reach, maxJump);
      if (reachS0.length > 0) {
        const reachS1 = reachableNext(options[i + 1].S, new Set(reachS0), maxJump);
        if (reachS1.length > 0) {
          classes.push('S', 'S');
          allowed.push(reachS0, reachS1);
          walk(i + 2, classes, allowed, new Set(reachS1));
          classes.pop();
          classes.pop();
          allowed.pop();
          allowed.pop();
        }
      }
    }
  };

  walk(0, [], [], null);
  return out;
}

interface AcceptedStructure {
  frame: FrameData;
  allowed: number[][];
}

/**
 * 连续漂移复核：在所有完整见证中按解出的数字串汇总。
 */
export function reviewDrift(durations: number[], maxJump: number): DriftReview {
  // 结构预检查（与跳变上限无关）：
  //  - 任何时钟都无法分类的间隔；
  //  - 类别由时长唯一确定（本参数下长短型全时钟范围互斥，单测覆盖）时，
  //    直接在该唯一分类上整体做帧校验：孤立短型/奇校验/帧/LRC 失败
  //    不会因放宽上限而改变，优先作为 unreadable 原因。
  const kinds: (IntervalClass | 'none' | 'both')[] = durations.map(intervalStructure);
  for (let i = 0; i < kinds.length; i++) {
    if (kinds[i] === 'none') {
      return {
        status: 'unreadable',
        maxJump,
        reason: `间隔 ${i + 1}（${durations[i]}µs）在 ${TAU_MIN}..${TAU_MAX}µs 内既无法判长型也无法判短型`,
      };
    }
  }
  if (!kinds.includes('both')) {
    const structural = buildFrame(kinds as IntervalClass[]);
    if (!structural.ok) return { status: 'unreadable', maxJump, reason: structural.reason };
  }

  const tilings = enumerateTilings(durations, maxJump);
  if (tilings.length === 0) {
    return {
      status: 'unreadable',
      maxJump,
      reason: `不存在相邻时钟差均不超过 ${maxJump}µs 的逐间隔时钟序列（短型对内部同样受限）`,
    };
  }

  const accepted: AcceptedStructure[] = [];
  let frameReason = '';
  for (const tiling of tilings) {
    const frame = buildFrame(tiling.classes);
    if (frame.ok) {
      accepted.push({ frame, allowed: tiling.allowed });
    } else if (frameReason === '') {
      frameReason = frame.reason;
    }
  }

  if (accepted.length === 0) {
    return { status: 'unreadable', maxJump, reason: frameReason || '没有任何完整见证通过帧规则' };
  }

  const groups = accepted.map(({ frame, allowed }) => {
    const traj = bestTrajectory(allowed, maxJump)!;
    const canonical: DriftWitness = {
      clocks: traj.clocks,
      totalJump: traj.totalJump,
      jumps: traj.jumps,
      digits: frame.digits,
    };
    return {
      digits: frame.digits,
      canonical,
      witnessCount: countTrajectories(allowed, maxJump),
      frame,
    };
  });

  // 同一数字串（多种铺法理论上可能）合并：规范轨迹取最优，见证数相加
  const byDigits = new Map<string, DriftAmbiguousEntry>();
  for (const g of groups) {
    const prev = byDigits.get(g.digits);
    if (!prev) {
      byDigits.set(g.digits, g);
      continue;
    }
    const gBetter =
      g.canonical.totalJump < prev.canonical.totalJump ||
      (g.canonical.totalJump === prev.canonical.totalJump &&
        compareSeq(g.canonical.clocks, prev.canonical.clocks) < 0);
    byDigits.set(g.digits, {
      digits: g.digits,
      canonical: gBetter ? g.canonical : prev.canonical,
      witnessCount: prev.witnessCount + g.witnessCount,
      frame: gBetter ? g.frame : prev.frame,
    });
  }

  const entries = [...byDigits.values()].sort((a, b) =>
    a.digits < b.digits ? -1 : a.digits > b.digits ? 1 : 0,
  );

  if (entries.length === 1) {
    const e = entries[0];
    return {
      status: 'decoded',
      maxJump,
      digits: e.digits,
      canonical: e.canonical,
      witnessCount: e.witnessCount,
      frame: e.frame,
    };
  }
  return { status: 'ambiguous', maxJump, entries };
}

/** 校验检修员填写的跳变上限：必须是 0..40 的整数文本 */
export function validateJumpLimit(text: string):
  | { ok: true; value: number }
  | { ok: false; message: string } {
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return { ok: false, message: '跳变上限必须是整数（微秒）' };
  }
  const value = Number(trimmed);
  if (value < DRIFT_MIN_JUMP || value > DRIFT_MAX_JUMP) {
    return { ok: false, message: `跳变上限必须在 ${DRIFT_MIN_JUMP}..${DRIFT_MAX_JUMP} 微秒内` };
  }
  return { ok: true, value };
}
