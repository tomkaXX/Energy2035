"""Swiss PV: official installed capacity -> correct the under-reported ENTSO-E solar series; map data.

ENTSO-E reports only part of Swiss PV (≈3.5-6 TWh/yr, mostly larger metered plants), while the official
stock (Swissolar/SFOE) implies ≈7-9 TWh. The model learns from the hourly *shape* of ENTSO-E solar, so we
keep the shape and rescale each year to  average installed capacity × specific yield.

Files (data/csv):
  pv_national.csv                installed MW at year ends (Swissolar), register snapshot, storage
  pv_cantons_2026-08-06.csv      26 cantons: systems, MW, W/capita, capital coordinates (ecoen.ch / SFOE register)
  pv_large_installations.csv     notable large plants (map)

    python -m pfc2035 pv          apply the correction to the dataset (idempotent)
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from ..config import load_settings, resolve

RAW = "ch_solar_entsoe"   # original ENTSO-E series is kept here


def _settings() -> dict:
    return load_settings()["data"]


def capacity_by_day(index_dates: pd.DatetimeIndex) -> pd.Series:
    """Official installed PV capacity (MW) per day, linear between year-end stocks, extrapolated at the ends."""
    st = _settings()
    nat = pd.read_csv(resolve(st["pv_national_csv"]), parse_dates=["as_of"])
    pts = nat[nat["kind"].isin(["stock_end_of_year", "derived"])].sort_values("as_of")
    x = pts["as_of"].map(pd.Timestamp.toordinal).values.astype(float)
    y = pts["installed_mw"].values.astype(float)
    t = np.array([d.toordinal() for d in index_dates], dtype=float)
    out = np.interp(t, x, y)
    # extrapolate with the first / last yearly growth instead of flat
    lo_slope = (y[1] - y[0]) / (x[1] - x[0])
    hi_slope = (y[-1] - y[-2]) / (x[-1] - x[-2])
    out = np.where(t < x[0], y[0] + (t - x[0]) * lo_slope, out)
    out = np.where(t > x[-1], y[-1] + (t - x[-1]) * hi_slope, out)
    return pd.Series(out, index=index_dates)


def correction_factors(df: pd.DataFrame) -> dict:
    """{year: factor} = (avg capacity × specific yield) / ENTSO-E annual energy, for complete years.
    Incomplete years use the factor of the latest complete year."""
    yld = float(_settings().get("pv_specific_yield_kwh_per_kwp", 950))
    raw = df[RAW] if RAW in df else df["ch_solar"]
    loc = df.index.tz_convert("Europe/Zurich")
    days = pd.DatetimeIndex(sorted(set(loc.normalize().tz_localize(None))))
    cap = capacity_by_day(days)
    f, info = {}, {}
    for yr in sorted(set(loc.year)):
        m = loc.year == yr
        if m.sum() < 24 * 360:
            continue
        reported_twh = raw[m].sum() / 1000
        cap_mw = cap[cap.index.year == yr].mean()
        expected_twh = cap_mw * yld / 1e6
        f[yr] = expected_twh / reported_twh if reported_twh > 0 else 1.0
        info[yr] = {"avg_capacity_mw": round(float(cap_mw), 1), "expected_twh": round(float(expected_twh), 2),
                    "entsoe_twh": round(float(reported_twh), 2), "factor": round(float(f[yr]), 3)}
    last = f[max(f)] if f else 1.0
    for yr in sorted(set(loc.year)):
        if yr not in f:
            f[yr] = last
            info[yr] = {"factor": round(float(last), 3), "note": "incomplete year: factor of latest complete year"}
    return {"factors": f, "info": info, "specific_yield_kwh_per_kwp": yld}


def apply(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Rescale ch_solar to official production levels (keeps the ENTSO-E series in ch_solar_entsoe)."""
    f = resolve(_settings().get("pv_national_csv"))
    if f is None or not f.exists():
        return df, {}
    out = df.copy()
    if RAW not in out:
        out[RAW] = out["ch_solar"]
    c = correction_factors(out)
    yr = out.index.tz_convert("Europe/Zurich").year
    out["ch_solar"] = out[RAW].values * pd.Series(yr).map(c["factors"]).values
    return out, c


def map_json() -> dict:
    """Canton PV and large installations for the React map."""
    st = _settings()
    out = {}
    f = resolve(st.get("pv_cantons_csv"))
    if f and f.exists():
        d = pd.read_csv(f)
        out["cantons"] = d.drop(columns=["source"]).to_dict(orient="records")
        out["cantons_date"] = str(d["data_date"].iloc[0])
        out["cantons_source"] = str(d["source"].iloc[0])
        out["total_mw"] = round(float(d["capacity_mw"].sum()), 1)
        out["total_systems"] = int(d["systems"].sum())
    f = resolve(st.get("pv_large_csv"))
    if f and f.exists():
        d = pd.read_csv(f)
        out["large"] = json.loads(d.to_json(orient="records"))
    # national key figures (Swissolar «Statistik Sonnenenergie», latest year-end stock)
    f = resolve(st.get("pv_national_csv"))
    if f and f.exists():
        n = pd.read_csv(f, parse_dates=["as_of"])
        stock = n[n["kind"] == "stock_end_of_year"].sort_values("as_of")
        if len(stock):
            last = stock.iloc[-1]
            prev = n[n["as_of"].dt.year == last["as_of"].year - 1]
            new_prev = float(prev["new_mw_in_year"].iloc[0]) if len(prev) and pd.notna(prev["new_mw_in_year"].iloc[0]) else None
            out["national"] = {
                "year": int(last["as_of"].year),
                "installed_mw": float(last["installed_mw"]),
                "systems": int(last["systems"]) if pd.notna(last["systems"]) else None,
                "share_of_consumption_pct": float(last["share_of_consumption_pct"]) if pd.notna(last.get("share_of_consumption_pct")) else None,
                "new_mw": float(last["new_mw_in_year"]) if pd.notna(last["new_mw_in_year"]) else None,
                "new_mw_prev": new_prev,
                "source": str(last["source"]),
            }
    # battery storage: national stock (behind the meter) and large facilities
    f = resolve(st.get("battery_national_csv"))
    if f and f.exists():
        out["battery_national"] = json.loads(pd.read_csv(f).to_json(orient="records"))
    f = resolve(st.get("battery_facilities_csv"))
    if f and f.exists():
        out["battery_facilities"] = json.loads(pd.read_csv(f).to_json(orient="records"))
    # ENTSO-E vs official production (from the dataset meta written by `python -m pfc2035 pv`)
    from ..config import HOURLY_META
    if HOURLY_META.exists():
        meta = json.loads(HOURLY_META.read_text(encoding="utf-8"))
        corr = meta.get("pv_correction") or {}
        out["correction"] = [{"year": int(y), **v} for y, v in sorted(corr.items()) if "entsoe_twh" in v]
        out["specific_yield_kwh_per_kwp"] = meta.get("pv_specific_yield_kwh_per_kwp")
    return out
