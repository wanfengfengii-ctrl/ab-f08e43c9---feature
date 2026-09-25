import { describe, it, expect } from 'vitest';
import { decodePulses } from './decode';
import { encodeDigits, encodeDigitsDrifted } from './encode';
import {
  intervalWindow,
  optimalClockTrajectory,
  preferWitness,
  reviewDrift,
  summarizeDriftWitnesses,
  validateJumpLimit,
  type DriftWitness,
  type IntervalWindow,
} from './drift';

function w(cls: 'L' | 'S', lo: number, hi: number): IntervalWindow {
  return { cls, lo, hi };
}

function fakeWitness(digits: string, clocks: number[], totalJump: number): DriftWitness {
  return {
    digits,
    clocks,
    totalJump,
    classes: [],
    bits: [],
    members: [],
    groups: [],
    codes: [],
  };
}

describe('intervalWindow：单间隔可行分类与时钟窗口', () => {
  it('长型窗口 [d-6, d+6] 与 80..120 求交', () => {
    expect(intervalWindow(100)).toEqual({ cls: 'L', lo: 94, hi: 106 });
    expect(intervalWindow(80)).toEqual({ cls: 'L', lo: 80, hi: 86 });
    expect(intervalWindow(126)).toEqual({ cls: 'L', lo: 120, hi: 120 });
    expect(intervalWindow(74)).toEqual({ cls: 'L', lo: 80, hi: 80 });
  });

  it('短型窗口 [2d-6, 2d+6] 与 80..120 求交', () => {
    expect(intervalWindow(50)).toEqual({ cls: 'S', lo: 94, hi: 106 });
    expect(intervalWindow(40)).toEqual({ cls: 'S', lo: 80, hi: 86 });
    expect(intervalWindow(63)).toEqual({ cls: 'S', lo: 120, hi: 120 });
    expect(intervalWindow(37)).toEqual({ cls: 'S', lo: 80, hi: 80 });
  });

  it('长短窗口不相交：任何时长至多一种归属', () => {
    for (let d = 20; d <= 150; d++) {
      const win = intervalWindow(d);
      if (!win) continue;
      // 窗口内任意 τ 的分类必须唯一且与 win.cls 一致
      for (let tau = win.lo; tau <= win.hi; tau++) {
        const isL = Math.abs(d - tau) <= 6;
        const isS = Math.abs(2 * d - tau) <= 6;
        expect(isL && isS).toBe(false);
        expect(isL ? 'L' : 'S').toBe(win.cls);
      }
    }
  });

  it('无法分类的时长返回 null', () => {
    expect(intervalWindow(20)).toBeNull();
    expect(intervalWindow(36)).toBeNull();
    expect(intervalWindow(64)).toBeNull();
    expect(intervalWindow(73)).toBeNull();
    expect(intervalWindow(127)).toBeNull();
    expect(intervalWindow(150)).toBeNull();
  });
});

describe('optimalClockTrajectory：最小总跳变量 + 字典序最小', () => {
  it('固定窗口可行时取恒定轨迹，总跳变量为 0', () => {
    const r = optimalClockTrajectory([w('L', 90, 100), w('L', 92, 96), w('S', 94, 110)], 3);
    expect(r).toEqual({ clocks: [94, 94, 94], totalJump: 0 });
  });

  it('跳变上限不足时返回 null', () => {
    expect(optimalClockTrajectory([w('L', 80, 80), w('L', 120, 120)], 39)).toBeNull();
    expect(optimalClockTrajectory([w('L', 80, 80), w('L', 120, 120)], 40)).toEqual({
      clocks: [80, 120],
      totalJump: 40,
    });
  });

  it('先取总跳变量最小，再取时钟序列字典序最小', () => {
    // 最小总跳变量 = 40（80 -> 120），中间可在 80..120 任选；
    // 字典序最小 => [80, 80, 120]
    const r = optimalClockTrajectory([w('L', 80, 80), w('L', 80, 120), w('L', 120, 120)], 40);
    expect(r).toEqual({ clocks: [80, 80, 120], totalJump: 40 });
  });

  it('字典序平局在更靠后的位置继续比较', () => {
    // 最小总跳变量 = 10；达到它的序列有 [90,90,100] 与 [90,95,100] 等，字典序最小为 [90,90,100]
    const r = optimalClockTrajectory([w('L', 90, 90), w('L', 90, 100), w('L', 100, 100)], 10);
    expect(r).toEqual({ clocks: [90, 90, 100], totalJump: 10 });
  });

  it('空窗口列表返回 null', () => {
    expect(optimalClockTrajectory([], 5)).toBeNull();
  });
});

describe('reviewDrift：连续漂移复核', () => {
  it('跳变量 0 时与固定时钟裁决一致（decoded）', () => {
    for (const [digits, tau] of [
      ['48321', 96],
      ['707', 118],
      ['0', 100],
      ['012345678901', 100],
      ['909', 82],
    ] as const) {
      const durations = encodeDigits(digits, tau);
      const fixed = decodePulses(durations);
      const drift = reviewDrift(durations, 0);
      expect(fixed.status).toBe('decoded');
      expect(drift.status).toBe('decoded');
      if (fixed.status === 'decoded' && drift.status === 'decoded') {
        expect(drift.digits).toBe(fixed.digits);
        expect(drift.best.totalJump).toBe(0);
        expect(new Set(drift.best.clocks).size).toBe(1); // 恒定时钟
      }
    }
  });

  it('跳变量 0 时与固定时钟裁决一致（unreadable）', () => {
    const cases = [
      [...encodeDigits('1', 100), 50], // 孤立短型
      [...encodeDigits('1', 100), 20], // 无法分类
      encodeDigitsDrifted('48321', 90, 110), // 固定时钟无法同时覆盖
    ];
    for (const durations of cases) {
      expect(decodePulses(durations).status).toBe('unreadable');
      expect(reviewDrift(durations, 0).status).toBe('unreadable');
    }
  });

  it('缓慢漂移的记录：固定时钟 unreadable，小跳变量下 decoded', () => {
    const durations = encodeDigitsDrifted('48321', 90, 110);
    expect(decodePulses(durations).status).toBe('unreadable');

    const drift = reviewDrift(durations, 1);
    expect(drift.status).toBe('decoded');
    if (drift.status !== 'decoded') return;
    expect(drift.digits).toBe('48321');

    const { clocks, totalJump, classes } = drift.best;
    expect(clocks.length).toBe(durations.length);
    expect(classes.length).toBe(durations.length);
    // 轨迹合法：窗口内、相邻跳变 ≤ 1
    clocks.forEach((t, i) => {
      const win = intervalWindow(durations[i])!;
      expect(t).toBeGreaterThanOrEqual(win.lo);
      expect(t).toBeLessThanOrEqual(win.hi);
      if (i > 0) expect(Math.abs(t - clocks[i - 1])).toBeLessThanOrEqual(1);
    });
    // 总跳变量 = 逐跳绝对值之和，且必须跨越 96 -> 104（首末窗口所限）
    const sum = clocks.slice(1).reduce((a, t, i) => a + Math.abs(t - clocks[i]), 0);
    expect(totalJump).toBe(sum);
    expect(totalJump).toBeGreaterThanOrEqual(8);
    expect(clocks[0]).toBeLessThanOrEqual(96);
    expect(clocks[clocks.length - 1]).toBeGreaterThanOrEqual(104);
  });

  it('同一内容多条轨迹时取总跳变量最小的一条', () => {
    const durations = encodeDigitsDrifted('48321', 90, 110);
    const drift = reviewDrift(durations, 1);
    if (drift.status !== 'decoded') throw new Error('应 decoded');
    // 首窗口上界 96、末窗口下界 104：任何轨迹总跳变量 ≥ 8，且 8 可达
    expect(drift.best.totalJump).toBe(8);
    // 总跳变量 8 迫使首端 = 96、末端 = 104；字典序最小轨迹在窗口内尽量保持 96
    expect(drift.best.clocks[0]).toBe(96);
    expect(drift.best.clocks[drift.best.clocks.length - 1]).toBe(104);
  });

  it('更大的跳变量上限仍然 decoded，且总跳变量不增', () => {
    const durations = encodeDigitsDrifted('48321', 90, 110);
    const d1 = reviewDrift(durations, 1);
    const d40 = reviewDrift(durations, 40);
    expect(d40.status).toBe('decoded');
    if (d1.status === 'decoded' && d40.status === 'decoded') {
      expect(d40.best.totalJump).toBeLessThanOrEqual(d1.best.totalJump);
      expect(d40.digits).toBe(d1.digits);
    }
  });

  it('存在无法分类的间隔时，任何跳变量都 unreadable', () => {
    const durations = [...encodeDigits('48321', 96), 64];
    expect(reviewDrift(durations, 40).status).toBe('unreadable');
  });

  it('孤立短型在漂移复核下仍 unreadable', () => {
    const durations = [...encodeDigits('1', 100), 50];
    expect(reviewDrift(durations, 10).status).toBe('unreadable');
  });
});

describe('summarizeDriftWitnesses：按数字串汇总所有完整见证', () => {
  it('空见证列表 -> unreadable', () => {
    expect(summarizeDriftWitnesses([])).toEqual({ status: 'unreadable' });
  });

  it('同一数字串多条轨迹 -> decoded，取总跳变量最小、再取字典序最小', () => {
    const r = summarizeDriftWitnesses([
      fakeWitness('12', [100, 100], 0),
      fakeWitness('12', [90, 95, 100], 10),
      fakeWitness('12', [90, 90, 100], 10),
    ]);
    expect(r.status).toBe('decoded');
    if (r.status === 'decoded') {
      expect(r.digits).toBe('12');
      expect(r.best.clocks).toEqual([100, 100]);
    }
  });

  it('多个数字串 -> ambiguous，按字典序列出且各附最优轨迹', () => {
    const r = summarizeDriftWitnesses([
      fakeWitness('9', [100], 0),
      fakeWitness('10', [90, 91], 1),
      fakeWitness('0', [80, 80], 0),
      fakeWitness('10', [85, 85], 0),
    ]);
    expect(r.status).toBe('ambiguous');
    if (r.status === 'ambiguous') {
      expect(r.entries.map((e) => e.digits)).toEqual(['0', '10', '9']);
      // '10' 的两条轨迹中总跳变量最小者为 [85, 85]
      expect(r.entries[1].best.clocks).toEqual([85, 85]);
    }
  });

  it('preferWitness：先比总跳变量，再比时钟序列字典序', () => {
    const a = fakeWitness('1', [90, 90], 0);
    const b = fakeWitness('1', [80, 100], 20);
    expect(preferWitness(a, b)).toBe(true);
    expect(preferWitness(b, a)).toBe(false);
    const c = fakeWitness('1', [90, 91], 1);
    const d = fakeWitness('1', [90, 90], 1);
    expect(preferWitness(d, c)).toBe(true);
    expect(preferWitness(c, d)).toBe(false);
  });
});

describe('validateJumpLimit：跳变量上限校验', () => {
  it('合法：不小于 0 的整数', () => {
    expect(validateJumpLimit('0')).toEqual({ ok: true, value: 0 });
    expect(validateJumpLimit('1')).toEqual({ ok: true, value: 1 });
    expect(validateJumpLimit(' 40 ')).toEqual({ ok: true, value: 40 });
    expect(validateJumpLimit('120')).toEqual({ ok: true, value: 120 });
  });

  it('非法：空串、非整数、负数、小数', () => {
    for (const bad of ['', '   ', 'abc', '1.5', '-1', '1e3', '+2']) {
      expect(validateJumpLimit(bad).ok).toBe(false);
    }
  });
});
