import { useEffect, useMemo, useState } from 'react';
import { LineChart } from './components/Charts.jsx';
import { NATIONAL, PLANTS } from './data/plants.js';
import { BESS_STATUS, bessSwatch } from './components/SwissMap.jsx';

const DATA_URL = `${import.meta.env.BASE_URL}pfc2035/`;
const v = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : '';
const nf = (x, d = 0) => (x == null || Number.isNaN(x) ? '–' : x.toLocaleString('de-CH', { minimumFractionDigits: d, maximumFractionDigits: d }));

const SUBTABS = [
  ['overview', 'Overview 2026', 'var(--text-primary)'],
  ['nuclear', 'Nuclear', 'var(--series-2)'],
  ['hydro', 'Hydro', 'var(--series-1)'],
  ['pv', 'PV', 'var(--series-4)'],
  ['wind', 'Wind', 'var(--series-3)'],
  ['thermal', 'Thermal', '#7a5c3e'],
  ['battery', 'Battery installations', '#1e7b4e'],
];

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// production categories as in the BFE electricity statistics, coloured like the generation map
const PROD_CATS = [
  ['run_of_river_gwh', 'Run-of-river hydro', 'var(--ror-fill)'],
  ['storage_hydro_gwh', 'Storage hydro', 'var(--series-1)'],
  ['nuclear_gwh', 'Nuclear', 'var(--series-2)'],
  ['thermal_gwh', 'Thermal', '#7a5c3e'],
  ['pv_gwh', 'Photovoltaics', 'var(--series-4)'],
  ['wind_gwh', 'Wind', 'var(--series-3)'],
];

/* Stacked monthly columns (production by category) with a consumption line. */
function StackedMonths({ rows, cats, line, unit = 'GWh' }) {
  const [hi, setHi] = useState(null);
  const W = 720, H = 300, m = { l: 48, r: 12, t: 10, b: 26 };
  const n = 12;
  const tot = rows.map((r) => cats.reduce((a, [k]) => a + (r[k] || 0), 0));
  const max = Math.max(...tot, ...rows.map((r) => r[line?.key] || 0)) * 1.08;
  const step = max > 6000 ? 2000 : 1000;
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
  const bw = (W - m.l - m.r) / n;
  const y = (v) => m.t + (1 - v / max) * (H - m.t - m.b);
  const r0 = rows.find((r) => r.month === hi);
  return (
    <div className="chart stack-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" onMouseLeave={() => setHi(null)}>
        {ticks.map((t) => <g key={t}><line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'grid'} /><text x={m.l - 6} y={y(t) + 4} textAnchor="end" className="tick">{nf(t)}</text></g>)}
        {MONTHS_EN.map((mn, i) => <text key={mn} x={m.l + bw * i + bw / 2} y={H - 8} textAnchor="middle" className="tick">{mn}</text>)}
        {rows.map((r) => {
          let acc = 0;
          const x0 = m.l + bw * (r.month - 1) + 4;
          return (
            <g key={r.month} onMouseEnter={() => setHi(r.month)} opacity={r.final === 0 ? 0.92 : 1}>
              <rect x={x0 - 4} y={m.t} width={bw} height={H - m.t - m.b} fill="transparent" />
              {cats.map(([k, , c]) => {
                const v = r[k] || 0; const yt = y(acc + v), yb = y(acc); acc += v;
                return <rect key={k} x={x0} y={yt} width={bw - 8} height={Math.max(0, yb - yt - (v > 0 ? 1.5 : 0))} style={{ fill: c, ...(k === 'run_of_river_gwh' ? { stroke: 'var(--ror-line)', strokeDasharray: '3 2', strokeWidth: 1 } : {}) }} />;
              })}
            </g>
          );
        })}
        {line && (() => {
          const pts = rows.map((r) => [m.l + bw * (r.month - 1) + bw / 2, y(r[line.key])]);
          return <g><polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--text-primary)" strokeWidth="2" />
            {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="4" fill="var(--text-primary)" stroke="var(--surface-1)" strokeWidth="2" />)}</g>;
        })()}
      </svg>
      {r0 && (
        <div className="stack-tip">
          <b>{MONTHS_EN[r0.month - 1]} {r0.year}</b>{r0.final === 0 ? ' (provisional)' : ''}
          {[...cats].reverse().map(([k, l, c]) => <div key={k}><i style={{ background: c }} />{l}<span>{nf(r0[k])} {unit}</span></div>)}
          {line && <div><i style={{ background: 'var(--text-primary)', borderRadius: '50%' }} />{line.label}<span>{nf(r0[line.key])} {unit}</span></div>}
        </div>
      )}
      <div className="line-legend">
        {cats.map(([k, l, c]) => <span key={k} className="lg"><i style={{ background: c, ...(k === 'run_of_river_gwh' ? { border: '1.5px dashed var(--ror-line)' } : {}) }} />{l}</span>)}
        {line && <span className="lg"><i style={{ background: 'var(--text-primary)', borderRadius: '50%' }} />{line.label} (line)</span>}
      </div>
    </div>
  );
}

// hydro type colours = map colours
const HC = { ror: 'var(--ror-fill)', storage: 'var(--series-1)', pumped: '#1b4f91', other: 'var(--text-muted)' };

/* Horizontal bar chart: one row per category, one bar per series (grouped), negatives allowed. */
function HBar({ rows, series, unit = '', decimals = 0, labelW = 190, rowH = 0, width = 720 }) {
  const [hi, setHi] = useState(null);
  const nS = series.length;
  const bh = nS === 1 ? 16 : 11;
  const rh = rowH || nS * (bh + 2) + 10;
  const W = width, m = { l: labelW, r: 64, t: 6, b: 22 };
  const H = m.t + m.b + rows.length * rh;
  const all = rows.flatMap((r) => r.values).filter((x) => x != null);
  const min = Math.min(0, ...all), max = Math.max(0, ...all);
  const x = (val) => m.l + ((val - min) / (max - min || 1)) * (W - m.l - m.r);
  const ticks = useMemo(() => {
    const span = max - min || 1, raw = span / 4, p = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw) || raw;
    const out = []; for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) out.push(+t.toFixed(6));
    return out;
  }, [min, max]);
  return (
    <div className="hbar">
      {nS > 1 && (
        <div className="line-legend">
          {series.map((s) => <span key={s.name} className="lg"><i style={{ background: s.color, ...(s.swatch || {}) }} />{s.name}</span>)}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" onMouseLeave={() => setHi(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={m.t} y2={H - m.b} className={t === 0 ? 'axis' : 'grid'} />
            <text x={x(t)} y={H - 6} textAnchor="middle" className="tick">{nf(t, Math.abs(t) < 10 && t % 1 ? 1 : 0)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y0 = m.t + i * rh + 5;
          return (
            <g key={r.label} onMouseEnter={() => setHi(i)}>
              <rect x={0} y={y0 - 4} width={W} height={rh} fill="transparent" />
              {hi === i && <rect x={0} y={y0 - 4} width={W} height={rh} className="hb-hi" />}
              <text x={m.l - 8} y={y0 + (nS * (bh + 2)) / 2 + 2} textAnchor="end" className="hb-lab">{r.label}</text>
              {r.values.map((val, j) => {
                if (val == null) return null;
                const a = x(Math.min(0, val)), b = x(Math.max(0, val));
                const yy = y0 + j * (bh + 2);
                const s = series[j];
                return (
                  <g key={j}>
                    <rect x={a} y={yy} width={Math.max(1, b - a)} height={bh} rx="3" style={{ fill: (nS === 1 && r.color) || s.color, ...(s.style || {}), ...((nS === 1 && r.style) || {}) }}>
                      <title>{`${r.label} · ${s.name}: ${nf(val, decimals)} ${unit}`}</title>
                    </rect>
                    {(nS === 1 || hi === i) && (val < 0 && b - a > 46
                      ? <text x={a + 4} y={yy + bh - 2} textAnchor="start" className="hb-val hb-val-in">{nf(val, decimals)}</text>
                      : <text x={val >= 0 ? b + 4 : a - 4} y={yy + bh - 2} textAnchor={val >= 0 ? 'start' : 'end'} className="hb-val">{nf(val, decimals)}</text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      <div className="hb-unit muted">{unit}{nS > 1 ? ' · hover a row for values' : ''}</div>
    </div>
  );
}

function Kpis({ items }) {
  return (
    <div className="kpi-row">
      {items.map((k) => (
        <div key={k.label} className="kpi"><div className="kpi-v">{k.value}</div><div className="kpi-l">{k.label}</div></div>
      ))}
    </div>
  );
}

function Card({ title, sub, children, wide }) {
  return (
    <section className={`panel data-card ${wide ? 'wide' : ''}`}>
      <div className="dc-head"><h3>{title}</h3>{sub && <span className="muted">{sub}</span>}</div>
      {children}
    </section>
  );
}


/* Monthly values of one BFE category, one line per year (latest years in colour). */
const YEAR_PAL = ['var(--series-1)', 'var(--series-3)', 'var(--series-2)', 'var(--text-primary)'];
function MonthlyByYear({ el, k, title, sub, unit = 'GWh', from = 2021, foot }) {
  if (!el) return null;
  const rows = el.monthly.filter((r) => r.year >= from && r[k] != null);
  const ys = [...new Set(rows.map((r) => r.year))].sort();
  const col = (i) => (i >= ys.length - YEAR_PAL.length ? YEAR_PAL[i - (ys.length - YEAR_PAL.length)] : 'var(--text-muted)');
  const dash = (i) => (i >= ys.length - YEAR_PAL.length ? undefined : '4 3');
  const series = ys.map((y, i) => ({ name: String(y), color: col(i), dash: dash(i),
    values: Array.from({ length: 12 }, (_, m) => rows.find((r) => r.year === y && r.month === m + 1)?.[k] ?? null) }));
  const tot = ys.map((y) => [y, rows.filter((r) => r.year === y).reduce((a, r) => a + r[k], 0), rows.filter((r) => r.year === y).length]);
  return (
    <Card title={title} sub={sub || `${unit} per month · BFE electricity statistics`}>
      <LineChart height={220} unit={unit} xLabels={MONTHS_EN} series={series} />
      <div className="line-legend">
        {series.map((x) => <span key={x.name} className="lg"><svg width="22" height="8" aria-hidden="true"><line x1="1" x2="21" y1="4" y2="4" stroke={x.color} strokeWidth="2" strokeDasharray={x.dash} /></svg>{x.name}</span>)}
      </div>
      <p className="foot">Year totals: {tot.map(([y, t, n]) => `${y} ${nf(t)}${n < 12 ? ` (${n} mo.)` : ''}`).join(' · ')} GWh. {foot}</p>
    </Card>
  );
}

/* Model input (hourly data summed per month) vs BFE statistics for one or more series. */
function ModelVsBfe({ el, series, title, foot }) {
  const vm = el?.validation_monthly;
  if (!vm?.length) return null;
  const keys = [...new Set(vm.filter((r) => r.series === series[0][0]).map((r) => `${r.year}-${String(r.month).padStart(2, '0')}`))].sort();
  const get = (sr, key, f) => vm.find((r) => r.series === sr && `${r.year}-${String(r.month).padStart(2, '0')}` === key)?.[f] ?? null;
  const lines = [{ name: 'BFE statistics', color: 'var(--text-primary)', values: keys.map((kk) => get(series[0][0], kk, 'bfe_gwh')) },
    ...series.map(([sr, label, c, d]) => ({ name: label, color: c, dash: d, values: keys.map((kk) => get(sr, kk, 'model_gwh')) }))];
  const ratio = series.map(([sr, label]) => {
    const r = (el.validation || []).filter((v) => v.series === sr);
    return `${label}: ${r.map((v) => `${v.year} ${nf(v.ratio, 2)}`).join(', ')}`;
  });
  return (
    <Card title={title || 'Model input vs. BFE statistics'} sub="GWh per month · ratio = model ÷ BFE">
      <LineChart height={220} unit="GWh" xTickEvery={6} xLabels={keys.map((kk) => kk.slice(2))} series={lines} />
      <div className="line-legend">
        {lines.map((x) => <span key={x.name} className="lg"><svg width="22" height="8" aria-hidden="true"><line x1="1" x2="21" y1="4" y2="4" stroke={x.color} strokeWidth="2" strokeDasharray={x.dash} /></svg>{x.name}</span>)}
      </div>
      <p className="foot">{ratio.join(' · ')}. {foot}</p>
    </Card>
  );
}

/* ------------------------------- HYDRO ------------------------------- */
function Hydro({ d, pv, summary, st, el }) {
  if (!d) return <p className="muted">Loading hydro data… (public/pfc2035/hydro_docs.json — run <code>python -m pfc2035 hydro</code>)</p>;
  const fact = Object.fromEntries(d.key_facts.map((k) => [k.key, k]));
  const fleet = d.fleet_bfe_2025;
  const typeColor = (t) => (t.startsWith('run') ? HC.ror : t.startsWith('storage') ? HC.storage : t.startsWith('pumped') ? HC.pumped : HC.other);
  const rorStyle = { stroke: 'var(--ror-line)', strokeDasharray: '3 2', strokeWidth: 1.5 };
  const cost = d.cost_by_type_2011_2016;
  const sens = summary?.sensitivity?.bau?.rows?.find((r) => r.id === 'hydro_ext');
  const top = (pv?.hydro_plants || []).slice().sort((a, b) => b.power_mw - a.power_mw).slice(0, 12);
  return (
    <div className="data-grid">
      <Card title="Swiss hydropower today" sub="BFE, statistics as of 31.12.2025" wide>
        <Kpis items={[
          { value: nf(fact.plants?.value), label: 'plants ≥ 300 kW' },
          { value: `${nf(fact.max_output?.value)} MW`, label: 'maximum output (generator)' },
          { value: `${nf(fact.production_potential?.value / 1000, 1)} TWh`, label: 'production potential per year' },
          { value: `${nf(fact.share_of_production?.value, 1)} %`, label: 'of Swiss electricity (10-yr avg)' },
          { value: `${nf(fact.large_scale_share?.value, 1)} %`, label: 'from large plants > 10 MW' },
          { value: `#${fact.europe_rank?.value}`, label: 'in Europe (after NO, AT, IS)' },
        ]} />
        <p className="foot">Storage plants deliver power at short notice and shift production from summer to winter, which makes Switzerland a central supplier in the European grid. Valais and Graubünden produce {nf(fact.vs_gr_twh?.value, 1)} TWh — almost half of Swiss hydropower; {fact.rhine_rhone_plants?.value} plants are fed by the Rhine (with Aare, Reuss, Limmat) and the Rhône. Energy Act guide value for 2035: {nf(fact.target_2035?.value / 1000, 1)} TWh/yr.</p>
      </Card>

      <MonthlyByYear el={el} k="run_of_river_gwh" title="Run-of-river production by month" foot="Snow and glacier melt: peak in June–July, low in winter." />
      <MonthlyByYear el={el} k="storage_hydro_gwh" title="Storage hydro production by month" foot="Includes production from pumped water; high in winter and in wet summers (2024)." />
      <ModelVsBfe el={el} title="Run-of-river: model input vs. BFE" series={[['ch_ror', 'Model (ENTSO-E run-of-river)', 'var(--ror-fill)']]} foot="Matches within a few percent per year — used as is." />
      <ModelVsBfe el={el} title="Storage hydro: model input vs. BFE" series={[['ch_reservoir', 'Model (ENTSO-E reservoir)', 'var(--series-1)']]} foot="ENTSO-E reports only about half of BFE storage production (pumped storage and some plants are missing). The model uses it only as a feature with the reservoir filling; candidate for monthly calibration to BFE." />

      <Card title="Fleet by plant type · capacity" sub="MW, BFE 2025">
        <HBar unit="MW" rows={fleet.map((f) => ({ label: f.type, values: [f.power_mw], color: typeColor(f.type), style: f.type.startsWith('run') ? rorStyle : undefined }))}
          series={[{ name: 'MW', color: HC.storage }]} labelW={130} />
        <ul className="type-key">
          {fleet.map((f) => <li key={f.type}><i style={{ background: typeColor(f.type), ...(f.type.startsWith('run') ? { border: '1.5px dashed var(--ror-line)' } : {}) }} />{f.type}: {nf(f.power_mw)} MW{f.production_gwh_per_year ? ` · ${nf(f.production_gwh_per_year)} GWh/yr` : ''}</li>)}
        </ul>
      </Card>
      <Card title="Fleet by plant type · production" sub="GWh per year, BFE 2025">
        <HBar unit="GWh/yr" rows={fleet.filter((f) => f.production_gwh_per_year).map((f) => ({ label: f.type, values: [f.production_gwh_per_year], color: typeColor(f.type), style: f.type.startsWith('run') ? rorStyle : undefined }))}
          series={[{ name: 'GWh/yr', color: HC.storage }]} labelW={130} />
        <p className="foot">Run-of-river and storage each produce ~17.8 TWh/yr; pumped storage is mainly a flexibility source (1.6 TWh/yr net of seasonal pumping not deducted). The PFC explorer now uses 17.8 TWh run-of-river from this table.</p>
      </Card>

      {summary?.reservoir_weekly_twh && Object.keys(summary.reservoir_weekly_twh).length > 0 && (() => {
        const rw = summary.reservoir_weekly_twh;
        const ys = Object.keys(rw).sort();
        const n = Math.max(...ys.map((y) => rw[y].length));
        // the four most recent years get categorical colours; older years are grey and dashed
        const pal = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-5)'];
        const old = Math.max(0, ys.length - pal.length);
        const last = summary.reservoir_last_date;
        const series = ys.map((y, i) => ({
          name: last && last.startsWith(y) ? `${y} (to ${last.slice(8, 10)}.${last.slice(5, 7)}.${last.slice(0, 4)})` : y,
          color: i < old ? 'var(--text-muted)' : pal[i - old],
          dash: i < old ? '4 3' : undefined,
          values: Array.from({ length: n }, (_, k) => rw[y][k] ?? null),
        }));
        return (
          <Card title="Swiss reservoir filling · model input" sub={`weekly (Monday), TWh stored · ${summary.reservoir_source ?? 'BFE'}`} wide>
            <LineChart xLabels={Array.from({ length: n }, (_, i) => `W${i + 1}`)} xTickEvery={4} unit="TWh" series={series} />
            <div className="line-legend">{series.map((x) => (
              <span key={x.name} className="lg"><svg width="22" height="8" aria-hidden="true"><line x1="1" x2="21" y1="4" y2="4" stroke={x.color} strokeWidth="2" strokeDasharray={x.dash} /></svg>{x.name}</span>
            ))}</div>
            <p className="foot">Water stored in Swiss dams ("water value"): low filling before winter means storage plants bid higher and winter prices rise. The model uses the filling and its deviation from the average year; for 2035 the weather year's filling is scaled by each scenario's <code>reservoir_factor</code>.</p>
          </Card>
        );
      })()}

      {st && (() => {
        const hp = st.electricity_production_1970_2025.filter((r) => r.year >= 1995);
        return (
          <Card title="Hydro production, 1995–2025" sub="TWh · BFE Gesamtenergiestatistik 2025 Tab. 24" wide>
            <LineChart height={210} unit="TWh" xTickEvery={5} xLabels={hp.map((r) => String(r.year))}
              series={[
                { name: 'Storage plants (incl. pumped)', color: HC.storage, values: hp.map((r) => r.storage_gwh / 1000) },
                { name: 'Run-of-river', color: HC.ror, values: hp.map((r) => r.run_of_river_gwh / 1000) },
                { name: 'Pumping consumption', color: 'var(--text-muted)', values: hp.map((r) => r.pumping_gwh / 1000), dash: '4 3' },
              ]} />
            <div className="line-legend">
              <span className="lg"><i style={{ background: HC.storage }} />Storage plants (incl. pumped)</span>
              <span className="lg"><i style={{ background: HC.ror, border: '1.5px dashed var(--ror-line)' }} />Run-of-river</span>
              <span className="lg"><svg width="22" height="8" aria-hidden="true"><line x1="1" x2="21" y1="4" y2="4" stroke="var(--text-muted)" strokeWidth="2" strokeDasharray="4 3" /></svg>Pumping consumption</span>
            </div>
            <p className="foot">Weather drives hydro: 33.5 TWh in dry 2022, a record 48.3 TWh in wet 2024, 37.5 TWh in 2025. Pumping rose from ~2 TWh to 4–5.6 TWh/yr after Linth-Limmern (2017) and Nant de Drance (2022).</p>
          </Card>
        );
      })()}

      <Card title="Largest stations on the map" sub="BFE large-scale list, MW">
        <HBar unit="MW" labelW={210} rows={top.map((p) => ({ label: `${p.name.replace(/^Kraftwerk /, '')} (${p.canton_code})`, values: [p.power_mw], color: HC[p.type] || HC.storage, style: p.type === 'ror' ? rorStyle : undefined }))}
          series={[{ name: 'MW', color: HC.storage }]} />
        <p className="foot">Colours as on the map: blue = storage, dark blue = pumped storage, bright blue dashed = run-of-river.</p>
      </Card>

      <Card title="Production cost by plant type" sub="full cost, Rp./kWh · BFE 2018 (survey 2011–2016)">
        <LineChart height={220} unit="Rp./kWh" xLabels={cost.map((c) => String(c.year))}
          series={[
            { name: 'Run-of-river', color: HC.ror, values: cost.map((c) => c.run_of_river) },
            { name: 'Storage', color: HC.storage, values: cost.map((c) => c.storage) },
            { name: 'Pumped storage', color: HC.pumped, values: cost.map((c) => c.pumped_storage) },
            { name: 'All hydro', color: 'var(--text-muted)', values: cost.map((c) => c.total), dash: '4 3' },
          ]} />
        <div className="line-legend">
          {[['Run-of-river', HC.ror], ['Storage', HC.storage], ['Pumped storage', HC.pumped]].map(([n, c]) => <span key={n} className="lg"><i style={{ background: c }} />{n}</span>)}
          <span className="lg"><svg width="22" height="8" aria-hidden="true"><line x1="1" x2="21" y1="4" y2="4" stroke="var(--text-muted)" strokeWidth="2" strokeDasharray="4 3" /></svg>All hydro</span>
        </div>
        <p className="foot">Full cost incl. equity return (WACC 5 %) and 0.6 Rp./kWh overhead. Cost per kWh is higher in dry years because costs are mostly fixed.</p>
      </Card>

      <Card title="Market revenue vs. full cost, 2016" sub="Rp./kWh · BFE 2018">
        <HBar unit="Rp./kWh" decimals={2} labelW={130}
          rows={d.revenue_vs_cost_2016.map((r) => ({ label: r.type, values: [r.market_revenue_rp_kwh, r.full_cost_rp_kwh] }))}
          series={[{ name: 'Market revenue', color: 'var(--series-3)' }, { name: 'Full production cost', color: 'var(--series-2)' }]} />
        <p className="foot">2016 was the price low (Swissix base 4.13 Rp./kWh). On the half of production sold on the market the gap was ~310 Mio CHF/yr (~200 Mio after the 110 Mio CHF/yr market premium 2018–2022). The other half goes to captive customers at cost.</p>
      </Card>

      <Card title="What a kWh of hydropower costs" sub="main cost blocks, Rp./kWh · BFE 2018">
        <HBar unit="Rp./kWh" decimals={2} labelW={190} rows={d.cost_components.map((c) => ({ label: c.component, values: [c.rp_kwh] }))}
          series={[{ name: 'Rp./kWh', color: HC.storage }]} />
        <p className="foot">Water fees (max. 80 → 100 CHF/kW in 2011, 110 CHF/kW since 2015) and depreciation are the largest blocks; hydro is capital-intensive, variable costs are low.</p>
      </Card>

      <Card title="Average cost by company type, 2000–2016" sub="Rp./kWh (2015 prices) · CEPE/ETH for BFE 2018">
        <HBar unit="Rp./kWh" decimals={1} labelW={170} rows={d.cost_by_company_type_2000_2016.map((c) => ({ label: c.company_type, values: [c.avg_cost_rp_kwh] }))}
          series={[{ name: 'Rp./kWh', color: HC.storage }]} />
        <p className="foot">Accounting (pagatorisch) cost of 60 companies. New large projects (BFE 2013, 25 projects, 2.6 TWh): <b>14.1 Rp./kWh</b> — more than twice the cost of existing plants.</p>
      </Card>

      <Card title="Potential of renewals & extensions, by measure" sub="GWh per year · Federal Council report Po. 23.3006 (June 2025)" wide>
        <HBar unit="GWh/yr" labelW={200} width={1240}
          rows={d.potential_by_measure_2025.map((p) => ({ label: p.measure, values: [p.annual_gwh, p.winter_gwh, p.summer_gwh] }))}
          series={[{ name: 'Annual production', color: HC.storage }, { name: 'Winter production', color: '#1b4f91' }, { name: 'Summer production', color: 'var(--series-4)' }]} />
        <p className="foot">Total 1,351 GWh/yr in existing plants (renewals only 97 GWh). Dam heightening mainly <b>moves</b> water from summer to winter: +2,096 GWh winter, −745 GWh summer, +1,816 GWh seasonal storage — most of it from Round-Table projects already known.</p>
      </Card>

      <Card title="Potential by canton" sub="GWh per year · Po. 23.3006">
        <HBar unit="GWh/yr" labelW={60}
          rows={d.potential_by_canton_2025.map((p) => ({ label: p.canton, values: [p.annual_gwh, p.seasonal_storage_gwh] }))}
          series={[{ name: 'Annual production', color: HC.storage }, { name: 'Extra seasonal storage', color: '#1b4f91' }]} />
      </Card>
      <Card title="Is the potential economic?" sub="GWh per year · Po. 23.3006">
        <HBar unit="GWh/yr" labelW={220} rows={d.potential_economics_2025.map((p) => ({ label: p.category, values: [p.annual_gwh] }))}
          series={[{ name: 'GWh/yr', color: HC.storage }]} />
        <p className="foot">Barriers named by operators: concession expiry, residual-flow rules, appeals, the support threshold, residual-value agreements, environmental law and missing profitability.</p>
      </Card>

      <Card title="Remaining hydro potential (2013 estimate)" sub="GWh per year · Federal Council 2013, in Po. 13.3521 (2017)">
        <HBar unit="GWh/yr" labelW={230}
          rows={d.potential_2013.map((p) => ({ label: p.category, values: [p.current_conditions_gwh, p.optimized_conditions_gwh] }))}
          series={[{ name: 'Current conditions', color: HC.storage }, { name: 'Optimized conditions', color: '#1b4f91' }]} />
        <p className="foot">To reach 37.4 TWh in 2035 a gross addition of ~2.8 TWh/yr is needed (pumping −1.3 TWh, plants under construction +0.3 TWh, residual-flow losses −0.9 TWh) — both large and small hydro are required.</p>
      </Card>

      <Card title="Pumped-storage plants" sub="MW · WASTA 2017, in Po. 13.3521">
        <table className="tbl pv-tbl">
          <thead><tr><th>Plant</th><th>Canton</th><th className="num">Pump</th><th className="num">Turbine</th></tr></thead>
          <tbody>
            {d.pumped_storage_2017.map((p) => (
              <tr key={p.plant}><td>{p.plant}{p.status.startsWith('under') ? ' *' : ''}</td><td>{p.canton}</td><td className="num">{nf(p.pump_mw)}</td><td className="num">{nf(p.turbine_mw)}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="foot">* Under construction in 2017 (Linth-Limmern since 2017, Nant de Drance since 2022). Total 3,014 MW pumping / 3,529 MW turbines; BFE 2025: 3,503 MW pumped storage.</p>
      </Card>

      <Card title="Policy timeline" sub="support and targets for large hydro">
        <ul className="timeline">
          {d.policy_timeline.map((t, i) => <li key={i}><b>{t.year}</b> {t.event} <span className="muted">({t.source})</span></li>)}
        </ul>
      </Card>

      <Card title="What this means for the 2035 price model" wide>
        <ul className="implications">
          <li><b>Existing fleet is in the prices.</b> The ~16.5 GW hydro fleet (incl. 3.5 GW pumped storage) is part of the historical data the model learns from; scenarios only add new capacity.</li>
          <li><b>Run-of-river calibrated to BFE.</b> The PFC explorer uses 17.8 TWh/yr run-of-river (BFE 2025) instead of a rough 47 % share.</li>
          <li><b>New sensitivity “Hydro extensions”.</b> The Po. 23.3006 potential (+2.1 TWh winter, −0.7 TWh summer) is added to Swiss supply in the 2035 scenarios{sens ? <>: BAU average <b>{sens.d_annual_avg > 0 ? '+' : ''}{nf(sens.d_annual_avg, 2)} €/MWh</b>, winter <b>{sens.d_winter_avg > 0 ? '+' : ''}{nf(sens.d_winter_avg, 2)} €/MWh</b>, summer <b>{sens.d_summer_avg > 0 ? '+' : ''}{nf(sens.d_summer_avg, 2)} €/MWh</b> (tornado chart in the Scenarios tab).</> : ' — see the Scenarios tab.'}</li>
          <li><b>Cost floor.</b> Full cost of existing hydro is ~6–7 Rp./kWh (≈ 60–75 €/MWh); new large projects ~14 Rp./kWh. 2035 prices of 84–134 €/MWh would cover existing plants and make extensions more viable — at 2016 prices they were not.</li>
        </ul>
      </Card>

      <Card title="Sources (BFE publications)" wide>
        <ul className="sources">
          {d.sources.map((s) => (
            <li key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> <span className="muted">· BFE ID {s.id} · {s.date}</span><br /><span className="muted">{s.key_finding}</span></li>
          ))}
          <li><a href="https://www.bfe.admin.ch/en/large-scale-hydropower" target="_blank" rel="noreferrer">BFE — Large-scale hydropower</a> <span className="muted">· fleet statistics 31.12.2025</span></li>
        </ul>
        <p className="foot">Figures extracted from the PDFs into data/csv/hydro_docs/*.csv (Python project); PDFs kept in data/pdf/hydro.</p>
      </Card>
    </div>
  );
}

/* ------------------------------- NUCLEAR ------------------------------- */
function Nuclear({ st, el }) {
  const n = PLANTS.filter((p) => p.type === 'nuclear').sort((a, b) => b.mw - a.mw);
  const on = n.filter((p) => !p.offline || p.offline > 2026);
  if (!st) return <p className="muted">Loading… (public/pfc2035/energy_stats.json — run <code>python -m pfc2035 hydro</code>)</p>;
  const f = Object.fromEntries(st.nuclear_key_facts.map((k) => [k.key, k]));
  const prod = st.electricity_production_1970_2025.filter((r) => r.year >= 1995);
  const yrs = prod.map((r) => String(r.year));
  const fe = st.final_energy_by_carrier[st.final_energy_by_carrier.length - 1];
  const pct = (x) => (100 * x) / fe.total_tj;
  const bal = st.electricity_balance_1970_2025.filter((r) => r.year >= 2010);
  const ge = st.gross_energy_domestic_import_nuclear.filter((r) => r.year >= 1995);
  return (
    <div className="data-grid">
      <Card title="Nuclear power in Switzerland" sub="BFE Gesamtenergiestatistik 2025 · PSI" wide>
        <Kpis items={[
          { value: `${nf(f.share_production_2025?.value, 1)} %`, label: 'of electricity production 2025' },
          { value: `${nf(f.share_winter_2025?.value)} %`, label: 'of production in the winter half-year' },
          { value: `${nf(f.nuclear_gwh_2025?.value / 1000, 1)} TWh`, label: 'nuclear production 2025' },
          { value: `${nf(on.reduce((s2, p) => s2 + p.mw, 0) / 1000, 2)} GW`, label: `${on.length} units operating` },
          { value: `${nf(f.gross_energy_share_2025?.value, 1)} %`, label: 'of gross energy consumption' },
          { value: `${nf(f.electricity_share_final_2025?.value, 1)} %`, label: 'electricity share of final energy' },
        ]} />
        <p className="foot">After hydropower, nuclear is the second most important source of electricity and one of the most important in winter. Electricity is less than a third of total energy use: petroleum products ~45 %, gas ~12 %, other renewables ~5 %, wood, district heat, coal and waste ~11 %.</p>
      </Card>

      <Card title="Electricity production by source, 1995–2025" sub="TWh · Tab. 24" wide>
        <LineChart height={240} unit="TWh" xTickEvery={5} xLabels={yrs}
          series={[
            { name: 'Hydro', color: 'var(--series-1)', values: prod.map((r) => r.hydro_gwh / 1000) },
            { name: 'Nuclear', color: 'var(--series-2)', values: prod.map((r) => r.nuclear_gwh / 1000) },
            { name: 'Other renewables (PV, wind, biomass)', color: 'var(--series-3)', values: prod.map((r) => (r.other_renewables_gwh ?? 0) / 1000) },
            { name: 'Conventional thermal & CHP', color: 'var(--text-muted)', values: prod.map((r) => r.thermal_gwh / 1000), dash: '4 3' },
          ]} />
        <div className="line-legend">
          {[['Hydro', 'var(--series-1)'], ['Nuclear', 'var(--series-2)'], ['Other renewables (PV, wind, biomass)', 'var(--series-3)']].map(([nm, c]) => <span key={nm} className="lg"><i style={{ background: c }} />{nm}</span>)}
          <span className="lg"><svg width="22" height="8" aria-hidden="true"><line x1="1" x2="21" y1="4" y2="4" stroke="var(--text-muted)" strokeWidth="2" strokeDasharray="4 3" /></svg>Conventional thermal &amp; CHP</span>
        </div>
        <p className="foot">Nuclear peaked at 26.4 TWh (2014); 2025: 18.4 TWh, the lowest since 2021. Hydro varies with the weather year (33.5 TWh in dry 2022, 48.3 TWh in wet 2024). Hydro storage production includes pumped energy.</p>
      </Card>

      <Card title="Nuclear share of production" sub="% · Tab. 24">
        <LineChart height={200} unit="%" xTickEvery={5} xLabels={yrs}
          series={[{ name: 'Nuclear share', color: 'var(--series-2)', values: prod.map((r) => r.nuclear_pct) }]} />
        <p className="foot">From 38–40 % around 2000 to 27.2 % in 2025 (Mühleberg closed 2019, growth of PV).</p>
      </Card>
      <Card title="Nuclear fuels in gross energy consumption" sub="% · Tab. 8">
        <LineChart height={200} unit="%" xTickEvery={5} xLabels={ge.map((r) => String(r.year))}
          series={[{ name: 'Nuclear fuels', color: 'var(--series-2)', values: ge.map((r) => r.nuclear_fuels_pct) }]} />
        <p className="foot">Counted as primary energy with 33 % efficiency: 200,500 TJ of nuclear fuel → 18.4 TWh electricity in 2025.</p>
      </Card>

      <Card title={`Final energy consumption by carrier, ${fe.year}`} sub="% of 777,870 TJ · Tab. 1">
        <HBar unit="%" decimals={1} labelW={170}
          rows={[
            ['Petroleum products', fe.petroleum_tj, 'var(--text-muted)'], ['Electricity', fe.electricity_tj, 'var(--series-1)'], ['Gas', fe.gas_tj, 'var(--text-muted)'],
            ['Wood', fe.wood_tj, 'var(--text-muted)'], ['Other renewables', fe.other_renewables_tj, 'var(--text-muted)'], ['District heat', fe.district_heat_tj, 'var(--text-muted)'],
            ['Industrial waste', fe.industrial_waste_tj, 'var(--text-muted)'], ['Coal', fe.coal_tj, 'var(--text-muted)'],
          ].map(([l, val, c]) => ({ label: l, values: [pct(val)], color: c }))}
          series={[{ name: '%', color: 'var(--text-muted)' }]} />
        <p className="foot">Electricity (blue) is 26.8 % of final energy; electrification of heat and transport (heat pumps, EVs) is what drives Swiss demand up in the 2035 scenarios.</p>
      </Card>
      <Card title="Net electricity imports (+) / exports (−)" sub="GWh per year · Tab. 25">
        <HBar unit="GWh" labelW={50}
          rows={bal.map((r) => ({ label: String(r.year), values: [r.net_import_gwh], color: r.net_import_gwh >= 0 ? 'var(--series-2)' : 'var(--series-1)' }))}
          series={[{ name: 'GWh', color: 'var(--series-1)' }]} />
        <p className="foot">Orange = net import, blue = net export. Imports in years with low nuclear or hydro output (2016–17, 2021–22); record export of 14.4 TWh in wet 2024; 2025 balanced.</p>
      </Card>

      <MonthlyByYear el={el} k="nuclear_gwh" title="Nuclear production by month" foot="Dips are refuelling outages (usually May–September) and unplanned outages (e.g. ~1 GW offline from June 2025 to March 2026)." />
      <ModelVsBfe el={el} title="Nuclear: model input vs. BFE" series={[['ch_nuclear', 'Model (ENTSO-E nuclear)', 'var(--series-2)']]} foot="Matches within 0–2 % — the hourly nuclear input is reliable." />

      <Card title="Swiss nuclear fleet" sub="net MW">
        <HBar unit="MW" labelW={110} rows={n.map((p) => ({ label: p.name, values: [p.mw], color: p.offline && p.offline <= 2026 ? 'var(--text-muted)' : 'var(--series-2)' }))} series={[{ name: 'MW', color: 'var(--series-2)' }]} />
      </Card>
      <Card title="Units, cooling and planned shutdown">
        <table className="tbl pv-tbl">
          <thead><tr><th>Unit</th><th className="num">MW</th><th>Cooling</th><th className="num">Online</th><th className="num">Offline</th></tr></thead>
          <tbody>{n.map((p) => <tr key={p.id}><td>{p.name}</td><td className="num">{nf(p.mw)}</td><td>{p.cooling}</td><td className="num">{p.online}</td><td className="num">{p.offline ?? 'open'}</td></tr>)}</tbody>
        </table>
        <p className="foot">River-cooled Beznau must reduce output when the Aare exceeds 25 °C. Planned shutdown of Beznau 2032/2033; Mühleberg off since 2019.</p>
      </Card>

      <Card title="What this means for the 2035 price model" wide>
        <ul className="implications">
          <li><b>Winter matters most.</b> Nuclear supplies ~34 % of winter-half-year production; losing Beznau (0.73 GW) by 2033 is why all 2035 scenarios use 2.24 GW nuclear (Gösgen + Leibstadt) and why winter prices rise most.</li>
          <li><b>Availability risk.</b> Annual nuclear output varied between 18.4 and 25.3 TWh in 2016–2025 (−27 % to 0 % of the best year). The Delayed scenario assumes 80 % availability and the “Nuclear −10 %” sensitivity tests smaller losses.</li>
          <li><b>Imports close the gap.</b> Low-nuclear or dry years turn Switzerland into a net importer, which couples Swiss prices more closely to German and French prices.</li>
        </ul>
      </Card>

      <Card title="Sources" wide>
        <ul className="sources">
          {st.sources.map((x) => (
            <li key={x.id}><a href={x.url} target="_blank" rel="noreferrer">{x.title}</a> <span className="muted">· {x.date}</span><br /><span className="muted">{x.key_finding}</span></li>
          ))}
        </ul>
        <p className="foot">Tables 1, 8, 24, 25 of the latest edition (2025) extracted to data/csv/energy_stats/*.csv (Python project); PDFs in data/pdf/energy_stats. Older editions were used for the final-energy mix of 2020–2023; their electricity shares were revised slightly in later editions.</p>
      </Card>
    </div>
  );
}

/* ------------------------------- PV ------------------------------- */
function Pv({ pv, st, el }) {
  if (!pv) return <p className="muted">Loading…</p>;
  const pvp = (st?.electricity_production_1970_2025 || []).filter((r) => r.year >= 2010);
  const c = [...(pv.cantons || [])].sort((a, b) => b.capacity_mw - a.capacity_mw).slice(0, 12);
  const w = [...(pv.cantons || [])].sort((a, b) => b.watts_per_capita - a.watts_per_capita).slice(0, 12);
  return (
    <div className="data-grid">
      <Card title="Solar PV installed" sub={pv.cantons_date?.split('-').reverse().join('.')} wide>
        <Kpis items={[
          { value: `${nf(pv.total_mw / 1000, 2)} GW`, label: 'installed (canton sum)' },
          { value: nf(pv.total_systems), label: 'systems' },
          ...(pv.national ? [{ value: `${nf(pv.national.share_of_consumption_pct, 1)} %`, label: `of consumption (${pv.national.year})` }] : []),
        ]} />
      </Card>
      {pvp.length > 0 && (
        <Card title="Solar and wind production, 2010–2025" sub="GWh · BFE Gesamtenergiestatistik 2025 Tab. 24" wide>
          <HBar unit="GWh" labelW={60} width={1240} rows={pvp.map((r) => ({ label: String(r.year), values: [r.pv_gwh, r.wind_gwh] }))}
            series={[{ name: 'Photovoltaics', color: 'var(--series-4)' }, { name: 'Wind', color: 'var(--series-3)' }]} />
          <p className="foot">PV grew from 94 GWh (2010) to 7,948 GWh (2025) — 11.8 % of Swiss production; wind stays at ~0.16 TWh.</p>
        </Card>
      )}
      <MonthlyByYear el={el} k="pv_gwh" title="PV production by month" foot="Summer months are 5–10 times winter months; annual PV output grew by 20–37 % per year since 2021." />
      <ModelVsBfe el={el} title="PV: model input vs. BFE" series={[['ch_solar', 'Model (corrected PV)', 'var(--series-4)'], ['ch_solar_entsoe', 'Raw ENTSO-E PV', 'var(--text-muted)', '4 3']]} foot="Raw ENTSO-E PV is 28–36 % too low; our capacity-based correction overshoots by 6–16 % — a monthly calibration to BFE would remove both errors." />
      <Card title="Largest cantons by capacity" sub="MW">
        <HBar unit="MW" labelW={60} rows={c.map((x) => ({ label: x.canton_code, values: [x.capacity_mw] }))} series={[{ name: 'MW', color: 'var(--series-4)' }]} />
      </Card>
      <Card title="Most PV per inhabitant" sub="W per capita">
        <HBar unit="W/capita" labelW={60} rows={w.map((x) => ({ label: x.canton_code, values: [x.watts_per_capita] }))} series={[{ name: 'W/capita', color: 'var(--series-4)' }]} />
        <p className="foot">Source: {pv.cantons_source}</p>
      </Card>
    </div>
  );
}

/* ------------------------------- BATTERY ------------------------------- */
function Battery({ pv }) {
  if (!pv) return <p className="muted">Loading…</p>;
  const t = pv.battery_status_totals || [];
  const bs = pv.battery_by_status || {};
  return (
    <div className="data-grid">
      <Card title="Battery installations with capacity over 5 MW" sub="MWh by status · SRF/Swissolar (used by the model)">
        <HBar unit="MWh" labelW={210} rows={t.map((x) => ({ label: x.label, values: [x.energy_mwh] }))} series={[{ name: 'MWh', color: '#1e7b4e' }]} />
      </Card>
      <Card title="Site list by status" sub="MW · map">
        <table className="tbl pv-tbl">
          <thead><tr><th>Status</th><th className="num">Sites</th><th className="num">MW</th><th className="num">MWh</th></tr></thead>
          <tbody>
            {Object.entries(BESS_STATUS).filter(([k]) => bs[k]).map(([k, s]) => (
              <tr key={k}><td><i className="sw" style={bessSwatch(k)} />{s.label}</td><td className="num">{bs[k].count}</td><td className="num">{nf(bs[k].power_mw)}</td><td className="num">{nf(bs[k].energy_mwh)}</td></tr>
            ))}
          </tbody>
        </table>
        {pv.battery_national?.length > 0 && <p className="foot">Home batteries behind the meter: {pv.battery_national.map((b) => `${b.as_of.slice(0, 4)} ${nf(b.storage_gwh, 2)} GWh`).join(' · ')} (Swissolar).</p>}
      </Card>
    </div>
  );
}

/* ------------------------------- OVERVIEW 2026 ------------------------------- */
const SERIES_LABEL = { ch_ror: 'Run-of-river', ch_reservoir: 'Storage hydro (ENTSO-E)', ch_nuclear: 'Nuclear', ch_solar: 'PV (model, corrected)', ch_solar_entsoe: 'PV (raw ENTSO-E)', ch_wind: 'Wind', ch_load: 'Consumption', ch_pump: 'Pumping (ENTSO-E)' };
function Overview({ el }) {
  const [yr, setYr] = useState(null);
  if (!el) return <p className="muted">Loading… (public/pfc2035/bfe_elstat.json — run <code>python -m pfc2035 validate</code>)</p>;
  const years = [...new Set(el.monthly.map((r) => r.year))].filter((y) => y >= 2020).sort();
  const year = yr ?? years[years.length - 1];
  const rows = el.monthly.filter((r) => r.year === year);
  const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  const prov = rows.some((r) => r.final === 0);
  const val = el.validation || [];
  const vYears = [...new Set(val.map((v) => v.year))].sort();
  const vSeries = [...new Set(val.map((v) => v.series))];
  return (
    <div className="data-grid">
      <Card title={`Electricity production by month, ${year}`} sub={`GWh · BFE electricity statistics${prov ? ' · provisional' : ''}`} wide>
        <div className="year-pick">
          {years.map((y) => <button key={y} type="button" className={y === year ? 'on' : ''} onClick={() => setYr(y)}>{y}</button>)}
        </div>
        <StackedMonths rows={rows} cats={PROD_CATS} line={{ key: 'national_consumption_gwh', label: 'National consumption' }} />
        <Kpis items={[
          { value: `${nf(sum('production_gwh') / 1000, 1)} TWh`, label: `production (${rows.length} months)` },
          { value: `${nf(sum('national_consumption_gwh') / 1000, 1)} TWh`, label: 'national consumption' },
          { value: `${nf(sum('net_import_gwh') / 1000, 1)} TWh`, label: 'net import (+) / export (−)' },
          { value: `${nf((100 * sum('nuclear_gwh')) / sum('production_gwh'), 1)} %`, label: 'nuclear share' },
          { value: `${nf((100 * sum('pv_gwh')) / sum('production_gwh'), 1)} %`, label: 'PV share' },
          { value: `${nf(sum('pumping_gwh') / 1000, 1)} TWh`, label: 'pumping consumption' },
        ]} />
        <p className="foot">Same categories and data as the BFE electricity-statistics chart (opendata.swiss «Elektrizitätsbilanz der Schweiz – Monatswerte»). Winter months need imports; from April PV and run-of-river turn Switzerland into an exporter. Data: data/csv/bfe_elstat (2026: bfe_monthly_2026.csv).</p>
      </Card>

      {val.length > 0 && (
        <Card title="Validation: model input vs. BFE statistics" sub="ratio of annual sums (1.00 = identical) · outputs/validation_bfe_monthly.csv" wide>
          <table className="tbl pv-tbl val-tbl">
            <thead><tr><th>Model series</th>{vYears.map((y) => <th key={y} className="num">{y}</th>)}</tr></thead>
            <tbody>
              {vSeries.map((sr) => (
                <tr key={sr}><td>{SERIES_LABEL[sr] || sr}</td>
                  {vYears.map((y) => {
                    const v = val.find((x) => x.series === sr && x.year === y);
                    const r = v?.ratio;
                    const cls = r == null ? '' : Math.abs(r - 1) <= 0.05 ? 'ok' : Math.abs(r - 1) <= 0.2 ? 'warn' : 'bad';
                    return <td key={y} className={`num ${cls}`}>{r == null ? '–' : nf(r, 2)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="foot"><span className="ok">●</span> within ±5 % <span className="warn">▲</span> ±5–20 % <span className="bad">◆</span> more than 20 % off. Nuclear, run-of-river and consumption match; ENTSO-E storage hydro covers only ~half of BFE storage production, pumping is missing in ENTSO-E, and our PV correction is 6–16 % too high — candidates for a monthly calibration to BFE.</p>
        </Card>
      )}

      {el.weekly?.length > 0 && (() => {
        const w = el.weekly;
        return (
          <Card title="Weekly statistic: a Wednesday per week, 2025–2026" sub="GWh per day · BFE «Wochenstatistik»" wide>
            <LineChart height={220} unit="GWh/day" xTickEvery={8} xLabels={w.map((r) => r.Datum.slice(2))}
              series={[
                { name: 'Consumption', color: 'var(--text-primary)', values: w.map((r) => r.Landesverbrauch_GWh) },
                { name: 'Storage hydro', color: 'var(--series-1)', values: w.map((r) => r.Erzeugung_speicherwerk_GWh) },
                { name: 'Nuclear', color: 'var(--series-2)', values: w.map((r) => r.Erzeugung_kernkraftwerk_GWh) },
                { name: 'Run-of-river', color: 'var(--ror-fill)', values: w.map((r) => r.Erzeugung_laufwerk_GWh) },
                { name: 'Photovoltaics', color: 'var(--series-4)', values: w.map((r) => r.Erzeugung_photovoltaik_GWh) },
                { name: 'Thermal', color: '#7a5c3e', values: w.map((r) => r.Erzeugung_thermisch_GWh) },
              ]} />
            <div className="line-legend">
              {[['Consumption', 'var(--text-primary)'], ['Storage hydro', 'var(--series-1)'], ['Nuclear', 'var(--series-2)'], ['Run-of-river', 'var(--ror-fill)'], ['Photovoltaics', 'var(--series-4)'], ['Thermal', '#7a5c3e']].map(([n, c]) => <span key={n} className="lg"><i style={{ background: c }} />{n}</span>)}
            </div>
            <p className="foot">Weekly data end on {w[w.length - 1].Datum.split('-').reverse().join('.')}. Steps in nuclear output show revisions and outages: from ~71 GWh/day in early 2025 to ~46 GWh/day from June 2025 (about 1 GW offline) and back to ~62 GWh/day from April 2026.</p>
          </Card>
        );
      })()}
    </div>
  );
}

/* ------------------------------- WIND ------------------------------- */
function Wind({ st, el, summary }) {
  if (!st) return <p className="muted">Loading…</p>;
  const a = st.electricity_production_1970_2025.filter((r) => r.year >= 2005);
  const last = a[a.length - 1];
  const mm = el ? el.monthly.filter((r) => r.year >= 2020 && r.wind_gwh != null) : [];
  const winter = mm.filter((r) => [1, 2, 3, 10, 11, 12].includes(r.month)).reduce((s2, r) => s2 + r.wind_gwh, 0);
  const all = mm.reduce((s2, r) => s2 + r.wind_gwh, 0);
  const sc = summary?.scenarios || {};
  const scw = Object.entries(sc).map(([id, x]) => [x.short || x.name || id, x.params?.ch?.wind_twh]).filter(([, w]) => w != null);
  return (
    <div className="data-grid">
      <Card title="Wind power in Switzerland" sub="BFE Gesamtenergiestatistik 2025 · electricity statistics" wide>
        <Kpis items={[
          { value: `${nf(last.wind_gwh)} GWh`, label: `wind production ${last.year}` },
          { value: `${nf((100 * last.wind_gwh) / last.production_gwh, 2)} %`, label: 'of electricity production' },
          { value: `${nf(Math.max(...a.map((r) => r.wind_gwh)))} GWh`, label: 'best year so far' },
          { value: `${nf((100 * winter) / (all || 1))} %`, label: 'of wind output in winter (Oct–Mar, 2020–26)' },
          ...scw.map(([n, w]) => ({ value: `${nf(w, 1)} TWh`, label: `2035 assumption · ${n}` })),
        ]} />
        <p className="foot">Swiss wind is small (≈ 0.15–0.17 TWh/yr, about 0.25 % of production) but about 60 % of it comes in the winter half-year, when Switzerland imports — the reason the Energy Act and the 2035 scenarios count on more wind.</p>
      </Card>
      <Card title="Wind production, 2005–2025" sub="GWh · Tab. 24">
        <HBar unit="GWh" labelW={50} rows={a.map((r) => ({ label: String(r.year), values: [r.wind_gwh] }))} series={[{ name: 'GWh', color: 'var(--series-3)' }]} />
      </Card>
      <MonthlyByYear el={el} k="wind_gwh" title="Wind production by month" from={2020} foot="Strongest from October to March (storms); summers are calm." />
      <ModelVsBfe el={el} title="Wind: model input vs. BFE" series={[['ch_wind', 'Model (ENTSO-E wind)', 'var(--series-3)']]} foot="Annual ratio 0.83–1.16; single months differ more because small totals amplify rounding — acceptable given the tiny share." />
      <Card title="What this means for the 2035 price model" wide>
        <ul className="implications">
          <li><b>Winter value.</b> Each TWh of wind delivers ~0.6 TWh in winter (October–March) — more valuable for the winter gap than the same TWh of PV.</li>
          <li><b>Scenario lever.</b> Wind is scaled from the hourly weather-year profile to the scenario target (BAU 0.6, Transition 1.5, Delayed 0.3 TWh). Even 1.5 TWh is ~2 % of demand, so its price effect is small next to nuclear, hydro and imports.</li>
          <li><b>Neighbours matter more.</b> German and French wind (in the model via their residual load) moves Swiss prices far more than Swiss wind.</li>
        </ul>
      </Card>
    </div>
  );
}

/* ------------------------------- THERMAL ------------------------------- */
function Thermal({ st, el }) {
  if (!st) return <p className="muted">Loading…</p>;
  const a = st.electricity_production_1970_2025.filter((r) => r.year >= 1995);
  const last = a[a.length - 1];
  const mt = el ? el.monthly.filter((r) => r.year >= 2020 && r.thermal_gwh != null) : [];
  const ys = [...new Set(mt.map((r) => r.year))].sort();
  const pal = ['var(--text-muted)', 'var(--text-muted)', 'var(--text-muted)', 'var(--series-1)', 'var(--series-3)', 'var(--series-2)', '#7a5c3e'];
  return (
    <div className="data-grid">
      <Card title="Thermal power plants in Switzerland" sub="BFE Gesamtenergiestatistik 2025 · electricity statistics" wide>
        <Kpis items={[
          { value: `${nf(last.thermal_gwh / 1000, 2)} TWh`, label: `conventional thermal & CHP ${last.year}` },
          { value: `${nf(last.thermal_pct, 1)} %`, label: 'of electricity production' },
          { value: `${nf(last.thermal_renewable_gwh / 1000, 2)} TWh`, label: 'of which renewable (waste incineration)' },
          { value: `${nf((last.wood_gwh + last.biogas_gwh) / 1000, 2)} TWh`, label: 'wood & biogas plants' },
          (() => { const pk = a.reduce((b, r) => (r.thermal_gwh > b.thermal_gwh ? r : b), a[0]); return { value: `${nf(pk.thermal_gwh / 1000, 2)} TWh`, label: `peak (${pk.year})` }; })(),
        ]} />
        <p className="foot">Thermal plants are mainly waste-incineration plants, industrial and district-heating CHP and small gas units; there are no large gas power stations in operation. Their output is steady (≈ 0.25–0.4 TWh per month, higher in winter when heat demand runs CHP).</p>
      </Card>
      <Card title="Thermal production, 1995–2025" sub="GWh · Tab. 24">
        <LineChart height={220} unit="GWh" xTickEvery={5} xLabels={a.map((r) => String(r.year))}
          series={[
            { name: 'Conventional thermal & CHP', color: '#7a5c3e', values: a.map((r) => r.thermal_gwh) },
            { name: 'of which renewable (waste)', color: 'var(--series-3)', values: a.map((r) => r.thermal_renewable_gwh) },
            { name: 'Wood & biogas plants', color: 'var(--series-4)', values: a.map((r) => (r.wood_gwh ?? 0) + (r.biogas_gwh ?? 0)) },
          ]} />
        <div className="line-legend">
          {[['Conventional thermal & CHP', '#7a5c3e'], ['of which renewable (waste)', 'var(--series-3)'], ['Wood & biogas plants', 'var(--series-4)']].map(([n, c]) => <span key={n} className="lg"><i style={{ background: c }} />{n}</span>)}
        </div>
        <p className="foot">In the BFE energy balance wood and biogas plants count as “diverse renewables”; the monthly electricity statistics include them in “thermal”.</p>
      </Card>
      {mt.length > 0 && (
        <Card title="Thermal production by month" sub="GWh · BFE monthly balance">
          <LineChart height={220} unit="GWh" xLabels={MONTHS_EN}
            series={ys.map((y, i) => ({ name: String(y), color: pal[Math.max(0, pal.length - ys.length + i)], dash: i < ys.length - 4 ? '4 3' : undefined,
              values: Array.from({ length: 12 }, (_, k) => mt.find((r) => r.year === y && r.month === k + 1)?.thermal_gwh ?? null) }))} />
          <div className="line-legend">
            {ys.map((y, i) => <span key={y} className="lg"><svg width="22" height="8" aria-hidden="true"><line x1="1" x2="21" y1="4" y2="4" stroke={pal[Math.max(0, pal.length - ys.length + i)]} strokeWidth="2" strokeDasharray={i < ys.length - 4 ? '4 3' : undefined} /></svg>{y}</span>)}
          </div>
          <p className="foot">Monthly thermal output is reported separately since 2020 (before: “other generation”). Winter months are roughly 20–50 % higher than summer (heat-led CHP and waste incineration). Monthly “thermal” includes wood and biogas plants: 2025 = 2,469 + 624 + 456 = 3,549 GWh.</p>
        </Card>
      )}
      <Card title="What this means for the 2035 price model" wide>
        <ul className="implications">
          <li><b>Small, must-run baseload.</b> ~2.5 TWh/yr conventional thermal (3.7 % of production), ~3.5 TWh including wood and biogas, runs mostly heat-led; in the model it is part of the residual load history and is held constant in 2035.</li>
          <li><b>No gas price setter in Switzerland.</b> The marginal gas plant that sets winter prices sits in Germany, France or Italy — which is why the model uses the gas SRMC and neighbours’ residual loads rather than Swiss thermal capacity.</li>
          <li><b>Reserve plants.</b> Winter reserve gas plants (e.g. Birr) are only dispatched in emergencies and are not part of the market price formation.</li>
        </ul>
      </Card>
    </div>
  );
}

export default function DataTab() {
  const [sub, setSub] = useState('hydro');
  const [hydro, setHydro] = useState(null);
  const [pv, setPv] = useState(null);
  const [summary, setSummary] = useState(null);
  const [stats, setStats] = useState(null);
  const [el, setEl] = useState(null);
  useEffect(() => {
    fetch(`${DATA_URL}bfe_elstat.json?v=${v}`).then((r) => (r.ok ? r.json() : null)).then(setEl).catch(() => setEl(null));
    fetch(`${DATA_URL}energy_stats.json?v=${v}`).then((r) => (r.ok ? r.json() : null)).then(setStats).catch(() => setStats(null));
    fetch(`${DATA_URL}hydro_docs.json?v=${v}`).then((r) => (r.ok ? r.json() : null)).then(setHydro).catch(() => setHydro(null));
    fetch(`${DATA_URL}pv_map.json?v=${v}`).then((r) => (r.ok ? r.json() : null)).then(setPv).catch(() => setPv(null));
    fetch(`${DATA_URL}summary.json?v=${v}`).then((r) => (r.ok ? r.json() : null)).then(setSummary).catch(() => setSummary(null));
  }, []);
  return (
    <div className="app data-tab">
      <header className="hdr">
        <div>
          <h1>Data · sources behind the model</h1>
          <p className="lede">Official statistics and reports per technology — same categories as the generation map.</p>
        </div>
      </header>
      <nav className="subtabs" role="tablist" aria-label="Technology">
        {SUBTABS.map(([id, label, c]) => (
          <button key={id} role="tab" aria-selected={sub === id} className={sub === id ? 'on' : ''} onClick={() => setSub(id)}>
            <i style={{ background: c }} />{label}
          </button>
        ))}
      </nav>
      {sub === 'hydro' && <Hydro d={hydro} pv={pv} summary={summary} st={stats} el={el} />}
      {sub === 'nuclear' && <Nuclear st={stats} el={el} />}
      {sub === 'pv' && <Pv pv={pv} st={stats} el={el} />}
      {sub === 'battery' && <Battery pv={pv} />}
      {sub === 'overview' && <Overview el={el} />}
      {sub === 'thermal' && <Thermal st={stats} el={el} />}
      {sub === 'wind' && <Wind st={stats} el={el} summary={summary} />}
    </div>
  );
}
