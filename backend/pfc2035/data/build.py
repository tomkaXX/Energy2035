"""Build the hourly modelling dataset data/processed/hourly.parquet from the chosen source."""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pandas as pd

from .. import COLUMNS_FUND, COLUMNS_PRICE, REQUIRED
from ..config import HOURLY_META, HOURLY_PARQUET, PROCESSED_DIR, entsoe_key, load_settings, resolve
from ..features import add_fuel


def _fetch(source: str, start: str, end: str, fuel_csv) -> pd.DataFrame:
    if source == "synthetic":
        from .synthetic import generate
        return generate(start, end, fuel_csv)
    if source == "energy-charts":
        from .energy_charts import fetch
        return fetch(start, end)
    if source == "entsoe":
        from .entsoe_source import fetch
        return fetch(start, end)
    if source == "both":
        # ENTSO-E (official source of the challenge) first, Energy-Charts fills gaps / missing columns
        frames = []
        if entsoe_key():
            from .entsoe_source import fetch as en
            try:
                frames.append((en(start, end), "entsoe"))
            except Exception as e:  # noqa: BLE001
                print(f"  ! ENTSO-E failed ({type(e).__name__}: {e}) -> Energy-Charts only")
        else:
            print("  (no ENTSOE_API_KEY in .env -> Energy-Charts only)")
        from .energy_charts import fetch as ec
        try:
            frames.append((ec(start, end), "energy-charts"))
        except Exception as e:  # noqa: BLE001
            print(f"  ! Energy-Charts failed ({type(e).__name__}: {e})")
        if not frames:
            raise RuntimeError("no data source reachable")
        df = frames[0][0]
        prov = {c: {frames[0][1]: int(df[c].notna().sum())} for c in df.columns}
        for other, name in frames[1:]:
            for c in other.columns:
                filled = int((df[c].isna() & other[c].notna()).sum()) if c in df else int(other[c].notna().sum())
                prov.setdefault(c, {})[name] = filled
            df = df.combine_first(other)
        df.attrs["provenance"] = prov
        return df
    raise ValueError(f"unknown data source {source!r}")


def build(source: str | None = None, start: str | None = None, end: str | None = None) -> pd.DataFrame:
    st = load_settings()["data"]
    source = source or st["source"]
    start, end = start or st["start"], end or st["end"]
    fuel_csv = resolve(st["fuel_prices_csv"])
    df = _fetch(source, start, end, fuel_csv)
    if source != "synthetic" and "ch_res_fill_twh" not in df:
        df = _attach_reservoir(df, start, end)
    reservoir_source = df.attrs.get("reservoir_source")
    if source != "synthetic":
        from . import pv
        df, pv_info = pv.apply(df)
    else:
        pv_info = {}
    prov = df.attrs.get("provenance") or {c: {source: int(df[c].notna().sum())} for c in df.columns}

    full = pd.date_range(start, end, freq="1h", tz="UTC", inclusive="left")
    df = df.reindex(full)
    for c in COLUMNS_PRICE + COLUMNS_FUND:
        if c not in df:
            df[c] = float("nan")
    missing = [c for c in REQUIRED if df[c].isna().all()]
    if missing:
        raise RuntimeError(f"required series missing from {source}: {missing}. "
                           "Check the API or try --source both / entsoe / synthetic.")
    gaps = df[REQUIRED].isna().mean().round(4).to_dict()
    # short gaps: interpolate up to 6 h, then fill the rest by same hour previous/next week
    df = df.interpolate(limit=6, limit_area="inside")
    for c in df.columns:
        if df[c].isna().any():
            df[c] = df[c].fillna(df[c].shift(168)).fillna(df[c].shift(-168))
    for c in ["ch_wind", "fr_wind", "it_wind", "ch_pump"]:
        df[c] = df[c].fillna(0.0)
    df = add_fuel(df, fuel_csv)
    fuel_source = df.attrs.get("fuel_source")
    df = df.dropna(subset=REQUIRED)

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    df.to_parquet(HOURLY_PARQUET)
    meta = {
        "source": source,
        "synthetic": source == "synthetic",
        "start": start, "end": end, "rows": int(len(df)),
        "share_missing_before_fill": gaps,
        "provenance_hours": {c: v for c, v in prov.items() if c in REQUIRED + ["price_de", "price_fr", "price_it"]},
        "provenance_share": _share(prov),
        "fuel_source": fuel_source,
        "reservoir": reservoir_source,
        "pv_correction": pv_info.get("info"),
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    HOURLY_META.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"Saved {len(df):,} hours -> {HOURLY_PARQUET}")
    print("Data provenance (share of values per source):", meta["provenance_share"])
    for c in ["price_ch", "ch_load", "ch_solar", "ch_nuclear"]:
        print(f"  {c:<12} {prov.get(c)}")
    return df


def _reservoir_weekly(start: str, end: str) -> tuple[pd.Series | None, str | None]:
    """Weekly Swiss reservoir content (MWh). BFE CSV (from the PDF bulletins) first, ENTSO-E A72 second."""
    st = load_settings()["data"]
    f = resolve(st.get("reservoir_csv"))
    if f is not None and f.exists():
        d = pd.read_csv(f, parse_dates=["date"])
        # BFE values are Monday 00:00 local time
        s = pd.Series(d["total_gwh"].values * 1000.0, index=d["date"].dt.tz_localize("Europe/Zurich"))
        return s, f"BFE weekly bulletin (Monday 00:00), {f.name}"
    from .entsoe_source import fetch_reservoir

    try:
        return fetch_reservoir(start, end), "ENTSO-E A72 weekly aggregated filling"
    except Exception as e:  # noqa: BLE001
        print(f"  ! reservoir data skipped: {type(e).__name__}: {e}")
        return None, None


def _attach_reservoir(df: pd.DataFrame, start: str, end: str) -> pd.DataFrame:
    from . import reservoir

    weekly, src = _reservoir_weekly(start, end)
    if weekly is None or weekly.empty:
        return df
    df.attrs["reservoir_source"] = src
    out = df.copy()
    out[reservoir.COL] = reservoir.to_hourly(weekly, out.index).values
    out.attrs["reservoir_source"] = src
    return out


def refresh_reservoir() -> pd.DataFrame:
    """Download only the Swiss reservoir filling (ENTSO-E) and attach it to the existing dataset."""
    df, meta = load()
    df = _attach_reservoir(df.drop(columns=["ch_res_fill_twh"], errors="ignore"), meta["start"], meta["end"])
    if "ch_res_fill_twh" not in df:
        raise SystemExit("No reservoir data attached — run  python -m pfc2035 reservoir-pdf  or check the ENTSO-E token")
    meta["reservoir"] = df.attrs.get("reservoir_source")
    df.to_parquet(HOURLY_PARQUET)
    HOURLY_META.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    y = df.index.tz_convert("Europe/Zurich").year
    print("Reservoir filling attached (TWh): ")
    print(df.groupby(y)["ch_res_fill_twh"].agg(["mean", "min", "max"]).round(2).to_string())
    return df


def refresh_pv() -> pd.DataFrame:
    """Rescale Swiss solar to the official installed capacity (data/csv/pv_national.csv)."""
    from . import pv

    df, meta = load()
    df, c = pv.apply(df)
    if not c:
        raise SystemExit("data/csv/pv_national.csv not found")
    meta["pv_correction"] = {str(k): v for k, v in c["info"].items()}
    meta["pv_specific_yield_kwh_per_kwp"] = c["specific_yield_kwh_per_kwp"]
    df.to_parquet(HOURLY_PARQUET)
    HOURLY_META.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"Swiss PV rescaled to official capacity × {c['specific_yield_kwh_per_kwp']:.0f} kWh/kWp:")
    for y, i in c["info"].items():
        print(f"  {y}: {i}")
    return df


def refresh_fuel() -> pd.DataFrame:
    """Re-attach gas/CO₂ prices to the existing dataset (no new download)."""
    df, meta = load()
    st = load_settings()["data"]
    df = add_fuel(df.drop(columns=["gas_eur_mwh", "co2_eur_t"], errors="ignore"), resolve(st["fuel_prices_csv"]))
    meta["fuel_source"] = df.attrs.get("fuel_source")
    df.to_parquet(HOURLY_PARQUET)
    HOURLY_META.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    y = df.index.tz_convert("Europe/Zurich").year
    print(f"Fuel prices attached ({meta['fuel_source']}):")
    print(df.groupby(y)[["gas_eur_mwh", "co2_eur_t"]].mean().round(1).to_string())
    return df


def _share(prov: dict) -> dict:
    tot: dict[str, int] = {}
    for v in prov.values():
        for k, n in v.items():
            tot[k] = tot.get(k, 0) + n
    s = sum(tot.values()) or 1
    return {k: round(n / s, 3) for k, n in tot.items()}


def load() -> tuple[pd.DataFrame, dict]:
    if not HOURLY_PARQUET.exists():
        raise FileNotFoundError("No dataset yet — run:  python -m pfc2035 data")
    return pd.read_parquet(HOURLY_PARQUET), json.loads(HOURLY_META.read_text(encoding="utf-8"))
