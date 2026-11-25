import { useEffect, useState } from 'react';
import Section from './Section.jsx';

// Today's hourly Swiss price: our model vs. the actual day-ahead price (euenergy.live / ENTSO-E).
// Data: public/pfc2035/today.json, written by `python -m pfc2035 today` (Python project).
const f3 = (v) => (v == null ? '–' : Number(v).toFixed(3));
const dmy = (s) => (s ? s.split('-').reverse().join('.') : '');

export default function TodayPrice() {
  const [d, setD] = useState(null);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}pfc2035/today.json?v=${__BUILD_ID__}`).then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => setD(null));
  }, []);
  if (!d?.hours?.length) return null;
  const h = d.hours;
  const act = h.filter((x) => x.actual_chf_kwh != null);
  const lo = act.length ? act.reduce((a, x) => (x.actual_chf_kwh < a.actual_chf_kwh ? x : a)) : null;
  const hi = act.length ? act.reduce((a, x) => (x.actual_chf_kwh > a.actual_chf_kwh ? x : a)) : null;
  const s = d.summary || {};
  const errCls = (e) => (e == null ? '' : Math.abs(e) <= 5 ? 'ok' : Math.abs(e) <= 15 ? 'warn' : 'bad');
  return (
    <div className="panel fleet today-panel">
      <h2 className="fleet-title">Electricity price today</h2>
      <Section title={`Spot price · ${dmy(d.date)}`} color="var(--text-primary)" defaultOpen
        summary={s.avg_actual_chf_kwh != null ? `Ø ${f3(s.avg_actual_chf_kwh)} CHF/kWh` : `model Ø ${f3(h.reduce((a, x) => a + x.model_chf_kwh, 0) / h.length)}`}>
        <p className="today-lede">Hourly day-ahead prices for Switzerland on <b>{dmy(d.date)}</b> (excluding grid fees, levies and VAT).</p>
        <table className="tbl pv-tbl today-tbl">
          <thead><tr><th>Hour (CET)</th><th className="num">Our model<br /><span className="muted">CHF/kWh</span></th><th className="num">Actual<br /><span className="muted">CHF/kWh</span></th><th className="num">Error<br /><span className="muted">model ÷ actual − 1</span></th></tr></thead>
          <tbody>
            {h.map((x) => (
              <tr key={x.hour}>
                <td><b>{x.hour}</b>{lo && x.hour === lo.hour ? <span className="muted"> (lowest)</span> : hi && x.hour === hi.hour ? <span className="muted"> (peak)</span> : null}</td>
                <td className="num">{f3(x.model_chf_kwh)}</td>
                <td className="num">{f3(x.actual_chf_kwh)}</td>
                <td className={`num ${errCls(x.error_pct)}`}>{x.error_pct == null ? '–' : `${x.error_pct > 0 ? '+' : ''}${x.error_pct.toFixed(1)} %`}</td>
              </tr>
            ))}
            {act.length > 0 && (
              <tr><td><b>Day</b></td><td className="num"><b>{f3(s.avg_model_chf_kwh)}</b></td><td className="num"><b>{f3(s.avg_actual_chf_kwh)}</b></td>
                <td className="num"><b>Ø |{s.mape_pct?.toFixed(1)} %|</b></td></tr>
            )}
          </tbody>
        </table>
        <p className="foot">
          Model: LightGBM price model with {d.model_inputs}; gas {d.gas_eur_mwh} €/MWh, CO₂ {d.co2_eur_t} €/t. Actual: {d.actual_source} — <a href="https://euenergy.live/switzerland" target="_blank" rel="noreferrer">euenergy.live</a>.
          {' '}EUR→CHF {d.fx_eur_chf}. {s.mae_eur_mwh != null ? `MAE ${s.mae_eur_mwh} €/MWh. ` : ''}{d.note} Updated {d.generated_at} with <code>python -m pfc2035 today</code>.
        </p>
      </Section>
    </div>
  );
}
