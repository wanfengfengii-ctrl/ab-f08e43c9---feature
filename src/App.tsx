import { useMemo, useState } from 'react';
import {
  decodePulses,
  decodeWithTau,
  validateInput,
  TAU_MIN,
  TAU_MAX,
  type Overall,
  type InputError,
  type FrameData,
} from './decode';
import { encodeDigits, encodeDigitsDrift, rampClock } from './encode';
import {
  reviewDrift,
  validateJumpLimit,
  DRIFT_MAX_JUMP,
  type DriftReview,
} from './drift';
import PulseDiagram from './PulseDiagram';

interface View {
  errors: InputError[];
  durations: number[] | null;
  outcome: Overall | null;
}

export default function App() {
  const [text, setText] = useState('');
  // 已发起复核的跳变上限原文；任何脉冲输入或上限编辑都会撤下旧漂移结论
  const [submittedText, setSubmittedText] = useState<string | null>(null);
  const [jumpText, setJumpText] = useState('');

  const updatePulses = (next: string) => {
    setText(next);
    setSubmittedText(null);
    setJumpText('');
  };

  const view = useMemo<View>(() => {
    const trimmed = text.trim();
    if (trimmed === '') return { errors: [], durations: null, outcome: null };
    // 校验失败即整份拒绝：不产出任何旧/新解码结果
    const { pulses, errors } = validateInput(trimmed);
    if (pulses === null) return { errors, durations: null, outcome: null };
    return { errors: [], durations: pulses, outcome: decodePulses(pulses) };
  }, [text]);

  // 仅在普通裁决为 unreadable、跳变上限自发起后未被任何编辑改动且仍合法时保留漂移结论
  const drift = useMemo<{ review: DriftReview; durations: number[] } | null>(() => {
    if (submittedText === null || !view.durations || !view.outcome) return null;
    if (view.outcome.status !== 'unreadable') return null;
    if (jumpText !== submittedText) return null;
    const v = validateJumpLimit(submittedText);
    if (!v.ok) return null;
    return { review: reviewDrift(view.durations, v.value), durations: view.durations };
  }, [submittedText, jumpText, view.durations, view.outcome]);

  const jumpFieldError = useMemo<string | null>(() => {
    if (jumpText.trim() === '') return null;
    const v = validateJumpLimit(jumpText);
    return v.ok ? null : v.message;
  }, [jumpText]);

  const submitReview = () => {
    const v = validateJumpLimit(jumpText);
    if (!v.ok) {
      setSubmittedText(null); // 非法跳变量：撤下旧漂移结论
      return;
    }
    // 规范化原文后发起；此后任何按键编辑都会使 jumpText !== submittedText
    setJumpText(v.value.toString());
    setSubmittedText(v.value.toString());
  };

  const sweep = useMemo(() => {
    if (!view.durations) return [];
    const out: { tau: number; ok: boolean; reason?: string; digits?: string }[] = [];
    for (let tau = TAU_MIN; tau <= TAU_MAX; tau++) {
      const r = decodeWithTau(tau, view.durations);
      out.push(r.ok ? { tau, ok: true, digits: r.digits } : { tau, ok: false, reason: r.reason });
    }
    return out;
  }, [view.durations]);

  return (
    <main className="page">
      <header>
        <h1>磁标读头脉冲串解码器</h1>
        <p className="subtitle">
          纯浏览器计算 · 枚举整数时钟 τ = {TAU_MIN}..{TAU_MAX}µs，判定数字串是否唯一
        </p>
      </header>

      <section className="panel">
        <label htmlFor="pulse-input" className="input-label">
          输入：{`6..200`} 个 {`20..150`} 微秒整数的 JSON 数组
        </label>
        <textarea
          id="pulse-input"
          data-testid="pulse-input"
          value={text}
          onChange={(e) => updatePulses(e.target.value)}
          spellCheck={false}
          rows={4}
          placeholder='[100, 50, 50, 100, ...]'
        />
        <div className="btn-row">
          <button type="button" data-testid="sample-decoded" onClick={() => updatePulses(JSON.stringify(encodeDigits('48321', 96)))}>
            示例：可解码
          </button>
          <button type="button" data-testid="sample-drift" onClick={() => updatePulses(JSON.stringify(encodeDigits('707', 118)))}>
            示例：漂移时钟
          </button>
          <button
            type="button"
            data-testid="sample-continuous-drift"
            onClick={() =>
              updatePulses(JSON.stringify(encodeDigitsDrift('5209', rampClock(84, 116))))
            }
          >
            示例：连续漂移复核
          </button>
          <button
            type="button"
            data-testid="sample-unreadable"
            onClick={() => updatePulses(JSON.stringify([...encodeDigits('48321', 96), 50]))}
          >
            示例：孤立短型
          </button>
          <button type="button" onClick={() => updatePulses('')}>清空</button>
        </div>
      </section>

      {view.errors.length > 0 && (
        <section className="panel error-panel" data-testid="input-errors">
          <h2>输入错误（整份拒绝，不保留旧结果）</h2>
          <ul>
            {view.errors.map((e, i) => (
              <li key={i} data-testid="error-item" data-pos={e.pos}>
                {e.pos >= 0 ? <span className="err-pos">第 {e.pos + 1} 项：</span> : <span className="err-pos">整份：</span>}
                {e.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.outcome && (
        <Result
          outcome={view.outcome}
          durations={view.durations!}
          drift={drift}
          jumpText={jumpText}
          jumpFieldError={jumpFieldError}
          onJumpTextChange={(v) => {
            setJumpText(v);
            // 编辑即撤下旧结论（值不再等于已提交值时 drift memo 自动失效）
          }}
          onSubmitReview={submitReview}
        />
      )}

      {sweep.length > 0 && <TauSweep rows={sweep} />}
    </main>
  );
}

interface ResultProps {
  outcome: Overall;
  durations: number[];
  drift: { review: DriftReview; durations: number[] } | null;
  jumpText: string;
  jumpFieldError: string | null;
  onJumpTextChange: (v: string) => void;
  onSubmitReview: () => void;
}

function Result({
  outcome,
  durations,
  drift,
  jumpText,
  jumpFieldError,
  onJumpTextChange,
  onSubmitReview,
}: ResultProps) {
  if (outcome.status === 'unreadable') {
    return (
      <section className="panel result" data-testid="result-panel">
        <h2>
          普通裁决：<span className="badge badge-unreadable" data-testid="result-status">unreadable</span>
        </h2>
        <p className="hint">τ = {TAU_MIN}..{TAU_MAX} 中没有任何固定时钟能得到合法帧。</p>

        <div className="drift-box" data-testid="drift-review">
          <h3>连续漂移复核</h3>
          <p className="hint">
            若一次刷卡中读头时钟持续缓慢变速，可填写相邻间隔允许的整数时钟跳变量上限
            （0..{DRIFT_MAX_JUMP} 微秒）发起复核：为每个原始间隔选择 {TAU_MIN}..{TAU_MAX}µs
            的局部整数时钟，相邻时钟之差不得超过该上限，全部规则在同一条时钟轨迹上共同成立。
          </p>
          <div className="drift-form">
            <label htmlFor="jump-limit">相邻跳变上限（µs）</label>
            <input
              id="jump-limit"
              data-testid="drift-limit"
              value={jumpText}
              onChange={(e) => onJumpTextChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSubmitReview();
              }}
              inputMode="numeric"
              spellCheck={false}
              placeholder="例如 3"
            />
            <button type="button" data-testid="drift-submit" onClick={onSubmitReview}>
              发起复核
            </button>
          </div>
          {jumpFieldError && (
            <div className="drift-error" data-testid="drift-limit-error">{jumpFieldError}</div>
          )}
          {drift && <DriftResult review={drift.review} durations={drift.durations} />}
        </div>
      </section>
    );
  }

  if (outcome.status === 'ambiguous') {
    return (
      <section className="panel result" data-testid="result-panel">
        <h2>
          普通裁决：<span className="badge badge-ambiguous" data-testid="result-status">ambiguous</span>
        </h2>
        <p className="hint">不同 τ 解出了多个不同数字串（按数字串字典序排列）：</p>
        <table className="amb-table">
          <thead>
            <tr><th>数字串</th><th>成立的 τ（µs）</th></tr>
          </thead>
          <tbody>
            {outcome.entries.map((e) => (
              <tr key={e.digits} data-testid="ambiguous-entry">
                <td className="digits" data-testid="amb-digits">{e.digits}</td>
                <td data-testid="amb-taus">{e.taus.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }

  return (
    <section className="panel result" data-testid="result-panel">
      <h2>
        普通裁决：<span className="badge badge-decoded" data-testid="result-status">decoded</span>
      </h2>
      <div className="result-grid">
        <div>
          <div className="field-label">数字串</div>
          <div className="digits big" data-testid="result-digits">{outcome.digits}</div>
        </div>
        <div>
          <div className="field-label">成立的 τ（µs）</div>
          <div className="tau-list" data-testid="result-tau">{outcome.taus.join(', ')}</div>
          <div className="hint">
            共 {outcome.taus.length} 个 τ 有效；按最小 τ = <strong>{outcome.min.tau}</strong> 绘制分类与成位。
          </div>
        </div>
      </div>
      <PulseDiagram
        durations={durations}
        frame={outcome.min}
        clocks={durations.map(() => outcome.min.tau)}
        clockCaption={`固定 τ = ${outcome.min.tau}µs`}
      />
      <CodeTable frame={outcome.min} />
    </section>
  );
}

function CodeTable({ frame }: { frame: FrameData }) {
  return (
    <table className="codes-table" data-testid="codes-table">
      <thead>
        <tr><th>角色</th><th>码值</th><th>5 位（低→高，末位奇校验）</th></tr>
      </thead>
      <tbody>
        {frame.groups.map((g, i) => (
          <tr key={i}>
            <td>{roleName(i, frame.groups.length)}</td>
            <td>{g.value}</td>
            <td className="mono">{g.bits.join(' ')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DriftResult({ review, durations }: { review: DriftReview; durations: number[] }) {
  if (review.status === 'unreadable') {
    return (
      <div className="drift-result" data-testid="drift-result">
        <h3>
          漂移复核结论：
          <span className="badge badge-unreadable" data-testid="drift-status">unreadable</span>
        </h3>
        <p className="hint" data-testid="drift-reason">
          上限 {review.maxJump}µs 下没有任何完整见证：{review.reason}
        </p>
      </div>
    );
  }

  if (review.status === 'ambiguous') {
    return (
      <div className="drift-result" data-testid="drift-result">
        <h3>
          漂移复核结论：<span className="badge badge-ambiguous" data-testid="drift-status">ambiguous</span>
        </h3>
        <p className="hint">完整见证解出多个数字串（按字典序排列）：</p>
        <table className="amb-table" data-testid="drift-amb-table">
          <thead>
            <tr><th>数字串</th><th>最小总跳变量（µs）</th><th>规范时钟轨迹</th><th>见证数</th></tr>
          </thead>
          <tbody>
            {review.entries.map((e) => (
              <tr key={e.digits} data-testid="drift-amb-entry">
                <td className="digits" data-testid="drift-amb-digits">{e.digits}</td>
                <td className="mono">{e.canonical.totalJump}</td>
                <td className="mono traj-cell">{e.canonical.clocks.join(', ')}</td>
                <td className="mono" data-testid="drift-amb-count">{e.witnessCount.toString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const { canonical } = review;
  const nonzero = canonical.jumps.filter((j) => j !== 0).length;
  return (
    <div className="drift-result" data-testid="drift-result">
      <h3>
        漂移复核结论：<span className="badge badge-decoded" data-testid="drift-status">decoded</span>
      </h3>
      <div className="result-grid">
        <div>
          <div className="field-label">数字串</div>
          <div className="digits big" data-testid="drift-digits">{review.digits}</div>
        </div>
        <div>
          <div className="field-label">逐间隔局部时钟（µs）</div>
          <div className="tau-list traj-cell" data-testid="drift-clocks">{canonical.clocks.join(', ')}</div>
          <div className="hint" data-testid="drift-summary">
            跳变上限 {review.maxJump}µs；规范轨迹总跳变量 <strong>{canonical.totalJump}</strong>µs
            （{nonzero} 次非零跳变）；完整见证共 {review.witnessCount.toString()} 条
            {canonical.totalJump === 0 ? '，全部时钟相同，与固定时钟裁决一致' : ''}。
          </div>
        </div>
      </div>
      <PulseDiagram
        durations={durations}
        frame={review.frame}
        clocks={canonical.clocks}
        clockCaption={`连续漂移复核（相邻跳变上限 ${review.maxJump}µs）`}
        showJumps
      />
      <details className="drift-jumps-details" open>
        <summary data-testid="drift-jumps-summary">每次跳变明细（{canonical.jumps.length} 个相邻边界）</summary>
        <table className="sweep-table drift-jumps-table" data-testid="drift-jumps">
          <thead>
            <tr><th>相邻边界</th><th>时钟 τ（µs）</th><th>跳变（µs）</th></tr>
          </thead>
          <tbody>
            <tr data-testid="drift-jump-row" data-boundary={0}>
              <td className="mono">间隔 1</td>
              <td className="mono">{canonical.clocks[0]}</td>
              <td className="mono">—</td>
            </tr>
            {canonical.jumps.map((j, i) => (
              <tr
                key={i + 1}
                data-testid="drift-jump-row"
                data-boundary={i + 1}
                data-jump={j}
                className={j > 0 ? 'jump-up-row' : j < 0 ? 'jump-down-row' : ''}
              >
                <td className="mono">间隔 {i + 2}</td>
                <td className="mono">{canonical.clocks[i + 1]}</td>
                <td className="mono">{j > 0 ? `+${j}` : `${j}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <CodeTable frame={review.frame} />
    </div>
  );
}

function roleName(i: number, n: number): string {
  if (i === 0) return '起始码';
  if (i === n - 1) return 'LRC';
  if (i === n - 2) return '结束码';
  return `载荷 ${i}`;
}

function TauSweep({ rows }: { rows: { tau: number; ok: boolean; reason?: string; digits?: string }[] }) {
  const okCount = rows.filter((r) => r.ok).length;
  return (
    <details className="panel sweep">
      <summary data-testid="sweep-summary">τ 枚举明细（{okCount}/{rows.length} 有效）</summary>
      <table className="sweep-table">
        <thead>
          <tr><th>τ (µs)</th><th>结果</th><th>说明</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.tau} data-testid="sweep-row" data-ok={r.ok ? '1' : '0'}>
              <td className="mono">{r.tau}</td>
              <td>{r.ok ? '✓ 有效' : '✗ 淘汰'}</td>
              <td>{r.ok ? `数字串 ${r.digits}` : r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
