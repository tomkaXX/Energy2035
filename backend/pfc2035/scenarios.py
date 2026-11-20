"""Turn a historical weather year into a 2035 year for a scenario, then price it with the model.

Steps per weather year
  1. re-index the reference year onto the 2035 calendar (weekdays aligned)
  2. rescale fundamentals: Swiss demand (+EV, heat pumps, cooling, data centres), PV, wind, nuclear,
     hydro; neighbours' PV/wind/nuclear/load; gas & CO₂ prices
  3. dispatch NEW flexibility (batteries + demand response) against Swiss residual load
     (existing pumped storage is already in the historical price signal)
  4. predict hourly prices with the LightGBM model
  5. stylised structural adjustments the history cannot teach: border capacity (NTC) and PV curtailment
Results are averaged over all weather years; the spread between them is the weather uncertainty.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .config import load_settings
from .features import build_features, calendar, srmc_gas
from .model import PriceModel

HP_MONTH = np.array([.18, .15, .12, .07, .03, 0, 0, 0, .02, .07, .14, .18])       # heat-pump energy by month
HP_HOUR = np.array([.8, .8, .8, .8, .9, 1.1, 1.4, 1.5, 1.3, 1.1, 1, .9, .9, .9, .9, .9, 1, 1.2, 1.3, 1.2, 1.1, 1, .9, .8])
EV_DUMB = np.array([.6, .5, .4, .3, .3, .3, .4, .6, .7, .7, .7, .7, .8, .8, .8, .9, 1.2, 1.8, 2.2, 2.2, 1.9, 1.5, 1.1, .8])
EV_SMART = np.array([.3, .2, .2, .2, .2, .2, .3, .5, .9, 1.4, 1.9, 2.3, 2.5, 2.4, 2.1, 1.6, 1.1, .8, .7, .7, .6, .5, .4, .3])
COOL_MONTH = np.array([0, 0, 0, 0, .05, .25, .38, .30, .02, 0, 0, 0])
COOL_HOUR = np.clip(np.sin((np.arange(24) - 8) / 14 * np.pi), 0, None) + 0.15


def _profile(hours: np.ndarray, months: np.ndarray, h_shape, m_shape=None) -> np.ndarray:
    w = np.asarray(h_shape, float)[hours]
    if m_shape is not None:
        w = w * np.asarray(m_shape, float)[months - 1]
    return w / w.sum()


def year_2035(hist: pd.DataFrame, ref_year: int, target_year: int = 2035) -> pd.DataFrame:
    """Copy one historical year onto the target calendar, aligning weekdays."""
    ref = hist[hist.index.tz_convert("Europe/Zurich").year == ref_year]
    if len(ref) < 8700:
        raise ValueError(f"weather year {ref_year} is incomplete ({len(ref)} h)")
    tgt_idx = pd.date_range(f"{target_year}-01-01", f"{target_year + 1}-01-01", freq="1h",
                            tz="Europe/Zurich", inclusive="left").tz_convert("UTC")
    shift_days = (tgt_idx[0].tz_convert("Europe/Zurich").dayofweek
                  - ref.index[0].tz_convert("Europe/Zurich").dayofweek) % 7
    vals = ref.values
    vals = np.roll(vals, shift_days * 24, axis=0)  # shift so weekdays line up
    vals = np.resize(vals, (len(tgt_idx), vals.shape[1])) if len(vals) < len(tgt_idx) else vals[: len(tgt_idx)]
    out = pd.DataFrame(vals, index=tgt_idx, columns=ref.columns)
    out.attrs["ref_year"] = ref_year
    return out


def apply_scenario(y: pd.DataFrame, p: dict) -> pd.DataFrame:
    ch, nb, mk = p["ch"], p["neighbours"], p["market"]
    d = y.copy()
    loc = d.index.tz_convert("Europe/Zurich")
    hrs, mon = loc.hour.values, loc.month.values

    # --- Swiss demand: scale the historical profile, then add new loads with their own shapes
    ref_twh = d["ch_load"].sum() / 1000
    base = d["ch_load"] * (1 + ch["population_growth"]) * (1 - ch["efficiency_gain"])
    hp_m = HP_MONTH ** ch.get("heating_peak_factor", 1.0)
    adds = {
        "ev": ch["add_ev_twh"] * 1000 * ((1 - ch["ev_smart_share"]) * _profile(hrs, mon, EV_DUMB)
                                         + ch["ev_smart_share"] * _profile(hrs, mon, EV_SMART)),
        "heatpump": ch["add_heatpump_twh"] * 1000 * _profile(hrs, mon, HP_HOUR, hp_m),
        "cooling": ch["add_cooling_twh"] * 1000 * _profile(hrs, mon, COOL_HOUR, COOL_MONTH),
        "flat": (ch["add_datacenter_twh"] + ch["add_industry_twh"]) * 1000 / len(d),
    }
    d["ch_load"] = base + sum(adds.values())

    # --- Swiss supply
    pv_ref = d["ch_solar"].sum() / 1000
    d["ch_solar"] = d["ch_solar"] * (ch["pv_twh"] / max(pv_ref, 1e-6))
    w_ref = d["ch_wind"].sum() / 1000
    d["ch_wind"] = d["ch_wind"] * (ch["wind_twh"] / w_ref) if w_ref > 0.01 else ch["wind_twh"] * 1000 / len(d)
    nuc_ref_gw = 2.97  # Beznau 1+2, Gösgen, Leibstadt (reference fleet 2023-2025)
    d["ch_nuclear"] = d["ch_nuclear"] * (ch["nuclear_gw"] / nuc_ref_gw) * ch["nuclear_availability_factor"]
    drought = np.where(np.isin(mon, [7, 8, 9]), ch["summer_drought_factor"], 1.0)
    d["ch_ror"] = d["ch_ror"] * ch["hydro_ror_factor"] * drought
    if "ch_res_fill_twh" in d:  # reservoir state of the weather year, scaled (dry/wet 2035)
        d["ch_res_fill_twh"] = d["ch_res_fill_twh"] * ch.get("reservoir_factor", 1.0)

    # --- neighbours
    for c in ["de", "fr", "it"]:
        for k in ["solar", "wind", "load"]:
            d[f"{c}_{k}"] = d[f"{c}_{k}"] * nb[f"{c}_{k}_factor"]
    d["fr_nuclear"] = d["fr_nuclear"] * nb["fr_nuclear_factor"]

    # --- market: scenario annual average × daily shape of an illustrative year (see settings.yaml)
    from .data import fuel  # noqa: PLC0415

    st = load_settings()["scenario_run"]
    doy = np.minimum(loc.dayofyear.values, 366) - 1
    g_year = mk.get("gas_profile_year", st.get("fuel_profile_year_gas", 2024))
    c_year = mk.get("co2_profile_year", st.get("fuel_profile_year_co2", 2024))
    d["gas_eur_mwh"] = mk["gas_eur_mwh"] * fuel.profile(g_year, "gas_eur_mwh")[doy]
    d["co2_eur_t"] = mk["co2_eur_t"] * fuel.profile(c_year, "co2_eur_t")[doy]

    # --- new flexibility smooths Swiss residual load within each day
    rl = (d["ch_load"] - d["ch_solar"] - d["ch_wind"] - d["ch_nuclear"] - d["ch_ror"]).values
    # storage split by technology: battery storage (BESS) and NEW hydro pumped storage, then demand response.
    # Existing pumped storage (~4 GW) is already reflected in the historical prices.
    rl_flex = rl.copy()
    after_bess = dispatch_flex(rl_flex, loc, ch["battery_gw"], ch["battery_hours"], ch["battery_efficiency"])
    d["ch_bess_gw"] = after_bess - rl_flex                     # + charging, − discharging
    after_ps = dispatch_flex(after_bess, loc, ch.get("pumped_storage_new_gw", 0.0), ch.get("pumped_storage_hours", 8.0),
                             ch.get("pumped_storage_efficiency", 0.75))
    d["ch_pumped_new_gw"] = after_ps - after_bess
    rl_flex = dispatch_flex(after_ps, loc, ch["dsm_gw"], 2.0, 1.0)
    d["ch_residual_raw"] = rl
    d["ch_residual_flex"] = rl_flex
    # neighbours' new batteries flatten their residual load too (otherwise 2035 solar dips are overstated)
    for c in ["de", "fr", "it"]:
        gw = nb.get(f"{c}_battery_gw", 0.0)
        r = d[f"{c}_load"] - d[f"{c}_solar"] - d[f"{c}_wind"] - (d["fr_nuclear"] if c == "fr" else 0.0)
        d[f"{c}_residual_flex"] = dispatch_flex(r.values, loc, gw, nb.get("battery_hours", 2.0), 0.88) if gw > 0 else r.values
    d.attrs.update(y.attrs)
    d.attrs["demand_twh"] = {"reference": round(ref_twh, 2), "base_2035": round(base.sum() / 1000, 2),
                             **{k: round(float(np.sum(v) / 1000 if np.ndim(v) else v * len(d) / 1000), 2) for k, v in adds.items()}}
    return d


def dispatch_flex(rl: np.ndarray, loc: pd.DatetimeIndex, gw: float, hours: float, eff: float,
                  iters: int = 120) -> np.ndarray:
    """Greedy daily peak-shaving / valley-filling, vectorised over days.

    Each day: repeatedly charge in the lowest residual-load hour and discharge in the highest,
    respecting power (GW) and energy (GW × hours) limits; stops when the spread is flat.
    """
    if gw <= 0 or hours <= 0:
        return rl
    days = pd.factorize(loc.date)[0]
    nd = days.max() + 1
    # pad each day to 25 slots (DST days have 23/25 h)
    pos = pd.Series(np.arange(len(rl))).groupby(days).cumcount().values
    M = np.full((nd, 25), np.nan)
    M[days, pos] = rl
    charge = np.zeros_like(M)
    dis = np.zeros_like(M)
    e_in = np.zeros(nd)
    cap_e = gw * hours
    step0 = 0.1 * gw
    rows = np.arange(nd)
    for _ in range(iters):
        cur = M + charge - dis
        can_c = (charge < gw - 1e-9) & (dis == 0) & ~np.isnan(M)
        can_d = (dis < gw - 1e-9) & (charge == 0) & ~np.isnan(M)
        lo = np.where(can_c, cur, np.inf).argmin(1)
        hi = np.where(can_d, cur, -np.inf).argmax(1)
        gap = cur[rows, hi] - cur[rows, lo]
        ok = (gap > 0.02) & (e_in < cap_e - 1e-9) & (lo != hi)
        if not ok.any():
            break
        step = np.minimum.reduce([np.full(nd, step0), gw - charge[rows, lo], (gw - dis[rows, hi]) / eff,
                                  cap_e - e_in, gap / (1 + eff)])
        step = np.where(ok, np.clip(step, 0, None), 0)
        charge[rows, lo] += step
        dis[rows, hi] += step * eff
        e_in += step
    adj = (charge - dis)[days, pos]
    return rl + adj


def structural_adjustments(price: np.ndarray, d: pd.DataFrame, p: dict, floor: float, cap: float) -> np.ndarray:
    """Stylised effects outside the historical data range (documented in the README)."""
    ch, mk = p["ch"], p["market"]
    out = price.copy()
    # Border capacity: less NTC -> Switzerland decouples -> intraday deviations amplify
    ntc = mk.get("ntc_factor", 1.0)
    if abs(ntc - 1) > 1e-6:
        loc_date = d.index.tz_convert("Europe/Zurich").date
        daily = pd.Series(out).groupby(loc_date).transform("mean").values
        out = daily + (out - daily) * (1 + 0.8 * (1 - ntc))
        # scarcity premium when residual load exceeds a capacity-scaled threshold
        thr = np.quantile(d["ch_residual_flex"], 0.97)
        short = np.clip(d["ch_residual_flex"].values - thr * ntc, 0, None)
        out = out + 25 * short
    # PV injection management / curtailment: PV stops producing below this price -> soft floor
    fl = ch.get("curtailment_floor_eur")
    if fl is not None:
        below = out < fl
        out[below] = fl + 0.15 * (out[below] - fl)
    return np.clip(out, floor, cap)


def run_scenario(model: PriceModel, hist: pd.DataFrame, params: dict, weather_years=None,
                 keep_hourly: bool = True) -> dict:
    st = load_settings()["scenario_run"]
    weather_years = weather_years or st["weather_years"]
    avail = set(hist.index.tz_convert("Europe/Zurich").year)
    weather_years = [y for y in weather_years if y in avail]
    if not weather_years:
        raise ValueError(f"none of the weather years are in the dataset ({sorted(avail)})")
    runs = []
    for wy in weather_years:
        y = year_2035(hist, wy, st["target_year"])
        d = apply_scenario(y, params)
        clim = model.meta.get("reservoir_climatology_twh")
        if clim is not None and "ch_res_fill_twh" in d:
            from .data import reservoir
            d = reservoir.add_anomaly(d, np.asarray(clim))
        X = build_features(d)
        pr = model.predict_frame(X)
        price = structural_adjustments(pr["price"].values, d, params, st["price_floor"], st["price_cap"])
        shift = price - pr["price"].values
        res = {"weather_year": wy, "frame": d, "price": price}
        for q in [c for c in pr.columns if c.startswith("q")]:
            res[q] = np.clip(pr[q].values + shift, st["price_floor"], st["price_cap"])
        runs.append(res)
    return {"runs": runs, "index": runs[0]["frame"].index, "params": params}


def mean_price(result: dict) -> np.ndarray:
    return np.mean([r["price"] for r in result["runs"]], axis=0)


def srmc_of(params: dict) -> float:
    return float(srmc_gas(params["market"]["gas_eur_mwh"], params["market"]["co2_eur_t"]))


__all__ = ["run_scenario", "mean_price", "apply_scenario", "year_2035", "dispatch_flex", "calendar", "srmc_of"]
