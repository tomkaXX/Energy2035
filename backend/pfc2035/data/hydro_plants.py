"""Swiss large hydropower stations (BFE list) from data/csv/hydro_plants.csv.

type: storage (reservoir), pumped (pumped storage), ror (run-of-river). Used for the map, the hydro
panel and as the reference fleet of the 2035 scenarios (existing storage/pumped capacity is already
in the historical prices; scenarios add only NEW capacity on top of this fleet).
"""
from __future__ import annotations

import pandas as pd

from ..config import load_settings, resolve

TYPES = ["storage", "pumped", "ror"]


def plants() -> pd.DataFrame | None:
    f = resolve(load_settings()["data"].get("hydro_plants_csv", "data/csv/hydro_plants.csv"))
    if not f or not f.exists():
        return None
    df = pd.read_csv(f)
    df["type"] = df["type"].str.strip().str.lower()
    bad = sorted(set(df["type"]) - set(TYPES))
    if bad:
        raise ValueError(f"{f.name}: unknown type {bad}; use one of {TYPES}")
    return df


def fleet() -> dict | None:
    df = plants()
    if df is None:
        return None
    g = df.groupby("type")["power_mw"].agg(["sum", "count"])
    out = {t: {"power_mw": round(float(g.loc[t, "sum"]), 1), "count": int(g.loc[t, "count"])} for t in g.index}
    out["total"] = {"power_mw": round(float(df["power_mw"].sum()), 1), "count": int(len(df))}
    return out


def report() -> None:
    f = fleet()
    if f is None:
        raise SystemExit("data/csv/hydro_plants.csv not found")
    for k, v in f.items():
        print(f"{k:<10}{v['count']:>4} plants {v['power_mw']:>9.1f} MW")
