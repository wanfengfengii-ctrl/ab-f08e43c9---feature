import { TAU_MIN, TAU_MAX } from './decode';
import type { DriftWitness } from './drift';

interface Props {
  durations: number[];
  witness: DriftWitness;
}

const W = 1000;
const MARGIN_X = 40;
const ROW_INTERVALS_Y = 32;
const BAR_H = 34;
const TAU_TICK_Y = ROW_INTERVALS_Y + BAR_H + 14;
const BRACKET_Y = ROW_INTERVALS_Y + BAR_H + 26;
const ROW_BITS_Y = 104;
const ROW_GROUPS_Y = 144;
const TRAJ_TOP = 204;
const TRAJ_BOTTOM = 256;
const H = 274;

/** 局部时钟 τ -> 轨迹带纵坐标（τ 越大越靠上） */
function tauY(tau: number): number {
  return TRAJ_BOTTOM - ((tau - TAU_MIN) / (TAU_MAX - TAU_MIN)) * (TRAJ_BOTTOM - TRAJ_TOP);
}

/**
 * 连续漂移复核图示：间隔分类（长型/短型）→ 成位 → 5 位分组，
 * 间隔条下方标注逐间隔局部时钟 τᵢ，底部绘制时钟轨迹与每次跳变。
 */
export default function DriftDiagram({ durations, witness }: Props) {
  const total = durations.reduce((a, b) => a + b, 0);
  const scale = (W - 2 * MARGIN_X) / total;

  // 每个间隔的横向区间（宽度按时长比例）
  const spans: { x: number; w: number; d: number; cls: 'L' | 'S'; tau: number }[] = [];
  let acc = 0;
  durations.forEach((d, i) => {
    spans.push({ x: MARGIN_X + acc * scale, w: d * scale, d, cls: witness.classes[i], tau: witness.clocks[i] });
    acc += d;
  });
  const centers = spans.map((s) => s.x + s.w / 2);

  // 每个位覆盖的间隔范围：长型 1 个间隔，短型对 2 个
  const bitSpans = witness.members.map((m, bi) => {
    const first = m[0];
    const last = m[m.length - 1];
    return {
      x: spans[first].x,
      w: spans[last].x + spans[last].w - spans[first].x,
      bit: witness.bits[bi],
    };
  });

  const groupLabels = witness.groups.map((g, i) => {
    if (i === 0) return `${g.value} 起始`;
    if (i === witness.groups.length - 1) return `${g.value} LRC`;
    if (i === witness.groups.length - 2) return `${g.value} 结束`;
    return `${g.value}`;
  });

  const jumps = witness.clocks.slice(1).map((t, i) => t - witness.clocks[i]);
  const trajPoints = centers.map((cx, i) => `${cx},${tauY(witness.clocks[i])}`).join(' ');

  return (
    <svg
      className="pulse-diagram drift-diagram"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="连续漂移时钟轨迹图"
      data-testid="drift-diagram"
    >
      <text x={MARGIN_X} y={18} className="dg-title">
        连续漂移轨迹（长型→位 0，相邻短型对→位 1；τᵢ 为逐间隔局部时钟，总跳变量 {witness.totalJump}µs）
      </text>

      {/* 间隔条：分类 + 时长 + 局部时钟 */}
      {spans.map((s, i) => (
        <g key={`iv-${i}`}>
          <rect x={s.x} y={ROW_INTERVALS_Y} width={Math.max(s.w - 1, 1)} height={BAR_H} className={`bar bar-${s.cls}`} />
          {s.w >= 26 && (
            <text x={s.x + s.w / 2} y={ROW_INTERVALS_Y + 21} className="bar-label">
              {s.d}
            </text>
          )}
          {s.w >= 16 && (
            <text x={s.x + s.w / 2} y={TAU_TICK_Y} className="tau-tick">
              {s.tau}
            </text>
          )}
        </g>
      ))}
      <Legend />

      {/* 成位：长型单间隔或短型对 */}
      {bitSpans.map((b, i) => (
        <g key={`bit-${i}`}>
          <path
            d={`M ${b.x + 2} ${BRACKET_Y} q 0 8 8 8 h ${Math.max(b.w - 20, 0)} q 8 0 8 -8`}
            className="bracket"
            fill="none"
          />
          <rect x={b.x + b.w / 2 - 11} y={ROW_BITS_Y} width={22} height={22} rx={4} className={`bit bit-${b.bit}`} />
          <text x={b.x + b.w / 2} y={ROW_BITS_Y + 16} className="bit-label">
            {b.bit}
          </text>
        </g>
      ))}

      {/* 每 5 位一组，标注码值与角色 */}
      {witness.groups.map((_, gi) => {
        const startBit = gi * 5;
        const endBit = startBit + 4;
        const x0 = bitSpans[startBit].x - 4;
        const x1 = bitSpans[endBit].x + bitSpans[endBit].w + 4;
        const role =
          gi === 0
            ? 'grp-start'
            : gi === witness.groups.length - 1
              ? 'grp-lrc'
              : gi === witness.groups.length - 2
                ? 'grp-end'
                : 'grp-data';
        return (
          <g key={`grp-${gi}`}>
            <rect x={x0} y={ROW_GROUPS_Y} width={x1 - x0} height={40} rx={6} className={`grp ${role}`} />
            <text x={(x0 + x1) / 2} y={ROW_GROUPS_Y + 25} className="grp-label">
              {groupLabels[gi]}
            </text>
          </g>
        );
      })}

      {/* 逐间隔局部时钟轨迹 */}
      {[TAU_MIN, 100, TAU_MAX].map((t) => (
        <g key={`grid-${t}`}>
          <line x1={MARGIN_X} y1={tauY(t)} x2={W - MARGIN_X} y2={tauY(t)} className="traj-grid" />
          <text x={6} y={tauY(t) + 4} className="traj-axis">
            {t}
          </text>
        </g>
      ))}
      <text x={6} y={TRAJ_TOP - 6} className="traj-axis">
        τᵢ
      </text>
      <polyline points={trajPoints} className="traj-line" />
      {centers.map((cx, i) => (
        <circle key={`pt-${i}`} cx={cx} cy={tauY(witness.clocks[i])} r={2.5} className="traj-point" />
      ))}

      {/* 每次跳变（非零）标注在轨迹段中点 */}
      {jumps.map((j, i) =>
        j === 0 ? null : (
          <text
            key={`jmp-${i}`}
            x={(centers[i] + centers[i + 1]) / 2}
            y={(tauY(witness.clocks[i]) + tauY(witness.clocks[i + 1])) / 2 - 4}
            className={`jump-label ${j > 0 ? 'jump-pos' : 'jump-neg'}`}
          >
            {j > 0 ? `+${j}` : j}
          </text>
        ),
      )}
    </svg>
  );
}

function Legend() {
  return (
    <g transform={`translate(${W - 250}, 8)`}>
      <rect x={0} y={0} width={14} height={14} className="bar bar-L" />
      <text x={20} y={11} className="legend-text">
        长型 (位 0)
      </text>
      <rect x={100} y={0} width={14} height={14} className="bar bar-S" />
      <text x={120} y={11} className="legend-text">
        短型对 (位 1)
      </text>
    </g>
  );
}
