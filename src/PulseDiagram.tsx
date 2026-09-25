import type { FrameData } from './decode';

interface Props {
  durations: number[];
  frame: FrameData;
  /** 逐间隔局部时钟；固定时钟裁决时为全部相同的常量序列 */
  clocks: number[];
  /** 标题中对时钟来源的说明，如“固定 τ = 90µs”或“连续漂移复核（上限 3µs）” */
  clockCaption: string;
  /** 是否标注每次跳变（漂移复核时开启） */
  showJumps?: boolean;
}

const W = 1000;
const MARGIN_X = 20;
const ROW_INTERVALS_Y = 56;
const ROW_BITS_Y = 132;
const ROW_GROUPS_Y = 190;
const TRAJ_TOP = 258;
const TRAJ_BOTTOM = 326;
const H = 356;

const TAU_LO = 80;
const TAU_HI = 120;

/** 绘制间隔分类（长型/短型）、成位（短型成对）、5 位分组与逐间隔时钟轨迹 */
export default function PulseDiagram({ durations, frame, clocks, clockCaption, showJumps }: Props) {
  const total = durations.reduce((a, b) => a + b, 0);
  const scale = (W - 2 * MARGIN_X) / total;

  // 每个间隔的横向区间（宽度按时长比例）
  const spans: { x: number; w: number; d: number; cls: 'L' | 'S'; tau: number }[] = [];
  let acc = 0;
  durations.forEach((d, i) => {
    spans.push({
      x: MARGIN_X + acc * scale,
      w: d * scale,
      d,
      cls: frame.classes[i],
      tau: clocks[i],
    });
    acc += d;
  });

  // 每个位覆盖的间隔范围：长型 1 个间隔，短型对 2 个
  const bitSpans = frame.members.map((m, bi) => {
    const first = m[0];
    const last = m[m.length - 1];
    return {
      x: spans[first].x,
      w: spans[last].x + spans[last].w - spans[first].x,
      bit: frame.bits[bi],
    };
  });

  const groupLabels = frame.groups.map((g, i) => {
    if (i === 0) return `${g.value} 起始`;
    if (i === frame.groups.length - 1) return `${g.value} LRC`;
    if (i === frame.groups.length - 2) return `${g.value} 结束`;
    return `${g.value}`;
  });

  // 逐间隔时钟轨迹：点位于间隔水平中心，纵向按 τ 映射
  const trajY = (t: number) =>
    TRAJ_BOTTOM - ((t - TAU_LO) / (TAU_HI - TAU_LO)) * (TRAJ_BOTTOM - TRAJ_TOP);
  const points = spans.map((s) => ({ x: s.x + s.w / 2, y: trajY(s.tau), cls: s.cls, tau: s.tau, w: s.w }));
  const polyline = points.map((p) => `${p.x},${p.y}`).join(' ');
  const gridTaus = [80, 90, 100, 110, 120];

  return (
    <svg className="pulse-diagram" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="间隔分类、成位与逐间隔时钟轨迹图">
      <text x={MARGIN_X} y={20} className="dg-title">
        间隔分类（{clockCaption}；长型→位 0，相邻短型对→位 1）
      </text>

      {/* 间隔条 */}
      {spans.map((s, i) => (
        <g key={`iv-${i}`}>
          <rect x={s.x} y={ROW_INTERVALS_Y} width={Math.max(s.w - 1, 1)} height={34} className={`bar bar-${s.cls}`} />
          {s.w >= 26 && (
            <text x={s.x + s.w / 2} y={ROW_INTERVALS_Y + 21} className="bar-label">
              {s.d}
            </text>
          )}
        </g>
      ))}
      <Legend />

      {/* 成位：长型单间隔或短型对 */}
      {bitSpans.map((b, i) => (
        <g key={`bit-${i}`}>
          <path
            d={`M ${b.x + 2} ${ROW_INTERVALS_Y + 44} q 0 8 8 8 h ${Math.max(b.w - 20, 0)} q 8 0 8 -8`}
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
      {frame.groups.map((_, gi) => {
        const startBit = gi * 5;
        const endBit = startBit + 4;
        const x0 = bitSpans[startBit].x - 4;
        const x1 = bitSpans[endBit].x + bitSpans[endBit].w + 4;
        const role =
          gi === 0
            ? 'grp-start'
            : gi === frame.groups.length - 1
              ? 'grp-lrc'
              : gi === frame.groups.length - 2
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
      <text x={MARGIN_X} y={250} className="dg-title">
        逐间隔局部时钟 τ（µs）
      </text>
      {gridTaus.map((t) => (
        <g key={`grid-${t}`}>
          <line x1={MARGIN_X} y1={trajY(t)} x2={W - MARGIN_X} y2={trajY(t)} className="traj-grid" />
          <text x={W - MARGIN_X - 2} y={trajY(t) - 3} className="traj-grid-label">
            {t}
          </text>
        </g>
      ))}
      <polyline points={polyline} className="traj-line" />
      {points.map((p, i) => (
        <g key={`traj-${i}`}>
          <circle cx={p.x} cy={p.y} r={3.5} className={`traj-point traj-point-${p.cls}`} />
          {p.w >= 24 && (
            <text x={p.x} y={p.y - 7} className="traj-tau-label">
              {p.tau}
            </text>
          )}
        </g>
      ))}
      {showJumps &&
        points.slice(1).map((p, i) => {
          const prev = points[i];
          const delta = p.tau - prev.tau;
          if (delta === 0) return null;
          const midX = (prev.x + p.x) / 2;
          const midY = (prev.y + p.y) / 2;
          if (p.x - prev.x < 16) return null; // 过窄处在下方跳变明细表中列出
          return (
            <text
              key={`jump-${i}`}
              x={midX}
              y={midY - 6}
              className={`traj-jump ${delta > 0 ? 'jump-up' : 'jump-down'}`}
            >
              {delta > 0 ? `+${delta}` : delta}
            </text>
          );
        })}
    </svg>
  );
}

function Legend() {
  return (
    <g transform={`translate(${W - 250}, 12)`}>
      <rect x={0} y={0} width={14} height={14} className="bar bar-L" />
      <text x={20} y={11} className="legend-text">长型 (位 0)</text>
      <rect x={100} y={0} width={14} height={14} className="bar bar-S" />
      <text x={120} y={11} className="legend-text">短型对 (位 1)</text>
    </g>
  );
}
