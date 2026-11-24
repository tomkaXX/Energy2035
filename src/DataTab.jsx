import { useEffect, useMemo, useState } from 'react';
import { LineChart } from './components/Charts.jsx';
import { NATIONAL, PLANTS } from './data/plants.js';
import { BESS_STATUS, bessSwatch } from './components/SwissMap.jsx';

const DATA_URL = `${import.meta.env.BASE_URL}pfc2035/`;
const v = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : '';
const nf = (x, d = 0) => (x == null || Number.isNaN(x) ? '–' : x.toLocaleString('de-CH', { minimumFractionDigits: d, maximumFractionDigits: d }));

const SUBTABS = [
  ['nuclear', 'Nuclear', 'var(--series-2)'],
  ['hydro', 'Hydro', 'var(--series-1)'],
  ['pv', 'PV', 'var(--series-4)'],
  ['battery', 'Battery installations', '#1e7b4e'],
];

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
                    {(nS === 1 || hi === i) && (
                      <text x={val >= 0 ? b + 4 : a - 4} y={yy + bh - 2} textAnchor={val >= 0 ? 'start' : 'end'} className="hb-val">{nf(val, decimals)}</text>
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

/* ------------------------------- HYDRO ------------------------------- */
function Hydro({ d, pv, summary }) {
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
function Nuclear() {
  const n = PLANTS.filter((p) => p.type === 'nuclear').sort((a, b) => b.mw - a.mw);
  const on = n.filter((p) => !p.offline || p.offline > 2026);
  return (
    <div className="data-grid">
      <Card title="Swiss nuclear fleet" sub="net MW">
        <Kpis items={[
          { value: `${nf(on.reduce((s, p) => s + p.mw, 0) / 1000, 2)} GW`, label: 'operating' },
          { value: on.length, label: 'units operating' },
          { value: `~${NATIONAL.nuclearTWh} TWh`, label: 'production per year' },
        ]} />
        <HBar unit="MW" labelW={110} rows={n.map((p) => ({ label: p.name, values: [p.mw] }))} series={[{ name: 'MW', color: 'var(--series-2)' }]} />
      </Card>
      <Card title="Units, cooling and planned shutdown">
        <table className="tbl pv-tbl">
          <thead><tr><th>Unit</th><th className="num">MW</th><th>Cooling</th><th className="num">Online</th><th className="num">Offline</th></tr></thead>
          <tbody>{n.map((p) => <tr key={p.id}><td>{p.name}</td><td className="num">{nf(p.mw)}</td><td>{p.cooling}</td><td className="num">{p.online}</td><td className="num">{p.offline ?? 'open'}</td></tr>)}</tbody>
        </table>
        <p className="foot">River-cooled Beznau must reduce output when the Aare exceeds 25 °C. Planned shutdown of Beznau 2032/2033; Mühleberg off since 2019.</p>
      </Card>
    </div>
  );
}

/* ------------------------------- PV ------------------------------- */
function Pv({ pv }) {
  if (!pv) return <p className="muted">Loading…</p>;
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

export default function DataTab() {
  const [sub, setSub] = useState('hydro');
  const [hydro, setHydro] = useState(null);
  const [pv, setPv] = useState(null);
  const [summary, setSummary] = useState(null);
  useEffect(() => {
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
      {sub === 'hydro' && <Hydro d={hydro} pv={pv} summary={summary} />}
      {sub === 'nuclear' && <Nuclear />}
      {sub === 'pv' && <Pv pv={pv} />}
      {sub === 'battery' && <Battery pv={pv} />}
    </div>
  );
}
