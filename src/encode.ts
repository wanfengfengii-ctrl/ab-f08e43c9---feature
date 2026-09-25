/**
 * 编码器：把数字串按协议反向生成间隔时长数组。
 * 主要用于单元/E2E 测试构造已知良好输入，也为 UI 提供示例数据。
 */
import { START_CODE, END_CODE } from './decode';

/** 码值 -> 5 位：前 4 位低位在前，第 5 位奇校验 */
export function codeToBits(code: number): number[] {
  const bits = [code & 1, (code >> 1) & 1, (code >> 2) & 1, (code >> 3) & 1];
  const ones = bits.reduce((a, b) => a + b, 0);
  bits.push(ones % 2 === 0 ? 1 : 0);
  return bits;
}

/** 位流 -> 间隔时长：0 位一个长型 τ；1 位两个短型 τ/2 */
export function bitsToDurations(bits: number[], tau = 100): number[] {
  const out: number[] = [];
  for (const b of bits) {
    if (b === 0) out.push(tau);
    else out.push(tau / 2, tau / 2);
  }
  return out;
}

/** 数字串 -> 完整帧（起始码 + 载荷 + 结束码 + LRC）的间隔时长数组 */
export function encodeDigits(digits: string, tau = 100): number[] {
  if (!/^[0-9]+$/.test(digits)) throw new Error('digits 必须为 0..9 的数字串');
  const codes = [START_CODE, ...[...digits].map((ch) => Number(ch)), END_CODE];
  let lrc = 0;
  for (const c of codes) lrc ^= c;
  codes.push(lrc);
  const bits = codes.flatMap(codeToBits);
  return bitsToDurations(bits, tau).map((d) => Math.round(d));
}

/**
 * 连续变速编码：为每个间隔指定自己的局部时钟（微秒，80..120 整数）。
 * 长型间隔取 d = τ；短型间隔取 d = round(τ/2)（奇数 τ 时 |2d−τ|=1，仍在容差内）。
 * 用于构造“一次刷卡中时钟持续缓慢漂移”的测试/示例数据。
 */
export function encodeDigitsDrift(digits: string, clockForInterval: (index: number, count: number) => number): number[] {
  if (!/^[0-9]+$/.test(digits)) throw new Error('digits 必须为 0..9 的数字串');
  const codes = [START_CODE, ...[...digits].map((ch) => Number(ch)), END_CODE];
  let lrc = 0;
  for (const c of codes) lrc ^= c;
  codes.push(lrc);
  const bits = codes.flatMap(codeToBits);
  const intervalCount = bits.reduce((n, b) => n + (b === 0 ? 1 : 2), 0);
  const out: number[] = [];
  let idx = 0;
  for (const b of bits) {
    if (b === 0) {
      out.push(clockForInterval(idx++, intervalCount));
    } else {
      const t0 = clockForInterval(idx++, intervalCount);
      const t1 = clockForInterval(idx++, intervalCount);
      out.push(Math.round(t0 / 2), Math.round(t1 / 2));
    }
  }
  return out;
}

/** 从 tauStart 到 tauEnd 在全部间隔上线性（取整）缓慢变速的时钟序列 */
export function rampClock(tauStart: number, tauEnd: number): (index: number, count: number) => number {
  return (index, count) =>
    count <= 1 ? tauStart : Math.round(tauStart + ((tauEnd - tauStart) * index) / (count - 1));
}
