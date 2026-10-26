// Indicative climate indicators relevant for Swiss power generation and demand.
// Values are rounded, illustrative medians inspired by the Swiss climate scenarios
// (CH2018 / CH2025, MeteoSwiss & NCCS) and Hydro-CH2018 – NOT official figures.
// Replace with data from the MeteoSwiss web atlas / opendata.swiss
// ("Klimaszenarien CH2025") for any real analysis.
//
// Reference period: 1991–2020 (centre ~2005).
// Scenarios: 'rcp26' = with climate protection, 'rcp85' = without climate protection.

export const HORIZONS = [2035, 2060, 2085];
export const REF_YEAR = 2005;

export const SCENARIOS = {
  rcp26: { label: 'With climate protection (RCP2.6)', short: 'With protection' },
  rcp85: { label: 'Without climate protection (RCP8.5)', short: 'Without protection' },
};

export const INDICATORS = [
  {
    id: 'riverHotDays',
    label: 'Days with Aare > 25 °C (Beznau)',
    unit: 'days/yr',
    ref: 4,
    rcp26: [9, 11, 12],
    rcp85: [12, 24, 42],
    affects: 'nuclear',
    impact: 'River-cooled nuclear (Beznau) must curtail. The same mechanism hits French river-cooled reactors on the Rhône and Rhine, which raises summer import prices.',
  },
  {
    id: 'hotDays',
    label: 'Hot days (Tmax ≥ 30 °C, Plateau)',
    unit: 'days/yr',
    ref: 11,
    rcp26: [16, 17, 18],
    rcp85: [19, 30, 46],
    affects: 'demand',
    impact: 'More cooling demand around midday and afternoon, lower PV module efficiency, higher water temperatures.',
  },
  {
    id: 'drySpell',
    label: 'Longest summer dry spell',
    unit: 'days',
    ref: 11,
    rcp26: [12, 13, 13],
    rcp85: [13, 15, 20],
    affects: 'hydro',
    impact: 'Lower run-of-river output in late summer/autumn and slower reservoir filling → higher autumn and winter prices.',
  },
  {
    id: 'summerPrecip',
    label: 'Summer precipitation change',
    unit: '%',
    ref: 0,
    rcp26: [-5, -7, -8],
    rcp85: [-8, -15, -24],
    affects: 'hydro',
    impact: 'Less summer inflow to reservoirs and rivers.',
  },
  {
    id: 'winterRunoff',
    label: 'Winter runoff change',
    unit: '%',
    ref: 0,
    rcp26: [8, 12, 14],
    rcp85: [10, 20, 33],
    affects: 'hydro',
    impact: 'More rain instead of snow → more winter run-of-river output, which softens winter prices.',
  },
  {
    id: 'glacier',
    label: 'Remaining glacier volume (vs. 2020)',
    unit: '%',
    ref: 100,
    rcp26: [70, 50, 40],
    rcp85: [65, 35, 10],
    affects: 'hydro',
    impact: '“Peak water” passes around mid-century; afterwards summer melt inflow to Alpine reservoirs declines.',
  },
  {
    id: 'heatingDD',
    label: 'Heating degree days change',
    unit: '%',
    ref: 0,
    rcp26: [-9, -11, -12],
    rcp85: [-11, -20, -32],
    affects: 'demand',
    impact: 'Lower heating demand in winter (partly offset by electrification with heat pumps).',
  },
];

// Linear interpolation of an indicator for a given calendar year.
export function indicatorAt(ind, scenario, year) {
  const xs = [REF_YEAR, ...HORIZONS];
  const ys = [ind.ref, ...ind[scenario]];
  if (year <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (year <= xs[i]) {
      const t = (year - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return ys[i - 1] + t * (ys[i] - ys[i - 1]);
    }
  }
  return ys[ys.length - 1];
}

export function climateFor(scenario, year) {
  const out = {};
  for (const ind of INDICATORS) out[ind.id] = indicatorAt(ind, scenario, year);
  return out;
}
