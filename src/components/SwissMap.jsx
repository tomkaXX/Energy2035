import { useEffect, useMemo, useState } from 'react';
import { geoMercator, geoPath } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import { PLANTS, TYPE_META } from '../data/plants.js';

const W = 760;
const H = 480;

// Climate stress level for a plant in the selected scenario/year → status
function stressFor(p, clim, year, nukes) {
  if (p.type === 'nuclear') {
    const n = nukes.find((x) => x.id === p.id);
    if (!n?.running) return null;
    if (p.cooling === 'river') {
      const d = clim.riverHotDays;
      return d >= 15 ? 'critical' : d >= 8 ? 'serious' : 'warning';
    }
    return clim.hotDays >= 25 ? 'warning' : 'good';
  }
  if (p.type === 'ror') {
    const drop = -clim.summerPrecip;
    return drop >= 15 ? 'serious' : drop >= 6 ? 'warning' : 'good';
  }
  // storage: glacier dependence & dry spells
  const g = clim.glacier;
  return g <= 40 ? 'serious' : g <= 70 ? 'warning' : 'good';
}

const STATUS_LABEL = { good: 'Low', warning: 'Moderate', serious: 'High', critical: 'Very high' };
const STATUS_ICON = { good: '●', warning: '▲', serious: '◆', critical: '✖' };

export default function SwissMap({ year, clim, nukes, showStress, selected, onSelect }) {
  const [topo, setTopo] = useState(null);
  const [hover, setHover] = useState(null);
  const [pv, setPv] = useState(null);         // PV by canton + large plants (public/pfc2035/pv_map.json)
  const [showPv, setShowPv] = useState(true);
  const [pvHover, setPvHover] = useState(null);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}ch.json`).then((r) => r.json()).then(setTopo).catch(() => setTopo(null));
    fetch(`${import.meta.env.BASE_URL}pfc2035/pv_map.json`).then((r) => (r.ok ? r.json() : null)).then(setPv).catch(() => setPv(null));
  }, []);

  const geo = useMemo(() => {
    if (!topo) return null;
    const country = feature(topo, topo.objects.country);
    const projection = geoMercator().fitExtent([[12, 12], [W - 12, H - 12]], country);
    const path = geoPath(projection);
    return {
      projection,
      country: path(country),
      cantonBorders: path(mesh(topo, topo.objects.cantons, (a, b) => a !== b)),
      lakes: feature(topo, topo.objects.lakes).features.map((f) => path(f)),
    };
  }, [topo]);

  const r = (mw) => 3 + Math.sqrt(mw) * 0.55;

  const plants = useMemo(() => {
    if (!geo) return [];
    return [...PLANTS]
      .sort((a, b) => b.mw - a.mw)
      .map((p) => {
        const [x, y] = geo.projection([p.lon, p.lat]);
        const nuke = nukes.find((n) => n.id === p.id);
        const inactive = p.type === 'nuclear' && !nuke?.running;
        return { ...p, x: x + (p.dx || 0), y, inactive, stress: stressFor(p, clim, year, nukes), offYear: nuke?.effectiveOffline };
      });
  }, [geo, clim, year, nukes]);

  const active = hover || plants.find((p) => p.id === selected);

  // canton dot: radius from watts per capita (322–1,884 W) -> ~3–6 px
  const rPv = (w) => 1.5 + Math.sqrt(w) * 0.105;
  const pvPoints = useMemo(() => {
    if (!geo || !pv) return { cantons: [], large: [] };
    const cantons = (pv.cantons || []).map((c) => {
      const [x, y] = geo.projection([c.capital_lon, c.capital_lat]);
      return { ...c, x, y };
    });
    const large = (pv.large || []).map((l) => {
      const [x, y] = geo.projection([l.lon, l.lat]);
      return { ...l, x, y };
    });
    return { cantons, large };
  }, [geo, pv]);
  const fmtN = (v, d = 0) => (v == null || Number.isNaN(v) ? '–' : Number(v).toLocaleString('de-CH', { maximumFractionDigits: d, minimumFractionDigits: d }));

  return (
    <div className="map-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="map" role="img" aria-label="Map of Switzerland with nuclear and hydro power plants">
        {geo && (
          <g>
            <path d={geo.country} className="map-country" />
            <path d={geo.cantonBorders} className="map-cantons" />
            {geo.lakes.map((d, i) => <path key={i} d={d} className="map-lake" />)}
          </g>
        )}
        {plants.map((p) => (
          <g key={p.id} transform={`translate(${p.x},${p.y})`} className="plant"
             onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}
             onClick={() => onSelect(p.id === selected ? null : p.id)}>
            <circle r={r(p.mw) + 3} className="hit" />
            {showStress && p.stress && !p.inactive && (
              <circle r={r(p.mw) + 3.5} className={`stress stress-${p.stress}`} />
            )}
            <circle r={r(p.mw)}
              className={`dot ${p.inactive ? 'inactive' : ''} ${selected === p.id ? 'sel' : ''}`}
              style={{ fill: p.inactive ? 'none' : TYPE_META[p.type].color, stroke: p.inactive ? 'var(--text-muted)' : undefined }} />
            {p.pumped && !p.inactive && <circle r={Math.max(2, r(p.mw) * 0.35)} className="pumped-core" />}
          </g>
        ))}
        {plants.filter((p) => p.type === 'nuclear' && p.mw > 900).map((p) => (
          <text key={p.id + 'l'} x={p.x + r(p.mw) + 6} y={p.y + 4} className="map-label">{p.name}</text>
        ))}
        {showPv && pvPoints.cantons.map((c) => (
          <g key={c.canton_code} transform={`translate(${c.x},${c.y})`} className="pv-canton"
             onMouseEnter={() => setPvHover({ kind: 'canton', ...c })} onMouseLeave={() => setPvHover(null)}>
            <circle r={rPv(c.watts_per_capita) + 4} className="hit" />
            <circle r={rPv(c.watts_per_capita)} className="pv-dot" />
          </g>
        ))}
        {showPv && pvPoints.large.map((l) => {
          const s = 5.5;
          return (
            <g key={l.name} transform={`translate(${l.x},${l.y})`} className="pv-large"
               onMouseEnter={() => setPvHover({ kind: 'large', ...l })} onMouseLeave={() => setPvHover(null)}>
              <circle r={s + 5} className="hit" />
              <rect x={-s} y={-s} width={2 * s} height={2 * s} transform="rotate(45)" rx="1.5"
                className={`pv-diamond ${l.status === 'planned' ? 'planned' : ''}`} />
            </g>
          );
        })}
        {!geo && <text x={W / 2} y={H / 2} textAnchor="middle" className="map-label">Loading map…</text>}
      </svg>

      <div className="map-legend">
        {Object.entries(TYPE_META).map(([k, v]) => (
          <span key={k} className="lg"><i style={{ background: v.color }} />{v.label}</span>
        ))}
        <span className="lg"><i className="lg-hollow" />Shut down (in {year})</span>
        <span className="lg"><i className="lg-pumped" />Pumped storage</span>
        <span className="lg muted">Circle area ∝ capacity (MW)</span>
      </div>
      {pv && (
        <div className="map-legend">
          <label className="chk"><input type="checkbox" checked={showPv} onChange={(e) => setShowPv(e.target.checked)} /> Solar PV</label>
          <span className="lg"><i className="lg-pv" />PV per canton capital · size ∝ W per inhabitant (CH Ø 946 W, {pv.cantons_date?.split('-').reverse().join('.')})</span>
          <span className="lg"><i className="lg-pv-large" />Large PV plant</span>
          <span className="lg"><i className="lg-pv-large planned" />planned</span>
        </div>
      )}
      {showStress && (
        <div className="map-legend">
          <span className="muted">Climate stress ring:</span>
          {Object.keys(STATUS_LABEL).map((s) => (
            <span key={s} className="lg"><b className={`st st-${s}`}>{STATUS_ICON[s]}</b>{STATUS_LABEL[s]}</span>
          ))}
        </div>
      )}

      {pvHover && (
        <div className="plant-card">
          {pvHover.kind === 'canton' ? <>
            <div className="pc-head"><strong>{pvHover.canton_en} ({pvHover.canton_code})</strong><span className="muted">#{pvHover.rank} of 26</span></div>
            <div className="pc-row"><span>Solar PV per inhabitant</span><span><b>{fmtN(pvHover.watts_per_capita)} W</b></span></div>
            <div className="pc-row"><span>Installed capacity</span><span><b>{fmtN(pvHover.capacity_mw, 1)} MW</b></span></div>
            <div className="pc-row"><span>Systems</span><span>{fmtN(pvHover.systems)} · Ø {fmtN(pvHover.avg_system_kwp, 1)} kWp</span></div>
            <div className="pc-row"><span>Roof-integrated</span><span>{fmtN(pvHover.roof_integrated_pct, 1)} %</span></div>
            <p className="pc-note">Point at the capital ({pvHover.capital}). SFOE register via ecoen.ch, {pvHover.data_date?.split('-').reverse().join('.')}.</p>
          </> : <>
            <div className="pc-head"><strong>{pvHover.name}</strong><span className="muted">{pvHover.canton_code}</span></div>
            <div className="pc-row"><span>{pvHover.kind_label || pvHover.kind} · {pvHover.status}{pvHover.year ? ` ${pvHover.year}` : ''}</span>
              <span><b>{pvHover.capacity_mwp ? `${fmtN(pvHover.capacity_mwp, 1)} MWp` : 'MWp n/a'}</b>{pvHover.production_gwh_per_year ? ` · ~${fmtN(pvHover.production_gwh_per_year, 1)} GWh/yr` : ''}</span></div>
            <p className="pc-note">{pvHover.note}</p>
          </>}
        </div>
      )}

      {!pvHover && active && (
        <div className="plant-card">
          <div className="pc-head">
            <strong>{active.name}</strong>
            <span className="muted">{active.canton}</span>
          </div>
          <div className="pc-row">
            <span>{TYPE_META[active.type].label}{active.pumped ? ' (pumped)' : ''}</span>
            <span><b>{active.mw.toLocaleString()} MW</b>{active.gwh ? ` · ~${active.gwh.toLocaleString()} GWh/yr` : ''}</span>
          </div>
          {active.type === 'nuclear' && (
            <div className="pc-row muted">
              <span>{active.cooling === 'river' ? 'River cooling' : 'Cooling tower'} · {active.river}</span>
              <span>{active.inactive ? `Off since ${active.offYear}` : `Assumed until ${active.offYear}`}</span>
            </div>
          )}
          {active.stress && !active.inactive && (
            <div className="pc-row">
              <span>Climate stress ({year})</span>
              <span><b className={`st st-${active.stress}`}>{STATUS_ICON[active.stress]}</b> {STATUS_LABEL[active.stress]}</span>
            </div>
          )}
          <p className="pc-note">{active.note}</p>
        </div>
      )}
    </div>
  );
}
