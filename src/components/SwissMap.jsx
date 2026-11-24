import { useEffect, useMemo, useRef, useState } from 'react';
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

const ALL_LAYERS = { nuclear: true, hydro: true, pv: true, battery: true };

// Battery storage (BESS) status colours, as in the SRF/Swissolar map (June 2026), lightly adjusted for contrast
// solid = operational or completed by end 2026; outline = in development (until 2030) / proposal
export const BESS_STATUS = {
  'being built': { label: 'Being built', color: '#5cc492', solid: true },
  operational: { label: 'Operational', color: '#1e7b4e', solid: true },
  'in development': { label: 'In development', color: '#2877c4', solid: false },
  proposal: { label: 'Proposal stage', color: '#d03b3b', solid: false, dashed: true, fillColor: '#f6c1c1' },
};
export const bessStyle = (status) => {
  const m = BESS_STATUS[status] || BESS_STATUS.operational;
  if (m.solid) return { fill: m.color };
  if (m.dashed) return { fill: m.fillColor, fillOpacity: 0.9, stroke: m.color, strokeWidth: 2, strokeOpacity: 1, strokeDasharray: '4 2.5' };
  return { fill: m.color, fillOpacity: 0.18, stroke: m.color, strokeWidth: 2.2, strokeOpacity: 1 };
};
export const bessSwatch = (status) => {
  const m = BESS_STATUS[status] || BESS_STATUS.operational;
  if (m.solid) return { background: m.color };
  if (m.dashed) return { background: m.fillColor, border: `1.5px dashed ${m.color}`, outline: 'none', boxSizing: 'border-box' };
  return { background: `${m.color}2e`, boxShadow: `inset 0 0 0 2px ${m.color}`, outline: 'none' };
};

export default function SwissMap({ year, clim, nukes, showStress, selected, onSelect, layers = ALL_LAYERS }) {
  const [topo, setTopo] = useState(null);
  const [hover, setHover] = useState(null);
  const [pv, setPv] = useState(null);         // PV by canton + large plants (public/pfc2035/pv_map.json)
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

  // hydro stations: BFE list from data/csv/hydro_plants.csv (via pv_map.json); fallback: built-in list
  const allPlants = useMemo(() => {
    if (!pv?.hydro_plants?.length) return PLANTS;
    const hydro = pv.hydro_plants.map((h) => ({
      id: `h-${h.name}`, name: h.name, canton: h.canton_code, lat: h.lat, lon: h.lon, mw: h.power_mw,
      type: h.type === 'ror' ? 'ror' : 'storage', pumped: h.type === 'pumped',
      river: h.type === 'ror' ? h.river_or_reservoir : undefined,
      note: `${h.type === 'ror' ? 'River' : 'Reservoir'}: ${h.river_or_reservoir}. Source: BFE large-scale hydropower list.`,
    }));
    return [...PLANTS.filter((p) => p.type === 'nuclear'), ...hydro];
  }, [pv]);

  const plants = useMemo(() => {
    if (!geo) return [];
    return [...allPlants]
      .sort((a, b) => b.mw - a.mw)
      .map((p) => {
        const [x, y] = geo.projection([p.lon, p.lat]);
        const nuke = nukes.find((n) => n.id === p.id);
        const inactive = p.type === 'nuclear' && !nuke?.running;
        return { ...p, x: x + (p.dx || 0), y, inactive, stress: stressFor(p, clim, year, nukes), offYear: nuke?.effectiveOffline };
      });
  }, [geo, clim, year, nukes, allPlants]);

  const visiblePlants = plants.filter((p) => (p.type === 'nuclear' ? layers.nuclear : layers.hydro));
  const active = hover || visiblePlants.find((p) => p.id === selected);

  // PV per canton and batteries use the SAME scale as the plants: circle area ∝ MW
  const rPv = (mw) => r(mw);
  const [showInfo, setShowInfo] = useState(false);
  const infoRef = useRef(null);
  useEffect(() => { // close "Reading the map" on a click/tap outside it or on Escape
    if (!showInfo) return undefined;
    const onDown = (e) => { if (infoRef.current && !infoRef.current.contains(e.target)) setShowInfo(false); };
    const onKey = (e) => { if (e.key === 'Escape') setShowInfo(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [showInfo]);
  const pvPoints = useMemo(() => {
    if (!geo || !pv) return { cantons: [], large: [], batteries: [] };
    const cantons = (pv.cantons || []).map((c) => {
      const [x, y] = geo.projection([c.capital_lon, c.capital_lat]);
      return { ...c, x, y };
    });
    const large = (pv.large || []).map((l) => {
      const [x, y] = geo.projection([l.lon, l.lat]);
      return { ...l, x, y };
    });
    const batteries = (pv.battery_facilities || []).map((b) => {
      const [x, y] = geo.projection([b.lon, b.lat]);
      return { ...b, x, y };
    }).sort((a, b) => b.power_mw - a.power_mw);
    return { cantons, large, batteries };
  }, [geo, pv]);
  const fmtN = (v, d = 0) => (v == null || Number.isNaN(v) ? '–' : Number(v).toLocaleString('de-CH', { maximumFractionDigits: d, minimumFractionDigits: d }));

  return (
    <div className="map-wrap">
      <div className="map-canvas">
      <svg viewBox={`0 0 ${W} ${H}`} className="map" role="img" aria-label="Map of Switzerland with nuclear and hydro power plants">
        {geo && (
          <g>
            <path d={geo.country} className="map-country" />
            <path d={geo.cantonBorders} className="map-cantons" />
            {geo.lakes.map((d, i) => <path key={i} d={d} className="map-lake" />)}
          </g>
        )}
        {layers.pv && [...pvPoints.cantons].sort((a, b) => b.capacity_mw - a.capacity_mw).map((c) => (
          <g key={c.canton_code} transform={`translate(${c.x},${c.y})`} className="pv-canton"
             onMouseEnter={() => setPvHover({ kind: 'canton', ...c })} onMouseLeave={() => setPvHover(null)}>
            <circle r={rPv(c.capacity_mw)} className="pv-dot" />
          </g>
        ))}
        {visiblePlants.map((p) => (
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
        {visiblePlants.filter((p) => p.type === 'nuclear' && p.mw > 900).map((p) => (
          <text key={p.id + 'l'} x={p.x + r(p.mw) + 6} y={p.y + 4} className="map-label">{p.name}</text>
        ))}
        {layers.pv && pvPoints.large.map((l) => {
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
        {layers.battery && [...pvPoints.batteries].sort((a, b) => b.power_mw - a.power_mw).map((b) => {
          const h = r(b.power_mw) * 0.89; // square with the same area as a circle of that MW
          return (
            <g key={b.name} transform={`translate(${b.x},${b.y})`} className="bat"
               onMouseEnter={() => setPvHover({ kind: 'battery', ...b })} onMouseLeave={() => setPvHover(null)}>
              <rect x={-h - 3} y={-h - 3} width={2 * h + 6} height={2 * h + 6} className="hit" />
              <rect x={-h} y={-h} width={2 * h} height={2 * h} rx="2" className="bat-sq" style={bessStyle(b.status)} />
            </g>
          );
        })}
        {!geo && <text x={W / 2} y={H / 2} textAnchor="middle" className="map-label">Loading map…</text>}
      </svg>
      <div className={`map-info ${showInfo ? 'open' : ''}`} ref={infoRef}>
        <button type="button" className="map-info-btn" aria-expanded={showInfo} onClick={() => setShowInfo((v) => !v)}>
          <span aria-hidden="true">ⓘ</span> Reading the map
        </button>
        {showInfo && (
          <ul className="howto">
            <li><b>Orange</b> nuclear units sit on the Aare and Rhine — river temperature matters for the river-cooled Beznau units.</li>
            <li><b>Blue</b> Alpine storage &amp; pumped-storage plants provide seasonal and daily flexibility; their inflows depend on snow and glacier melt.</li>
            <li><b>Green</b> run-of-river plants on the Rhine, Aare and Rhône follow river flow — high in May–August, low in winter and in dry years.</li>
            <li>The coloured <b>ring</b> shows climate stress for the selected year and scenario.</li>
            <li><b>Yellow</b> circles: installed PV per canton; diamonds: large PV plants. <b>Squares</b>: battery installations with capacity over 5 MW, coloured by status — solid = operational or being built (until end 2026), outline = in development (until 2030), light red dashed = proposal (planned). Circle and square area ∝ MW, on one scale for all technologies.</li>
          </ul>
        )}
      </div>
      </div>

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
          <span className="lg"><i className="lg-pv" />PV installed per canton (at the capital, {pv.cantons_date?.split('-').reverse().join('.')}) · same MW scale as plants</span>
          <span className="lg"><i className="lg-pv-large" />Large PV plant</span>
          <span className="lg"><i className="lg-pv-large planned" />planned</span>
        </div>
      )}
      {pv && layers.battery && (
        <div className="map-legend">
          <span className="lg muted">Battery installations with capacity over 5 MW (square area ∝ MW):</span>
          {Object.entries(BESS_STATUS).map(([k, v]) => (
            <span key={k} className="lg"><i className="lg-bat" style={bessSwatch(k)} />{v.label}</span>
          ))}
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
          {pvHover.kind === 'battery' ? <>
            <div className="pc-head"><strong>{pvHover.name}</strong><span className="muted">{pvHover.canton_code}</span></div>
            <div className="pc-row"><span>Battery installation · <b style={{ color: (BESS_STATUS[pvHover.status] || {}).color }}>{(BESS_STATUS[pvHover.status] || {}).solid ? '■' : '□'}</b> {(BESS_STATUS[pvHover.status] || {}).label || pvHover.status}</span>
              <span><b>{fmtN(pvHover.power_mw, 1)} MW</b>{pvHover.energy_mwh ? ` · ${fmtN(pvHover.energy_mwh, 1)} MWh` : ''}</span></div>
            {pvHover.power_mw > 0 && pvHover.energy_mwh > 0 && <div className="pc-row muted"><span>Duration</span><span>{fmtN(pvHover.energy_mwh / pvHover.power_mw, 1)} h</span></div>}
            {pvHover.note && <p className="pc-note">{pvHover.note}</p>}
          </> : pvHover.kind === 'canton' ? <>
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
