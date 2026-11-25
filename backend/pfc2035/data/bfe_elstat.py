"""BFE electricity statistics (opendata.swiss) -> validation data for the model.

Files in data/csv/bfe_elstat/ (source: BFE, www.bfe.admin.ch/en/electricity-statistics):
  ogd35_elektrizitaetsbilanz_monatswerte.csv   monthly balance 2000-today (current year provisional)
      https://www.bfe-ogd.ch/ogd35/ogd35_schweizerische_elektrizitaetsbilanz_monatswerte.csv
  ogd51_wochenstatistik_2025_2026.csv          weekly statistic: production/consumption of the Wednesday (GWh/day)
      https://www.bfe-ogd.ch/ogd51/ogd51_wochenstatistik_elektrizitaetsbilanz.csv
  annual values: https://www.uvek-gis.admin.ch/BFE/ogd/32/ogd32_elektrizitaetbilanz_jahreswerte.csv

`python -m pfc2035 validate` writes
  data/csv/bfe_elstat/bfe_monthly_<year>.csv   tidy monthly values per category for the latest year
  outputs/validation_bfe_monthly.csv           model input (hourly dataset, summed per month) vs BFE
"""
from __future__ import annotations

import json

import pandas as pd

from ..config import HOURLY_PARQUET, ROOT, WORK

DIR = ROOT / "data" / "csv" / "bfe_elstat"
MONTHLY = DIR / "ogd35_elektrizitaetsbilanz_monatswerte.csv"
WEEKLY = DIR / "ogd51_wochenstatistik_2025_2026.csv"

CATS = {  # BFE column -> tidy name
    "Erzeugung_Laufwerk_GWh": "run_of_river_gwh",
    "Erzeugung_Speicherwerk_GWh": "storage_hydro_gwh",
    "Erzeugung_Kernkraftwerk_GWh": "nuclear_gwh",
    "Erzeugung_Thermische_GWh": "thermal_gwh",
    "Erzeugung_Windkraft_GWh": "wind_gwh",
    "Erzeugung_Photovoltaik_GWh": "pv_gwh",
    "Erzeugung_andere_GWh": "other_gwh_until_2019",
    "Landeserzeugung_GWh": "production_gwh",
    "Verbrauch_Speicherpumpen_GWh": "pumping_gwh",
    "Erzeugung_netto_GWh": "net_production_gwh",
    "Einfuhr_GWh": "import_gwh",
    "Ausfuhr_GWh": "export_gwh",
    "Landesverbrauch_GWh": "national_consumption_gwh",
    "Verluste_GWh": "losses_gwh",
    "Endverbrauch_GWh": "final_consumption_gwh",
}
# hourly dataset column (MW per hour -> MWh) vs BFE tidy column
MODEL_VS_BFE = {
    "ch_ror": "run_of_river_gwh", "ch_reservoir": "storage_hydro_gwh", "ch_nuclear": "nuclear_gwh",
    "ch_solar": "pv_gwh", "ch_solar_entsoe": "pv_gwh", "ch_wind": "wind_gwh", "ch_load": "national_consumption_gwh",
    "ch_pump": "pumping_gwh",
}


def monthly() -> pd.DataFrame | None:
    if not MONTHLY.exists():
        return None
    df = pd.read_csv(MONTHLY, na_values="NULL").rename(columns=CATS)
    df = df.rename(columns={"Jahr": "year", "Monat": "month", "Definitiv": "final"})
    df["net_import_gwh"] = df["import_gwh"] - df["export_gwh"]
    return df


def tidy_year(year: int | None = None) -> pd.DataFrame:
    df = monthly()
    year = year or int(df["year"].max())
    y = df[df["year"] == year].copy()
    y["status"] = y["final"].map({1: "final", 0: "provisional"})
    cols = ["year", "month", "status", "run_of_river_gwh", "storage_hydro_gwh", "nuclear_gwh", "thermal_gwh", "wind_gwh",
            "pv_gwh", "production_gwh", "pumping_gwh", "net_production_gwh", "import_gwh", "export_gwh", "net_import_gwh",
            "national_consumption_gwh", "losses_gwh", "final_consumption_gwh"]
    out = y[cols]
    out.to_csv(DIR / f"bfe_monthly_{year}.csv", index=False)
    return out


def validate() -> pd.DataFrame:
    """Monthly sums of the model's hourly inputs vs official BFE values (ratio 1.0 = identical)."""
    df = monthly()
    h = pd.read_parquet(HOURLY_PARQUET).tz_convert("Europe/Zurich")
    m = h.resample("MS").sum(min_count=600)  # MW·h -> MWh per month; incomplete months dropped
    m = m[[c for c in MODEL_VS_BFE if c in m]] / 1000.0  # GWh (hourly values are MW)
    if m.abs().max().max() < 100:  # dataset stored in GW -> GWh already
        m = m * 1000.0
    m.index = pd.MultiIndex.from_arrays([m.index.year, m.index.month], names=["year", "month"])
    b = df.set_index(["year", "month"])
    rows = []
    for col, bcol in MODEL_VS_BFE.items():
        if col not in m:
            continue
        j = pd.DataFrame({"model_gwh": m[col], "bfe_gwh": b[bcol]}).dropna()
        j = j[j["bfe_gwh"] > 0]
        for (yy, mm), r in j.iterrows():
            rows.append({"year": yy, "month": mm, "series": col, "bfe_category": bcol,
                         "model_gwh": round(r.model_gwh, 1), "bfe_gwh": r.bfe_gwh, "ratio": round(r.model_gwh / r.bfe_gwh, 3)})
    out = pd.DataFrame(rows)
    p = WORK / "outputs" / "validation_bfe_monthly.csv"
    p.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(p, index=False)
    s = out.groupby(["series", "year"]).agg(model=("model_gwh", "sum"), bfe=("bfe_gwh", "sum"))
    s["ratio"] = (s.model / s.bfe).round(2)
    print(s["ratio"].unstack().to_string())
    print(f"wrote {p}")
    return out


def to_json() -> dict | None:
    df = monthly()
    if df is None:
        return None
    keep = ["year", "month", "final", "run_of_river_gwh", "storage_hydro_gwh", "nuclear_gwh", "thermal_gwh", "wind_gwh",
            "pv_gwh", "other_gwh_until_2019", "production_gwh", "pumping_gwh", "import_gwh", "export_gwh", "net_import_gwh",
            "national_consumption_gwh"]
    out = {"monthly": json.loads(df[keep].to_json(orient="records"))}
    if WEEKLY.exists():
        out["weekly"] = json.loads(pd.read_csv(WEEKLY).to_json(orient="records"))
    v = WORK / "outputs" / "validation_bfe_monthly.csv"
    if v.exists():
        vv = pd.read_csv(v)
        s = vv.groupby(["series", "year"]).agg(model=("model_gwh", "sum"), bfe=("bfe_gwh", "sum")).reset_index()
        s["ratio"] = (s.model / s.bfe).round(3)
        out["validation"] = json.loads(s.to_json(orient="records"))
        out["validation_monthly"] = json.loads(vv[["year", "month", "series", "model_gwh", "bfe_gwh"]].to_json(orient="records"))
    return out


MIX = [("run_of_river_gwh", "run_of_river"), ("storage_hydro_gwh", "storage_hydro"), ("nuclear_gwh", "nuclear"),
       ("thermal_gwh", "thermal"), ("pv_gwh", "pv"), ("wind_gwh", "wind")]


def energy_mix(first_year: int = 2021) -> pd.DataFrame:
    """Monthly energy mix per year (GWh and % of production) -> data/csv/bfe_elstat/energy_mix_*.csv"""
    df = monthly()
    d = df[df["year"] >= first_year].copy()
    d["status"] = d["final"].map({1: "final", 0: "provisional"})
    cols = ["year", "month", "status"] + [c for c, _ in MIX] + ["production_gwh", "pumping_gwh", "national_consumption_gwh",
                                                                 "import_gwh", "export_gwh", "net_import_gwh"]
    out = d[cols].copy()
    for c, short in MIX:
        out[f"{short}_pct"] = (100 * out[c] / out["production_gwh"]).round(1)
    out.to_csv(DIR / f"energy_mix_monthly_{first_year}_{int(out['year'].max())}.csv", index=False)
    for y, g in out.groupby("year"):
        g.to_csv(DIR / f"energy_mix_{y}.csv", index=False)
    return out


XLSX = DIR / "switzerland_electricity_production.xlsx"
XLSX_COLS = {"run_of_river_hydropower_GWh": "run_of_river_gwh", "storage_hydropower_GWh": "storage_hydro_gwh",
             "nuclear_GWh": "nuclear_gwh", "thermal_GWh": "thermal_gwh", "photovoltaic_GWh": "pv_gwh", "wind_GWh": "wind_gwh",
             "estimated_total_generation_GWh": "production_gwh", "national_consumption_GWh_estimated": "national_consumption_gwh"}


def check_xlsx() -> pd.DataFrame | None:
    """Values read off the BFE chart (switzerland_electricity_production.xlsx) vs the official OGD CSV."""
    if not XLSX.exists():
        return None
    b = monthly().set_index(["year", "month"])
    rows = []
    for sheet, d in pd.read_excel(XLSX, sheet_name=None).items():
        y = int(sheet)
        for _, r in d.iterrows():
            for xc, bc in XLSX_COLS.items():
                if xc in d and pd.notna(r[xc]) and (y, int(r["month"])) in b.index:
                    off = float(b.loc[(y, int(r["month"])), bc])
                    if abs(float(r[xc]) - off) > 0.5:
                        rows.append({"year": y, "month": int(r["month"]), "category": bc, "xlsx": float(r[xc]), "bfe_ogd": off,
                                     "difference": float(r[xc]) - off})
    out = pd.DataFrame(rows, columns=["year", "month", "category", "xlsx", "bfe_ogd", "difference"])
    out.to_csv(DIR / "xlsx_vs_bfe_differences.csv", index=False)
    print(f"xlsx vs BFE OGD: {len(out)} cells differ (see {DIR / 'xlsx_vs_bfe_differences.csv'})")
    return out
