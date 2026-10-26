import { useMemo, useState } from 'react';
import { MONTHS } from '../model/pfc.js';

const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));

function niceTicks(min, max, n = 5) {
  const span = max - min || 1;
  const step0 = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= step0);
  const t = [];
  for (let v = Math.floor(min / step) * step; v <= max + 1e-9; v += step) t.push(+v.toFixed(6));
  return t;
}

/** Multi-series line chart with crosshair tooltip. series: [{name, color, values}] */
export function LineChart({ series, xLabels, height = 240, unit = '€/MWh', xTickEvery = 1, refLine }) {
  const [hi, setHi] = useState(null);
  const W = 720, H = height, m = { l: 44, r: 12, t: 12, b: 26 };
  const n = series[0].values.length;
  const all = series.flatMap((s) => s.values);
  let min = Math.min(0, ...all), max = Math.max(...all);
  const ticks = niceTicks(min, max);
  min = Math.min(min, ticks[0]); max = Math.max(max, ticks[ticks.length - 1]);
  const x = (i) => m.l + (i / (n - 1)) * (W - m.l - m.r);
  const y = (v) => m.t + (1 - (v - min) / (max - min)) * (H - m.t - m.b);

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - m.l) / (W - m.l - m.r)) * (n - 1));
    setHi(i >= 0 && i < n ? i : null);
  };

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} onMouseMove={onMove} onMouseLeave={() => setHi(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'grid'} />
            <text x={m.l - 6} y={y(t) + 4} textAnchor="end" className="tick">{t}</text>
          </g>
        ))}
        {xLabels.map((l, i) => (i % xTickEvery === 0 ? (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="tick">{l}</text>
        ) : null))}
        {refLine != null && <line x1={m.l} x2={W - m.r} y1={y(refLine)} y2={y(refLine)} className="refline" />}
        {series.map((s) => (
          <path key={s.name} d={s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('')}
            fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeDasharray={s.dash} />
        ))}
        {hi != null && (
          <g>
            <line x1={x(hi)} x2={x(hi)} y1={m.t} y2={H - m.b} className="crosshair" />
            {series.map((s) => (
              <circle key={s.name} cx={x(hi)} cy={y(s.values[hi])} r="4" fill={s.color} className="ring" />
            ))}
          </g>
        )}
        <rect x={m.l} y={m.t} width={W - m.l - m.r} height={H - m.t - m.b} fill="transparent" />
      </svg>
      {hi != null && (
        <div className="tooltip" style={{ left: `${(x(hi) / W) * 100}%` }}>
          <div className="tt-title">{xLabels[hi]}</div>
          {series.map((s) => (
            <div key={s.name} className="tt-row"><i style={{ background: s.color }} />{s.name}<b>{fmt(s.values[hi])} {unit}</b></div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Month × hour heatmap, diverging around the annual base price. */
export function Heatmap({ grid, base }) {
  const [hi, setHi] = useState(null);
  const W = 1000, H = 300, m = { l: 36, r: 8, t: 8, b: 22 };
  const cw = (W - m.l - m.r) / 24, ch = (H - m.t - m.b) / 12;
  const flat = grid.flat();
  const maxDev = Math.max(...flat.map((v) => Math.abs(v - base)), 1);

  const color = useMemo(() => (v) => {
    const t = Math.max(-1, Math.min(1, (v - base) / maxDev));
    // diverging: blue (below base) ↔ neutral ↔ red (above base)
    const lo = [42, 120, 214], hiC = [227, 73, 72];
    const mid = getComputedStyle(document.documentElement).getPropertyValue('--div-mid').trim() || '#f0efec';
    const mc = hexToRgb(mid);
    const end = t < 0 ? lo : hiC;
    const a = Math.pow(Math.abs(t), 0.85);
    const c = mc.map((v0, k) => Math.round(v0 + (end[k] - v0) * a));
    return `rgb(${c.join(',')})`;
  }, [base, maxDev]);

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} onMouseLeave={() => setHi(null)}>
        {grid.map((row, mi) => row.map((v, h) => (
          <rect key={`${mi}-${h}`} x={m.l + h * cw + 1} y={m.t + mi * ch + 1} width={cw - 2} height={ch - 2} rx="2"
            fill={color(v)} onMouseEnter={() => setHi({ mi, h, v })}
            className={hi && hi.mi === mi && hi.h === h ? 'cell-hi' : ''} />
        )))}
        {MONTHS.map((l, i) => <text key={l} x={m.l - 6} y={m.t + i * ch + ch / 2 + 4} textAnchor="end" className="tick">{l}</text>)}
        {Array.from({ length: 24 }, (_, h) => (h % 3 === 0 ? <text key={h} x={m.l + h * cw + cw / 2} y={H - 8} textAnchor="middle" className="tick">{h}h</text> : null))}
      </svg>
      <div className="heat-legend">
        <span>{fmt(base - maxDev)}</span>
        <div className="heat-bar" />
        <span>{fmt(base + maxDev)} €/MWh</span>
        <span className="muted">· centre = annual base {fmt(base)}</span>
      </div>
      {hi && (
        <div className="tooltip" style={{ left: `${((m.l + hi.h * cw + cw / 2) / W) * 100}%`, top: `${((m.t + hi.mi * ch) / H) * 100}%` }}>
          <div className="tt-title">{MONTHS[hi.mi]} · {hi.h}:00–{hi.h + 1}:00</div>
          <div className="tt-row">Avg price<b>{fmt(hi.v)} €/MWh</b></div>
          <div className="tt-row">vs. base<b>{hi.v >= base ? '+' : ''}{fmt(hi.v - base)}</b></div>
        </div>
      )}
    </div>
  );
}

function hexToRgb(h) {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}

/** Small grouped bars: reference + 3 horizons for two scenarios. */
export function MiniBars({ ind, scenario, year }) {
  const W = 220, H = 70, m = { l: 4, r: 4, t: 6, b: 16 };
  const cats = ['Ref', '2035', '2060', '2085'];
  const a = [ind.ref, ...ind.rcp26], b = [ind.ref, ...ind.rcp85];
  const all = [...a, ...b, 0];
  const min = Math.min(...all), max = Math.max(...all);
  const y = (v) => m.t + (1 - (v - min) / (max - min || 1)) * (H - m.t - m.b);
  const gw = (W - m.l - m.r) / 4;
  const bw = gw / 2 - 6;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="minibars" role="img" aria-label={`${ind.label} by horizon`}>
      <line x1={m.l} x2={W - m.r} y1={y(0)} y2={y(0)} className="axis" />
      {cats.map((c, i) => {
        const x0 = m.l + i * gw + 4;
        const bars = i === 0 ? [[a[0], 'var(--text-muted)', null]] : [[a[i], 'var(--series-1)', 'rcp26'], [b[i], 'var(--series-2)', 'rcp85']];
        return (
          <g key={c}>
            {bars.map(([v, col, sc], k) => {
              const bx = i === 0 ? x0 + gw / 4 - 2 : x0 + k * (bw + 2);
              const top = Math.min(y(v), y(0)), hgt = Math.max(1, Math.abs(y(v) - y(0)));
              return <rect key={k} x={bx} y={top} width={bw} height={hgt} rx="2" fill={col}
                opacity={sc && sc !== scenario ? 0.35 : 1}><title>{`${c} ${sc ?? ''}: ${v} ${ind.unit}`}</title></rect>;
            })}
            <text x={x0 + gw / 2 - 4} y={H - 4} textAnchor="middle" className={`tick ${c !== 'Ref' && Math.abs(+c - year) <= 12 ? 'tick-strong' : ''}`}>{c}</text>
          </g>
        );
      })}
    </svg>
  );
}
