"""Historical gas (TTF day-ahead) and CO₂ (EU ETS EUA) prices.

Files (semicolon CSV, German date format dd.mm.yyyy), paths in config/settings.yaml:
  data/csv/EEX-TTF-Day-Ahead.csv     Datum;Preis (€/MWh)          daily, no weekends/holidays
  data/csv/EUA_data_2016-2026.csv    Date;price (EUR/tCO2)        every few days

Both are turned into a calendar-daily series. Missing days take the last known price
(CO₂ is "constant between two dates", gas is carried over weekends/holidays).
For 2035 the *shape* of one illustrative year is scaled to the scenario's annual average.
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np
import pandas as pd

from ..config import load_settings, resolve


def _read(path, name: str) -> pd.Series:
    df = pd.read_csv(path, sep=";", encoding="latin-1", decimal=".")
    df = df.iloc[:, :2]
    df.columns = ["date", name]
    df["date"] = pd.to_datetime(df["date"].astype(str).str.strip(), format="%d.%m.%Y", errors="coerce")
    df[name] = pd.to_numeric(df[name].astype(str).str.replace(",", ".", regex=False), errors="coerce")
    s = df.dropna().drop_duplicates("date", keep="last").set_index("date")[name].sort_index()
    # calendar-daily, step function: a price holds until the next quoted date
    return s.asfreq("D").ffill()


@lru_cache(maxsize=1)
def daily() -> pd.DataFrame | None:
    """Daily gas & CO₂ prices, or None if the CSV files are not there."""
    st = load_settings()["data"]
    g, c = resolve(st.get("gas_csv")), resolve(st.get("co2_csv"))
    if not g or not c or not g.exists() or not c.exists():
        return None
    df = pd.concat([_read(g, "gas_eur_mwh"), _read(c, "co2_eur_t")], axis=1).ffill()
    return df


def hourly(index: pd.DatetimeIndex) -> pd.DataFrame | None:
    """Gas & CO₂ for each hour of `index` (by local Swiss date)."""
    d = daily()
    if d is None:
        return None
    dates = pd.DatetimeIndex(index.tz_convert("Europe/Zurich").date)
    out = d.reindex(dates, method="ffill")
    if out.isna().any().any():  # before the first quote: use the first known value
        out = out.bfill()
    out.index = index
    return out


def profile(year: int, column: str, detrend: bool | None = None) -> np.ndarray:
    """366 daily multipliers (mean 1) = shape of `year`, indexed by day-of-year − 1.

    detrend (settings scenario_run.fuel_profile_detrend): divide out the straight-line drift within the
    year (e.g. 2024 gas rose from ~30 to ~45 €/MWh), keeping seasonality and day-to-day moves only.
    """
    d = daily()
    if d is None:
        return np.ones(366)
    if detrend is None:
        detrend = load_settings()["scenario_run"].get("fuel_profile_detrend", True)
    s = d.loc[str(year), column].dropna()
    if len(s) < 300:
        raise ValueError(f"not enough {column} data in {year} for a 2035 profile (got {len(s)} days)")
    v = s.values.astype(float)
    if detrend:
        t = np.arange(len(v))
        slope, icpt = np.polyfit(t, v, 1)
        trend = icpt + slope * t
        v = v / trend * trend.mean()
    shape = v / v.mean()
    return np.resize(shape, 366) if len(shape) < 366 else shape[:366]


def yearly_stats() -> dict:
    d = daily()
    if d is None:
        return {}
    g = d.groupby(d.index.year).agg(["mean", "min", "max"]).round(2)
    num = lambda v: None if pd.isna(v) else float(v)  # noqa: E731 — JSON has no NaN
    return {int(y): {"gas_mean": num(r[("gas_eur_mwh", "mean")]), "gas_min": num(r[("gas_eur_mwh", "min")]),
                     "gas_max": num(r[("gas_eur_mwh", "max")]), "co2_mean": num(r[("co2_eur_t", "mean")]),
                     "co2_min": num(r[("co2_eur_t", "min")]), "co2_max": num(r[("co2_eur_t", "max")])}
            for y, r in g.iterrows()}


def monthly(years) -> dict:
    d = daily()
    if d is None:
        return {}
    out = {}
    for y in years:
        s = d.loc[str(y)]
        if len(s) > 300:
            m = s.groupby(s.index.month).mean()
            out[str(y)] = {"gas": m["gas_eur_mwh"].round(2).tolist(), "co2": m["co2_eur_t"].round(2).tolist()}
    return out
