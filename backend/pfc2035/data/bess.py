"""Swiss battery storage (BESS) from data/csv/battery_facilities.csv -> scenario input.

Each scenario can carry, under ``ch``:

    bess_from_csv:
      share: {operational: 1.0, being built: 1.0, in development: 0.5, proposal: 0.0}
      home_gw: 0.2        # behind-the-meter batteries (not in the list)
      home_hours: 2.0

The share of each status that is realised by 2035 gives the grid-scale GW and GWh; adding
home batteries gives ``battery_gw`` and ``battery_hours`` (= GWh / GW) used by the dispatch.
Set ``bess_from_csv: null`` in a scenario to use hand-set battery_gw / battery_hours instead.
"""
from __future__ import annotations

import pandas as pd

from ..config import load_settings, resolve

STATUSES = ["operational", "being built", "in development", "proposal"]


def facilities() -> pd.DataFrame:
    f = resolve(load_settings()["data"].get("battery_facilities_csv", "data/csv/battery_facilities.csv"))
    df = pd.read_csv(f)
    df["status"] = df["status"].str.strip().str.lower()
    bad = sorted(set(df["status"]) - set(STATUSES))
    if bad:
        raise ValueError(f"{f.name}: unknown status {bad}; use one of {STATUSES}")
    df["energy_mwh"] = df["energy_mwh"].fillna(df["power_mw"] * 2.0)  # 2 h if MWh is missing
    return df


def from_csv(spec: dict, df: pd.DataFrame | None = None) -> dict:
    df = facilities() if df is None else df
    share = df["status"].map({k: float(v) for k, v in (spec.get("share") or {}).items()}).fillna(0.0)
    grid_mw = float((df["power_mw"] * share).sum())
    grid_mwh = float((df["energy_mwh"] * share).sum())
    home_gw = float(spec.get("home_gw", 0.0))
    home_h = float(spec.get("home_hours", 2.0))
    gw = grid_mw / 1000 + home_gw
    gwh = grid_mwh / 1000 + home_gw * home_h
    return {"battery_gw": round(gw, 3), "battery_hours": round(gwh / gw, 2) if gw > 0 else 2.0,
            "grid_gw": round(grid_mw / 1000, 3), "grid_gwh": round(grid_mwh / 1000, 3),
            "home_gw": home_gw, "home_gwh": round(home_gw * home_h, 3)}


def apply(params: dict) -> dict:
    """Replace ch.battery_gw / battery_hours with the values derived from the CSV (in place)."""
    ch = params.get("ch", {})
    spec = ch.get("bess_from_csv")
    if spec:
        r = from_csv(spec)
        ch["battery_gw"], ch["battery_hours"] = r["battery_gw"], r["battery_hours"]
    return params


def export(path=None) -> pd.DataFrame:
    """Write the BESS list with the MW / MWh each scenario counts for 2035 (outputs/bess_list.csv)."""
    from ..config import WORK, load_scenarios
    df = facilities()
    raw = load_scenarios()["scenarios"]
    out = df.copy()
    print(f"{'scenario':<14}{'grid GW':>9}{'grid GWh':>10}{'home GW':>9}{'BESS GW':>9}{'hours':>7}")
    for sid, sc in raw.items():
        spec = sc["params"]["ch"].get("bess_from_csv")
        if not spec:
            continue
        sh = df["status"].map({k: float(v) for k, v in spec["share"].items()}).fillna(0.0)
        out[f"{sid}_mw_2035"] = (df["power_mw"] * sh).round(2)
        out[f"{sid}_mwh_2035"] = (df["energy_mwh"] * sh).round(2)
        r = from_csv(spec, df)
        print(f"{sid:<14}{r['grid_gw']:>9.2f}{r['grid_gwh']:>10.2f}{r['home_gw']:>9.2f}{r['battery_gw']:>9.2f}{r['battery_hours']:>7.2f}")
    path = path or (WORK / "outputs" / "bess_list.csv")
    path.parent.mkdir(parents=True, exist_ok=True)
    out.sort_values("power_mw", ascending=False).to_csv(path, index=False, encoding="utf-8-sig")
    print(f"wrote {path} ({len(out)} sites, {df.power_mw.sum():.0f} MW / {df.energy_mwh.sum():.0f} MWh)")
    return out
