import { useEffect, useMemo, useState } from 'react';
import { LineChart, Heatmap } from './components/Charts.jsx';
import { MONTHS } from './model/pfc.js';

// Results are produced by the Python project in Documents\Energy2035 (python -m pfc2035 all)
// and copied to public/pfc2035/. The optional FastAPI backend enables custom what-if runs.
const DATA_URL = `${import.meta.env.BASE_URL}pfc2035/`;
const API_URL = import.meta.env.VITE_PFC_API ?? 'http://localhost:8000';
const IDS = ['bau', 'transition', 'delayed'];

const f0 = (v) => (v == null || Number.isNaN(v) ? '–' : Math.round(v).toLocaleString('en-US'));
const f1 = (v) => (v == null || Number.isNaN(v) ? '–' : v.toFixed(1));
const sign = (v, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;

const TZ_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23' });
function localParts(startMs, i) {
  const p = Object.fromEntries(TZ_FMT.formatToParts(new Date(startMs + i * 3600e3)).map((x) => [x.type, x.value]));
  return { wd: p.weekday, m: +p.month - 1, d: +p.day, h: +p.hour };
}

const KPI_ROWS = ['annual_avg', 'winter_avg', 'summer_avg', 'neg_hours', 'neg_freq', 'hours_above_100', 'p10', 'p90', 'max', 'peak_avg', 'solar_capture', 'daily_spread'];
const INT_KPIS = new Set(['neg_hours', 'hours_above_100']);

const SLIDERS = [
  ['ch.pv_twh', 'Swiss PV', 5, 50, 0.5, 'TWh'],
  ['ch.nuclear_gw', 'Swiss nuclear', 0, 3, 0.01, 'GW'],
  ['ch.battery_gw', 'Swiss batteries', 0, 10, 0.1, 'GW'],
  ['ch.add_ev_twh', 'Extra EV demand', 0, 10, 0.1, 'TWh'],
  ['ch.add_heatpump_twh', 'Extra heat-pump demand', 0, 10, 0.1, 'TWh'],
  ['neighbours.de_solar_factor', 'German PV vs today', 0.8, 3.5, 0.05, '×'],
  ['market.gas_eur_mwh', 'Gas (TTF)', 10, 100, 1, '€/MWh'],
  ['market.co2_eur_t', 'CO₂ (EUA)', 20, 250, 5, '€/t'],
  ['market.ntc_factor', 'Border capacity vs today', 0.5, 1.5, 0.05, '×'],
];
const getP = (o, k) => k.split('.').reduce((a, b) => a?.[b], o);
function setP(o, k, v) {
  const [a, b] = k.split('.');
  return { ...o, [a]: { ...(o?.[a] ?? {}), [b]: v } };
}

function Bars({ rows, unit, color = 'var(--series-1)', signed = false }) {
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1e-9);
  return (
    <div className="bars">
      {rows.map((r) => {
        const w = (Math.abs(r.value) / max) * (signed ? 50 : 100);
        const left = signed ? (r.value >= 0 ? 50 : 50 - w) : 0;
        return (
          <div className="bar-row" key={r.label}>
            <span className="bar-l">{r.label}</span>
            <span className="bar-track">
              {signed && <i className="bar-mid" />}
              <i className="bar" style={{ left: `${left}%`, width: `${w}%`, background: signed ? (r.value >= 0 ? 'var(--series-2)' : 'var(--series-1)') : color }} />
            </span>
            <b className="bar-v">{signed ? sign(r.value) : f1(r.value)} {unit}</b>
          </div>
        );
      })}
    </div>
  );
}

function Status({ children }) {
  return <div className="app"><div className="panel notes">{children}</div></div>;
}

export default function Scenarios2035() {
  const [summary, setSummary] = useState(null);
  const [scen, setScen] = useState({});
  const [err, setErr] = useState(null);
  const [sel, setSel] = useState('bau');
  const [season, setSeason] = useState('winter');
  const [month, setMonth] = useState(5);
  const [week, setWeek] = useState(1);
  const [tornadoMetric, setTornadoMetric] = useState('d_annual_avg');
  const [api, setApi] = useState({ ok: false, checked: false });
  const [over, setOver] = useState({});
  const [custom, setCustom] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`${DATA_URL}summary.json`).then((r) => { if (!r.ok) throw new Error(`summary.json: HTTP ${r.status}`); return r.json(); }),
      ...IDS.map((id) => fetch(`${DATA_URL}scenario_${id}.json`).then((r) => (r.ok ? r.json() : null))),
    ]).then(([s, ...docs]) => {
      setSummary(s);
      setScen(Object.fromEntries(IDS.map((id, i) => [id, docs[i]]).filter(([, d]) => d)));
    }).catch((e) => setErr(String(e)));
    fetch(`${API_URL}/api/health`).then((r) => r.json()).then((j) => setApi({ ok: !!j.ok, checked: true }))
      .catch(() => setApi({ ok: false, checked: true }));
  }, []);

  const cur = scen[sel];
  const startMs = cur ? Date.parse(cur.hourly.start_utc) : 0;

  const weekData = useMemo(() => {
    if (!cur) return null;
    const n = cur.hourly.price.length;
    let i0 = 0;
    for (let i = 0; i < n; i++) { const p = localParts(startMs, i); if (p.m === month && p.wd === 'Mon' && p.h === 0) { i0 = i; break; } }
    i0 = Math.min(i0 + week * 168, n - 168);
    const idx = Array.from({ length: 168 }, (_, k) => i0 + k);
    const parts = idx.map((i) => localParts(startMs, i));
    const H = cur.hourly;
    const series = [{ name: 'PFC (mean of weather years)', color: cur.color || 'var(--series-1)', values: idx.map((i) => H.price[i]) }];
    if (H.q10) series.push({ name: 'P10', color: 'var(--text-muted)', values: idx.map((i) => H.q10[i]), dash: '3 3' });
    if (H.q90) series.push({ name: 'P90', color: 'var(--text-muted)', values: idx.map((i) => H.q90[i]), dash: '3 3' });
    return {
      labels: parts.map((p) => `${p.wd} ${p.d}.${p.m + 1}. ${p.h}:00`),
      ticks: parts.map((p) => (p.h === 0 ? `${p.wd} ${p.d}.${p.m + 1}.` : '')),
      series,
      supply: [
        { name: 'Swiss load', color: 'var(--text-secondary)', values: idx.map((i) => H.load_gw[i]) },
        { name: 'Swiss PV', color: 'var(--series-4)', values: idx.map((i) => H.pv_gw[i]) },
        { name: 'Residual load after new flexibility', color: 'var(--series-3)', values: idx.map((i) => H.residual_gw[i]) },
      ],
    };
  }, [cur, startMs, month, week]);

  if (err) {
    return (
      <Status>
        <h2>No 2035 results yet</h2>
        <p className="foot">Could not load <code>public/pfc2035/summary.json</code> ({err}). Generate it with the Python project:</p>
        <pre className="code">{'cd %USERPROFILE%\\Documents\\Energy2035\n.venv\\Scripts\\activate\npython -m pfc2035 all'}</pre>
      </Status>
    );
  }
  if (!summary || !cur) return <Status><p className="muted">Loading 2035 scenario results…</p></Status>;

  const histYears = Object.keys(summary.historical);
  const lastHist = histYears[histYears.length - 1];
  const kl = summary.kpi_labels;
  const sc = IDS.filter((id) => scen[id]).map((id) => scen[id]);

  const runCustom = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${API_URL}/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base: sel, overrides: over }) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setCustom(await r.json());
    } catch (e) { setCustom({ error: String(e) }); }
    setBusy(false);
  };

  const download = () => {
    const H = cur.hourly;
    const lines = ['datetime_utc,pfc_eur_mwh,p10_eur_mwh,p90_eur_mwh,pv_gw,load_gw'];
    for (let i = 0; i < H.price.length; i++) {
      const t = new Date(startMs + i * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
      lines.push([t, H.price[i], H.q10?.[i] ?? '', H.q90?.[i] ?? '', H.pv_gw[i], H.load_gw[i]].join(','));
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `pfc_ch_2035_${sel}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const tornado = summary.sensitivity?.[sel]?.rows ?? [];
  const bt = summary.backtest;
  const ch = summary.chronos;
  const f1a = summary.analysis_factor1 ?? {};
  const prof = (s) => (season === 'winter' ? s.profile_winter : s.profile_summer);

  return (
    <div className="app">
      <header className="hdr">
        <div>
          <h1>Swiss PFC 2035 · three scenarios</h1>
          <p className="lede">Hourly Swiss spot-price forward curve for 2035 from a gradient-boosting model trained on {summary.data.start.slice(0, 4)}–{String(+summary.data.end.slice(0, 4) - 1)} fundamentals, benchmarked against the Chronos foundation model.</p>
        </div>
        <button className="btn" onClick={download}>Download hourly PFC 2035 · {cur.short} (CSV)</button>
      </header>

      {summary.data.synthetic && (
        <div className="banner">
          <b>Demo data.</b> These results were built from the <code>synthetic</code> offline source to test the pipeline — they are not real prices.
          Run <code>python -m pfc2035 all</code> (Energy-Charts / ENTSO-E) to replace them.
        </div>
      )}

      {!summary.data.synthetic && (
        <p className="foot" style={{ margin: '-6px 0 14px' }}>
          Data: <b>{summary.data.source}</b> · {summary.data.start} → {summary.data.end}
          {summary.data.provenance_share && <> · values from {Object.entries(summary.data.provenance_share).map(([k, v]) => `${k === 'entsoe' ? 'ENTSO-E' : k} ${Math.round(v * 100)}%`).join(', ')}</>}
          {summary.data.built_at && <> · downloaded {summary.data.built_at.slice(0, 10)}</>}
        </p>
      )}

      <section className="scen-cards">
        {sc.map((s) => (
          <button key={s.id} className={`scen-card ${sel === s.id ? 'on' : ''}`} onClick={() => { setSel(s.id); setCustom(null); setOver({}); }} style={{ '--sc': s.color }}>
            <span className="scen-name">{s.name}</span>
            <span className="scen-avg">{f0(s.kpis.annual_avg.mean)}<small> €/MWh</small></span>
            <span className="scen-sub">{f0(s.kpis.neg_hours.mean)} negative h · winter {f0(s.kpis.winter_avg.mean)} / summer {f0(s.kpis.summer_avg.mean)}</span>
            <span className="scen-narr">{s.narrative}</span>
            <span className="scen-params">
              PV {s.params.ch.pv_twh} TWh · nuclear {s.params.ch.nuclear_gw} GW · batteries {s.params.ch.battery_gw} GW · gas {s.params.market.gas_eur_mwh} €/MWh · CO₂ {s.params.market.co2_eur_t} €/t · border cap. ×{s.params.market.ntc_factor}
            </span>
          </button>
        ))}
      </section>

      <section className="panel">
        <div className="panel-h">
          <h2>Results · 2035 vs. actual years</h2>
          <span className="muted">Scenario values: mean over weather years {sc[0].weather_years.join(', ')} (range in grey)</span>
        </div>
        <div className="tbl-wrap">
          <table className="tbl res">
            <thead>
              <tr><th>Output</th><th>Unit</th>{histYears.map((y) => <th key={y} className="num">Actual {y}</th>)}{sc.map((s) => <th key={s.id} className="num" style={{ color: s.color }}>{s.short} 2035</th>)}</tr>
            </thead>
            <tbody>
              {KPI_ROWS.map((k) => (
                <tr key={k}>
                  <td>{kl[k]?.label}</td><td className="muted">{kl[k]?.unit}</td>
                  {histYears.map((y) => <td key={y} className="num muted">{INT_KPIS.has(k) ? f0(summary.historical[y][k]) : f1(summary.historical[y][k])}</td>)}
                  {sc.map((s) => {
                    const v = s.kpis[k];
                    return <td key={s.id} className="num"><b>{v ? (INT_KPIS.has(k) ? f0(v.mean) : f1(v.mean)) : '–'}</b>{v && <small className="rng"> {f0(v.min)}–{f0(v.max)}</small>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid2">
        <div className="panel">
          <div className="panel-h"><h2>Monthly average price</h2><span className="muted">dashed: actual {lastHist}</span></div>
          <LineChart xLabels={MONTHS} xTickEvery={1}
            series={[...sc.map((s) => ({ name: s.short, color: s.color, values: s.monthly_avg })),
              { name: `Actual ${lastHist}`, color: 'var(--text-muted)', values: summary.historical[lastHist].monthly_avg, dash: '5 4' }]} />
        </div>
        <div className="panel">
          <div className="panel-h">
            <h2>Average daily shape</h2>
            <div className="seg small" role="radiogroup" aria-label="Season">
              {[['winter', 'Winter (Oct–Mar)'], ['summer', 'Summer (Apr–Sep)']].map(([v, l]) => (
                <button key={v} role="radio" aria-checked={season === v} className={season === v ? 'on' : ''} onClick={() => setSeason(v)}>{l}</button>
              ))}
            </div>
          </div>
          <LineChart xLabels={Array.from({ length: 24 }, (_, h) => `${h}h`)} xTickEvery={3}
            series={sc.map((s) => ({ name: s.short, color: s.color, values: prof(s) }))} />
          <p className="foot">The midday "solar dip" and the evening ramp are what matter for hedging PV and for battery revenues.</p>
        </div>
      </section>

      <section className="panel">
        <div className="panel-h"><h2>Hourly price shape · month × hour · {cur.name}</h2><span className="muted">centre colour = annual average</span></div>
        <Heatmap grid={cur.heatmap} base={cur.kpis.annual_avg.mean} />
      </section>

      <section className="grid2">
        <div className="panel">
          <div className="panel-h">
            <h2>Hourly PFC · one week · {cur.short}</h2>
            <span>
              <select value={month} onChange={(e) => setMonth(+e.target.value)} aria-label="Month">{MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}</select>{' '}
              <select value={week} onChange={(e) => setWeek(+e.target.value)} aria-label="Week">{[0, 1, 2, 3].map((w) => <option key={w} value={w}>Week {w + 1}</option>)}</select>
            </span>
          </div>
          {weekData && <>
            <LineChart xLabels={weekData.labels} xTickEvery={24} series={weekData.series} />
            <LineChart xLabels={weekData.labels} xTickEvery={24} height={130} unit="GW" series={weekData.supply} />
          </>}
          <p className="foot">Dotted: P10/P90 from quantile models. Lower panel: Swiss load, PV and residual load after new batteries/demand response.</p>
        </div>
        <div className="panel">
          <div className="panel-h"><h2>Price duration curve</h2><span className="muted">hours sorted from highest to lowest price</span></div>
          <LineChart xLabels={sc[0].duration_curve.map((_, i) => `${Math.round((i / 199) * 8760)} h`)} xTickEvery={40}
            series={sc.map((s) => ({ name: s.short, color: s.color, values: s.duration_curve }))} />
          <div className="mix">
            {sc.map((s) => (
              <div key={s.id}><b style={{ color: s.color }}>{s.short}</b>
                <span>Demand {f1(s.mix.demand_twh)} TWh · PV {f1(s.mix.pv_twh)} · nuclear {f1(s.mix.nuclear_twh)} · run-of-river {f1(s.mix.run_of_river_twh)} · residual {f1(s.mix.residual_twh)} TWh</span></div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid2">
        <div className="panel">
          <div className="panel-h"><h2>Q1 · What drives the Swiss price?</h2><span className="muted">permutation importance</span></div>
          <Bars unit="€/MWh" rows={Object.entries(summary.importance_by_factor).map(([label, value]) => ({ label, value }))} />
          <p className="foot">How much the model's error (MAE) grows when each driver group is shuffled — the factor groups of the challenge sheet. Top single features: {Object.entries(summary.importance_by_feature).slice(0, 5).map(([k, v]) => `${k} (${f1(v)})`).join(', ')}.</p>
          {f1a.corr_price && (
            <p className="foot">Factor 1 · correlation of the Swiss price with DE {f1a.corr_price.DE}, FR {f1a.corr_price.FR}, IT-North {f1a.corr_price['IT-North']}
              {f1a.neg_hours?.share_while_exporting != null && <> · {Math.round(f1a.neg_hours.share_while_exporting * 100)}% of negative-price hours occur while Switzerland is a net exporter</>}.</p>
          )}
        </div>
        <div className="panel">
          <div className="panel-h">
            <h2>Q3 · Sensitivity · {cur.short}</h2>
            <select value={tornadoMetric} onChange={(e) => setTornadoMetric(e.target.value)} aria-label="Metric">
              <option value="d_annual_avg">Δ annual average (€/MWh)</option>
              <option value="d_winter_avg">Δ winter average (€/MWh)</option>
              <option value="d_summer_avg">Δ summer average (€/MWh)</option>
              <option value="d_neg_hours">Δ negative hours (h)</option>
              <option value="d_daily_spread">Δ daily spread (€/MWh)</option>
              <option value="d_solar_capture">Δ PV capture rate (pp)</option>
            </select>
          </div>
          {tornado.length ? <Bars signed unit={tornadoMetric === 'd_neg_hours' ? 'h' : ''} rows={[...tornado].sort((a, b) => Math.abs(b[tornadoMetric]) - Math.abs(a[tornadoMetric])).map((r) => ({ label: r.label, value: r[tornadoMetric] }))} />
            : <p className="muted">Run without <code>--no-sensitivity</code> to fill this chart.</p>}
          <p className="foot">One change at a time on top of the scenario (sheet "sensitivity analysis"). Edit the list in <code>config/scenarios.yaml</code>.</p>
        </div>
      </section>

      <section className="grid2">
        <div className="panel">
          <div className="panel-h"><h2>What-if · start from {cur.short}</h2>
            <span className={api.ok ? 'pill ok-pill' : 'pill'}>{api.ok ? 'API connected' : api.checked ? 'API offline' : 'checking API…'}</span></div>
          {api.ok ? (
            <>
              <div className="whatif">
                {SLIDERS.map(([k, label, min, max, step, unit]) => {
                  const v = getP(over, k) ?? getP(cur.params, k);
                  return (
                    <label className="ctl" key={k}>
                      <span className="ctl-top"><span>{label}</span><b>{+(+v).toFixed(2)} {unit}</b></span>
                      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => setOver((o) => setP(o, k, +e.target.value))} />
                    </label>
                  );
                })}
              </div>
              <div className="row-btns">
                <button className="btn" onClick={runCustom} disabled={busy}>{busy ? 'Running…' : 'Run custom scenario'}</button>
                <button className="btn ghost" onClick={() => { setOver({}); setCustom(null); }}>Reset</button>
              </div>
            </>
          ) : (
            <div className="foot">
              Start the backend to run your own scenarios:
              <pre className="code">{'cd %USERPROFILE%\\Documents\\Energy2035\n.venv\\Scripts\\activate\nuvicorn api.main:app --port 8000'}</pre>
              or edit <code>config/scenarios.yaml</code> and run <code>python -m pfc2035 scenarios</code>.
            </div>
          )}
        </div>
        <div className="panel">
          <div className="panel-h"><h2>Custom result</h2></div>
          {!custom && <p className="muted">Move sliders and press "Run custom scenario".</p>}
          {custom?.error && <p className="foot">Error: {custom.error}</p>}
          {custom && !custom.error && (
            <>
              <table className="tbl res">
                <thead><tr><th>Output</th><th className="num">{cur.short}</th><th className="num">Custom</th><th className="num">Δ</th></tr></thead>
                <tbody>
                  {['annual_avg', 'winter_avg', 'summer_avg', 'neg_hours', 'hours_above_100', 'solar_capture', 'daily_spread'].map((k) => (
                    <tr key={k}><td>{kl[k].label}</td><td className="num">{f1(cur.kpis[k].mean)}</td><td className="num"><b>{f1(custom.kpis[k].mean)}</b></td>
                      <td className="num">{sign(custom.kpis[k].mean - cur.kpis[k].mean)}</td></tr>
                  ))}
                </tbody>
              </table>
              <LineChart xLabels={Array.from({ length: 24 }, (_, h) => `${h}h`)} xTickEvery={3}
                series={[{ name: `${cur.short} ${season}`, color: cur.color, values: prof(cur) },
                  { name: `Custom ${season}`, color: 'var(--text-primary)', values: season === 'winter' ? custom.profile_winter : custom.profile_summer, dash: '5 4' }]} />
            </>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-h"><h2>Model quality · back-test on hold-out data</h2><span className="muted">{bt.period[0].slice(0, 10)} → {bt.period[1].slice(0, 10)}</span></div>
        <table className="tbl res">
          <thead><tr><th>Model</th><th className="num">MAE €/MWh</th><th className="num">RMSE</th><th className="num">R²</th><th className="num">Neg. hours (pred / actual)</th><th>What it sees</th></tr></thead>
          <tbody>
            <tr><td><b>LightGBM (linear trees)</b></td><td className="num">{f1(bt.lightgbm.mae)}</td><td className="num">{f1(bt.lightgbm.rmse)}</td><td className="num">{bt.lightgbm.r2.toFixed(2)}</td><td className="num">{bt.lightgbm.neg_hours_pred} / {bt.lightgbm.neg_hours_true}</td><td className="muted">actual fundamentals of each hour (scenario model)</td></tr>
            {ch && <tr><td><b>Chronos</b> <span className="muted">{ch.model_id}</span></td><td className="num">{f1(ch.chronos.mae)}</td><td className="num">{f1(ch.chronos.rmse)}</td><td className="num">{ch.chronos.r2.toFixed(2)}</td><td className="num">{ch.chronos.neg_hours_pred} / {ch.chronos.neg_hours_true}</td><td className="muted">only past prices, 24 h ahead, last {ch.days} days</td></tr>}
            <tr><td>Naive: same hour last week</td><td className="num">{f1(bt.naive_same_hour_last_week.mae)}</td><td className="num">{f1(bt.naive_same_hour_last_week.rmse)}</td><td className="num">{bt.naive_same_hour_last_week.r2.toFixed(2)}</td><td className="num">{bt.naive_same_hour_last_week.neg_hours_pred} / {bt.naive_same_hour_last_week.neg_hours_true}</td><td className="muted">past prices</td></tr>
            <tr><td>Naive: same hour yesterday</td><td className="num">{f1(bt.naive_same_hour_yesterday.mae)}</td><td className="num">{f1(bt.naive_same_hour_yesterday.rmse)}</td><td className="num">{bt.naive_same_hour_yesterday.r2.toFixed(2)}</td><td className="num">{bt.naive_same_hour_yesterday.neg_hours_pred} / {bt.naive_same_hour_yesterday.neg_hours_true}</td><td className="muted">past prices</td></tr>
          </tbody>
        </table>
        {!ch && <p className="foot">Chronos not run yet: <code>pip install -r requirements-chronos.txt</code>, then <code>python -m pfc2035 chronos</code> and <code>python -m pfc2035 scenarios</code>.</p>}
        {ch?.sample && (
          <LineChart xLabels={ch.sample.t.map((t) => t.slice(5, 16))} xTickEvery={24}
            series={[{ name: 'Actual', color: 'var(--text-primary)', values: ch.sample.actual },
              { name: 'Chronos mean', color: 'var(--series-2)', values: ch.sample.chronos },
              { name: 'Chronos P10', color: 'var(--text-muted)', values: ch.sample.p10, dash: '3 3' },
              { name: 'Chronos P90', color: 'var(--text-muted)', values: ch.sample.p90, dash: '3 3' }]} />
        )}
        <p className="foot">{bt.note} Chronos answers "what will tomorrow look like?"; only the fundamentals model can answer "what if PV doubles?", which is why it drives the 2035 scenarios.</p>
      </section>

      <section className="panel notes">
        <h2>Method in five steps</h2>
        <ol>
          <li><b>Data</b>: hourly CH/DE/FR/IT day-ahead prices, Swiss load, PV, wind, nuclear, run-of-river and neighbours' load/PV/wind/nuclear ({summary.data.source}), plus monthly gas and CO₂ prices.</li>
          <li><b>Model</b>: LightGBM with linear leaves predicts price ÷ gas-plant marginal cost from Swiss and neighbouring residual load, renewables share, fuel cost and calendar; quantile models give P10/P90.</li>
          <li><b>2035 year</b>: each historical weather year is moved to the 2035 calendar and rescaled to the scenario (demand + EV/heat pumps/cooling, PV, nuclear, hydro, neighbours, fuel). New batteries and demand response flatten the residual load before pricing.</li>
          <li><b>Structural effects</b> outside the data — reduced border capacity, PV curtailment floors — are applied as transparent adjustments.</li>
          <li><b>Uncertainty</b>: results are averaged over weather years (range shown) and stress-tested one parameter at a time.</li>
        </ol>
        <p className="foot">Generated {summary.generated_at.replace('T', ' ').slice(0, 16)} UTC. Research tool, not investment advice.</p>
      </section>
    </div>
  );
}
