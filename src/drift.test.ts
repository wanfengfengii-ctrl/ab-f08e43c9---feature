import { describe, it, expect } from 'vitest';
import {
  reviewDrift,
  bestTrajectory,
  countTrajectories,
  validateJumpLimit,
  intervalStructure,
  classOptions,
  DRIFT_MIN_JUMP,
  DRIFT_MAX_JUMP,
} from './drift';
import { decodePulses, classifyInterval } from './decode';
import { encodeDigits, encodeDigitsDrift, rampClock } from './encode';

describe('validateJumpLimit', () => {
  it('接受 0..40 的整数文本', () => {
    expect(validateJumpLimit('0')).toEqual({ ok: true, value: 0 });
    expect(validateJumpLimit(' 3 ')).toEqual({ ok: true, value: 3 });
    expect(validateJumpLimit(String(DRIFT_MAX_JUMP))).toEqual({ ok: true, value: 40 });
    expect(DRIFT_MIN_JUMP).toBe(0);
  });

  it('拒绝非整数、越界与负数', () => {
    expect(validateJumpLimit('').ok).toBe(false);
    expect(validateJumpLimit('abc').ok).toBe(false);
    expect(validateJumpLimit('1.5').ok).toBe(false);
    expect(validateJumpLimit('-1').ok).toBe(false);
    expect(validateJumpLimit('41').ok).toBe(false);
  });
});

describe('长短型在全时钟范围内互斥（结构唯一）', () => {
  it('20..150 的任何时长都不会在不同时钟下既可长型又可短型', () => {
    for (let d = 20; d <= 150; d++) {
      expect(intervalStructure(d)).not.toBe('both');
    }
  });

  it('classOptions 与逐 τ 分类一致；20/150 在 τ∈80..120 下都不可分类', () => {
    for (const d of [37, 42, 50, 63, 74, 84, 100, 116, 126]) {
      const { L, S } = classOptions(d);
      for (let t = 80; t <= 120; t++) {
        const c = classifyInterval(d, t);
        if (c === 'L') expect(L).toContain(t);
        if (c === 'S') expect(S).toContain(t);
      }
      expect(L.length + S.length).toBeGreaterThan(0);
    }
    expect(intervalStructure(20)).toBe('none');
    expect(intervalStructure(150)).toBe('none'); // 长型需 τ≥144，超出 120
  });
});

describe('bestTrajectory / countTrajectories（DP 规范轨迹）', () => {
  it('唯一最优路径精确还原时钟与带符号跳变', () => {
    const allowed = [[80], [81], [83], [82]];
    const r = bestTrajectory(allowed, 2)!;
    expect(r.clocks).toEqual([80, 81, 83, 82]);
    expect(r.jumps).toEqual([1, 2, -1]);
    expect(r.totalJump).toBe(4);
    expect(countTrajectories(allowed, 2)).toBe(1n);
  });

  it('同总跳变量时取逐间隔时钟序列字典序最小', () => {
    const r = bestTrajectory([[100], [90, 110], [100]], 10)!;
    expect(r.totalJump).toBe(20);
    expect(r.clocks).toEqual([100, 90, 100]); // 而非 [100,110,100]
    expect(countTrajectories([[100], [90, 110], [100]], 10)).toBe(2n);
  });

  it('上限不足无解；计数只统计有界可达路径', () => {
    expect(bestTrajectory([[100], [90, 110], [100]], 9)).toBeNull();
    expect(countTrajectories([[100], [90, 110], [100]], 9)).toBe(0n);
    expect(countTrajectories([[80], [81, 82]], 2)).toBe(2n);
  });
});

describe('连续漂移复核', () => {
  it('跳变上限 0 与固定时钟裁决一致：固定数据 decoded，规范轨迹为常量最小 τ', () => {
    const durations = encodeDigits('123', 100);
    const ordinary = decodePulses(durations);
    expect(ordinary.status).toBe('decoded');

    const review = reviewDrift(durations, 0);
    expect(review.status).toBe('decoded');
    if (review.status !== 'decoded') return;
    expect(review.digits).toBe('123');
    expect(review.canonical.totalJump).toBe(0);
    expect(review.canonical.jumps.every((j) => j === 0)).toBe(true);
    const t0 = review.canonical.clocks[0];
    expect(review.canonical.clocks.every((t) => t === t0)).toBe(true);
    // 与普通裁决取“最小 τ”一致（94..106 均可，字典序最小为 94）
    expect(t0).toBe(94);
    if (ordinary.status === 'decoded') expect(t0).toBe(ordinary.min.tau);
  });

  it('跳变上限 0 时固定裁决 unreadable 的漂移复核仍 unreadable（孤立短型）', () => {
    const durations = [...encodeDigits('1', 100), 50];
    expect(decodePulses(durations).status).toBe('unreadable');
    const review = reviewDrift(durations, 0);
    expect(review.status).toBe('unreadable');
    if (review.status === 'unreadable') expect(review.reason).toContain('孤立短型');
  });

  it('持续变速数据：固定裁决 unreadable，足够上限下复核 decoded，轨迹共同满足全部规则', () => {
    const clockAt = rampClock(84, 116);
    const durations = encodeDigitsDrift('5209', clockAt);
    const expectedClocks = durations.map((_, i) => clockAt(i, durations.length));
    const maxStep = Math.max(...expectedClocks.slice(1).map((t, i) => Math.abs(t - expectedClocks[i])));
    expect(maxStep).toBe(1);

    // 固定 τ：首间隔要求 τ≤90、末间隔要求 τ≥110，无公共固定时钟
    expect(decodePulses(durations).status).toBe('unreadable');
    // 上限 0：常量时钟无法跨越 84→116 的漂移
    expect(reviewDrift(durations, 0).status).toBe('unreadable');

    const review = reviewDrift(durations, maxStep);
    expect(review.status).toBe('decoded');
    if (review.status !== 'decoded') return;
    expect(review.digits).toBe('5209');

    const { clocks, jumps, totalJump } = review.canonical;
    expect(clocks).toHaveLength(durations.length);
    clocks.forEach((t, i) => {
      expect(t).toBeGreaterThanOrEqual(80);
      expect(t).toBeLessThanOrEqual(120);
      expect(Number.isInteger(t)).toBe(true);
      // 长短型互斥仍须逐项成立（不能既长又短或都不是）
      expect(['L', 'S']).toContain(classifyInterval(durations[i], t));
    });
    jumps.forEach((j) => expect(Math.abs(j)).toBeLessThanOrEqual(maxStep));
    // 总跳变量与逐跳变明细一致；最小代价不超过编码时钟本身的单调漂移量
    expect(totalJump).toBe(jumps.reduce((a, b) => a + Math.abs(b), 0));
    expect(totalJump).toBeGreaterThan(0);
    expect(totalJump).toBeLessThanOrEqual(expectedClocks[expectedClocks.length - 1] - expectedClocks[0]);
    expect(review.witnessCount).toBeGreaterThan(0n);
  });

  it('缓漂数据可被小上限救回，所有跳变不超过上限', () => {
    // 88→112 在约 42 个间隔上缓慢漂移；上限 2 即可见证
    const durations = encodeDigitsDrift('007', rampClock(88, 112));
    expect(decodePulses(durations).status).toBe('unreadable');
    const review = reviewDrift(durations, 2);
    expect(review.status).toBe('decoded');
    if (review.status === 'decoded') {
      expect(review.digits).toBe('007');
      expect(review.canonical.totalJump).toBeGreaterThan(0);
      expect(Math.max(...review.canonical.jumps.map(Math.abs))).toBeLessThanOrEqual(2);
    }
  });

  it('上限小于可行性边界时无见证，达到边界后可解（边界单调性）', () => {
    const durations = encodeDigitsDrift('42', rampClock(90, 120));
    expect(decodePulses(durations).status).toBe('unreadable'); // 常量时钟无交集

    let smallest = -1;
    for (let k = 0; k <= DRIFT_MAX_JUMP; k++) {
      if (reviewDrift(durations, k).status === 'decoded') {
        smallest = k;
        break;
      }
    }
    expect(smallest).toBeGreaterThan(0); // 上限 0 必然不可解（与普通裁决一致）
    expect(reviewDrift(durations, smallest - 1).status).toBe('unreadable');
    const review = reviewDrift(durations, smallest);
    expect(review.status).toBe('decoded');
    if (review.status === 'decoded') {
      expect(review.digits).toBe('42');
      expect(Math.max(...review.canonical.jumps.map(Math.abs))).toBeLessThanOrEqual(smallest);
    }
  });

  it('无法分类的间隔任何上限都 unreadable 且给出位置', () => {
    const durations = [...encodeDigitsDrift('9', rampClock(90, 110)), 20];
    const review = reviewDrift(durations, DRIFT_MAX_JUMP);
    expect(review.status).toBe('unreadable');
    if (review.status === 'unreadable') {
      expect(review.reason).toContain(String(durations.length));
      expect(review.reason).toContain('20');
    }
  });

  it('帧规则仍整体生效：追加多余长间隔导致帧外残余，复核 unreadable', () => {
    const durations = [...encodeDigitsDrift('3', rampClock(90, 110)), 100];
    const review = reviewDrift(durations, DRIFT_MAX_JUMP);
    expect(review.status).toBe('unreadable');
  });
});
