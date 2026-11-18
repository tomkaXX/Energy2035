"""KPIs from the Excel 'Results' table (+ a few PFC shape metrics)."""
from __future__ import annotations

import numpy as np
import pandas as pd

WINTER = [10, 11, 12, 1, 2, 3]

KPI_LABELS = {
    "annual_avg": ("Annual average spot price", "€/MWh"),
    "winter_avg": ("Winter average spot price (Oct–Mar)", "€/MWh"),
    "summer_avg": ("Summer average spot price (Apr–Sep)", "€/MWh"),
    "neg_hours": ("Negative-price hours", "h/year"),
    "neg_freq": ("Negative-price frequency", "% of hours"),
    "hours_above_100": ("Hours above €100/MWh", "h/year"),
    "p10": ("P10 price", "€/MWh"),
    "p90": ("P90 price", "€/MWh"),
    "max": ("Maximum hourly price", "€/MWh"),
    "peak_avg": ("Peak (Mon–Fri 8–20 h)", "€/MWh"),
    "solar_capture": ("PV capture rate", "% of base"),
    "daily_spread": ("Average daily spread (max − min)", "€/MWh"),
}


def kpis(price: np.ndarray, index: pd.DatetimeIndex, pv: np.ndarray | None = None) -> dict:
    loc = index.tz_convert("Europe/Zurich")
    m, h, dow = loc.month.values, loc.hour.values, loc.dayofweek.values
    winter = np.isin(m, WINTER)
    peak = (dow < 5) & (h >= 8) & (h < 20)
    s = pd.Series(price, index=loc.date)
    out = {
        "annual_avg": float(price.mean()),
        "winter_avg": float(price[winter].mean()),
        "summer_avg": float(price[~winter].mean()),
        "neg_hours": int((price < 0).sum()),
        "neg_freq": float((price < 0).mean() * 100),
        "hours_above_100": int((price > 100).sum()),
        "p10": float(np.percentile(price, 10)),
        "p90": float(np.percentile(price, 90)),
        "max": float(price.max()),
        "peak_avg": float(price[peak].mean()),
        "daily_spread": float((s.groupby(level=0).max() - s.groupby(level=0).min()).mean()),
    }
    if pv is not None and pv.sum() > 0:
        out["solar_capture"] = float((pv * price).sum() / pv.sum() / price.mean() * 100)
    return out


def combine(kpi_list: list[dict]) -> dict:
    """Mean over weather years + min/max range."""
    keys = kpi_list[0].keys()
    return {k: {"mean": float(np.mean([d[k] for d in kpi_list])),
                "min": float(np.min([d[k] for d in kpi_list])),
                "max": float(np.max([d[k] for d in kpi_list]))} for k in keys}


def month_hour_grid(price: np.ndarray, index: pd.DatetimeIndex) -> list[list[float]]:
    loc = index.tz_convert("Europe/Zurich")
    df = pd.DataFrame({"p": price, "m": loc.month.values - 1, "h": loc.hour.values})
    g = df.groupby(["m", "h"])["p"].mean().unstack().reindex(index=range(12), columns=range(24))
    return g.round(2).values.tolist()
