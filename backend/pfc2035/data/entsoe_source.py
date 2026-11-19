"""ENTSO-E Transparency Platform via `entsoe-py` (optional).

Needs a free API token: register at https://transparency.entsoe.eu, then e-mail
transparency@entsoe.eu with subject "Restful API access". Put it in .env as ENTSOE_API_KEY=...
Data is fetched month by month (with retries) and cached per year as parquet under data/raw/entsoe/.
"""
from __future__ import annotations

import pandas as pd

from ..config import RAW_DIR, entsoe_key

CACHE = RAW_DIR / "entsoe"

PRICE_ZONES = {"price_ch": "CH", "price_de": "DE_LU", "price_fr": "FR", "price_it": "IT_NORD"}
LOAD_AREAS = {"ch": "CH", "de": "DE_LU", "fr": "FR", "it": "IT"}
GEN_MAP = {  # ENTSO-E psr name -> suffix
    "Solar": "solar",
    "Wind Onshore": "wind",
    "Wind Offshore": "wind",
    "Nuclear": "nuclear",
    "Hydro Run-of-river and poundage": "ror",
    "Hydro Water Reservoir": "reservoir",
}
WANTED = {
    "ch": ["solar", "wind", "nuclear", "ror", "reservoir"],
    "de": ["solar", "wind"],
    "fr": ["nuclear", "solar", "wind"],
    "it": ["solar", "wind"],
}


def _hourly(x) -> pd.Series | pd.DataFrame:
    x = x.tz_convert("UTC")
    return x.resample("1h").mean()


def _mask(msg: str) -> str:
    key = entsoe_key()
    return msg.replace(key, "***") if key else msg


def _call(fn, a, b, tries: int = 3):
    """One API call with retries (ENTSO-E answers 5xx/599 when busy or on large requests)."""
    import time

    from entsoe.exceptions import NoMatchingDataError

    for attempt in range(tries):
        try:
            out = fn(a, b)
            time.sleep(0.5)  # stay well below ENTSO-E's request limit
            return out
        except NoMatchingDataError:
            return None
        except Exception as e:  # noqa: BLE001
            if attempt == tries - 1:
                raise
            wait = 10 * 2 ** attempt  # 10, 20 s
            print(f"    retry in {wait}s ({type(e).__name__}: {_mask(str(e))[:120]})")
            time.sleep(wait)


_GIVE_UP: set[str] = set()


def _cached(name: str, fn, s0: pd.Timestamp, s1: pd.Timestamp):
    """Fetch [s0, s1) month by month (small requests avoid ENTSO-E paging errors), cache the result.

    The year is cached only if every month succeeded, so a re-run retries the failed parts.
    """
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / f"{name}.parquet"
    if f.exists():
        return pd.read_parquet(f)
    parts, failed, streak = [], 0, 0
    months = pd.date_range(s0, s1, freq="MS", inclusive="left").union([s0])
    for a in months:
        b = min(a + pd.offsets.MonthBegin(1), s1)
        if name.rsplit("_", 1)[0] in _GIVE_UP:
            failed += 1
            continue
        try:
            obj = _call(fn, a, b)
            streak = 0
        except Exception as e:  # noqa: BLE001 — keep going with partial data
            print(f"  ! ENTSO-E {name} {a:%Y-%m}: {type(e).__name__}: {_mask(str(e))[:160]}")
            failed += 1
            streak += 1
            if streak >= 2:
                print(f"  ! ENTSO-E {name}: giving up for this run (Energy-Charts will fill it)")
                _GIVE_UP.add(name.rsplit("_", 1)[0])  # skip this series in later years too
            continue
        if obj is not None and len(obj):
            parts.append(obj.to_frame("v") if isinstance(obj, pd.Series) else obj)
    if not parts:
        return None
    df = pd.concat(parts)
    df = df[~df.index.duplicated(keep="first")].sort_index()
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [" | ".join(map(str, c)) for c in df.columns]
    df.columns = [str(c) for c in df.columns]
    if failed == 0:
        df.to_parquet(f)
    else:
        print(f"  ! {name}: {failed} month(s) missing — not cached, re-run 'python -m pfc2035 data' to retry")
    return df


def check() -> None:
    """Test the token with one day of each request type and show ENTSO-E's raw answer on errors."""
    import requests

    key = entsoe_key()
    if not key:
        raise SystemExit("ENTSOE_API_KEY is not set in .env")
    from entsoe.entsoe import URL

    day = (pd.Timestamp.now(tz="UTC").normalize() - pd.Timedelta(days=3))
    p0, p1 = day.strftime("%Y%m%d0000"), (day + pd.Timedelta(days=1)).strftime("%Y%m%d0000")
    ch = "10YCH-SWISSGRIDZ"
    tests = {
        "prices (A44)": {"documentType": "A44", "in_Domain": ch, "out_Domain": ch},
        "load (A65)": {"documentType": "A65", "processType": "A16", "outBiddingZone_Domain": ch},
        "generation (A75)": {"documentType": "A75", "processType": "A16", "in_Domain": ch},
        "flows DE->CH (A11)": {"documentType": "A11", "in_Domain": ch, "out_Domain": "10Y1001A1001A82H"},
        "reservoir fill (A72)": {"documentType": "A72", "processType": "A16", "in_Domain": ch},
    }
    print(f"Endpoint {URL}, day {day:%Y-%m-%d}")
    for label, params in tests.items():
        try:
            q0 = (day - pd.Timedelta(days=21)).strftime("%Y%m%d0000") if params["documentType"] == "A72" else p0
            r = requests.get(URL, params={**params, "securityToken": key, "periodStart": q0, "periodEnd": p1}, timeout=60)
            body = r.text
            ok = r.status_code == 200 and "Acknowledgement_MarketDocument" not in body
            print(f"  {'OK ' if ok else 'ERR'} {label:<20} HTTP {r.status_code}, {len(body):,} bytes")
            if not ok:
                print("      " + _mask(body[:400]).replace("\n", " "))
        except requests.RequestException as e:
            print(f"  ERR {label:<20} {type(e).__name__}: {_mask(str(e))[:200]}")


def fetch_reservoir(start: str, end: str) -> pd.Series | None:
    """Swiss aggregated reservoir filling (A72), weekly MWh, cached per year."""
    key = entsoe_key()
    if not key:
        print("  (no ENTSOE_API_KEY -> no reservoir data)")
        return None
    from entsoe import EntsoePandasClient

    client = EntsoePandasClient(api_key=key)
    parts = []
    years = range(pd.Timestamp(start).year, (pd.Timestamp(end) - pd.Timedelta(seconds=1)).year + 1)
    for y in years:
        # start a week early so the first days of the year can be interpolated
        s0 = max(pd.Timestamp(start, tz="Europe/Zurich"), pd.Timestamp(f"{y}-01-01", tz="Europe/Zurich")) - pd.Timedelta(days=8)
        s1 = min(pd.Timestamp(end, tz="Europe/Zurich"), pd.Timestamp(f"{y + 1}-01-01", tz="Europe/Zurich")) + pd.Timedelta(days=8)
        df = _cached(f"ch_reservoir_{y}", lambda a, b: client.query_aggregate_water_reservoirs_and_hydro_storage("CH", start=a, end=b), s0, s1)
        if df is not None:
            parts.append(df.iloc[:, 0])
    if not parts:
        return None
    s = pd.concat(parts).sort_index()
    s = s[~s.index.duplicated(keep="last")]
    print(f"  reservoir filling CH: {len(s)} weekly values, {s.index[0]:%Y-%m-%d} .. {s.index[-1]:%Y-%m-%d}, "
          f"{s.min() / 1e6:.1f}–{s.max() / 1e6:.1f} TWh")
    return s


def fetch(start: str, end: str) -> pd.DataFrame:
    key = entsoe_key()
    if not key:
        raise RuntimeError("ENTSOE_API_KEY is not set (copy .env.example to .env and add your token).")
    from entsoe import EntsoePandasClient  # optional dependency

    client = EntsoePandasClient(api_key=key)
    print(f"ENTSO-E: {start} -> {end} (cached in {CACHE})")
    cols: dict[str, pd.Series] = {}
    years = range(pd.Timestamp(start).year, (pd.Timestamp(end) - pd.Timedelta(seconds=1)).year + 1)
    for y in years:
        s0 = max(pd.Timestamp(start, tz="Europe/Zurich"), pd.Timestamp(f"{y}-01-01", tz="Europe/Zurich"))
        s1 = min(pd.Timestamp(end, tz="Europe/Zurich"), pd.Timestamp(f"{y + 1}-01-01", tz="Europe/Zurich"))
        parts: dict[str, pd.Series] = {}
        for col, zone in PRICE_ZONES.items():
            df = _cached(f"{col}_{y}", lambda a, b, z=zone: client.query_day_ahead_prices(z, start=a, end=b), s0, s1)
            if df is not None:
                parts[col] = _hourly(df.iloc[:, 0])
        for c, area in LOAD_AREAS.items():
            df = _cached(f"{c}_load_{y}", lambda a, b, ar=area: client.query_load(ar, start=a, end=b), s0, s1)
            if df is not None:
                parts[f"{c}_load"] = _hourly(df.iloc[:, 0]) / 1000.0
            gen = _cached(f"{c}_gen_{y}", lambda a, b, ar=area: client.query_generation(ar, start=a, end=b, psr_type=None), s0, s1)
            if gen is not None:
                for colname in gen.columns:
                    base = colname.split(" | ")[0]
                    suffix = GEN_MAP.get(base)
                    if suffix not in WANTED[c] or "Consumption" in colname:
                        if c == "ch" and base == "Hydro Pumped Storage" and "Consumption" in colname:
                            parts["ch_pump"] = _hourly(gen[colname]).abs() / 1000.0
                        continue
                    s = _hourly(gen[colname]) / 1000.0
                    key_ = f"{c}_{suffix}"
                    parts[key_] = parts[key_].add(s, fill_value=0) if key_ in parts else s
        # Swiss net import = sum of physical flows into CH minus out of CH
        net = None
        for nb in ["DE_LU", "FR", "IT_NORD", "AT"]:
            fin = _cached(f"flow_{nb}_CH_{y}", lambda a, b, n=nb: client.query_crossborder_flows(n, "CH", start=a, end=b), s0, s1)
            fout = _cached(f"flow_CH_{nb}_{y}", lambda a, b, n=nb: client.query_crossborder_flows("CH", n, start=a, end=b), s0, s1)
            if fin is not None and fout is not None:
                d = (_hourly(fin.iloc[:, 0]) - _hourly(fout.iloc[:, 0])) / 1000.0
                net = d if net is None else net.add(d, fill_value=0)
        if net is not None:
            parts["ch_net_import"] = net
        for k, s in parts.items():
            cols.setdefault(k, []).append(s)
        print(f"  {y}: {sorted(parts)}")
    out = {k: pd.concat(v) for k, v in cols.items()}
    out = {k: s[~s.index.duplicated()] for k, s in out.items()}
    return pd.DataFrame(out)
