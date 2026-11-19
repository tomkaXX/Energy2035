"""Swiss hydro reservoir filling (BFE weekly bulletin or ENTSO-E A72, weekly, MWh) — the "water value" state of Swiss hydro.

Full reservoirs in autumn let storage plants bid low through winter; low reservoirs push winter prices
up. Two features go into the model:
  ch_res_fill_twh  stored energy (TWh), weekly values interpolated to hours
  ch_res_anom_twh  fill minus the average fill on the same day of year (2023-2025 climatology)
                   -> "how much more/less water than usual"
"""
from __future__ import annotations

import numpy as np
import pandas as pd

COL = "ch_res_fill_twh"
ANOM = "ch_res_anom_twh"


def to_hourly(weekly_mwh: pd.Series, index: pd.DatetimeIndex) -> pd.Series:
    """Weekly MWh -> hourly TWh on `index` (time-interpolated between weekly points)."""
    s = (weekly_mwh.dropna().astype(float) / 1e6).sort_index()
    s.index = pd.DatetimeIndex(s.index).tz_convert("UTC")
    s = s[~s.index.duplicated(keep="last")]
    full = s.reindex(s.index.union(index)).interpolate("time").ffill().bfill()
    return full.reindex(index)


def climatology(df: pd.DataFrame) -> np.ndarray | None:
    """Average fill per day of year (366 values, smoothed ±7 days) from complete years in `df`."""
    if COL not in df or df[COL].notna().sum() < 24 * 300:
        return None
    loc = df.index.tz_convert("Europe/Zurich")
    daily = df[COL].groupby(loc.date).mean()
    doy = pd.DatetimeIndex(daily.index).dayofyear
    clim = daily.groupby(doy).mean().reindex(range(1, 367)).interpolate().ffill().bfill()
    sm = pd.concat([clim.iloc[-7:], clim, clim.iloc[:7]]).rolling(15, center=True).mean().iloc[7:-7]
    return sm.values


def add_anomaly(df: pd.DataFrame, clim: np.ndarray | None) -> pd.DataFrame:
    out = df.copy()
    if clim is None or COL not in out:
        out[ANOM] = np.nan
        return out
    doy = np.minimum(out.index.tz_convert("Europe/Zurich").dayofyear.values, 366) - 1
    out[ANOM] = out[COL].values - clim[doy]
    return out


def weekly_by_year(df: pd.DataFrame) -> dict:
    """{year: [weekly mean fill TWh]} for charts."""
    if COL not in df or df[COL].notna().sum() == 0:
        return {}
    loc = df.index.tz_convert("Europe/Zurich")
    out = {}
    for y in sorted(set(loc.year)):
        s = df.loc[loc.year == y, COL]
        if s.notna().sum() < 24 * 300:
            continue
        w = s.groupby(np.minimum((loc[loc.year == y].dayofyear - 1) // 7, 51)).mean()
        out[str(y)] = [round(float(v), 3) for v in w.values]
    return out


def climatology_from_csv(path, years=None) -> np.ndarray | None:
    """Average filling per day of year (TWh, 366 values) from the weekly BFE CSV, complete years only.

    Using every year in the CSV (e.g. 2022-2025) gives a steadier "normal year" than the 3 training years,
    so the anomaly feature means "more/less water than usual" rather than "which year is it".
    """
    from pathlib import Path

    if path is None or not Path(path).exists():
        return None
    d = pd.read_csv(path, parse_dates=["date"])
    s = pd.Series(d["total_gwh"].values / 1000.0, index=d["date"])
    s = s.resample("D").mean().interpolate("time")
    counts = s.groupby(s.index.year).size()
    full = [y for y, n in counts.items() if n >= 350 and (years is None or y in years)]
    if len(full) < 2:
        return None
    s = s[s.index.year.isin(full)]
    clim = s.groupby(s.index.dayofyear).mean().reindex(range(1, 367)).interpolate().ffill().bfill()
    sm = pd.concat([clim.iloc[-7:], clim, clim.iloc[:7]]).rolling(15, center=True).mean().iloc[7:-7]
    return sm.values


def weekly_from_csv(path) -> tuple[dict, str | None]:
    """{year: [weekly TWh]} straight from the BFE CSV (all years, incl. the current partial one) + last date."""
    from pathlib import Path

    if path is None or not Path(path).exists():
        return {}, None
    d = pd.read_csv(path, parse_dates=["date"]).sort_values("date")
    out = {}
    for y, g in d.groupby(d["date"].dt.year):
        out[str(y)] = [round(float(v) / 1000.0, 3) for v in g["total_gwh"].values]
    return out, d["date"].max().strftime("%Y-%m-%d")
