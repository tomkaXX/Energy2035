import { useEffect, useState } from 'react';
import Section from './Section.jsx';
import { LineChart } from './Charts.jsx';
import { NATIONAL, PLANTS } from '../data/plants.js';
import { BESS_STATUS } from './SwissMap.jsx';

// Solar PV, battery storage and hydro sections of the fleet panel.
// Data: public/pfc2035/pv_map.json, written by the Python project (python -m pfc2035 scenarios).
const n0 = (v) => (v == null ? '–' : Number(v).toLocaleString('de-CH', { maximumFractionDigits: 0 }));
const n1 = (v) => (v == null ? '–' : Number(v).toLocaleString('de-CH', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const n2 = (v) => (v == null ? '–' : Number(v).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const dmy = (s) => (s ? s.split('-').reverse().join('.') : '');

export default function PvPanel() {
  const [pv, setPv] = useState(null);
  const [allBess, setAllBess] = useState(false);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}pfc2035/pv_map.json`).then((r) => (r.ok ? r.json() : null)).then(setPv).catch(() => setPv(null));
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

      {/* ---------------- Battery storage (BESS) ---------------- */}
      {(bat.length > 0 || pv.battery_facilities?.length > 0) && (() => {
        const fac = [...(pv.battery_facilities || [])].sort((a, b) => b.power_mw - a.power_mw);
        const bs = pv.battery_by_status || {};
        const tot = Object.values(bs).reduce((t, v) => ({ mw: t.mw + v.power_mw, mwh: t.mwh + v.energy_mwh, n: t.n + v.count }), { mw: 0, mwh: 0, n: 0 });
        const shown = allBess ? fac : fac.slice(0, 8);
        return (
          <Section title="Battery storage (BESS)" color={BESS_STATUS.operational.color}
            summary={batLast ? `${n2(batLast.storage_gwh)} GWh home · ${n1(tot.mw / 1000)} GW grid pipeline` : null}>
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
                <thead><tr><th>Grid-scale, by status</th><th className="num">Sites</th><th className="num">Power</th><th className="num">Energy</th></tr></thead>
                <tbody>
                  {Object.entries(BESS_STATUS).filter(([k]) => bs[k]).map(([k, v]) => (
                    <tr key={k}><td><i className="sw" style={{ background: v.color }} />{v.label}</td><td className="num">{bs[k].count}</td>
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
                    <tr key={b.name}><td><i className="sw" style={{ background: (BESS_STATUS[b.status] || {}).color }} />{b.name} ({b.canton_code})</td>
                      <td className="num">{n1(b.power_mw)} MW</td><td className="num">{b.energy_mwh ? `${n1(b.energy_mwh)} MWh` : '–'}</td></tr>
                  ))}
                </tbody>
              </table>
              {fac.length > 8 && <button type="button" className="btn ghost small" onClick={() => setAllBess((v) => !v)}>{allBess ? 'Show top 8' : `Show all ${fac.length} sites`}</button>}
            </>}
            <p className="foot">Grid-scale BESS &gt; 5 MW and status: SRF / Swissolar / 49Komma8 map (June 2026), Gurtnellen updated to operational (inaugurated 9.9.2026), plus SABAG Rothenburg (3.45 MW, May 2026). Behind-the-meter: Swissolar. In the 2035 scenarios BESS is a separate parameter from pumped-storage hydro (BAU 1.5 GW, Transition 3.0 GW, Delayed 0.5 GW).</p>
          </Section>
        );
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
          <h3 className="acc-sub">Pumped-storage hydro (map)</h3>
          <table className="tbl pv-tbl">
            <thead><tr><th>Plant</th><th className="num">Turbine</th><th>Canton</th></tr></thead>
            <tbody>
              {PLANTS.filter((x) => x.pumped).sort((a, b) => b.mw - a.mw).map((x) => (
                <tr key={x.id}><td>{x.name}</td><td className="num">{n0(x.mw)} MW</td><td>{x.canton}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="foot">Indicative scheme capacities (some include non-pumped turbines). Existing dam and pumped-storage hydro is already in the historical prices; the 2035 scenarios add <i>new</i> pumped storage as its own parameter (0 GW by default), separate from battery storage (BESS).</p>
          <p className="foot">BFE weekly bulletin «Speicherinhalt» (Monday 00:00), data/csv/ch_reservoir_weekly.csv. Days of demand = stored energy ÷ ({NATIONAL.demandTWh} TWh/yr ÷ 365). Installed hydro ≈ {NATIONAL.hydroGW} GW, ≈ {NATIONAL.hydroTWh} TWh/yr (indicative).</p>
        </Section>
      )}
    </>
  );
}
