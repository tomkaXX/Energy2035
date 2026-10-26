// Stylised hourly Price Forward Curve (PFC) shape model for Switzerland.
//
// Idea (as in practice): a PFC = forward price LEVEL (from traded Cal/Q/M products)
// × a SHAPE (hourly profile). This model builds the shape from fundamentals:
//   residual load = demand − nuclear − run-of-river − PV  (Swiss + coupled EU signal)
//   flexibility (pumped storage, batteries, DSM, PV injection management) flattens it
//   a convex merit-order mapping turns residual load into relative prices
// and then calibrates the result so the annual base average equals the chosen level.
// It is an educational tool, not a forecast.

import { PLANTS, NATIONAL } from '../data/plants.js';
import { climateFor } from '../data/climate.js';

const MONTH_DEMAND = [1.18, 1.14, 1.05, 0.95, 0.9, 0.87, 0.87, 0.87, 0.92, 0.99, 1.08, 1.16];
const MONTH_ROR = [0.55, 0.55, 0.65, 0.88, 1.3, 1.6, 1.6, 1.4, 1.1, 0.85, 0.7, 0.6];
const PV_KWH_PER_KWP = [30, 50, 85, 115, 130, 135, 140, 120, 90, 60, 30, 22]; // ≈ 1,007 kWh/kWp/yr
const DAYLIGHT_H = [8.8, 10.2, 11.9, 13.6, 15.0, 15.8, 15.4, 14.1, 12.4, 10.7, 9.2, 8.4];
const HOT_WEIGHT = [0, 0, 0, 0, 0, 0.15, 0.4, 0.4, 0.05, 0, 0, 0]; // where hot river days fall
const NUC_AVAIL = [0.97, 0.97, 0.95, 0.9, 0.78, 0.78, 0.85, 0.9, 0.92, 0.95, 0.97, 0.97]; // revisions in spring/summer

// Workday demand profile by hour (relative)
const DAY_PROFILE = [0.8, 0.77, 0.76, 0.76, 0.78, 0.85, 0.97, 1.07, 1.12, 1.13, 1.13, 1.1,
  1.06, 1.08, 1.08, 1.07, 1.07, 1.09, 1.1, 1.06, 1.0, 0.95, 0.9, 0.84];
const WEEKEND_PROFILE = [0.8, 0.77, 0.75, 0.74, 0.74, 0.76, 0.8, 0.86, 0.92, 0.97, 0.99, 1.0,
  0.99, 0.95, 0.93, 0.93, 0.95, 1.0, 1.03, 1.01, 0.97, 0.93, 0.88, 0.83];

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function defaultParams(year = 2030) {
  const dy = year - 2025;
  return {
    year,
    scenario: 'rcp85',
    baseLevel: 85, // €/MWh annual base
    pvGW: round1(Math.min(45, NATIONAL.pvGW2025 + 1.4 * dy)),
    flexGW: round1(Math.min(8, 0.4 + 0.35 * dy)),
    flexHours: 2,
    demandTWh: Math.round(62 + 0.8 * dy),
    transitGW: 7.5,
    hydro: 'normal', // 'wet' | 'normal' | 'dry'
    nuclearLife: 60, // operating years for Gösgen & Leibstadt
  };
}

function round1(x) { return Math.round(x * 10) / 10; }

function solarShape(month, hour, summerTime) {
  // expected clear+cloud mix bell curve between sunrise and sunset (local time)
  const noon = summerTime ? 13.4 : 12.4;
  const half = DAYLIGHT_H[month] / 2;
  const x = (hour + 0.5 - noon) / half; // −1..1 during daylight
  if (Math.abs(x) >= 1) return 0;
  return Math.pow(Math.cos((x * Math.PI) / 2), 1.6);
}

export function nuclearOnline(year, nuclearLife) {
  return PLANTS.filter((p) => p.type === 'nuclear').map((p) => {
    let off = p.offline;
    if (!off) off = p.online + nuclearLife;
    return { ...p, effectiveOffline: off, running: year < off };
  });
}

export function computePFC(params) {
  const { year, scenario, baseLevel, pvGW, flexGW, flexHours, demandTWh, transitGW, hydro, nuclearLife } = params;
  const clim = climateFor(scenario, year);
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const nDays = isLeap ? 366 : 365;
  const N = nDays * 24;

  // ---- climate-driven modifiers ------------------------------------------
  const heatAmp = 1 + clim.heatingDD / 100 * 0.5; // reduces winter demand amplitude
  const hydroFactor = hydro === 'dry' ? 0.82 : hydro === 'wet' ? 1.12 : 1;
  const winterRunoff = 1 + clim.winterRunoff / 100;
  const summerRunoff = 1 + (clim.summerPrecip / 100) * 0.8 + ((clim.glacier - 100) / 100) * 0.12;
  const dryExtra = Math.max(0, clim.drySpell - 11) * 0.01; // late summer flow loss per extra dry day

  // ---- nuclear ------------------------------------------------------------
  const nukes = nuclearOnline(year, nuclearLife);
  const riverCooledMW = nukes.filter((p) => p.running && p.cooling === 'river').reduce((s, p) => s + p.mw, 0);
  const towerMW = nukes.filter((p) => p.running && p.cooling === 'tower').reduce((s, p) => s + p.mw, 0);

  // ---- PV -----------------------------------------------------------------
  // normalise daily solar shape so monthly energy matches yield
  const solarDaySum = MONTH_DEMAND.map((_, m) => {
    let s = 0;
    const st = m >= 3 && m <= 9;
    for (let h = 0; h < 24; h++) s += solarShape(m, h, st);
    return s;
  });

  const avgDemandGW = (demandTWh * 1000) / 8760;
  const rorAvgGW = (NATIONAL.hydroTWh * 0.47 * 1000) / 8760 * hydroFactor;
  // EU coupled signal: neighbours' PV share of demand grows quickly
  const euPvShare = Math.min(0.32, 0.11 + 0.012 * (year - 2025));
  const euWindShare = Math.min(0.4, 0.27 + 0.007 * (year - 2025));

  const hours = new Array(N);
  const start = Date.UTC(year, 0, 1);
  // normalise demand monthly factors with heating amplitude
  const md = MONTH_DEMAND.map((f) => 1 + (f - 1) * (f > 1 ? heatAmp : 1));
  const mdMean = md.reduce((a, b) => a + b, 0) / 12;
  const mror = MONTH_ROR.map((f, m) => {
    let x = f;
    if (m <= 2 || m >= 11) x *= winterRunoff;
    if (m >= 6 && m <= 9) x *= summerRunoff - dryExtra * (m - 5);
    return x;
  });
  const mrorMean = mror.reduce((a, b) => a + b, 0) / 12;

  for (let i = 0; i < N; i++) {
    const d = new Date(start + i * 3600e3);
    const m = d.getUTCMonth();
    const h = d.getUTCHours();
    const dow = d.getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const st = m >= 3 && m <= 9;
    const prof = weekend ? WEEKEND_PROFILE : DAY_PROFILE;
    // cooling demand bump on hot afternoons
    const hotFrac = (clim.hotDays * HOT_WEIGHT[m]) / 30;
    const cooling = h >= 11 && h <= 18 ? 0.04 * hotFrac : 0;
    const demand = avgDemandGW * (md[m] / mdMean) * prof[h] * (1 + cooling);

    const solar = solarShape(m, h, st);
    const daysInMonth = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
    const pvEnergyDay = (pvGW * PV_KWH_PER_KWP[m]) / daysInMonth; // GWh/day
    const pv = solarDaySum[m] > 0 ? (pvEnergyDay * solar) / solarDaySum[m] : 0;

    const ror = rorAvgGW * (mror[m] / mrorMean) * (0.97 + 0.03 * Math.sin(((h - 6) / 24) * 2 * Math.PI));

    // expected river-temperature curtailment of river-cooled units
    const riverFrac = Math.min(1, (clim.riverHotDays * HOT_WEIGHT[m]) / daysInMonth);
    const heatLoss = Math.min(1, (clim.hotDays * HOT_WEIGHT[m]) / daysInMonth) * 0.03;
    const nuclear = (NUC_AVAIL[m] * (riverCooledMW * (1 - 0.7 * riverFrac) + towerMW * (1 - heatLoss))) / 1000;

    const rlCH = demand - nuclear - ror - pv;
    // EU residual load (normalised to EU avg demand = 1)
    const euDemand = (MONTH_DEMAND[m] / 1) * prof[h];
    const euPv = (euPvShare * 12 * PV_KWH_PER_KWP[m] / 1007) * (solar * 24 / solarDaySum[m] || 0);
    const euWind = euWindShare * (m <= 2 || m >= 9 ? 1.25 : 0.75);
    const rlEU = euDemand - euPv - euWind;

    hours[i] = { i, m, h, dow, weekend, day: Math.floor(i / 24), demand, pv, ror, nuclear, rlCH, rlEU, riverFrac };
  }

  // ---- flexibility: pumped storage (existing) + decentralised flex -------------
  const existingPS = { gw: 3.0, hours: 8 };
  applyFlex(hours, nDays, existingPS.gw, existingPS.hours, 'rlCH', 0.8);
  applyFlex(hours, nDays, flexGW, flexHours, 'rlCH', 0.88);

  // ---- price mapping ----------------------------------------------------------
  const c = transitGW / (transitGW + 5); // coupling weight to EU signal
  const meanCH = avg(hours.map((x) => x.rlCH));
  const meanEU = avg(hours.map((x) => x.rlEU));
  const gamma = 1.25;
  const beta = 0.45;
  for (const x of hours) {
    const zCH = (x.rlCH - meanCH) / avgDemandGW;
    const zEU = (x.rlEU - meanEU) / 1;
    x.z = (1 - c) * zCH * 1.3 + c * zEU;
    let f = Math.exp(gamma * x.z) + beta * Math.min(0, x.z);
    // scarcity when residual load exceeds import capacity
    const short = x.rlCH - transitGW;
    if (short > 0) f += 0.6 * (short / avgDemandGW) * 4;
    x.f = f;
  }

  // monthly levels: endogenous from monthly mean signal + hydro/climate premia
  const monthF = Array(12).fill(0), monthN = Array(12).fill(0);
  for (const x of hours) { monthF[x.m] += x.f; monthN[x.m]++; }
  const monthLevel = monthF.map((s, m) => {
    let L = Math.pow(s / monthN[m], 0.55); // seasonal hydro storage dampens seasonal spread
    if (hydro === 'dry' && (m <= 3 || m >= 8)) L *= 1.12;
    if (hydro === 'wet' && (m <= 3 || m >= 8)) L *= 0.93;
    L *= 1 + 0.006 * clim.riverHotDays * HOT_WEIGHT[m] * 2.5; // FR river-cooled fleet derating
    return L;
  });

  for (const x of hours) {
    const intraday = x.f / (monthF[x.m] / monthN[x.m]);
    x.rel = monthLevel[x.m] * intraday;
  }
  const relMean = avg(hours.map((x) => x.rel));
  for (const x of hours) x.price = (x.rel / relMean) * baseLevel;

  return { hours, nDays, clim, nukes, kpis: kpis(hours, baseLevel), monthly: monthlyStats(hours) };
}

function applyFlex(hours, nDays, gw, dur, key, eff) {
  if (gw <= 0) return;
  const energy = gw * dur;
  for (let d = 0; d < nDays; d++) {
    const day = hours.slice(d * 24, d * 24 + 24);
    const charge = Array(24).fill(0), dis = Array(24).fill(0);
    let eIn = 0;
    for (let iter = 0; iter < 200; iter++) {
      // find current lowest (chargeable) and highest (dischargeable)
      let lo = -1, hi = -1;
      for (let k = 0; k < 24; k++) {
        const v = day[k][key] + charge[k] - dis[k];
        if (charge[k] < gw && dis[k] === 0 && (lo < 0 || v < day[lo][key] + charge[lo] - dis[lo])) lo = k;
        if (dis[k] < gw && charge[k] === 0 && (hi < 0 || v > day[hi][key] + charge[hi] - dis[hi])) hi = k;
      }
      if (lo < 0 || hi < 0 || lo === hi) break;
      const vlo = day[lo][key] + charge[lo] - dis[lo];
      const vhi = day[hi][key] + charge[hi] - dis[hi];
      const gap = vhi - vlo;
      if (gap < 0.05 || eIn >= energy) break;
      const step = Math.min(0.1 * gw + 0.01, gw - charge[lo], (gw - dis[hi]) / eff, energy - eIn, gap / 2);
      if (step <= 1e-4) break;
      charge[lo] += step;
      dis[hi] += step * eff;
      eIn += step;
    }
    for (let k = 0; k < 24; k++) day[k][key] += charge[k] - dis[k];
  }
}

function avg(a) { let s = 0; for (const v of a) s += v; return s / a.length; }

function kpis(hours, base) {
  const peak = hours.filter((x) => !x.weekend && x.h >= 8 && x.h < 20);
  const solar = hours.filter((x) => x.h >= 11 && x.h < 15);
  const evening = hours.filter((x) => x.h >= 18 && x.h < 21);
  let pvE = 0, pvRev = 0;
  for (const x of hours) { pvE += x.pv; pvRev += x.pv * x.price; }
  const neg = hours.filter((x) => x.price < 0).length;
  // average daily spread (max - min)
  let spread = 0, nd = 0;
  for (let d = 0; d * 24 < hours.length; d++) {
    const ps = hours.slice(d * 24, d * 24 + 24).map((x) => x.price);
    spread += Math.max(...ps) - Math.min(...ps); nd++;
  }
  const winter = hours.filter((x) => x.m <= 2 || x.m >= 9);
  const summer = hours.filter((x) => x.m >= 3 && x.m <= 8);
  return {
    base,
    peak: avg(peak.map((x) => x.price)),
    solar: avg(solar.map((x) => x.price)),
    evening: avg(evening.map((x) => x.price)),
    pvCapture: pvE > 0 ? pvRev / pvE / base : 0,
    negHours: neg,
    spread: spread / nd,
    winter: avg(winter.map((x) => x.price)),
    summer: avg(summer.map((x) => x.price)),
  };
}

function monthlyStats(hours) {
  const grid = Array.from({ length: 12 }, () => Array.from({ length: 24 }, () => ({ s: 0, n: 0 })));
  for (const x of hours) { const c = grid[x.m][x.h]; c.s += x.price; c.n++; }
  return grid.map((row) => row.map((c) => c.s / c.n));
}

export function toCSV(hours, year) {
  const lines = ['datetime_cet,price_eur_mwh,demand_gw,pv_gw,run_of_river_gw,nuclear_gw'];
  const start = Date.UTC(year, 0, 1);
  for (const x of hours) {
    const d = new Date(start + x.i * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
    lines.push([d, x.price.toFixed(2), x.demand.toFixed(3), x.pv.toFixed(3), x.ror.toFixed(3), x.nuclear.toFixed(3)].join(','));
  }
  return lines.join('\n');
}
