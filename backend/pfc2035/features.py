"""Feature engineering shared by training and 2035 scenario runs.

Only *exogenous* drivers are used as features — things we can set for 2035 in a scenario.
Endogenous series (reservoir dispatch, pumping, net imports, neighbour prices) are kept for analysis only.
"""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd

# Excel "Defined Model" factors -> features
FACTOR_GROUPS = {
    "Interconnection & neighbours": ["de_residual", "fr_residual", "it_residual", "de_res_share",
                                     "neigh_residual_share", "neigh_residual_d"],
    "Consumption profile": ["ch_load"],
    "Production mix": ["ch_solar", "ch_wind", "ch_nuclear", "ch_ror", "ch_residual", "ch_residual_d"],
    "External market (gas, CO₂)": ["srmc_gas", "gas_share"],
    "Calendar / seasonality": ["hour", "dow", "is_off"],
}
# Physical direction of each driver -> LightGBM monotone constraints (+1 price rises with it, −1 falls).
# Keeps the model physically sensible when 2035 values leave the historical range. Day-of-year features
# were dropped: they let the model memorise year-specific levels (2023 crisis) instead of learning drivers.
MONOTONE = {
    "ch_load": 1, "ch_residual": 1, "ch_residual_d": 1, "de_residual": 1, "fr_residual": 1, "it_residual": 1,
    "neigh_residual_share": 1, "neigh_residual_d": 1, "srmc_gas": 1,
    "ch_solar": -1, "ch_wind": -1, "ch_nuclear": -1, "ch_ror": -1, "de_res_share": -1,
}
FEATURES = [f for g in FACTOR_GROUPS.values() for f in g]

GAS_EFF = 0.55      # CCGT efficiency
CO2_INT = 0.365     # t CO2 per MWh_el of a CCGT


def srmc_gas(gas_eur_mwh, co2_eur_t):
    """Short-run marginal cost of a CCGT (EUR/MWh) — the price-setting unit in DE/IT most hours."""
    return gas_eur_mwh / GAS_EFF + co2_eur_t * CO2_INT


def _easter(y: int) -> date:
    a = y % 19
    b, c = divmod(y, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l_ = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l_) // 451
    month = (h + l_ - 7 * m + 114) // 31
    day = (h + l_ - 7 * m + 114) % 31 + 1
    return date(y, month, day)


def swiss_holidays(years) -> set[date]:
    out = set()
    for y in years:
        e = _easter(y)
        out |= {date(y, 1, 1), date(y, 1, 2), e - timedelta(days=2), e + timedelta(days=1),
                e + timedelta(days=39), e + timedelta(days=50), date(y, 8, 1), date(y, 12, 25), date(y, 12, 26)}
    return out


def calendar(index: pd.DatetimeIndex) -> pd.DataFrame:
    loc = index.tz_convert("Europe/Zurich")
    hol = swiss_holidays(range(loc.year.min(), loc.year.max() + 1))
    is_hol = np.array([d in hol for d in loc.date])
    doy = loc.dayofyear.values
    return pd.DataFrame({
        "hour": loc.hour.values,
        "dow": loc.dayofweek.values,
        "month": loc.month.values,
        "is_off": ((loc.dayofweek.values >= 5) | is_hol).astype(int),
        "doy_sin": np.sin(2 * np.pi * doy / 365.25),
        "doy_cos": np.cos(2 * np.pi * doy / 365.25),
        "local_date": loc.date,
    }, index=index)


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """df: hourly UTC frame with fundamentals + gas/co2. Returns a frame with FEATURES (+ helpers)."""
    x = calendar(df.index)
    g = lambda c: df[c] if c in df else 0.0  # noqa: E731
    for c in ["ch_load", "ch_solar", "ch_wind", "ch_nuclear", "ch_ror"]:
        x[c] = g(c)
    # residual load = what hydro storage, imports and flexibility have to cover
    x["ch_residual"] = df["ch_residual_flex"] if "ch_residual_flex" in df else (
        g("ch_load") - g("ch_solar") - g("ch_wind") - g("ch_nuclear") - g("ch_ror"))
    # *_residual_flex columns exist only in 2035 scenario frames (after new storage is dispatched)
    x["de_residual"] = df["de_residual_flex"] if "de_residual_flex" in df else g("de_load") - g("de_solar") - g("de_wind")
    x["fr_residual"] = df["fr_residual_flex"] if "fr_residual_flex" in df else (
        g("fr_load") - g("fr_nuclear") - g("fr_solar") - g("fr_wind"))
    x["it_residual"] = df["it_residual_flex"] if "it_residual_flex" in df else g("it_load") - g("it_solar") - g("it_wind")
    x["de_res_share"] = (g("de_solar") + g("de_wind")) / df["de_load"].clip(lower=1)
    neigh_load = g("de_load") + g("fr_load") + g("it_load")
    x["neigh_residual_share"] = (x["de_residual"] + x["fr_residual"] + x["it_residual"]) / neigh_load.clip(lower=1)
    # daily means capture the slow "water value"/level effect
    x["ch_residual_d"] = x.groupby("local_date")["ch_residual"].transform("mean")
    x["neigh_residual_d"] = x.groupby("local_date")["neigh_residual_share"].transform("mean")
    x["srmc_gas"] = srmc_gas(df["gas_eur_mwh"], df["co2_eur_t"])
    # fuel vs. carbon part of the gas-plant cost (0..1): lets the model tell a gas shock from a CO₂ shock
    x["gas_share"] = (df["gas_eur_mwh"] / GAS_EFF) / x["srmc_gas"].clip(lower=1e-6)
    return x


def add_fuel(df: pd.DataFrame, fuel_csv=None) -> pd.DataFrame:
    """Attach gas (EUR/MWh) and CO₂ (EUR/t) prices to every hour.

    Uses the daily TTF/EUA files (data/csv, see pfc2035/data/fuel.py); falls back to the monthly
    placeholder CSV only if those files are missing.
    """
    from .data import fuel  # noqa: PLC0415

    out = df.copy()
    h = fuel.hourly(df.index)
    if h is not None:
        out["gas_eur_mwh"] = h["gas_eur_mwh"].values
        out["co2_eur_t"] = h["co2_eur_t"].values
        out.attrs["fuel_source"] = "daily TTF + EUA (data/csv)"
        return out
    if fuel_csv is None:
        raise FileNotFoundError("no gas/CO₂ data: add data/csv files or data.fuel_prices_csv")
    print("  ! daily gas/CO₂ files not found -> using monthly placeholder CSV")
    m = pd.read_csv(fuel_csv, comment="#")
    m["month"] = m["month"].astype(str)
    m = m.set_index("month")
    key = pd.Series(df.index.tz_convert("Europe/Zurich").strftime("%Y-%m"), index=df.index)
    out["gas_eur_mwh"] = key.map(m["gas_eur_mwh"]).ffill().bfill().values
    out["co2_eur_t"] = key.map(m["co2_eur_t"]).ffill().bfill().values
    out.attrs["fuel_source"] = "monthly placeholder CSV"
    return out
