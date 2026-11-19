import { useEffect, useState } from 'react';

// Solar PV installed: national key figures (Swissolar) + ENTSO-E vs official production.
// Data: public/pfc2035/pv_map.json, written by the Python project (python -m pfc2035 scenarios).
const n0 = (v) => (v == null ? '–' : Number(v).toLocaleString('de-CH', { maximumFractionDigits: 0 }));
const n1 = (v) => (v == null ? '–' : Number(v).toLocaleString('de-CH', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

export default function PvPanel() {
  const [pv, setPv] = useState(null);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}pfc2035/pv_map.json`).then((r) => (r.ok ? r.json() : null)).then(setPv).catch(() => setPv(null));
  }, []);
  if (!pv?.national && !pv?.correction?.length) return null;
  const nat = pv.national;
  const change = nat?.new_mw && nat?.new_mw_prev ? (nat.new_mw / nat.new_mw_prev - 1) * 100 : null;

  return (
    <div className="pv-panel">
      <h2 style={{ marginTop: 16 }}>Solar PV installed</h2>
      {nat && (
        <table className="tbl pv-tbl">
          <thead><tr><th>Metric</th><th className="num">Value (end of {nat.year})</th></tr></thead>
          <tbody>
            <tr><td>Total installed capacity</td><td className="num"><b>{n1(nat.installed_mw)} MW</b></td></tr>
            {nat.systems && <tr><td>Number of systems</td><td className="num"><b>{n0(nat.systems)}</b></td></tr>}
            {nat.share_of_consumption_pct != null && <tr><td>Share of Swiss electricity consumption</td><td className="num"><b>{Number(nat.share_of_consumption_pct).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %</b></td></tr>}
            {nat.new_mw != null && <tr><td>New installations {nat.year}</td><td className="num"><b>{n0(nat.new_mw)} MW</b></td></tr>}
            {nat.new_mw_prev != null && <tr><td>New installations {nat.year - 1}</td><td className="num"><b>{n0(nat.new_mw_prev)} MW</b></td></tr>}
            {change != null && <tr><td>Change</td><td className="num"><b>{change > 0 ? '+' : '−'}{Math.abs(change).toFixed(0)} %</b></td></tr>}
          </tbody>
        </table>
      )}
      {pv.correction?.length > 0 && <>
        <h2 style={{ marginTop: 16 }}>PV production: ENTSO-E vs. official</h2>
        <table className="tbl pv-tbl">
          <thead><tr><th>Year</th><th className="num">ENTSO-E</th><th className="num">Official estimate</th><th className="num">Factor</th></tr></thead>
          <tbody>
            {pv.correction.map((c) => (
              <tr key={c.year}><td>{c.year}</td><td className="num">{n1(c.entsoe_twh)} TWh</td><td className="num"><b>{n1(c.expected_twh)} TWh</b></td><td className="num">×{Number(c.factor).toFixed(2)}</td></tr>
            ))}
          </tbody>
        </table>
      </>}
      {pv.battery_national?.length > 0 && <>
        <h2 style={{ marginTop: 16 }}>Battery storage</h2>
        <table className="tbl pv-tbl">
          <thead><tr><th>Behind the grid connection point</th><th className="num">Storage</th></tr></thead>
          <tbody>
            {pv.battery_national.map((b) => (
              <tr key={b.as_of}><td>{b.kind === 'forecast' ? `Forecast end of ${b.as_of.slice(0, 4)}` : `End of ${b.as_of.slice(0, 4)}`}</td>
                <td className="num"><b>{Number(b.storage_gwh).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GWh</b></td></tr>
            ))}
          </tbody>
        </table>
        {pv.battery_facilities?.length > 0 && (
          <table className="tbl pv-tbl">
            <thead><tr><th>Large facilities</th><th className="num">Power</th><th className="num">Energy</th><th>Status</th></tr></thead>
            <tbody>
              {[...pv.battery_facilities].sort((a, b) => b.power_mw - a.power_mw).map((b) => (
                <tr key={b.name}><td>{b.name} ({b.canton_code})</td><td className="num">{n0(b.power_mw)} MW</td>
                  <td className="num">{b.energy_mwh ? `${n0(b.energy_mwh)} MWh` : '–'}</td><td className="muted">{b.status}{b.year ? ` ${b.year}` : ''}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </>}
      <p className="foot">
        Battery storage: Swissolar expects growth to 2.5 GWh behind the meter by end of 2026; facilities from operator releases (Axpo, Primeo/INTILION, Alpiq, FlexBase).
        Key figures: Swissolar «Statistik Sonnenenergie {nat?.year}», collected each year on behalf of the SFOE and published in early July (edition of 10.07.2026), via ecoen.ch.
        ENTSO-E reports only part of Swiss PV; the model keeps its hourly profile and rescales each year to average installed capacity × {n0(pv.specific_yield_kwh_per_kwp ?? 950)} kWh/kWp.
      </p>
    </div>
  );
}
