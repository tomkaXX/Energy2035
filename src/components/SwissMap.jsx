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

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}ch.json`).then((r) => r.json()).then(setTopo).catch(() => setTopo(null));
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
      {showStress && (
        <div className="map-legend">
          <span className="muted">Climate stress ring:</span>
          {Object.keys(STATUS_LABEL).map((s) => (
            <span key={s} className="lg"><b className={`st st-${s}`}>{STATUS_ICON[s]}</b>{STATUS_LABEL[s]}</span>
          ))}
        </div>
      )}

      {active && (
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
