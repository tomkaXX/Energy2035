import { useEffect, useState } from 'react';
import Section from './Section.jsx';
import { LineChart } from './Charts.jsx';
import { NATIONAL } from '../data/plants.js';
import { BESS_STATUS, bessSwatch } from './SwissMap.jsx';

// Solar PV, battery storage and hydro sections of the fleet panel.
// Data: public/pfc2035/pv_map.json, written by the Python project (python -m pfc2035 scenarios).
const n0 = (v) => (v == null ? '–' : Number(v).toLocaleString('de-CH', { maximumFractionDigits: 0 }));
const n1 = (v) => (v == null ? '–' : Number(v).toLocaleString('de-CH', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const n2 = (v) => (v == null ? '–' : Number(v).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const dmy = (s) => (s ? s.split('-').reverse().join('.') : '');

export default function PvPanel() {
  const [pv, setPv] = useState(null);
  const [allBess, setAllBess] = useState(false);
  const [allHydro, setAllHydro] = useState(false);
  const [el, setEl] = useState(null);   // BFE monthly electricity statistics (bfe_elstat.json)
  const [st, setSt] = useState(null);   // BFE Gesamtenergiestatistik tables (energy_stats.json)
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}pfc2035/bfe_elstat.json?v=${__BUILD_ID__}`).then((r) => (r.ok ? r.json() : null)).then(setEl).catch(() => setEl(null));
    fetch(`${import.meta.env.BASE_URL}pfc2035/energy_stats.json?v=${__BUILD_ID__}`).then((r) => (r.ok ? r.json() : null)).then(setSt).catch(() => setSt(null));
    fetch(`${import.meta.env.BASE_URL}pfc2035/pv_map.json?v=${__BUILD_ID__}`).then((r) => (r.ok ? r.json() : null)).then(setPv).catch(() => setPv(null));
  }, []);
  if (!pv) return null;
  const nat = pv.national;
  const change = nat?.new_mw && nat?.new_mw_prev ? (nat.new_mw / nat.new_mw_prev - 1) * 100 : null;
  const bat = pv.battery_national || [];
  const batLast = bat.filter((b) => b.kind !== 'forecast').slice(-1)[0];
  const h = pv.hydro;

  return (
    <>
      {/* ---------------- Solar PV ---------------- */}
      {(nat || pv.correction?.length > 0) && (
        <Section title="Solar PV installed" color="var(--series-4)"
          summary={nat ? `${n1(nat.installed_mw / 1000)} GW · end ${nat.year}` : null}>
          {nat && (
            <table className="tbl pv-tbl">
              <thead><tr><th>Metric</th><th className="num">Value (end of {nat.year})</th></tr></thead>
              <tbody>
                <tr><td>Total installed capacity</td><td className="num"><b>{n1(nat.installed_mw)} MW</b></td></tr>
                {nat.systems && <tr><td>Number of systems</td><td className="num"><b>{n0(nat.systems)}</b></td></tr>}
                {nat.share_of_consumption_pct != null && <tr><td>Share of Swiss electricity consumption</td><td className="num"><b>{n2(nat.share_of_consumption_pct)} %</b></td></tr>}
                {nat.new_mw != null && <tr><td>New installations {nat.year}</td><td className="num"><b>{n0(nat.new_mw)} MW</b></td></tr>}
                {nat.new_mw_prev != null && <tr><td>New installations {nat.year - 1}</td><td className="num"><b>{n0(nat.new_mw_prev)} MW</b></td></tr>}
                {change != null && <tr><td>Change</td><td className="num"><b>{change > 0 ? '+' : '−'}{Math.abs(change).toFixed(0)} %</b></td></tr>}
              </tbody>
            </table>
          )}
          {pv.correction?.length > 0 && <>
            <h3 className="acc-sub">PV production: ENTSO-E vs. official</h3>
            <table className="tbl pv-tbl">
              <thead><tr><th>Year</th><th className="num">ENTSO-E</th><th className="num">Official estimate</th><th className="num">Factor</th></tr></thead>
              <tbody>
                {pv.correction.map((c) => (
                  <tr key={c.year}><td>{c.year}</td><td className="num">{n1(c.entsoe_twh)} TWh</td><td className="num"><b>{n1(c.expected_twh)} TWh</b></td><td className="num">×{Number(c.factor).toFixed(2)}</td></tr>
                ))}
              </tbody>
            </table>
          </>}
          <p className="foot">Swissolar «Statistik Sonnenenergie {nat?.year}», collected each year on behalf of the SFOE and published in early July (edition of 10.07.2026), via ecoen.ch. ENTSO-E reports only part of Swiss PV; the model keeps its hourly profile and rescales each year to average installed capacity × {n0(pv.specific_yield_kwh_per_kwp ?? 950)} kWh/kWp.</p>
        </Section>
      )}

      {/* ---------------- Battery installations ---------------- */}
      {(bat.length > 0 || pv.battery_facilities?.length > 0) && (() => {
        const fac = [...(pv.battery_facilities || [])].sort((a, b) => b.power_mw - a.power_mw);
        const bs = pv.battery_by_status || {};
        const srf = pv.battery_status_totals || [];
        const tot = Object.values(bs).reduce((t, v) => ({ mw: t.mw + v.power_mw, mwh: t.mwh + v.energy_mwh, n: t.n + v.count }), { mw: 0, mwh: 0, n: 0 });
        const shown = allBess ? fac : fac.slice(0, 8);
        return (
          <Section title="Battery installations" color={BESS_STATUS.operational.color}
            summary={srf.length ? `${n0(srf.reduce((a, x) => a + x.energy_mwh, 0))} MWh by 2030` : `${n1(tot.mw / 1000)} GW pipeline`}>
            {srf.length > 0 && (() => {
              const mx = Math.max(...srf.map((x) => x.energy_mwh));
              return (
                <div className="srf-bars" role="img" aria-label="Battery installations over 5 MW in MWh by status">
                  <div className="srf-title">Battery installations with capacity over 5 MW · in MWh <span className="muted">(used by the model)</span></div>
                  {srf.map((x) => (
                    <div key={x.status} className="srf-row">
                      <span className="srf-lab"><i className="sw" style={bessSwatch(x.status)} />{x.label}</span>
                      <span className="srf-track"><span className="srf-bar" style={{ width: `${Math.max(1.5, (100 * x.energy_mwh) / mx)}%`, ...bessSwatch(x.status) }} /></span>
                      <span className="srf-val">{n0(x.energy_mwh)}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
            {bat.length > 0 && (
              <table className="tbl pv-tbl">
                <thead><tr><th>Behind the grid connection point</th><th className="num">Storage</th></tr></thead>
                <tbody>
                  {bat.map((b) => (
                    <tr key={b.as_of}><td>{b.kind === 'forecast' ? `Forecast end of ${b.as_of.slice(0, 4)}` : `End of ${b.as_of.slice(0, 4)}`}</td>
                      <td className="num"><b>{n2(b.storage_gwh)} GWh</b></td></tr>
                  ))}
                </tbody>
              </table>
            )}
            {Object.keys(bs).length > 0 && (
              <table className="tbl pv-tbl">
                <thead><tr><th>Site list (map), by status</th><th className="num">Sites</th><th className="num">Power</th><th className="num">Energy</th></tr></thead>
                <tbody>
                  {Object.entries(BESS_STATUS).filter(([k]) => bs[k]).map(([k, v]) => (
                    <tr key={k}><td><i className="sw" style={bessSwatch(k)} />{v.label}</td><td className="num">{bs[k].count}</td>
                      <td className="num">{n0(bs[k].power_mw)} MW</td><td className="num">{n0(bs[k].energy_mwh)} MWh</td></tr>
                  ))}
                  <tr><td><b>Total</b></td><td className="num"><b>{tot.n}</b></td><td className="num"><b>{n0(tot.mw)} MW</b></td><td className="num"><b>{n0(tot.mwh)} MWh</b></td></tr>
                </tbody>
              </table>
            )}
            {fac.length > 0 && <>
              <table className="tbl pv-tbl">
                <thead><tr><th>Sites (largest first)</th><th className="num">Power</th><th className="num">Energy</th></tr></thead>
                <tbody>
                  {shown.map((b) => (
                    <tr key={b.name}><td><i className="sw" style={bessSwatch(b.status)} />{b.name} ({b.canton_code})</td>
                      <td className="num">{n1(b.power_mw)} MW</td><td className="num">{b.energy_mwh ? `${n1(b.energy_mwh)} MWh` : '–'}</td></tr>
                  ))}
                </tbody>
              </table>
              {fac.length > 8 && <button type="button" className="btn ghost small" onClick={() => setAllBess((v) => !v)}>{allBess ? 'Show top 8' : `Show all ${fac.length} sites`}</button>}
            </>}
            <p className="foot">Battery installations with capacity over 5 MW: SRF / Swissolar / 49Komma8 (June 2026); solid = operational or being built (until end 2026), outline = in development (until 2030), light red dashed = proposal stage (planned). The model uses the SRF totals (~150 MWh operational, 280 MWh being built, 4,350 MWh in development, data/csv/battery_status_totals.csv); the site list is scaled per status to match them. Map extras: Gurtnellen operational since 9.9.2026, SABAG Rothenburg (3.45 MW). Behind-the-meter: Swissolar. 2035 battery storage (BESS) per scenario: BAU 1.36 GW, Transition 2.74 GW, Delayed 0.37 GW — separate from pumped-storage hydro.</p>
          </Section>
        );
      })()}

      {/* ---------------- Wind & thermal (BFE monthly statistics) ---------------- */}
      {el?.monthly?.length > 0 && (() => {
        const mo = el.monthly;
        const ly = Math.max(...mo.map((r) => r.year));
        const cur = mo.filter((r) => r.year === ly);
        const prev = mo.filter((r) => r.year === ly - 1);
        const nM = cur.length;
        const sumK = (rows, k, n = 12) => rows.filter((r) => r.month <= n).reduce((a, r) => a + (r[k] || 0), 0);
        const ann = st?.electricity_production_1970_2025 || [];
        const lastA = ann[ann.length - 1];
        const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const table = (k) => (
          <table className="tbl pv-tbl">
            <thead><tr><th>Month</th><th className="num">{ly - 1}</th><th className="num">{ly}{cur.some((r) => r.final === 0) ? ' *' : ''}</th></tr></thead>
            <tbody>
              {MON.map((m, i) => {
                const a = prev.find((r) => r.month === i + 1)?.[k];
                const b = cur.find((r) => r.month === i + 1)?.[k];
                return <tr key={m}><td>{m}</td><td className="num">{n0(a)} GWh</td><td className="num">{b == null ? '–' : `${n0(b)} GWh`}</td></tr>;
              })}
              <tr><td><b>Jan–{MON[nM - 1]}</b></td><td className="num"><b>{n0(sumK(prev, k, nM))} GWh</b></td><td className="num"><b>{n0(sumK(cur, k, nM))} GWh</b></td></tr>
            </tbody>
          </table>
        );
        return <>
          <Section title="Wind power" color="var(--series-3)" summary={`${n0(sumK(prev, 'wind_gwh'))} GWh in ${ly - 1}`}>
            {table('wind_gwh')}
            <p className="foot">BFE electricity statistics (monthly, * provisional). {lastA ? `${lastA.year}: ${n0(lastA.wind_gwh)} GWh = ${n2((100 * lastA.wind_gwh) / lastA.production_gwh)} % of production. ` : ''}About 60 % of Swiss wind comes in October–March. No wind layer on the map (no site list yet) — details in Data → Wind.</p>
          </Section>
          <Section title="Thermal power plants" color="#7a5c3e" summary={`${n0(sumK(prev, 'thermal_gwh'))} GWh in ${ly - 1}`}>
            {table('thermal_gwh')}
            <p className="foot">Waste incineration, industrial and district-heating CHP, wood and biogas plants; heat-led, higher in winter. {lastA ? `Energy statistics ${lastA.year}: conventional thermal ${n0(lastA.thermal_gwh)} GWh (${n1(lastA.thermal_pct)} %), of which ${n0(lastA.thermal_renewable_gwh)} GWh renewable. ` : ''}Details in Data → Thermal.</p>
          </Section>
        </>;
      })()}
      {/* ---------------- Hydro ---------------- */}
      {h && (
        <Section title="Hydro storage & pumped storage" color="var(--series-1)" summary={`${n1(h.total_pct)} % full · ${dmy(h.date)}`}>
          <table className="tbl pv-tbl">
            <thead><tr><th>Reservoir content, Monday {dmy(h.date)}</th><th className="num">Value</th></tr></thead>
            <tbody>
              <tr><td>Stored energy (Swiss total)</td><td className="num"><b>{n0(h.total_gwh)} GWh</b></td></tr>
              <tr><td>Filling vs. capacity ({n0(h.capacity_gwh)} GWh)</td><td className="num"><b>{n1(h.total_pct)} %</b></td></tr>
              {h.same_week_avg_gwh != null && <tr><td>Same week, average {h.compare_years[0]}–{h.compare_years[h.compare_years.length - 1]}</td>
                <td className="num"><b>{n0(h.same_week_avg_gwh)} GWh</b></td></tr>}
              {h.same_week_avg_gwh != null && <tr><td>Difference to average</td>
                <td className="num"><b>{h.total_gwh >= h.same_week_avg_gwh ? '+' : '−'}{n0(Math.abs(h.total_gwh - h.same_week_avg_gwh))} GWh ({h.total_gwh >= h.same_week_avg_gwh ? '+' : '−'}{n0(Math.abs(h.total_gwh / h.same_week_avg_gwh - 1) * 100)} %)</b></td></tr>}
              {h.same_week_min_gwh != null && <tr><td>Range same week {h.compare_years[0]}–{h.compare_years[h.compare_years.length - 1]}</td>
                <td className="num">{n0(h.same_week_min_gwh)}–{n0(h.same_week_max_gwh)} GWh</td></tr>}
              <tr><td>Potential: days of Swiss demand covered</td><td className="num"><b>≈ {n0(h.total_gwh / (NATIONAL.demandTWh * 1000 / 365))} days</b></td></tr>
              <tr><td>Rhine at Rheinfelden (flow)</td><td className="num">{n0(h.rhine_actual_m3s)} m³/s · {n0(h.rhine_pct)} % of normal</td></tr>
            </tbody>
          </table>
          <table className="tbl pv-tbl">
            <thead><tr><th>Region</th><th className="num">Stored</th><th className="num">Full</th><th className="num">Capacity</th></tr></thead>
            <tbody>
              {h.regions.map((r) => (
                <tr key={r.region}><td>{r.region}</td><td className="num">{n0(r.gwh)} GWh</td><td className="num"><b>{n1(r.pct)} %</b></td><td className="num">{n0(r.capacity_gwh)} GWh</td></tr>
              ))}
            </tbody>
          </table>
          {h.curve_current_gwh?.length > 1 && h.curve_avg_gwh?.length > 0 && (() => {
            const n = h.curve_avg_gwh.length;
            const cur = Array.from({ length: n }, (_, i) => (h.curve_current_gwh[i] != null ? h.curve_current_gwh[i] / 1000 : null));
            const avg = h.curve_avg_gwh.map((v) => v / 1000);
            return <>
              <LineChart height={150} unit="TWh" xTickEvery={13} xLabels={Array.from({ length: n }, (_, i) => `W${i + 1}`)}
                series={[{ name: `Average ${h.compare_years[0]}–${h.compare_years[h.compare_years.length - 1]}`, color: 'var(--text-muted)', values: avg, dash: '4 3' },
                  { name: h.date.slice(0, 4), color: 'var(--series-1)', values: cur }]} />
              <div className="line-legend">
                <span className="lg"><svg width="22" height="8" aria-hidden="true"><line x1="1" x2="21" y1="4" y2="4" stroke="var(--text-muted)" strokeWidth="2" strokeDasharray="4 3" /></svg>Average {h.compare_years[0]}–{h.compare_years[h.compare_years.length - 1]}</span>
                <span className="lg"><svg width="22" height="8" aria-hidden="true"><line x1="1" x2="21" y1="4" y2="4" stroke="var(--series-1)" strokeWidth="2" /></svg>{h.date.slice(0, 4)}</span>
              </div>
            </>;
          })()}
          {pv.hydro_plants?.length > 0 ? (() => {
            const hp = [...pv.hydro_plants].sort((x, y) => y.power_mw - x.power_mw);
            const f = pv.hydro_fleet || {};
            const TL = { storage: 'Storage (reservoir)', pumped: 'Pumped storage', ror: 'Run-of-river' };
            const shown = allHydro ? hp : hp.slice(0, 10);
            return <>
              <h3 className="acc-sub">Hydroelectric power stations (BFE)</h3>
              <table className="tbl pv-tbl">
                <thead><tr><th>Type</th><th className="num">Stations</th><th className="num">Capacity</th></tr></thead>
                <tbody>
                  {['pumped', 'storage', 'ror'].filter((t) => f[t]).map((t) => (
                    <tr key={t}><td>{TL[t]}</td><td className="num">{f[t].count}</td><td className="num">{n0(f[t].power_mw)} MW</td></tr>
                  ))}
                  {f.total && <tr><td><b>Total</b></td><td className="num"><b>{f.total.count}</b></td><td className="num"><b>{n0(f.total.power_mw)} MW</b></td></tr>}
                </tbody>
              </table>
              <table className="tbl pv-tbl">
                <thead><tr><th>Station (largest first)</th><th>Type</th><th className="num">MW</th></tr></thead>
                <tbody>
                  {shown.map((x) => (
                    <tr key={x.name}><td>{x.name} ({x.canton_code})</td><td>{TL[x.type]}</td><td className="num">{n1(x.power_mw)}</td></tr>
                  ))}
                </tbody>
              </table>
              {hp.length > 10 && <button type="button" className="btn ghost small" onClick={() => setAllHydro((v) => !v)}>{allHydro ? 'Show top 10' : `Show all ${hp.length} stations`}</button>}
              <p className="foot">Source: <a href="https://www.bfe.admin.ch/en/large-scale-hydropower" target="_blank" rel="noreferrer">BFE — large-scale hydropower</a>, data/csv/hydro_plants.csv (types and coordinates added; locations approximate). The list covers the large stations (~13.2 GW of 16.5 GW installed in 701 plants, BFE 31.12.2025). More charts in the Data tab. This existing fleet is already in the historical prices; the 2035 scenarios add only <i>new</i> pumped storage (0 GW by default), separate from battery storage (BESS).</p>
            </>;
          })() : (
            <p className="foot">Existing dam and pumped-storage hydro is already in the historical prices; the 2035 scenarios add <i>new</i> pumped storage as its own parameter.</p>
          )}
          <p className="foot">BFE weekly bulletin «Speicherinhalt» (Monday 00:00), data/csv/ch_reservoir_weekly.csv. Days of demand = stored energy ÷ ({NATIONAL.demandTWh} TWh/yr ÷ 365). Installed hydro {NATIONAL.hydroGW} GW, {NATIONAL.hydroTWh} TWh/yr (BFE 31.12.2025).</p>
        </Section>
      )}
    </>
  );
}
