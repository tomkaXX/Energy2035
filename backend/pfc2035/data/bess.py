"""Swiss battery storage (BESS) from data/csv/battery_facilities.csv -> scenario input.

Each scenario can carry, under ``ch``:

    bess_from_csv:
      share: {operational: 1.0, being built: 1.0, in development: 0.5, proposal: 0.0}
      home_gw: 0.2        # behind-the-meter batteries (not in the list)
      home_hours: 2.0

Calibration: if data/csv/battery_status_totals.csv exists (SRF chart: operational ~150 MWh,
being built 280 MWh until end 2026, in development 4,350 MWh until 2030), the site list is scaled
per status so its MWh match those totals (MW scaled by the same factor, so durations are kept).
Statuses missing from the totals file (e.g. proposal) keep the site-list values.

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


def status_totals() -> pd.DataFrame | None:
    f = resolve(load_settings()["data"].get("battery_status_totals_csv", "data/csv/battery_status_totals.csv"))
    if not f or not f.exists():
        return None
    t = pd.read_csv(f)
    t["status"] = t["status"].str.strip().str.lower()
    return t


def calibrated(df: pd.DataFrame | None = None) -> pd.DataFrame:
    """Site list scaled per status to the SRF MWh totals (model input; the map shows the raw list)."""
    df = (facilities() if df is None else df).copy()
    t = status_totals()
    df["calib_factor"] = 1.0
    if t is not None:
        for _, r in t.iterrows():
            m = df["status"] == r["status"]
            have = df.loc[m, "energy_mwh"].sum()
            if have > 0:
                df.loc[m, "calib_factor"] = float(r["energy_mwh"]) / have
    df["model_mw"] = df["power_mw"] * df["calib_factor"]
    df["model_mwh"] = df["energy_mwh"] * df["calib_factor"]
    return df


def from_csv(spec: dict, df: pd.DataFrame | None = None) -> dict:
    df = calibrated() if df is None else df
    share = df["status"].map({k: float(v) for k, v in (spec.get("share") or {}).items()}).fillna(0.0)
    grid_mw = float((df["model_mw"] * share).sum())
    grid_mwh = float((df["model_mwh"] * share).sum())
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
    df = calibrated()
    raw = load_scenarios()["scenarios"]
    out = df.copy()
    print(f"{'scenario':<14}{'grid GW':>9}{'grid GWh':>10}{'home GW':>9}{'BESS GW':>9}{'hours':>7}")
    for sid, sc in raw.items():
        spec = sc["params"]["ch"].get("bess_from_csv")
        if not spec:
            continue
        sh = df["status"].map({k: float(v) for k, v in spec["share"].items()}).fillna(0.0)
        out[f"{sid}_mw_2035"] = (df["model_mw"] * sh).round(2)
        out[f"{sid}_mwh_2035"] = (df["model_mwh"] * sh).round(2)
        r = from_csv(spec, df)
        print(f"{sid:<14}{r['grid_gw']:>9.2f}{r['grid_gwh']:>10.2f}{r['home_gw']:>9.2f}{r['battery_gw']:>9.2f}{r['battery_hours']:>7.2f}")
    path = path or (WORK / "outputs" / "bess_list.csv")
    path.parent.mkdir(parents=True, exist_ok=True)
    out["model_mw"] = out["model_mw"].round(2)
    out["model_mwh"] = out["model_mwh"].round(2)
    out["calib_factor"] = out["calib_factor"].round(3)
    out.sort_values("power_mw", ascending=False).to_csv(path, index=False, encoding="utf-8-sig")
    g = df.groupby("status")[["energy_mwh", "model_mwh", "model_mw"]].sum().round(0)
    print("site list vs model (SRF totals):\n" + g.to_string())
    print(f"wrote {path} ({len(out)} sites; model {df.model_mw.sum():.0f} MW / {df.model_mwh.sum():.0f} MWh)")
    return out
