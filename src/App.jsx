import { useMemo, useState } from 'react';
import SwissMap from './components/SwissMap.jsx';
import { LineChart, Heatmap, MiniBars } from './components/Charts.jsx';
import { computePFC, defaultParams, toCSV, MONTHS } from './model/pfc.js';
import { INDICATORS, SCENARIOS, indicatorAt } from './data/climate.js';
import { NATIONAL } from './data/plants.js';
import './App.css';

const REF_YEAR = 2026;

function Slider({ label, value, min, max, step = 1, unit, onChange, hint }) {
  return (
    <label className="ctl">
      <span className="ctl-top"><span>{label}</span><b>{value}{unit ? ` ${unit}` : ''}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
      {hint && <span className="ctl-hint">{hint}</span>}
    </label>
  );
}

function Seg({ value, options, onChange, label }) {
  return (
    <div className="ctl">
      <span className="ctl-top"><span>{label}</span></span>
      <div className="seg" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>
        ))}
      </div>
    </div>
  );
}

function Kpi({ label, value, unit, sub }) {
  return (
    <div className="kpi">
      <span className="kpi-l">{label}</span>
      <span className="kpi-v">{value}<small>{unit}</small></span>
      {sub && <span className="kpi-s">{sub}</span>}
    </div>
  );
}

export default function App() {
  const [p, setP] = useState(() => defaultParams(2030));
  const [month, setMonth] = useState(5);
  const [week, setWeek] = useState(0);
  const [showStress, setShowStress] = useState(true);
  const [selected, setSelected] = useState(null);

  const set = (k) => (v) => setP((o) => ({ ...o, [k]: v }));
  const setYear = (y) => setP((o) => ({ ...defaultParams(y), scenario: o.scenario, baseLevel: o.baseLevel, transitGW: o.transitGW, hydro: o.hydro, nuclearLife: o.nuclearLife }));

  const res = useMemo(() => computePFC(p), [p]);
  const ref = useMemo(() => computePFC({ ...defaultParams(REF_YEAR), baseLevel: p.baseLevel, scenario: p.scenario }), [p.baseLevel, p.scenario]);

  const k = res.kpis;
  const nucGW = res.nukes.filter((n) => n.running).reduce((s, n) => s + n.mw, 0) / 1000;

  // average weekday profile for selected month
  const profile = (r) => {
    const s = Array(24).fill(0), c = Array(24).fill(0);
    for (const x of r.hours) if (x.m === month && !x.weekend) { s[x.h] += x.price; c[x.h]++; }
    return s.map((v, i) => v / c[i]);
  };

  // 168 h starting from the first Monday of selected month + week offset
  const weekData = useMemo(() => {
    const firstMon = res.hours.find((x) => x.m === month && x.dow === 1 && x.h === 0);
    const startI = Math.min((firstMon?.i ?? 0) + week * 168, res.hours.length - 168);
    const slice = res.hours.slice(startI, startI + 168);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return {
      labels: slice.map((x) => `${days[x.dow]} ${x.h}:00`),
      tick: slice.map((x) => (x.h === 0 ? days[x.dow] : '')),
      price: slice.map((x) => x.price),
      pv: slice.map((x) => x.pv),
    };
  }, [res, month, week]);

  const download = () => {
    const blob = new Blob([toCSV(res.hours, p.year)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pfc_ch_${p.year}_${p.scenario}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="app">
      <header className="hdr">
        <div>
          <h1>Energy 2035 · Swiss Price Forward Curve explorer</h1>
          <p className="lede">How nuclear, hydro, solar, flexibility and a changing climate shape the hourly Swiss spot price curve, {p.year}.</p>
        </div>
        <button className="btn" onClick={download}>Download hourly PFC (CSV)</button>
      </header>

      <div className="layout">
        <aside className="panel controls">
          <h2>Scenario</h2>
          <Slider label="Delivery year" value={p.year} min={2026} max={2050} onChange={setYear} />
          <Seg label="Climate scenario" value={p.scenario} onChange={set('scenario')}
            options={Object.entries(SCENARIOS).map(([k2, v]) => [k2, v.short])} />
          <Seg label="Hydrological year" value={p.hydro} onChange={set('hydro')}
            options={[['wet', 'Wet'], ['normal', 'Normal'], ['dry', 'Dry']]} />
          <h2>Market level</h2>
          <Slider label="Base forward level" value={p.baseLevel} min={30} max={180} unit="€/MWh" onChange={set('baseLevel')}
            hint="Calibration: the hourly shape is scaled to this Cal base price" />
          <Slider label="Import / transit capacity" value={p.transitGW} min={3} max={12} step={0.5} unit="GW" onChange={set('transitGW')}
            hint="Higher = stronger coupling to DE/FR/IT shape" />
          <h2>Supply &amp; demand</h2>
          <Slider label="PV capacity (CH)" value={p.pvGW} min={5} max={50} step={0.5} unit="GW" onChange={set('pvGW')} />
          <Slider label="Decentralised flexibility" value={p.flexGW} min={0} max={10} step={0.1} unit="GW" onChange={set('flexGW')}
            hint="Batteries, demand response, PV injection management" />
          <Slider label="Flexibility duration" value={p.flexHours} min={1} max={6} unit="h" onChange={set('flexHours')} />
          <Slider label="Annual demand" value={p.demandTWh} min={55} max={90} unit="TWh" onChange={set('demandTWh')} />
          <Slider label="Gösgen / Leibstadt lifetime" value={p.nuclearLife} min={50} max={80} unit="yrs" onChange={set('nuclearLife')}
            hint={`Gösgen until ${1979 + p.nuclearLife}, Leibstadt until ${1984 + p.nuclearLife}`} />
        </aside>

        <main className="main">
          <section className="kpis">
            <Kpi label="Base" value={k.base.toFixed(0)} unit=" €/MWh" sub={`Winter ${k.winter.toFixed(0)} · Summer ${k.summer.toFixed(0)}`} />
            <Kpi label="Peak (Mo–Fr 8–20h)" value={k.peak.toFixed(0)} unit=" €/MWh" sub={`${((k.peak / k.base - 1) * 100).toFixed(0)}% vs base`} />
            <Kpi label="Solar hours 11–15h" value={k.solar.toFixed(0)} unit=" €/MWh" sub={`Evening 18–21h: ${k.evening.toFixed(0)}`} />
            <Kpi label="PV capture rate" value={(k.pvCapture * 100).toFixed(0)} unit="%" sub="PV-weighted price ÷ base" />
            <Kpi label="Avg daily spread" value={k.spread.toFixed(0)} unit=" €/MWh" sub="Value for batteries / pumping" />
            <Kpi label="Negative hours" value={k.negHours} unit=" h" sub={`Nuclear online ${nucGW.toFixed(2)} GW`} />
          </section>

          <section className="map-row">
            <div className="panel">
              <div className="panel-h">
                <h2>Generation map · nuclear &amp; hydro</h2>
                <label className="chk"><input type="checkbox" checked={showStress} onChange={(e) => setShowStress(e.target.checked)} /> Climate stress</label>
              </div>
              <SwissMap year={p.year} clim={res.clim} nukes={res.nukes} showStress={showStress} selected={selected} onSelect={setSelected} />
              <p className="foot">Main plants with indicative capacities (Swiss fleet today: ~{NATIONAL.hydroGW} GW hydro, ~{NATIONAL.hydroTWh} TWh/yr; {NATIONAL.nuclearGW} GW nuclear). Hover or tap a plant for details.</p>
            </div>

            <div className="panel fleet">
              <h2>Nuclear fleet in {p.year}</h2>
              <table className="tbl">
                <thead><tr><th>Unit</th><th>MW</th><th>Cooling</th><th>Status</th></tr></thead>
                <tbody>
                  {res.nukes.map((n) => (
                    <tr key={n.id} className={selected === n.id ? 'sel' : ''} onClick={() => setSelected(n.id)}>
                      <td>{n.name}</td><td>{n.mw.toLocaleString()}</td><td>{n.cooling === 'river' ? 'River' : 'Tower'}</td>
                      <td>{n.running ? <span className="ok">● until {n.effectiveOffline}</span> : <span className="muted">○ off {n.effectiveOffline}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="fleet-stats">
                <div><span className="muted">Nuclear online</span><b>{nucGW.toFixed(2)} GW</b></div>
                <div><span className="muted">Exp. Beznau curtailment days</span><b>{res.nukes.some((n) => n.running && n.cooling === 'river') ? res.clim.riverHotDays.toFixed(0) : '–'}</b></div>
                <div><span className="muted">PV installed</span><b>{p.pvGW} GW</b></div>
                <div><span className="muted">Hydro (storage + RoR)</span><b>~{NATIONAL.hydroGW} GW</b></div>
              </div>
              <h2 style={{ marginTop: 16 }}>Reading the map</h2>
              <ul className="howto">
                <li><b>Orange</b> nuclear units sit on the Aare and Rhine — river temperature matters for the river-cooled Beznau units.</li>
                <li><b>Blue</b> Alpine storage &amp; pumped-storage plants provide seasonal and daily flexibility; their inflows depend on snow and glacier melt.</li>
                <li><b>Green</b> run-of-river plants on the Rhine, Aare and Rhône follow river flow — high in May–August, low in winter and in dry years.</li>
                <li>The coloured <b>ring</b> shows climate stress for the selected year and scenario.</li>
              </ul>
            </div>
          </section>

          <section className="panel">
              <div className="panel-h">
                <h2>Weather &amp; climate drivers · {p.year}</h2>
                <span className="legend-inline">
                  <span className="lg"><i style={{ background: 'var(--series-1)' }} />With protection</span>
                  <span className="lg"><i style={{ background: 'var(--series-2)' }} />Without</span>
                </span>
              </div>
              <div className="climate-grid">
                {INDICATORS.map((ind) => {
                  const v = indicatorAt(ind, p.scenario, p.year);
                  const delta = v - ind.ref;
                  return (
                    <div key={ind.id} className={`clim clim-${ind.affects}`}>
                      <div className="clim-top">
                        <span className="tag">{ind.affects}</span>
                        <span className="clim-l">{ind.label}</span>
                      </div>
                      <div className="clim-v">{v.toFixed(0)}<small> {ind.unit}</small>
                        {ind.ref !== 0 && ind.ref !== 100 && <span className="clim-d">({delta >= 0 ? '+' : ''}{delta.toFixed(0)} vs ref.)</span>}
                      </div>
                      <MiniBars ind={ind} scenario={p.scenario} year={p.year} />
                      <p className="clim-i">{ind.impact}</p>
                    </div>
                  );
                })}
              </div>
              <p className="foot">Indicative values inspired by the Swiss climate scenarios (CH2018/CH2025) and Hydro-CH2018; reference 1991–2020. See the <a href="https://www.meteoswiss.admin.ch/climate/climate-change/swiss-climate-scenarios/reports-data-and-graphs-of-climate-change-scenarios/swiss-climate-scenarios-web-atlas.html" target="_blank" rel="noreferrer">MeteoSwiss web atlas</a> for official data.</p>
            </section>

          <section className="panel">
            <div className="panel-h">
              <h2>Hourly price shape · month × hour</h2>
              <span className="muted">Average price per hour of day, {p.year}</span>
            </div>
            <Heatmap grid={res.monthly} base={p.baseLevel} />
          </section>

          <section className="grid2">
            <div className="panel">
              <div className="panel-h">
                <h2>Weekday profile</h2>
                <select value={month} onChange={(e) => setMonth(+e.target.value)} aria-label="Month">
                  {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
                </select>
              </div>
              <LineChart
                xLabels={Array.from({ length: 24 }, (_, h) => `${h}h`)} xTickEvery={3} refLine={p.baseLevel}
                series={[
                  { name: `${p.year}`, color: 'var(--series-1)', values: profile(res) },
                  { name: `${REF_YEAR} reference`, color: 'var(--text-muted)', values: profile(ref), dash: '5 4' },
                ]} />
              <p className="foot">Dashed: {REF_YEAR} with default assumptions at the same base level — the change in shape is what matters for hedging.</p>
            </div>
            <div className="panel">
              <div className="panel-h">
                <h2>Hourly PFC · one week</h2>
                <span>
                  <select value={month} onChange={(e) => setMonth(+e.target.value)} aria-label="Month">
                    {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
                  </select>{' '}
                  <select value={week} onChange={(e) => setWeek(+e.target.value)} aria-label="Week">
                    {[0, 1, 2, 3].map((w) => <option key={w} value={w}>Week {w + 1}</option>)}
                  </select>
                </span>
              </div>
              <LineChart xLabels={weekData.labels} xTickEvery={24} refLine={p.baseLevel}
                series={[{ name: 'Price', color: 'var(--series-1)', values: weekData.price }]} />
              <LineChart xLabels={weekData.labels} xTickEvery={24} height={110} unit="GW"
                series={[{ name: 'PV output (CH)', color: 'var(--series-4)', values: weekData.pv }]} />
            </div>
          </section>

          <section className="panel notes">
            <h2>How the model works</h2>
            <ol>
              <li><b>Residual load</b> per hour = demand − nuclear − run-of-river − PV in Switzerland, blended with a stylised EU residual load (DE/FR/IT solar and wind). The blend weight grows with import/transit capacity, because the Swiss price is largely coupled to its neighbours.</li>
              <li><b>Flexibility</b> — existing pumped storage (~3 GW) plus the decentralised flexibility slider (batteries, demand response, PV injection management) — shifts energy within each day from low- to high-residual-load hours, flattening the shape.</li>
              <li><b>Merit order</b>: a convex function maps residual load to relative price, with negative prices in strong oversupply and a scarcity premium when residual load exceeds import capacity.</li>
              <li><b>Climate</b>: hot-river days curtail river-cooled nuclear (Beznau) and raise summer import prices (French fleet); dry spells, lower summer precipitation and glacier retreat cut late-summer run-of-river; wetter winters raise winter runoff; fewer heating degree days lower winter demand.</li>
              <li><b>Calibration</b>: as with a real PFC, the hourly shape is scaled so the annual average equals the base forward level. Times are CET without daylight-saving shifts.</li>
            </ol>
            <p className="foot">Educational model with indicative data — not investment advice or an official forecast.</p>
          </section>
        </main>
      </div>
    </div>
  );
}
